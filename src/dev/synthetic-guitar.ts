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

import { midiToFrequency } from "../music/pitch.js";

export class SyntheticGuitarSource {
  readonly #context: AudioContext;
  readonly #destination: MediaStreamAudioDestinationNode;
  #originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;

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
   * Plucks one note: a sine tone at `midi`, starting at `atContextTime`, with
   * a fast rise and an exponential decay so the recognizer sees a bounded
   * attack rather than a tone that is already sounding. Sine only — this
   * exists to hand the recognizer one clean, unambiguous fundamental, not to
   * sound like a guitar.
   */
  pluck(midi: number, atContextTime: number, durationSeconds: number): void {
    const osc = this.#context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(midiToFrequency(midi), atContextTime);

    const stopTime = atContextTime + durationSeconds;
    const gain = this.#context.createGain();
    gain.gain.setValueAtTime(0.0001, atContextTime);
    gain.gain.exponentialRampToValueAtTime(0.5, atContextTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(gain);
    gain.connect(this.#destination);
    osc.start(atContextTime);
    osc.stop(stopTime + 0.05);
  }

  dispose(): void {
    this.uninstall();
    this.#destination.disconnect();
  }
}
