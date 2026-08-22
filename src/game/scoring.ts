/**
 * Numeric score and streak tracking for one attempt.
 *
 * Score and stars are related but separate systems (`AGENTS.md` §8). This one
 * answers "how well did you play"; `stars.ts` answers "do you survive". Neither
 * decides whether the goat moves — that is the judgment outcome, and Perfect
 * and Good advance identically.
 */

import {
  SCORE_VALUES,
  STREAK_BONUS_MAX_NOTES,
  STREAK_BONUS_MIN_LENGTH,
  CONSISTENCY_POINTS_PER_NOTE,
  STREAK_BONUS_PER_NOTE,
  JUDGMENT_POINTS,
  WRONG_NOTE_BREAKS_STREAK,
} from "../config/tuning.js";
import type { JudgmentEvent } from "./judgment.js";

export type ScoreSnapshot = {
  score: number;
  /** The metric star thresholds are denominated in. */
  judgmentPoints: number;
  perfect: number;
  good: number;
  missed: number;
  wrongNotes: number;
  streak: number;
  bestStreak: number;
};

export type ScoreOptions = {
  /**
   * Whether this level's material earns the streak bonus. Scale exercises do
   * not; dense sixteenth material will. The streak itself is always tracked.
   */
  streakBonusEligible: boolean;
  wrongNoteBreaksStreak?: boolean;
};

export class AttemptScore {
  readonly #streakBonusEligible: boolean;
  readonly #wrongBreaksStreak: boolean;
  #score = 0;
  #judgmentPoints = 0;
  #perfect = 0;
  #good = 0;
  #missed = 0;
  #wrongNotes = 0;
  #streak = 0;
  #bestStreak = 0;

  constructor(options: ScoreOptions) {
    this.#streakBonusEligible = options.streakBonusEligible;
    this.#wrongBreaksStreak = options.wrongNoteBreaksStreak ?? WRONG_NOTE_BREAKS_STREAK;
  }

  get snapshot(): ScoreSnapshot {
    return {
      score: this.#score,
      judgmentPoints: this.#judgmentPoints,
      perfect: this.#perfect,
      good: this.#good,
      missed: this.#missed,
      wrongNotes: this.#wrongNotes,
      streak: this.#streak,
      bestStreak: this.#bestStreak,
    };
  }

  get judgmentPoints(): number {
    return this.#judgmentPoints;
  }

  /**
   * The consistency bonus, in judgment-point units, for the star meter's
   * second-star comparison only (`stars.ts`).
   *
   * One point per unbroken note, against ten for a Perfect. So a flawless
   * attempt earns a bonus worth exactly 10% of its own all-Perfect maximum,
   * whatever the note count — no scenario-specific tuning, and it cannot be
   * gamed by a long exercise. PROVISIONAL: 10% is a starting number to play
   * against, not a derived one.
   */
  get consistencyPoints(): number {
    return this.#bestStreak * CONSISTENCY_POINTS_PER_NOTE;
  }

  get score(): number {
    return this.#score;
  }

  apply(event: JudgmentEvent): void {
    switch (event.type) {
      case "PerfectNote":
        this.#perfect += 1;
        this.#judgmentPoints += JUDGMENT_POINTS.perfect;
        this.#succeed(SCORE_VALUES.perfect);
        break;
      case "GoodNote":
        this.#good += 1;
        this.#judgmentPoints += JUDGMENT_POINTS.good;
        this.#succeed(SCORE_VALUES.good);
        break;
      case "MissedNote":
        this.#missed += 1;
        this.#judgmentPoints += JUDGMENT_POINTS.miss;
        this.#score += SCORE_VALUES.miss;
        this.#streak = 0;
        break;
      case "WrongNote":
        this.#wrongNotes += 1;
        this.#score += SCORE_VALUES.wrongNote;
        if (this.#wrongBreaksStreak) this.#streak = 0;
        break;
      default:
        break;
    }
  }

  #succeed(base: number): void {
    this.#streak += 1;
    if (this.#streak > this.#bestStreak) this.#bestStreak = this.#streak;
    this.#score += base + this.#streakBonus();
  }

  #streakBonus(): number {
    if (!this.#streakBonusEligible || this.#streak < STREAK_BONUS_MIN_LENGTH) return 0;
    const beyond = Math.min(this.#streak - STREAK_BONUS_MIN_LENGTH + 1, STREAK_BONUS_MAX_NOTES);
    return beyond * STREAK_BONUS_PER_NOTE;
  }
}
