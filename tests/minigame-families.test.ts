/**
 * The dev panel's minigame table: which rows and cells exist, and what an
 * override does to a `RunSlot` about to be queued.
 */

import { describe, expect, it } from "vitest";

import {
  cellKey,
  MINIGAME_DIFFICULTY_LEVELS,
  MINIGAME_FAMILIES,
  resolveMinigameOverride,
  scenariosForFamily,
  type MinigameOverrideState,
} from "../src/dev/minigame-families.js";
import { CAN_CRUSHING, ROCKY_ASCENT, ROCKY_ASCENT_HIGH, ROCKY_DESCENT } from "../src/scenario/registry.js";

const NO_OVERRIDE: MinigameOverrideState = {
  disabledCells: new Set(),
  targetDifficulty: null,
  pendingPin: null,
};

describe("minigame family table", () => {
  it("lists all six permanent families", () => {
    expect(MINIGAME_FAMILIES.map((entry) => entry.family)).toEqual([
      "Scale",
      "Blues Lick",
      "Scale Run",
      "Triplets",
      "Straight Sixteenths",
      "Sixteenth Phrases",
    ]);
  });

  it("difficulty columns run 1..7, matching the run's own curve", () => {
    expect(MINIGAME_DIFFICULTY_LEVELS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("lists every registered scenario of a family as its own row", () => {
    const scaleVariants = scenariosForFamily("Scale");
    expect(scaleVariants).toContain(ROCKY_ASCENT);
    expect(scaleVariants).toContain(ROCKY_ASCENT_HIGH);
    expect(scaleVariants.every((scenario) => scenario.family === "Scale")).toBe(true);
    expect(scenariosForFamily("Straight Sixteenths")).toEqual([CAN_CRUSHING]);
  });

  it("a family nothing authors yet lists no rows", () => {
    expect(scenariosForFamily("Blues Lick")).toEqual([]);
  });
});

describe("resolveMinigameOverride", () => {
  const slot = { difficulty: 1, scenario: ROCKY_ASCENT };

  it("leaves an untouched slot alone", () => {
    expect(resolveMinigameOverride(slot, NO_OVERRIDE)).toBeNull();
  });

  it("re-rolls when the slot's own pick has been disabled, even with no other override", () => {
    const state: MinigameOverrideState = {
      ...NO_OVERRIDE,
      disabledCells: new Set([cellKey(ROCKY_ASCENT.id, 1)]),
    };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution).not.toBeNull();
    // Rocky Descent shares Rocky Ascent's family and level, so disabling one
    // variant must not be enough to rule out the whole family — only itself.
    expect(resolution?.scenario?.id).not.toBe(ROCKY_ASCENT.id);
    expect(resolution?.pinConsumed).toBe(false);
  });

  it("forces the sticky target difficulty and re-rolls the scenario for it", () => {
    const state: MinigameOverrideState = { ...NO_OVERRIDE, targetDifficulty: 2 };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution?.difficulty).toBe(2);
    expect(resolution?.scenario).not.toBeNull();
    expect(resolution?.scenario?.levels.has(2)).toBe(true);
  });

  it("a pin overrides the sticky difficulty, names one exact scenario, and reports consumed", () => {
    const state: MinigameOverrideState = {
      ...NO_OVERRIDE,
      targetDifficulty: 5,
      pendingPin: { scenarioId: CAN_CRUSHING.id, difficulty: 1 },
    };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution?.difficulty).toBe(1);
    expect(resolution?.scenario).toBe(CAN_CRUSHING);
    expect(resolution?.pinConsumed).toBe(true);
  });

  it("a pin naming a variant leaves its same-family, same-level siblings alone", () => {
    // L1 is authored by both Rocky Ascent and Rocky Descent (Scale) plus Can
    // Crushing (Straight Sixteenths). Pinning Rocky Descent specifically must
    // never resolve to Rocky Ascent, even though both are "Scale" at L1.
    const state: MinigameOverrideState = {
      ...NO_OVERRIDE,
      pendingPin: { scenarioId: ROCKY_DESCENT.id, difficulty: 1 },
    };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution?.scenario).toBe(ROCKY_DESCENT);
  });

  it("returns a null scenario, not a throw, when every eligible scenario is disabled", () => {
    const state: MinigameOverrideState = {
      ...NO_OVERRIDE,
      targetDifficulty: 1,
      disabledCells: new Set([
        cellKey(ROCKY_ASCENT.id, 1),
        cellKey(ROCKY_DESCENT.id, 1),
        cellKey(CAN_CRUSHING.id, 1),
      ]),
    };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution?.scenario).toBeNull();
    expect(resolution?.difficulty).toBe(1);
  });
});
