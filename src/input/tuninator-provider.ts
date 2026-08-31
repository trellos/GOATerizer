/**
 * The production guitar input path: Tuninator's streaming recognizer, wrapped.
 *
 * Only the library's public entry point is used — `createRecognizer` and
 * `RecognizerError` as values, everything else as types. GOATerizer implements
 * no pitch detection of its own and never reaches into `tuninator/src/**`.
 *
 * ## Why the timestamps are trustworthy
 *
 * Tuninator reports `SourceTimeMs`: milliseconds of *source audio* since the
 * first processed sample, derived from a sample count and nothing else. On its
 * own that is a clock the game cannot use. But `getTimebase().originContextTime`
 * is `AudioContext.currentTime` at source time 0, and the game hands the
 * recognizer the very AudioContext its transport runs on — so
 *
 *     contextTime = originContextTime + sourceMs / 1000
 *
 * is an exact conversion into transport space, not an estimate. A detected
 * attack therefore carries the audio-sample time of the attack itself, not the
 * time the answer was delivered. That distinction is the whole reason this game
 * can judge timing honestly, and it is why the adapter uses `note.startTime`
 * rather than "now" even when it has to wait for the pitch to settle.
 *
 * ## Why an attack can be emitted late but timed early
 *
 * `noteStarted` fires as soon as there is evidence something was played, which
 * can precede knowing *what*. When the pitch is not yet available the adapter
 * holds the note and emits the attack on the first change that supplies one,
 * still stamped with `note.startTime`. A later `pitchCorrection` becomes a
 * `retune` on the same id — never a second attack, so one played note is never
 * counted as two.
 */

import { createRecognizer, RecognizerError } from "tuninator";
import type {
  Note,
  NoteChange,
  PitchFrame,
  Recognizer,
  RecognizerState,
} from "tuninator";

import { MIN_ATTACK_CONFIDENCE } from "../config/tuning.js";
import {
  Emitter,
  type GuitarInputEvent,
  type GuitarInputProvider,
  type GuitarInputStatus,
  type Unsubscribe,
} from "./guitar-input.js";

export type TuninatorProviderOptions = {
  /** Shared with the transport and the bass. Never closed by the recognizer. */
  audioContext: AudioContext;
  /** URL of the built worklet asset; vite.config.ts puts it in public/assets. */
  workletUrl: string;
  /** `input.channels`, exposed for the debug panel's channel controls. */
  channels?: "auto" | "sum" | number;
  /**
   * Amplitude below which Tuninator treats the input as silence.
   *
   * Left undefined the library uses its own default, which assumes a hotter
   * input than a guitarist running an amp sim tends to. Measured per rig — see
   * `game/input-gate.ts` — and passed here so a quiet, clean signal is heard
   * without the player having to drive their interface into their amp sim.
   */
  rmsGate?: number;
};

/** Player-facing copy, per recognizer error code. Never euphemistic. */
const ERROR_COPY: Readonly<Record<string, string>> = {
  "mic-permission-denied":
    "Microphone access was denied. GOATerizer needs to hear the guitar; allow the mic and try again.",
  "mic-unavailable":
    "No usable microphone. Plug in an interface or check that nothing else has grabbed the input.",
  "audio-context-failed": "The browser refused to open an audio context.",
  "worklet-unavailable": "This browser has no AudioWorklet support, so Tuninator cannot run.",
  "worklet-load-failed":
    "Tuninator's worklet asset failed to load. Run `npm run setup:tuninator` so the build can copy it into public/assets.",
  "engine-load-failed": "Tuninator's engine worker failed to load.",
  "already-disposed": "This guitar input was already disposed.",
  unknown: "Guitar input failed for an unknown reason.",
};

const STATE_COPY: Readonly<Record<RecognizerState, string>> = {
  idle: "Guitar input is not running.",
  starting: "Opening the microphone…",
  listening: "Listening to your guitar.",
  stopping: "Stopping guitar input…",
  error: "Guitar input failed.",
};

/** What the adapter remembers about one in-flight Note. */
type TrackedNote = {
  /** Null until an attack has actually been emitted for this note. */
  emittedMidi: number | null;
  contextTime: number;
};

export class TuninatorGuitarInputProvider implements GuitarInputProvider {
  readonly kind = "tuninator" as const;

  readonly #options: TuninatorProviderOptions;
  readonly #events = new Emitter<GuitarInputEvent>();
  readonly #statusChanges = new Emitter<GuitarInputStatus>();
  readonly #tracked = new Map<string, TrackedNote>();
  #unsubscribes: Unsubscribe[] = [];
  #recognizer: Recognizer | null = null;
  #status: GuitarInputStatus = {
    kind: "tuninator",
    state: "idle",
    message: STATE_COPY.idle,
  };

  constructor(options: TuninatorProviderOptions) {
    this.#options = options;
  }

  getStatus(): GuitarInputStatus {
    return this.#status;
  }

  onEvent(handler: (event: GuitarInputEvent) => void): Unsubscribe {
    return this.#events.on(handler);
  }

  onStatusChange(handler: (status: GuitarInputStatus) => void): Unsubscribe {
    return this.#statusChanges.on(handler);
  }

  async start(): Promise<void> {
    if (this.#recognizer) return;

    this.#setStatus({ state: "starting", message: STATE_COPY.starting });

    const recognizer = createRecognizer({
      audioContext: this.#options.audioContext,
      workletUrl: this.#options.workletUrl,
      input: {
        // Guitar, not speech: the browser's speech processors chew holes in a
        // sustained note. Tuninator defaults these off; being explicit keeps
        // the intent visible at the call site.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channels: this.#options.channels ?? "auto",
      },
      // Only sent when the player has actually measured their rig; otherwise
      // the object is omitted entirely and Tuninator's defaults stand.
      ...(this.#options.rmsGate !== undefined
        ? { engine: { rmsGate: this.#options.rmsGate } }
        : {}),
      diagnostics: {
        // The tuner readout and the "is the guitar actually being heard" meter
        // both need the continuous stream.
        pitchFrames: true,
        // Recorded so a future bend target has a trajectory to grade. Rocky
        // Ascent does not read it; the note model keeps it anyway.
        contour: true,
      },
    });
    this.#recognizer = recognizer;
    this.#subscribe(recognizer);

    try {
      await recognizer.start();
    } catch (error) {
      const code = error instanceof RecognizerError ? error.code : "unknown";
      this.#setStatus({
        state: "error",
        message: ERROR_COPY[code] ?? ERROR_COPY["unknown"]!,
        errorCode: code,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    const recognizer = this.#recognizer;
    if (!recognizer) return;
    await recognizer.stop();
    this.#tracked.clear();
  }

  async dispose(): Promise<void> {
    const recognizer = this.#recognizer;
    this.#recognizer = null;
    for (const off of this.#unsubscribes) off();
    this.#unsubscribes = [];
    this.#tracked.clear();
    if (recognizer) {
      try {
        await recognizer.dispose();
      } catch {
        // Disposing twice is not an error worth surfacing to a player.
      }
    }
    this.#events.clear();
    this.#setStatus({ state: "idle", message: STATE_COPY.idle });
    this.#statusChanges.clear();
  }

  /* ------------------------------------------------------------------ */

  #subscribe(recognizer: Recognizer): void {
    this.#unsubscribes.push(
      recognizer.on("stateChange", (state) => {
        if (state === "error") return; // the error handler has better copy
        this.#setStatus({ state, message: STATE_COPY[state] });
      }),
      recognizer.on("error", (error) => {
        const code = String((error as { code?: unknown }).code ?? "unknown");
        this.#setStatus({
          state: "error",
          message: ERROR_COPY[code] ?? error.message,
          errorCode: code,
        });
      }),
      recognizer.on("pitchFrame", (frame) => this.#onFrame(frame)),
      recognizer.on("noteStarted", (note) => this.#onNoteEvidence(note)),
      recognizer.on("noteChanged", (note, change) => this.#onNoteEvidence(note, change)),
      recognizer.on("noteResolved", (note) => this.#onNoteEvidence(note)),
      recognizer.on("noteEnded", (note) => this.#onNoteEnded(note))
    );
  }

  /**
   * Source time -> audio-clock seconds.
   *
   * Exact whenever the recognizer has published a timebase, which it does once
   * `start()` resolves. Before that there is nothing to convert against and the
   * current clock is the only honest answer.
   */
  #toContextTime(sourceMs: number): number {
    const timebase = this.#recognizer?.getTimebase();
    if (timebase?.originContextTime !== undefined) {
      return timebase.originContextTime + sourceMs / 1000;
    }
    return this.#options.audioContext.currentTime;
  }

  #onFrame(frame: PitchFrame): void {
    this.#setStatus({
      frame: {
        frequencyHz: frame.frequencyHz,
        confidence: frame.confidence,
        rms: frame.amplitude.rms,
        ...(frame.channelRms ? { channelRms: frame.channelRms } : {}),
        ...(frame.selectedChannel !== undefined
          ? { selectedChannel: frame.selectedChannel }
          : {}),
      },
    });
  }

  /**
   * One handler for `noteStarted`, `noteChanged` and `noteResolved`, because
   * the question at each of them is the same: do we know enough to announce
   * this note yet, and has the answer changed since we announced it?
   */
  #onNoteEvidence(note: Note, change?: NoteChange): void {
    const pitch = note.pitch.current;
    const midi = pitch?.midi;
    const tracked = this.#tracked.get(note.id);

    if (midi === undefined) {
      // Evidence of *something*, no pitch yet. Remember the onset so the
      // eventual attack is stamped with it rather than with delivery time.
      if (!tracked) {
        this.#tracked.set(note.id, {
          emittedMidi: null,
          contextTime: this.#toContextTime(note.startTime),
        });
      }
      return;
    }

    if (note.confidence < MIN_ATTACK_CONFIDENCE) return;

    const contextTime = tracked?.contextTime ?? this.#toContextTime(note.startTime);
    const rounded = Math.round(midi);

    if (!tracked || tracked.emittedMidi === null) {
      this.#tracked.set(note.id, { emittedMidi: rounded, contextTime });
      this.#events.emit({
        type: "attack",
        id: note.id,
        midi: rounded,
        frequencyHz: pitch?.frequencyHz ?? note.pitch.currentFrequencyHz ?? 0,
        confidence: note.confidence,
        contextTime,
      });
      return;
    }

    if (tracked.emittedMidi !== rounded) {
      // The recognizer revised the answer. Same played note, better label.
      tracked.emittedMidi = rounded;
      this.#events.emit({
        type: "retune",
        id: note.id,
        midi: rounded,
        frequencyHz: pitch?.frequencyHz ?? note.pitch.currentFrequencyHz ?? 0,
        confidence: note.confidence,
        contextTime,
      });
      return;
    }

    // Same note, same pitch: a continuous update. Only worth forwarding when it
    // carries something continuous — otherwise it is per-frame noise.
    const bendCents = note.bend?.active ? note.bend.amountCents : 0;
    if (bendCents !== 0 || change?.type === "pitchMovement" || change?.type === "bendUpdate") {
      this.#events.emit({
        type: "sustain",
        id: note.id,
        midi: rounded,
        frequencyHz: pitch?.frequencyHz ?? note.pitch.currentFrequencyHz ?? 0,
        bendCents,
        // `change.at` is when the *evidence* is from, which is what a bend
        // trajectory has to be stamped with; it can precede delivery.
        contextTime: this.#toContextTime(change?.at ?? note.startTime),
      });
    }
  }

  #onNoteEnded(note: Note): void {
    const tracked = this.#tracked.get(note.id);
    this.#tracked.delete(note.id);
    if (!tracked || tracked.emittedMidi === null) return;
    this.#events.emit({
      type: "release",
      id: note.id,
      contextTime: this.#toContextTime(note.endTime ?? note.startTime),
    });
  }

  #setStatus(patch: Partial<GuitarInputStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.#statusChanges.emit(this.#status);
  }
}
