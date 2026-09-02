/**
 * The pluck envelope shared by every dev-only sine voice: a fast attack, decay
 * to a definite floor, then a linear ramp to true silence. See
 * `AUTOPLAY_PLUCK_*` in `src/config/tuning.ts` for why the shape looks like
 * this — it is set against Tuninator's own note-tracking thresholds, not
 * chosen by ear.
 *
 * Two callers use it for opposite reasons: `SyntheticGuitarSource` plucks into
 * a mocked microphone so the real recognizer can find the note, and is never
 * meant to reach the speakers; `AutoplayMonitor` plucks into the game's
 * audible mix so the *player* can hear what autoplay is doing, and never
 * reaches Tuninator. Sharing this keeps both honest about note-off timing
 * without coupling either to the other's destination.
 */

import {
  AUTOPLAY_PLUCK_ATTACK_SECONDS,
  AUTOPLAY_PLUCK_BODY_FLOOR_GAIN,
  AUTOPLAY_PLUCK_PEAK_GAIN,
  AUTOPLAY_PLUCK_RELEASE_SECONDS,
} from "../config/tuning.js";
import { midiToFrequency } from "../music/pitch.js";

/** One scheduled pluck, kept so it can be silenced before it sounds. */
type PluckVoice = {
  startTime: number;
  endTime: number;
  osc: OscillatorNode;
  gain: GainNode;
};

const EPSILON_GAIN = 0.0001;

/** Tracks the voices it schedules onto one destination, so they can be cut off. */
export class PluckVoicePool {
  readonly #context: BaseAudioContext;
  readonly #destination: AudioNode;
  #voices: PluckVoice[] = [];

  constructor(context: BaseAudioContext, destination: AudioNode) {
    this.#context = context;
    this.#destination = destination;
  }

  /**
   * Plucks one note: a sine tone at `midi`, starting at `atContextTime`, with a
   * fast rise, a decay to a definite floor, and then a short linear release to
   * true silence. `soundingSeconds` is the body, *excluding* the release ramp.
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

    const voice: PluckVoice = { startTime: atContextTime, endTime: silentAt, osc, gain };
    osc.onended = () => {
      gain.disconnect();
      this.#voices = this.#voices.filter((entry) => entry !== voice);
    };
    this.#voices.push(voice);
  }

  /**
   * Silences everything from `contextTime` onwards. A voice that has not
   * started is stopped outright; one that is already sounding is released
   * rather than cut, so a listener still hears a note end rather than a click.
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
    this.cancelFrom(this.#context.currentTime);
    this.#voices = [];
  }
}
