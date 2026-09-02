/**
 * A synthetic "microphone" for exercising the real Tuninator pipeline without
 * a real microphone.
 *
 * `?dev=1&input=synth` exists for one specific gap: the sandboxed browser this
 * game gets developed and calibrated in cannot grant microphone access at
 * all, so `TuninatorGuitarInputProvider` — the actual production path,
 * onset/pitch detection and all — never receives a single sample there. The
 * deterministic `TestGuitarInputProvider` (`?dev=1&input=test`) does not fill
 * that gap: it injects already-judged note events directly and never touches
 * audio, which is exactly right for testing game logic and exactly wrong for
 * testing detection latency, confidence gating, or the timing-compensation
 * chain this session exists to calibrate.
 *
 * This fills the actual gap instead of the adjacent one: it monkey-patches
 * `navigator.mediaDevices.getUserMedia` — a standard browser API, not a
 * Tuninator one — so that when Tuninator's real recognizer asks for the
 * microphone, it receives a `MediaStream` backed by a sine oscillator this
 * class controls, plucked with a short attack envelope so the recognizer has
 * a real onset transient to detect. Nothing in `TuninatorGuitarInputProvider`
 * or Tuninator changes, and nothing about either invents an API neither
 * actually has (`AGENTS.md` §4).
 *
 * Dev-only, and loud about it (`AGENTS.md` §13): the game state this produces
 * still reports `kind: "tuninator"`, since as far as the adapter can tell it
 * is one — `game-app.ts` tracks installation separately so the "not a real
 * guitar" banner stays honest anyway.
 */

import { PluckVoicePool } from "./pluck-voices.js";

export class SyntheticGuitarSource {
  readonly #context: AudioContext;
  readonly #destination: MediaStreamAudioDestinationNode;
  readonly #voices: PluckVoicePool;
  #originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;

  constructor(context: AudioContext) {
    this.#context = context;
    this.#destination = context.createMediaStreamDestination();
    this.#voices = new PluckVoicePool(context, this.#destination);
  }

  /** Patches `getUserMedia` so the next provider `start()` receives this stream. */
  install(): void {
    if (this.#originalGetUserMedia) return;
    const media = navigator.mediaDevices;
    this.#originalGetUserMedia = media.getUserMedia.bind(media);
    media.getUserMedia = async () => this.#destination.stream;
  }

  /** Restores the real `getUserMedia`. Always called before a genuine mic attempt. */
  uninstall(): void {
    if (!this.#originalGetUserMedia) return;
    navigator.mediaDevices.getUserMedia = this.#originalGetUserMedia;
    this.#originalGetUserMedia = null;
  }

  get installed(): boolean {
    return this.#originalGetUserMedia !== null;
  }

  /**
   * Plucks one note: a sine tone at `midi`, starting at `atContextTime`, with a
   * fast rise, a decay to a definite floor, and then a short linear release to
   * true silence. Sine only — this exists to hand the recognizer one clean,
   * unambiguous fundamental, not to sound like a guitar.
   *
   * The release is set against Tuninator's own thresholds rather than chosen by
   * ear. The previous envelope ramped exponentially towards 0.0001 across the
   * whole note, which is asymptotically flat: no moment in it reads as "the
   * note stopped", so the recognizer's note end had no fixed relationship to
   * the requested duration. Decaying to a definite floor and then ramping
   * linearly to true zero makes the note-off a locatable event; the caller
   * leaves enough silence after it (`AUTOPLAY_PLUCK_GAP_SECONDS`, above
   * Tuninator's `tracking.releaseGraceMs`) for the recognizer to act on it.
   *
   * Measured rather than assumed, on a flawless autoplay through the real
   * recognizer: both envelopes end every note (the dev panel's `unreleased
   * played` stays at 0 either way — the played bars that never stopped came
   * from the injected path, which used to schedule no `release` at all, not
   * from here). What this shape buys is fewer spurious onsets: 1 stray
   * detection across three runs against 3 for the old curve. A small sample, so
   * the claim is "no worse, probably better", not a fix.
   *
   * `soundingSeconds` is the body, *excluding* the release ramp. The envelope
   * itself lives in `PluckVoicePool`, shared with `AutoplayMonitor`.
   */
  pluck(midi: number, atContextTime: number, soundingSeconds: number): void {
    this.#voices.pluck(midi, atContextTime, soundingSeconds);
  }

  /**
   * Silences everything from `contextTime` onwards.
   *
   * Autoplay schedules a whole attempt ahead, so "Stop autoplay" has to be able
   * to un-schedule plucks already committed to the audio graph — without this,
   * turning autoplay off would keep playing for up to four measures.
   */
  cancelFrom(contextTime: number): void {
    this.#voices.cancelFrom(contextTime);
  }

  dispose(): void {
    this.uninstall();
    this.#voices.dispose();
    this.#destination.disconnect();
  }
}
