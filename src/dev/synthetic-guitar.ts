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

import {
  AUTOPLAY_PLUCK_ATTACK_SECONDS,
  AUTOPLAY_PLUCK_BODY_FLOOR_GAIN,
  AUTOPLAY_PLUCK_PEAK_GAIN,
  AUTOPLAY_PLUCK_RELEASE_SECONDS,
} from "../config/tuning.js";
import { midiToFrequency } from "../music/pitch.js";

/** One scheduled pluck, kept so it can be silenced before it sounds. */
type ScheduledVoice = {
  startTime: number;
  endTime: number;
  osc: OscillatorNode;
  gain: GainNode;
};

const EPSILON_GAIN = 0.0001;

export class SyntheticGuitarSource {
  readonly #context: AudioContext;
  readonly #destination: MediaStreamAudioDestinationNode;
  #originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
  #voices: ScheduledVoice[] = [];

  constructor(context: AudioContext) {
    this.#context = context;
    this.#destination = context.createMediaStreamDestination();
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
   * `soundingSeconds` is the body, *excluding* the release ramp.
   */
  pluck(midi: number, atContextTime: number, soundingSeconds: number): void {
    const osc = this.#context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(midiToFrequency(midi), atContextTime);

    const bodyEnd = atContextTime + Math.max(AUTOPLAY_PLUCK_ATTACK_SECONDS * 2, soundingSeconds);
    const silentAt = bodyEnd + AUTOPLAY_PLUCK_RELEASE_SECONDS;

    const gain = this.#context.createGain();
    gain.gain.setValueAtTime(EPSILON_GAIN, atContextTime);
    gain.gain.exponentialRampToValueAtTime(
      AUTOPLAY_PLUCK_PEAK_GAIN,
      atContextTime + AUTOPLAY_PLUCK_ATTACK_SECONDS
    );
    gain.gain.exponentialRampToValueAtTime(AUTOPLAY_PLUCK_BODY_FLOOR_GAIN, bodyEnd);
    // Linear, and all the way to zero: an exponential ramp cannot reach 0, and
    // "asymptotically quiet" is exactly the failure this replaces.
    gain.gain.linearRampToValueAtTime(0, silentAt);

    osc.connect(gain);
    gain.connect(this.#destination);
    osc.start(atContextTime);
    osc.stop(silentAt + 0.005);

    const voice: ScheduledVoice = { startTime: atContextTime, endTime: silentAt, osc, gain };
    osc.onended = () => {
      gain.disconnect();
      this.#voices = this.#voices.filter((entry) => entry !== voice);
    };
    this.#voices.push(voice);
  }

  /**
   * Silences everything from `contextTime` onwards.
   *
   * Autoplay schedules a whole attempt ahead, so "Stop autoplay" has to be able
   * to un-schedule plucks already committed to the audio graph — without this,
   * turning autoplay off would keep playing for up to four measures. A voice
   * that has not started is stopped outright; one that is already sounding is
   * released rather than cut, so the recognizer still sees a note end rather
   * than a click.
   */
  cancelFrom(contextTime: number): void {
    for (const voice of this.#voices) {
      if (voice.endTime <= contextTime) continue;
      try {
        if (voice.startTime >= contextTime) {
          voice.osc.stop(contextTime);
        } else {
          voice.gain.gain.cancelScheduledValues(contextTime);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, contextTime);
          voice.gain.gain.linearRampToValueAtTime(0, contextTime + AUTOPLAY_PLUCK_RELEASE_SECONDS);
          voice.osc.stop(contextTime + AUTOPLAY_PLUCK_RELEASE_SECONDS + 0.005);
        }
      } catch {
        // Already stopped; nothing to do.
      }
    }
  }

  dispose(): void {
    this.uninstall();
    this.cancelFrom(this.#context.currentTime);
    this.#voices = [];
    this.#destination.disconnect();
  }
}
