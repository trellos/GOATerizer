/**
 * The three-star meter for one attempt.
 *
 * ★ = pass, ★★ = strong, ★★★ = perfect. Thresholds are cumulative and
 * authored per level in scenario data; a star locks the moment it is earned and
 * cannot be lost to later mistakes (GDD §7). At least one star is required to
 * continue.
 *
 * The meter is deliberately monotonic in code as well as in intent, so a future
 * metric that can *decrease* still cannot take a star back.
 */

import type { StarThresholds } from "../scenario/types.js";

export class StarMeter {
  readonly #thresholds: StarThresholds;
  #stars = 0;
  #peakPoints = 0;

  constructor(thresholds: StarThresholds) {
    this.#thresholds = thresholds;
  }

  get stars(): number {
    return this.#stars;
  }

  get thresholds(): StarThresholds {
    return this.#thresholds;
  }

  get passed(): boolean {
    return this.#stars >= 1;
  }

  /** Fraction towards the next unearned star, 0..1. Drives the meter fill. */
  get progressToNextStar(): number {
    const { passThreshold, star2Threshold, star3Threshold } = this.#thresholds;
    const [from, to] =
      this.#stars === 0
        ? [0, passThreshold]
        : this.#stars === 1
          ? [passThreshold, star2Threshold]
          : this.#stars === 2
            ? [star2Threshold, star3Threshold]
            : [star3Threshold, star3Threshold];
    if (to <= from) return 1;
    return Math.max(0, Math.min(1, (this.#peakPoints - from) / (to - from)));
  }

  /** Feeds the meter cumulative judgment points. Returns the star count. */
  update(judgmentPoints: number): number {
    this.#peakPoints = Math.max(this.#peakPoints, judgmentPoints);
    const { passThreshold, star2Threshold, star3Threshold } = this.#thresholds;
    let earned = 0;
    if (this.#peakPoints >= passThreshold) earned = 1;
    if (this.#peakPoints >= star2Threshold) earned = 2;
    if (this.#peakPoints >= star3Threshold) earned = 3;
    // Locked: never below what has already been earned.
    this.#stars = Math.max(this.#stars, earned);
    return this.#stars;
  }
}
