/**
 * How fast the game is actually running, and how much of that is our fault.
 *
 * Two numbers, because they fail differently and the fix is different:
 *
 *   - **Frame rate** is what the player sees. It is bounded by the display's
 *     refresh and by everything the browser does after our callback returns —
 *     rasterising the canvases, compositing, presenting.
 *   - **Work** is how long our own callback took. It is the only part this
 *     codebase controls, and it is what a regression here would show up in.
 *
 * A high work figure means the JavaScript got slow. A low work figure beside a
 * low frame rate means the paint got expensive — a full-screen canvas being
 * repainted when it did not change, a gradient over the whole viewport — and
 * the JS profile will show nothing at all. Reporting only one of the two sends
 * you looking in the wrong place.
 *
 * A rolling window rather than a running mean: the question is always "is it
 * smooth *now*", and an average over a minute hides a stall.
 */

/** Frames kept. At 60fps this is about a second; at 240, a quarter of one. */
const WINDOW = 60;

export class FrameMeter {
  readonly #intervals: number[] = [];
  readonly #work: number[] = [];
  #lastFrameMs: number | null = null;
  #startedMs = 0;

  /** Call at the top of the frame callback. */
  begin(nowMs: number): void {
    if (this.#lastFrameMs !== null) push(this.#intervals, nowMs - this.#lastFrameMs);
    this.#lastFrameMs = nowMs;
    this.#startedMs = nowMs;
  }

  /** Call at the bottom of the frame callback. */
  end(nowMs: number): void {
    push(this.#work, nowMs - this.#startedMs);
  }

  /** Frames per second over the window, or null before there is a window. */
  get fps(): number | null {
    const mean = average(this.#intervals);
    return mean === null || mean <= 0 ? null : 1000 / mean;
  }

  /** Mean and worst milliseconds spent inside the frame callback. */
  get workMs(): number | null {
    return average(this.#work);
  }

  get worstWorkMs(): number | null {
    return this.#work.length === 0 ? null : Math.max(...this.#work);
  }

  /**
   * The longest gap between frames in the window.
   *
   * A mean frame rate of 60 with a 90ms worst gap is not a smooth 60 — it is a
   * visible hitch that the mean has averaged away, which is exactly the thing a
   * player notices and a summary statistic hides.
   */
  get worstIntervalMs(): number | null {
    return this.#intervals.length === 0 ? null : Math.max(...this.#intervals);
  }
}

function push(values: number[], value: number): void {
  if (!Number.isFinite(value)) return;
  values.push(value);
  if (values.length > WINDOW) values.shift();
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
