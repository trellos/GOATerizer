/**
 * The run: 16 minigame slots, one key, one tempo.
 *
 * The whole 16-slot sequence is generated before play starts, because the
 * player can see part of the *next* scenario before finding out whether they
 * survive the current one (GDD §11.2).
 *
 * The vertical slice ships one scenario, so slots whose difficulty nothing
 * authors are left explicitly unfilled rather than being papered over with
 * invented L5–L7 exercise data. The run then ends at the first unfilled slot
 * and says why. That is a content limit, not a game-over.
 */

import type { RunKey } from "../music/keys.js";
import { scenariosForDifficulty } from "../scenario/registry.js";
import type { ScenarioDefinition } from "../scenario/types.js";
import type { AttemptResult } from "./attempt.js";
import { rankForStars } from "./ranks.js";

/** GDD §3: introduce a harder level, back off, climb again. Fixed. */
export const DIFFICULTY_SEQUENCE: readonly number[] = [
  1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7,
];

export const RUN_SLOT_COUNT = DIFFICULTY_SEQUENCE.length;

export type RunSlot = {
  ordinal: number;
  difficulty: number;
  /** Null when no scenario in the library authors this difficulty. */
  scenario: ScenarioDefinition | null;
  result: AttemptResult | null;
};

export type RunEnding = "failed" | "completed" | "content-limit";

export type RunSummary = {
  totalStars: number;
  totalScore: number;
  slotsPlayed: number;
  rank: string;
  ending: RunEnding;
};

export type RunOptions = {
  key: RunKey;
  bpm: number;
  random?: () => number;
  /**
   * Overrides the run's difficulty curve. **Developer use only** — it exists so
   * a single Rocky Ascent level can be played repeatedly while tuning, without
   * grinding up to it. Normal play always uses {@link DIFFICULTY_SEQUENCE}.
   */
  difficultySequence?: readonly number[];
  /**
   * Fills every slot this scenario is eligible for with it. **Developer use
   * only** — the browser suite and a designer looking at one scenario need
   * to know which one they will get, and with several scenarios authoring the
   * same difficulty the pick is otherwise random. Slots the scenario does not
   * author still fill normally.
   */
  preferScenarioId?: string;
};

export class RunState {
  readonly key: RunKey;
  readonly bpm: number;
  readonly slots: RunSlot[];
  #currentIndex = 0;
  #ending: RunEnding | null = null;

  constructor(options: RunOptions) {
    this.key = options.key;
    this.bpm = options.bpm;
    this.slots = fillSlots(
      options.difficultySequence ?? DIFFICULTY_SEQUENCE,
      options.random ?? Math.random,
      options.preferScenarioId ?? null
    );
  }

  get currentIndex(): number {
    return this.#currentIndex;
  }

  get currentSlot(): RunSlot | null {
    return this.slots[this.#currentIndex] ?? null;
  }

  get nextSlot(): RunSlot | null {
    return this.slots[this.#currentIndex + 1] ?? null;
  }

  get previousSlot(): RunSlot | null {
    return this.slots[this.#currentIndex - 1] ?? null;
  }

  get over(): boolean {
    return this.#ending !== null;
  }

  get ending(): RunEnding | null {
    return this.#ending;
  }

  get totalStars(): number {
    return this.slots.reduce((sum, slot) => sum + (slot.result?.stars ?? 0), 0);
  }

  get totalScore(): number {
    return this.slots.reduce((sum, slot) => sum + (slot.result?.score ?? 0), 0);
  }

  get slotsPlayed(): number {
    return this.slots.filter((slot) => slot.result !== null).length;
  }

  /**
   * Records an attempt and moves on.
   *
   * Zero stars ends the run immediately (GDD §7). Otherwise the next slot
   * becomes current — unless the library has nothing authored for it, which
   * ends the run as a content limit.
   */
  recordResult(result: AttemptResult): RunEnding | null {
    const slot = this.currentSlot;
    if (!slot) return this.#ending;
    slot.result = result;

    if (!result.passed) {
      this.#ending = "failed";
      return this.#ending;
    }

    this.#currentIndex += 1;
    if (this.#currentIndex >= this.slots.length) {
      this.#ending = "completed";
    } else if (this.currentSlot?.scenario === null) {
      this.#ending = "content-limit";
    }
    return this.#ending;
  }

  get summary(): RunSummary {
    return {
      totalStars: this.totalStars,
      totalScore: this.totalScore,
      slotsPlayed: this.slotsPlayed,
      rank: rankForStars(this.totalStars),
      ending: this.#ending ?? "failed",
    };
  }
}

/**
 * Fills all 16 slots up front.
 *
 * Selection is pure random among eligible scenarios, with reuse avoided while
 * any eligible scenario is still unused. There is deliberately no class
 * balancing (GDD §3.1).
 */
function fillSlots(
  sequence: readonly number[],
  random: () => number,
  preferScenarioId: string | null
): RunSlot[] {
  const used = new Set<string>();

  return sequence.map((difficulty, ordinal) => {
    const eligible = scenariosForDifficulty(difficulty);
    if (eligible.length === 0) {
      return { ordinal, difficulty, scenario: null, result: null };
    }

    // Dev-only preference, ahead of the reuse rule: the point is to see one
    // scenario every slot it can fill, not to see it once.
    const preferred = eligible.find((scenario) => scenario.id === preferScenarioId);
    if (preferred) {
      used.add(preferred.id);
      return { ordinal, difficulty, scenario: preferred, result: null };
    }

    const unused = eligible.filter((scenario) => !used.has(scenario.id));
    const pool = unused.length > 0 ? unused : eligible;
    const picked = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    if (!picked) return { ordinal, difficulty, scenario: null, result: null };

    used.add(picked.id);
    return { ordinal, difficulty, scenario: picked, result: null };
  });
}
