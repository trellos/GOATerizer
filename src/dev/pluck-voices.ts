/**
 * The pluck envelope shared by every dev-only voice: a fast attack, decay to a
 * definite floor, then a linear ramp to true silence. See `AUTOPLAY_PLUCK_*` in
 * `src/config/tuning.ts` for why the shape looks like this — it is set against
 * Tuninator's own note-tracking thresholds, not chosen by ear.
 *
 * Two callers use it for opposite reasons, and the difference decides the
 * **timbre**:
 *
 *   - `SyntheticGuitarSource` plucks into a mocked microphone so the real
 *     recognizer can find the note, and is never meant to reach the speakers.
 *     It uses `"sine"`: one partial, nothing for a pitch detector to disagree
 *     with, and the tone every assertion about the synthetic path was written
 *     against.
 *   - `AutoplayMonitor` and the minigame editor pluck into the game's audible
 *     mix so a *person* can hear what is being played, and Tuninator never sees
 *     them. They use `"pluck"`, because a sine is the hardest thing there is to
 *     hear in a mix: all of its energy is at the fundamental, and at the bottom
 *     of the guitar's register that is 130-260Hz, which is where a drum kit
 *     already lives and where a laptop speaker gives up. Harmonics are what
 *     make a note audible on a small speaker, so this one has some.
 *
 * Sharing the envelope keeps both honest about note-off timing without coupling
 * either to the other's destination.
 */

import {
  AUTOPLAY_PLUCK_ATTACK_SECONDS,
  AUTOPLAY_PLUCK_BODY_FLOOR_GAIN,
  AUTOPLAY_PLUCK_PEAK_GAIN,
  AUTOPLAY_PLUCK_RELEASE_SECONDS,
} from "../config/tuning.js";
import { midiToFrequency } from "../music/pitch.js";

/** What a voice is made of. See the header: the choice is about who listens. */
export type PluckTimbre = "sine" | "pluck";

/**
 * The partials of the audible voice: harmonic number and relative level.
 *
 * A triangle fundamental rather than a sine — it already carries a little of
 * the third and fifth harmonic — plus an octave and a twelfth above it, which
 * are the partials a plucked string is loudest in and the ones a small speaker
 * actually reproduces. The levels sum to about 1, so the voice peaks where a
 * single sine at {@link AUTOPLAY_PLUCK_PEAK_GAIN} did and the master bus sees
 * the same ceiling: this is a change of tone, not a change of level.
 */
const PLUCK_PARTIALS: readonly { harmonic: number; level: number; type: OscillatorType }[] = [
  { harmonic: 1, level: 0.6, type: "triangle" },
  { harmonic: 2, level: 0.28, type: "sine" },
  { harmonic: 3, level: 0.12, type: "sine" },
];

/** One scheduled pluck, kept so it can be silenced before it sounds. */
type PluckVoice = {
  startTime: number;
  endTime: number;
  oscs: OscillatorNode[];
  gain: GainNode;
};

const EPSILON_GAIN = 0.0001;

/** Tracks the voices it schedules onto one destination, so they can be cut off. */
export class PluckVoicePool {
  readonly #context: BaseAudioContext;
  readonly #destination: AudioNode;
  readonly #timbre: PluckTimbre;
  #voices: PluckVoice[] = [];

  constructor(context: BaseAudioContext, destination: AudioNode, timbre: PluckTimbre = "sine") {
    this.#context = context;
    this.#destination = destination;
    this.#timbre = timbre;
  }

  /**
   * Plucks one note at `midi`, starting at `atContextTime`, with a fast rise, a
   * decay to a definite floor, and then a short linear release to true silence.
   * `soundingSeconds` is the body, *excluding* the release ramp.
   */
  pluck(midi: number, atContextTime: number, soundingSeconds: number): void {
    const frequency = midiToFrequency(midi);
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
    gain.connect(this.#destination);

    const partials =
      this.#timbre === "sine"
        ? [{ harmonic: 1, level: 1, type: "sine" as OscillatorType }]
        : PLUCK_PARTIALS;

    const oscs: OscillatorNode[] = [];
    for (const partial of partials) {
      const osc = this.#context.createOscillator();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(frequency * partial.harmonic, atContextTime);
      if (partial.level === 1) {
        osc.connect(gain);
      } else {
        const level = this.#context.createGain();
        level.gain.value = partial.level;
        osc.connect(level);
        level.connect(gain);
      }
      osc.start(atContextTime);
      osc.stop(silentAt + 0.005);
      oscs.push(osc);
    }

    const voice: PluckVoice = { startTime: atContextTime, endTime: silentAt, oscs, gain };
    // The lowest partial always outlives the others, so one `onended` retires
    // the whole voice.
    (oscs[0] as OscillatorNode).onended = () => {
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
          for (const osc of voice.oscs) osc.stop(contextTime);
        } else {
          voice.gain.gain.cancelScheduledValues(contextTime);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, contextTime);
          voice.gain.gain.linearRampToValueAtTime(0, contextTime + AUTOPLAY_PLUCK_RELEASE_SECONDS);
          for (const osc of voice.oscs) {
            osc.stop(contextTime + AUTOPLAY_PLUCK_RELEASE_SECONDS + 0.005);
          }
        }
      } catch {
        // Already stopped; nothing to do.
      }
    }
  }

  /**
   * Drops everything queued but not yet begun, leaving sounding notes to ring.
   *
   * What re-programming a running loop needs, and the difference from
   * {@link cancelFrom} is the whole point: the note under the player's ear when
   * they moved a bar somewhere else is not the note they edited, and cutting it
   * short is an artefact they would hear on every edit.
   */
  dropUnstarted(contextTime: number): void {
    for (const voice of this.#voices) {
      if (voice.startTime < contextTime) continue;
      try {
        for (const osc of voice.oscs) osc.stop(contextTime);
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
