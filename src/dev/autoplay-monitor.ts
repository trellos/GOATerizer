/**
 * Makes autoplay audible to whoever is watching the dev panel.
 *
 * Dev-only, like everything else under `src/dev`. Neither existing sink is
 * audible on its own: `TestGuitarInputProvider` never touches audio at all —
 * it hands the judge already-decided events — and `SyntheticGuitarSource`
 * plucks into a *mocked microphone* so the real recognizer can hear it,
 * connected to a `MediaStreamAudioDestinationNode` that never reaches the
 * speakers. Either way, a developer watching `?dev=1&autoplay=50` has no way
 * to tell what it actually played except by reading the timeline.
 *
 * This is a third, independent voice that plucks the exact same gestures into
 * the game's own audible mix (`AudioEngine.master`, alongside the bass and
 * drums), purely so autoplay can be heard. It never touches `getUserMedia`
 * and Tuninator never sees it, so whichever sink (`synth` or `test`) is
 * actually driving judgment is unaffected — this only adds a second, purely
 * audible performance of the same gestures.
 */

import { AUTOPLAY_MONITOR_GAIN } from "../config/tuning.js";
import { PluckVoicePool } from "./pluck-voices.js";

export class AutoplayMonitor {
  readonly #gain: GainNode;
  readonly #voices: PluckVoicePool;

  constructor(context: AudioContext, destination: AudioNode) {
    this.#gain = context.createGain();
    this.#gain.gain.value = AUTOPLAY_MONITOR_GAIN;
    this.#gain.connect(destination);
    this.#voices = new PluckVoicePool(context, this.#gain);
  }

  /** Same envelope and note-off behaviour as `SyntheticGuitarSource.pluck`. */
  pluck(midi: number, atContextTime: number, soundingSeconds: number): void {
    this.#voices.pluck(midi, atContextTime, soundingSeconds);
  }

  /** Silences everything from `contextTime` onwards. See `SyntheticGuitarSource.cancelFrom`. */
  cancelFrom(contextTime: number): void {
    this.#voices.cancelFrom(contextTime);
  }

  dispose(): void {
    this.#voices.dispose();
    this.#gain.disconnect();
  }
}
