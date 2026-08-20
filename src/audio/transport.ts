/**
 * The musical transport — the one authoritative clock in GOATerizer.
 *
 * Everything musical reads from here: bass scheduling, target-note position,
 * the strike line, judgment windows, measure boundaries, minigame completion
 * and the one-beat scenario transition. Nothing chains `setTimeout` to decide
 * *when* something happens; timers only decide when to *look*.
 *
 * Position is derived, never accumulated. One anchor `(contextTime, beat, bpm)`
 * plus a linear map means there is no per-frame error to accumulate, and a
 * tempo change is exact rather than approximate:
 *
 *     beat(t) = anchorBeat + (t - anchorTime) * bpm / 60
 *
 * Re-anchoring at the current beat on every tempo change is what keeps the
 * phase — the player's place in the four-measure loop — across a tempo switch
 * or a key reroll. The beat never restarts, which is what "the beat does not
 * stop between minigames" (GDD §10) actually requires.
 *
 * The time source is injected, so the whole class is testable without an
 * AudioContext. In the browser it is `() => audioContext.currentTime`.
 */

import { BEATS_PER_MEASURE } from "../config/tuning.js";

export type TimeSource = () => number;

type Anchor = {
  /** Audio-clock time, in seconds, at which the transport was at `beat`. */
  contextTime: number;
  beat: number;
  bpm: number;
};

export class Transport {
  readonly #now: TimeSource;
  #anchor: Anchor | null = null;

  constructor(now: TimeSource) {
    this.#now = now;
  }

  get running(): boolean {
    return this.#anchor !== null;
  }

  get bpm(): number {
    return this.#anchor?.bpm ?? 0;
  }

  /** Seconds per beat at the current tempo. */
  get secondsPerBeat(): number {
    return 60 / (this.#anchor?.bpm ?? 1);
  }

  /**
   * Starts the clock at beat 0. Calling this on a running transport is a
   * programming error: the beat is supposed to survive everything except a
   * page load.
   */
  start(bpm: number, atContextTime = this.#now()): void {
    if (this.#anchor) throw new Error("Transport is already running; use setBpm()");
    this.#anchor = { contextTime: atContextTime, beat: 0, bpm };
  }

  /** Releases the clock. Only the app teardown path should call this. */
  stop(): void {
    this.#anchor = null;
  }

  /**
   * Changes tempo while preserving the current beat position exactly.
   *
   * Re-anchoring at "the beat we are on right now" is the whole trick: the
   * player's position in the bass loop is unchanged, so the loop does not jump
   * and does not restart at beat 1.
   */
  setBpm(bpm: number, atContextTime = this.#now()): void {
    this.#requireAnchor();
    this.#anchor = {
      contextTime: atContextTime,
      beat: this.beatAt(atContextTime),
      bpm,
    };
  }

  /** Continuous beats since `start()`. Fractional. */
  beatAt(contextTime: number): number {
    const anchor = this.#requireAnchor();
    return anchor.beat + ((contextTime - anchor.contextTime) * anchor.bpm) / 60;
  }

  /** Inverse of {@link beatAt}: when a given beat happens on the audio clock. */
  contextTimeAt(beat: number): number {
    const anchor = this.#requireAnchor();
    return anchor.contextTime + ((beat - anchor.beat) * 60) / anchor.bpm;
  }

  get beat(): number {
    return this.beatAt(this.#now());
  }

  get contextTime(): number {
    return this.#now();
  }

  /** 0-based measure index since `start()`. */
  get measure(): number {
    return Math.floor(this.beat / BEATS_PER_MEASURE);
  }

  /** 0-based position inside the current measure, fractional. */
  get beatInMeasure(): number {
    const beat = this.beat;
    return beat - Math.floor(beat / BEATS_PER_MEASURE) * BEATS_PER_MEASURE;
  }

  /** The next measure boundary at or after `beat`, in absolute beats. */
  nextMeasureBoundary(beat = this.beat): number {
    // `+ 0` normalises the -0 that Math.ceil produces at exactly beat 0.
    return Math.ceil(beat / BEATS_PER_MEASURE - 1e-9) * BEATS_PER_MEASURE + 0;
  }

  #requireAnchor(): Anchor {
    if (!this.#anchor) throw new Error("Transport is not running");
    return this.#anchor;
  }
}
