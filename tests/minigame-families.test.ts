/**
 * The dev panel's minigame table: which cells exist, and what an override
 * does to a `RunSlot` about to be queued.
 */

import { describe, expect, it } from "vitest";

import {
  cellKey,
  familyHasLevel,
  MINIGAME_DIFFICULTY_LEVELS,
  MINIGAME_FAMILIES,
  resolveMinigameOverride,
  type MinigameOverrideState,
} from "../src/dev/minigame-families.js";
import { ROCKY_ASCENT, CAN_CRUSHING } from "../src/scenario/registry.js";

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

  it("marks a cell present only when a registered scenario authors it", () => {
    expect(familyHasLevel("Scale", 1)).toBe(true);
    expect(familyHasLevel("Scale", 7)).toBe(false); // Rocky's highest is L6.
    expect(familyHasLevel("Straight Sixteenths", 1)).toBe(true);
    expect(familyHasLevel("Blues Lick", 1)).toBe(false); // No scenario yet.
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
      disabledCells: new Set([cellKey("Scale", 1)]),
    };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution).not.toBeNull();
    expect(resolution?.scenario?.family).not.toBe("Scale");
    expect(resolution?.pinConsumed).toBe(false);
  });

  it("forces the sticky target difficulty and re-rolls the scenario for it", () => {
    const state: MinigameOverrideState = { ...NO_OVERRIDE, targetDifficulty: 2 };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution?.difficulty).toBe(2);
    expect(resolution?.scenario).not.toBeNull();
    expect(resolution?.scenario?.levels.has(2)).toBe(true);
  });

  it("a pin overrides the sticky difficulty, restricts to its family, and reports consumed", () => {
    const state: MinigameOverrideState = {
      ...NO_OVERRIDE,
      targetDifficulty: 5,
      pendingPin: { family: "Straight Sixteenths", difficulty: 1 },
    };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution?.difficulty).toBe(1);
    expect(resolution?.scenario).toBe(CAN_CRUSHING);
    expect(resolution?.pinConsumed).toBe(true);
  });

  it("returns a null scenario, not a throw, when every eligible scenario is disabled", () => {
    const state: MinigameOverrideState = {
      ...NO_OVERRIDE,
      targetDifficulty: 1,
      disabledCells: new Set([cellKey("Scale", 1), cellKey("Straight Sixteenths", 1)]),
    };
    const resolution = resolveMinigameOverride(slot, state, () => 0);
    expect(resolution?.scenario).toBeNull();
    expect(resolution?.difficulty).toBe(1);
  });
});
