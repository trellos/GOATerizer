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

import { MINIGAME_API_VERSION } from "../src/minigame/api.js";
import { minigameById, registeredMinigameIds, registerMinigame } from "../src/minigame/registry.js";
import { ATTEMPT_REPEATS, JUDGMENT_POINTS } from "../src/config/tuning.js";
import { formatDegreeToken, laneIndexOf, LANE_COUNT, resolveDegree } from "../src/music/degrees.js";
import { loadScenario } from "../src/scenario/load.js";
import {
  CAN_CRUSHING,
  GOAT_FRONTMAN,
  ROCKY_ASCENT,
  ROCKY_ASCENT_HIGH,
  ROCKY_DESCENT,
  ROCKY_DESCENT_HIGH,
  SCENARIOS,
  scenarioById,
  scenariosForDifficulty,
} from "../src/scenario/registry.js";

describe("scenario registry", () => {
  it("holds the four Rocky-family climbs, the one repeat scenario and the one performance", () => {
    expect(SCENARIOS).toHaveLength(6);
    for (const scenario of SCENARIOS) {
      if (scenario === CAN_CRUSHING || scenario === GOAT_FRONTMAN) continue;
      expect(scenario.minigameId).toBe("ClimbMinigame");
      expect(scenario.family).toBe("Scale");
    }
    expect(CAN_CRUSHING.minigameId).toBe("RepeatMinigame");
    expect(GOAT_FRONTMAN.minigameId).toBe("PerformMinigame");
    expect(GOAT_FRONTMAN.family).toBe("Blues Lick");
    expect(new Set(SCENARIOS.map((s) => s.id))).toEqual(
      new Set([
        "rocky_ascent",
        "rocky_ascent_high",
        "rocky_descent",
        "rocky_descent_high",
        "can_crushing",
        "goat_frontman",
      ])
    );
  });

  /**
   * The one number the authoring scripts have to duplicate.
   *
   * Star thresholds are baked into the scenario JSON by `scripts/author-*.mjs`,
   * which are plain `.mjs` and cannot import `ATTEMPT_REPEATS` from the
   * TypeScript config — so they hard-code it. That is a silent-drift hazard:
   * change the repeat count and every authored ceiling is quietly wrong until
   * someone reruns the scripts. This is the guard, and it covers every scenario
   * in the registry rather than the two that happen to have their own suites.
   */
  it("keeps every authored star ceiling in step with the repeat count", () => {
    for (const scenario of SCENARIOS) {
      for (const [difficulty, level] of scenario.levels) {
        const onePass = level.noteOpportunityCount * JUDGMENT_POINTS.perfect;
        const where = `${scenario.id} L${difficulty}`;
        // Three stars is every opportunity in the attempt taken at Perfect.
        expect(`${where}: ${level.stars.star3Threshold}`).toBe(
          `${where}: ${onePass * ATTEMPT_REPEATS}`
        );
        // The pass bar is deliberately NOT scaled with the repeat: it stays
        // what a single clean pass was worth, so a good second pass rescues a
        // bad first read. See src/config/tuning.ts ATTEMPT_REPEATS.
        expect(level.stars.passThreshold).toBeLessThan(onePass);
        expect(level.stars.passThreshold).toBeGreaterThan(0);
      }
    }
  });

  it("resolves every scenario by id", () => {
    expect(scenarioById("rocky_ascent")).toBe(ROCKY_ASCENT);
    expect(scenarioById("rocky_ascent_high")).toBe(ROCKY_ASCENT_HIGH);
    expect(scenarioById("rocky_descent")).toBe(ROCKY_DESCENT);
    expect(scenarioById("rocky_descent_high")).toBe(ROCKY_DESCENT_HIGH);
    expect(scenarioById("can_crushing")).toBe(CAN_CRUSHING);
    expect(scenarioById("goat_frontman")).toBe(GOAT_FRONTMAN);
    expect(scenarioById("does_not_exist")).toBeUndefined();
  });

  it("declares the supported levels the scenario files author", () => {
    expect([...ROCKY_ASCENT.supportedLevels]).toEqual([1, 2, 3, 4]);
    expect([...ROCKY_DESCENT.supportedLevels]).toEqual([1, 2, 3, 4]);
    expect([...ROCKY_ASCENT_HIGH.supportedLevels]).toEqual([3, 4, 5, 6]);
    expect([...ROCKY_DESCENT_HIGH.supportedLevels]).toEqual([3, 4, 5, 6]);
    expect([...CAN_CRUSHING.supportedLevels]).toEqual([1, 2, 3, 4]);
    expect([...GOAT_FRONTMAN.supportedLevels]).toEqual([1, 2, 3, 4]);
  });

  it.each([
    [1, ["can_crushing", "goat_frontman", "rocky_ascent", "rocky_descent"]],
    [2, ["can_crushing", "goat_frontman", "rocky_ascent", "rocky_descent"]],
    [
      3,
      [
        "can_crushing",
        "goat_frontman",
        "rocky_ascent",
        "rocky_ascent_high",
        "rocky_descent",
        "rocky_descent_high",
      ],
    ],
    [
      4,
      [
        "can_crushing",
        "goat_frontman",
        "rocky_ascent",
        "rocky_ascent_high",
        "rocky_descent",
        "rocky_descent_high",
      ],
    ],
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

  it("authors every target inside the one-octave pitch space, in either mode", () => {
    for (const scenario of SCENARIOS) {
      for (const [difficulty, level] of scenario.levels) {
        for (const event of level.prompt) {
          if (!event.degree) continue;
          // A pentatonic token only becomes a lane once the mode is known, and
          // it has to be a real lane in both.
          for (const mode of ["major", "minor"] as const) {
            const degree = resolveDegree(event.degree, mode);
            const lane = laneIndexOf(degree);
            expect(
              lane,
              `${scenario.id} L${difficulty} authors lane ${lane} in ${mode}`
            ).toBeLessThan(LANE_COUNT);
            // Band 1 is the octave root and nothing else — a `b3` in a scenario
            // file would mean the two-octave vocabulary crept back in.
            if (degree.octaveBand === 1) expect(degree.degree).toBe(1);
          }
        }
      }
    }
  });

  it("gives the _high scenarios a different exercise, not a transposed one", () => {
    // They no longer differ by register — there is only one octave — so their
    // reason to sit two levels higher is that they sequence the octave rather
    // than run it straight. If a level ever became a copy of its normal
    // counterpart, the difficulty ladder would be lying.
    const tokensOf = (scenario: typeof ROCKY_ASCENT, difficulty: number) =>
      (scenario.levels.get(difficulty)?.prompt ?? [])
        .map((event) => (event.degree ? formatDegreeToken(event.degree) : "-"))
        .join(" ");

    for (const [normal, high] of [
      [ROCKY_ASCENT, ROCKY_ASCENT_HIGH],
      [ROCKY_DESCENT, ROCKY_DESCENT_HIGH],
    ] as const) {
      for (const difficulty of [3, 4]) {
        expect(tokensOf(high, difficulty)).not.toBe(tokensOf(normal, difficulty));
        expect(tokensOf(high, difficulty)).not.toBe("");
      }
    }
  });
});

/**
 * The minigame library.
 *
 * These are the guarantees that make a minigame something the game can be
 * *given* rather than something it has to know about: an unregistered id is a
 * loud content error instead of "whatever runs first", and a package built
 * against a different revision of the contract is refused at registration
 * rather than halfway through a render call.
 */
describe("minigame registry", () => {
  it("registers the climb and perform minigames by importing the scenario library", () => {
    expect(registeredMinigameIds()).toContain("ClimbMinigame");
    expect(registeredMinigameIds()).toContain("PerformMinigame");
    expect(minigameById("ClimbMinigame")?.apiVersion).toBe(MINIGAME_API_VERSION);
    expect(minigameById("PerformMinigame")?.apiVersion).toBe(MINIGAME_API_VERSION);
  });

  it("refuses a scenario whose minigame nobody registered, and says which exist", () => {
    const orphan = { ...structuredClone(RAW_SCENARIO_SHAPE), minigameClass: "BattleMinigame" };
    expect(() => loadScenario(orphan, {})).toThrow(
      /no minigame registered for "BattleMinigame".*ClimbMinigame/s
    );
  });

  it("refuses a package built against a different API revision", () => {
    expect(() =>
      registerMinigame({
        id: "FromTheFuture",
        displayName: "From the future",
        apiVersion: MINIGAME_API_VERSION + 1,
        parseConfig: () => ({}),
        parseLevel: () => ({}),
        assetIds: () => [],
        create: () => {
          throw new Error("unreachable");
        },
      })
    ).toThrow(/targets API v/);
    expect(registeredMinigameIds()).not.toContain("FromTheFuture");
  });

  it("refuses a second, different package claiming an id already taken", () => {
    const climb = minigameById("ClimbMinigame")!;
    // The same module registering twice is fine; a different one is not.
    expect(() => registerMinigame(climb)).not.toThrow();
    expect(() => registerMinigame({ ...climb, displayName: "Impostor" })).toThrow(
      /already registered/
    );
  });
});

/**
 * The smallest scenario the *host* half of the loader accepts.
 *
 * Deliberately not a real file: the point is to reach the minigame lookup, so
 * everything beyond identity is minimal. A real scenario's own validation lives
 * with its minigame and is covered by `scenario-data.test.ts`.
 */
const RAW_SCENARIO_SHAPE = {
  id: "orphan",
  displayName: "Orphan",
  theme: "none",
  minigameClass: "ClimbMinigame",
  family: "Scale",
  visualVerb: "CLIMB",
  scenarioPremise: "a scenario whose minigame is not registered",
  supportedLevels: [1],
  classParameters: {},
  assetBindings: {},
  levels: {},
};
