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
  /** Accuracy alone. Decides the pass and the perfection badge. */
  #peakPoints = 0;
  /** Accuracy plus consistency. Decides the second star only. */
  #peakWithBonus = 0;

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

  /**
   * Feeds the meter. Returns the star count.
   *
   * Two inputs, and which one each comparison uses is the whole rule
   * (`docs/game-design/PROPOSED_Timeline_Actors.md` §7):
   *
   *   - **0 → 1** uses accuracy alone. Zero stars ends a run, so the pass has
   *     to stay a pure accuracy verdict — consistency must never be able to buy
   *     someone out of a failing attempt, or it becomes a second failure
   *     channel. This is structural, not a tuned cap: no bonus size can cross
   *     this line because the bonus is not in the comparison.
   *   - **1 → 2** uses accuracy plus the consistency bonus. This is the one
   *     place holding a streak together pays in stars.
   *   - **2 → 3** uses accuracy alone. Three stars stays a perfection badge —
   *     the only unambiguous signal the player actually played the exercise
   *     correctly rather than got carried by a hot streak.
   *
   * @param consistencyPoints judgment-point-denominated streak bonus. Zero
   * reproduces the old accuracy-only behaviour exactly.
   */
  update(judgmentPoints: number, consistencyPoints = 0): number {
    this.#peakPoints = Math.max(this.#peakPoints, judgmentPoints);
    this.#peakWithBonus = Math.max(this.#peakWithBonus, judgmentPoints + consistencyPoints);
    const { passThreshold, star2Threshold, star3Threshold } = this.#thresholds;
    let earned = 0;
    if (this.#peakPoints >= passThreshold) earned = 1;
    if (earned === 1 && this.#peakWithBonus >= star2Threshold) earned = 2;
    if (this.#peakPoints >= star3Threshold) earned = 3;
    // Locked: never below what has already been earned.
    this.#stars = Math.max(this.#stars, earned);
    return this.#stars;
  }
}
