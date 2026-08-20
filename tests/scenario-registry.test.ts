/**
 * The scenario registry: which scenarios exist, and which difficulty they
 * cover.
 *
 * `loadScenario` (exercised in `scenario-data.test.ts` for Rocky Ascent, and
 * implicitly for every scenario every time this module is imported, since
 * `registry.ts` calls it eagerly) already enforces each scenario's own
 * internal consistency — durations summing to 16 beats, one waypoint per note
 * opportunity, ascending star thresholds. A structural defect in a scenario
 * file fails every test in this suite at import time, not quietly at runtime.
 *
 * What that does not cover is the registry as a whole: now that more than one
 * scenario authors the same difficulty, `scenariosForDifficulty` has real
 * pooling and selection behaviour (`game/run.ts`) that is worth pinning down
 * directly.
 */

import { describe, expect, it } from "vitest";

import {
  ROCKY_ASCENT,
  ROCKY_ASCENT_HIGH,
  ROCKY_DESCENT,
  ROCKY_DESCENT_HIGH,
  SCENARIOS,
  scenarioById,
  scenariosForDifficulty,
} from "../src/scenario/registry.js";

describe("scenario registry", () => {
  it("holds all four Rocky-family scenarios, each a ClimbMinigame in the Scale family", () => {
    expect(SCENARIOS).toHaveLength(4);
    for (const scenario of SCENARIOS) {
      expect(scenario.minigameClass).toBe("ClimbMinigame");
      expect(scenario.family).toBe("Scale");
    }
    expect(new Set(SCENARIOS.map((s) => s.id))).toEqual(
      new Set(["rocky_ascent", "rocky_ascent_high", "rocky_descent", "rocky_descent_high"])
    );
  });

  it("resolves every scenario by id", () => {
    expect(scenarioById("rocky_ascent")).toBe(ROCKY_ASCENT);
    expect(scenarioById("rocky_ascent_high")).toBe(ROCKY_ASCENT_HIGH);
    expect(scenarioById("rocky_descent")).toBe(ROCKY_DESCENT);
    expect(scenarioById("rocky_descent_high")).toBe(ROCKY_DESCENT_HIGH);
    expect(scenarioById("does_not_exist")).toBeUndefined();
  });

  it("declares the supported levels the scenario files author", () => {
    expect([...ROCKY_ASCENT.supportedLevels]).toEqual([1, 2, 3, 4]);
    expect([...ROCKY_DESCENT.supportedLevels]).toEqual([1, 2, 3, 4]);
    expect([...ROCKY_ASCENT_HIGH.supportedLevels]).toEqual([3, 4, 5, 6]);
    expect([...ROCKY_DESCENT_HIGH.supportedLevels]).toEqual([3, 4, 5, 6]);
  });

  it.each([
    [1, ["rocky_ascent", "rocky_descent"]],
    [2, ["rocky_ascent", "rocky_descent"]],
    [3, ["rocky_ascent", "rocky_ascent_high", "rocky_descent", "rocky_descent_high"]],
    [4, ["rocky_ascent", "rocky_ascent_high", "rocky_descent", "rocky_descent_high"]],
    [5, ["rocky_ascent_high", "rocky_descent_high"]],
    [6, ["rocky_ascent_high", "rocky_descent_high"]],
    [7, []],
  ])("difficulty %i is covered by exactly %j", (difficulty, expectedIds) => {
    const ids = scenariosForDifficulty(difficulty)
      .map((scenario) => scenario.id)
      .sort();
    expect(ids).toEqual([...expectedIds].sort());
  });

  it("L7 is a real content limit, not a bug: nothing authors it", () => {
    expect(scenariosForDifficulty(7)).toHaveLength(0);
  });
});
