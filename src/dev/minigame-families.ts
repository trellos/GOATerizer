/**
 * The dev panel's minigame-family x difficulty table: what it shows, and what
 * happens when a developer overrides the run's own selection.
 *
 * Dev-only. `RunState.slots` are pre-filled at construction by `fillSlots`
 * (`src/game/run.ts`) — pure random selection among eligible scenarios, with
 * no developer knowledge at all. This module never touches that algorithm; it
 * only *overwrites* a `RunSlot`'s `difficulty`/`scenario` immediately before
 * `game-app.ts` turns that slot into an attempt, which is late enough that the
 * override always wins and early enough that it is indistinguishable from
 * `fillSlots` having picked differently. `RunSlot` fields are plain and
 * mutable for exactly this reason.
 */

import { DIFFICULTY_SEQUENCE, type RunSlot } from "../game/run.js";
import { scenariosForDifficulty, SCENARIOS } from "../scenario/registry.js";
import type { MinigameId, ScenarioDefinition } from "../scenario/types.js";

/**
 * The six permanent minigame families (`AGENTS.md` §1, GDD §1.2), fixed
 * regardless of how many scenarios the library currently authors for each.
 * The vertical slice ships scenarios for only two of them; the rest still get
 * a row in the table, entirely blank, because the table describes the game's
 * structure rather than today's content.
 */
export const MINIGAME_FAMILIES: readonly { family: string; minigameClass: MinigameId }[] = [
  { family: "Scale", minigameClass: "ClimbMinigame" },
  { family: "Blues Lick", minigameClass: "PerformMinigame" },
  { family: "Scale Run", minigameClass: "TraverseMinigame" },
  { family: "Triplets", minigameClass: "ThreeStepMinigame" },
  { family: "Straight Sixteenths", minigameClass: "RepeatMinigame" },
  { family: "Sixteenth Phrases", minigameClass: "BattleMinigame" },
];

/** 1..N, derived from the run's own difficulty curve rather than a second literal. */
export const MINIGAME_DIFFICULTY_LEVELS: readonly number[] = Array.from(
  { length: Math.max(...DIFFICULTY_SEQUENCE) },
  (_, index) => index + 1
);

/**
 * Every registered scenario belonging to `family`, in registry order — one
 * dev-panel row each. A family with more than one (Rocky Ascent and Rocky
 * Ascent High both author "Scale") used to share a single row and a single
 * table cell per level, so pinning or disabling one meant *all* of them at
 * that level — the table could not actually name which variant it meant.
 */
export function scenariosForFamily(family: string): readonly ScenarioDefinition[] {
  return SCENARIOS.filter((scenario) => scenario.family === family);
}

/** Identifies one table cell: one scenario variant at one difficulty. Scenario ids never contain `|`. */
export function cellKey(scenarioId: string, level: number): string {
  return `${scenarioId}|${level}`;
}

export type MinigameOverrideState = {
  /** Cells the player has unhighlighted, keyed by {@link cellKey}. */
  disabledCells: ReadonlySet<string>;
  /** The sticky difficulty selected at the top of the table, or none. */
  targetDifficulty: number | null;
  /** The one-shot pin from a double-click, consumed by the next resolution. */
  pendingPin: { scenarioId: string; difficulty: number } | null;
};

export type MinigameResolution = {
  difficulty: number;
  /** Null when every scenario for the resolved difficulty was disabled. */
  scenario: ScenarioDefinition | null;
  /** Whether `state.pendingPin` was consumed and should now be cleared. */
  pinConsumed: boolean;
};

/**
 * Decides what an upcoming `RunSlot` should actually play, given the dev
 * panel's overrides. Returns `null` when nothing overrides it — the slot
 * `fillSlots` already chose stands untouched, so a run nobody has touched the
 * table for behaves exactly as before.
 *
 * A pin takes priority over the sticky target difficulty; either forces a
 * difficulty and re-rolls the scenario for it. A pin names one exact scenario
 * id, so — unlike the sticky difficulty column, which still rolls among
 * whichever variants of whichever families are left eligible — it is
 * deterministic: the named scenario if it is eligible, otherwise nothing.
 * With neither active, the slot is still re-rolled if its own current pick
 * has since been disabled — a developer unhighlighting a cell mid-run should
 * not require also touching the other two controls to see an effect.
 * `random` is a seam for tests; production leaves it as `Math.random`,
 * consistent with the un-seeded random selection `fillSlots` itself uses
 * (`src/dev/auto-performance.ts` is the one seeded exception, and for a
 * reason specific to replayable autoplay).
 */
export function resolveMinigameOverride(
  slot: Pick<RunSlot, "difficulty" | "scenario">,
  state: MinigameOverrideState,
  random: () => number = Math.random
): MinigameResolution | null {
  const pin = state.pendingPin;
  const forcedDifficulty = pin ? pin.difficulty : state.targetDifficulty;
  const scenarioFilter = pin ? pin.scenarioId : null;

  const currentPickDisabled =
    slot.scenario !== null && state.disabledCells.has(cellKey(slot.scenario.id, slot.difficulty));

  if (forcedDifficulty === null && !currentPickDisabled) return null;

  const difficulty = forcedDifficulty ?? slot.difficulty;
  const eligible = scenariosForDifficulty(difficulty).filter(
    (scenario) =>
      !state.disabledCells.has(cellKey(scenario.id, difficulty)) &&
      (scenarioFilter === null || scenario.id === scenarioFilter)
  );
  const scenario = eligible.length > 0 ? (eligible[Math.floor(random() * eligible.length)] ?? null) : null;

  return { difficulty, scenario, pinConsumed: pin !== null };
}
