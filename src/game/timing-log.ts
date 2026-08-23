/**
 * A running record of how early or late the player actually is.
 *
 * This exists to calibrate `EXTRA_INPUT_LATENCY_MS` against a real rig. The
 * judgment layer already computes a signed delta for every note it resolves;
 * without somewhere to accumulate it, calibration means watching a number
 * flicker past once per note and guessing at the average, which is exactly how
 * you end up compensating for one badly-timed note.
 *
 * **Sign convention, everywhere: positive is late.** A delta is
 * `playedBeat - targetBeat`, so a positive value means the note landed after
 * the beat, and the compensation that cancels it is a positive latency trim
 * (`src/config/tuning.ts`: a positive trim judges the player as having played
 * earlier than the raw timestamp says). That makes the correction additive —
 * see {@link TimingDeltaLog.suggestedTrimMs}.
 *
 * Robust statistics rather than a mean: a player calibrating will fumble a note
 * or two, and one note half a beat out would drag a mean far enough to make the
 * suggestion useless. The median ignores it, and the median absolute deviation
 * says how tightly the rest cluster — which is the real signal for whether a
 * bias has been found or the samples are just noise.
 */

/** How many recent notes the bias is computed over. */
const DEFAULT_CAPACITY = 64;

/**
 * How far a note landed from the nearest beat, in milliseconds, positive late.
 *
 * This is the pregame calibration's measurement: there are no targets there, so
 * the reference is the beat grid the player is hearing from the drums.
 *
 * **It can only see an offset up to half a beat.** Past that, the nearest beat
 * is the *next* one and the error folds over — a note 0.6 beats late measures as
 * 0.4 beats early. At 90bpm that ceiling is ±333ms, which covers everything
 * short of a badly-paired Bluetooth speaker; the slowest tempo gives ±500ms. A
 * rig worse than that has to be calibrated at a slower tempo, and the fold-over
 * is why the caller should treat a sign flip between samples as noise rather
 * than as a player who cannot keep time.
 */
export function offBeatMs(beat: number, secondsPerBeat: number): number {
  return (beat - Math.round(beat)) * secondsPerBeat * 1000;
}

export class TimingDeltaLog {
  readonly #capacity: number;
  #samples: number[] = [];

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.#capacity = Math.max(1, capacity);
  }

  /** Records one judged note. `milliseconds` is positive for late. */
  record(milliseconds: number): void {
    if (!Number.isFinite(milliseconds)) return;
    this.#samples.push(milliseconds);
    if (this.#samples.length > this.#capacity) this.#samples.shift();
  }

  /**
   * Discards every sample.
   *
   * Must be called whenever the latency compensation changes: samples measured
   * under the old trim describe a rig that no longer exists, and averaging them
   * with the new ones hides the very change being tested.
   */
  clear(): void {
    this.#samples = [];
  }

  get count(): number {
    return this.#samples.length;
  }

  get last(): number | null {
    return this.#samples.length ? this.#samples[this.#samples.length - 1]! : null;
  }

  /** Typical signed offset, in ms. Positive is late. */
  get median(): number | null {
    return median(this.#samples);
  }

  /**
   * Median absolute deviation, in ms — how tightly the notes cluster.
   *
   * A small spread beside a large median is a latency offset worth correcting.
   * A spread as large as the median is a player who is not playing steadily
   * enough to calibrate against yet, and the honest answer is more samples
   * rather than a new constant.
   */
  get spread(): number | null {
    const mid = this.median;
    if (mid === null) return null;
    return median(this.#samples.map((sample) => Math.abs(sample - mid)));
  }

  /**
   * What the latency trim should become, given what it is now.
   *
   * Additive because the trim shifts judged time earlier by exactly its own
   * value: a player landing consistently 30 ms late needs 30 ms more
   * compensation than they currently have.
   */
  suggestedTrimMs(currentTrimMs: number): number | null {
    const mid = this.median;
    return mid === null ? null : currentTrimMs + mid;
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}
