/**
 * Scenario-data validation.
 *
 * These assertions are the specification: the Rocky Ascent exercise is
 * hand-authored, and the counts below are the ones the design states. If a
 * future edit changes them, that has to be a deliberate design change, not a
 * silent one.
 */

import { describe, expect, it } from "vitest";

import { ATTEMPT_REPEATS } from "../src/config/tuning.js";

import { ROCKY_ASCENT, scenariosForDifficulty } from "../src/scenario/registry.js";
import { formatDegreeToken } from "../src/music/degrees.js";
import type { ScenarioLevelData } from "../src/scenario/types.js";
import {
  climbConfig,
  climbLevel,
  CLIMB_MINIGAME,
} from "../src/scenario/minigames/climb-minigame.js";

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** difficulty -> note opportunities, from the Rocky Ascent specification. */
const EXPECTED_OPPORTUNITIES: Record<number, number> = { 1: 15, 2: 14, 3: 9, 4: 12, 5: 23, 6: 30 };

/** The whole authored vocabulary: one octave, root to root. */
const OCTAVE = ["1", "2", "3", "4", "5", "6", "7", "b1"] as const;

function level(difficulty: number): ScenarioLevelData {
  const data = ROCKY_ASCENT.levels.get(difficulty);
  if (!data) throw new Error(`Rocky Ascent has no level ${difficulty}`);
  return data;
}

/**
 * `config` and `data` are `unknown` on the scenario model: the host carries them
 * and only `ClimbMinigame` knows their shape. A test asserting on a foothold or
 * a bad-note policy is a climb test and has to say so.
 */
const ASCENT_CONFIG = climbConfig(ROCKY_ASCENT.config);

describe("Rocky Ascent scenario", () => {
  it("is a ClimbMinigame supporting exactly L1-L6", () => {
    expect(ROCKY_ASCENT.id).toBe("rocky_ascent");
    expect(ROCKY_ASCENT.minigameId).toBe("ClimbMinigame");
    expect(ROCKY_ASCENT.family).toBe("Scale");
    expect([...ROCKY_ASCENT.supportedLevels]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...ROCKY_ASCENT.levels.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("runs one continuous four-measure visual arc with no measure reset", () => {
    expect(climbLevel(level(1).data).visualSpanMeasures).toBe(4);
    expect(climbLevel(level(1).data).resetBetweenMeasures).toBe(false);
    expect(ASCENT_CONFIG.badNotePolicy).toBe("Wobble");
  });

  it.each(LEVELS)("L%i totals exactly 16 beats", (difficulty) => {
    const data = level(difficulty);
    const total = data.prompt.reduce((sum, event) => sum + event.durationBeats, 0);
    expect(total).toBe(16);
    expect(data.authoredBeatCount).toBe(16);
    expect(data.measurePlan.attemptMeasures * data.measurePlan.beatsPerMeasure).toBe(16);
  });

  it.each(LEVELS)("L%i has the authored number of note opportunities", (difficulty) => {
    const data = level(difficulty);
    const expected = EXPECTED_OPPORTUNITIES[difficulty];
    expect(data.noteOpportunityCount).toBe(expected);
    expect(data.prompt.filter((event) => event.type === "note")).toHaveLength(expected as number);
  });

  it.each(LEVELS)("L%i start beats are the running sum of the durations", (difficulty) => {
    let beat = 0;
    for (const event of level(difficulty).prompt) {
      expect(event.startBeat).toBeCloseTo(beat, 9);
      expect(event.measureIndex).toBe(Math.floor(beat / 4));
      expect(event.beatWithinMeasure).toBeCloseTo(beat % 4, 9);
      beat += event.durationBeats;
    }
  });

  it.each(LEVELS)("L%i rests carry no degree and create no opportunity", (difficulty) => {
    const rests = level(difficulty).prompt.filter((event) => event.type === "rest");
    for (const rest of rests) expect(rest.degree).toBeNull();
    expect(level(difficulty).prompt.length - rests.length).toBe(
      EXPECTED_OPPORTUNITIES[difficulty]
    );
  });

  it("L1 climbs the octave, restarts, and closes on a rest", () => {
    const tokens = level(1).prompt.map((e) => (e.degree ? formatDegreeToken(e.degree) : "rest"));
    expect(tokens).toEqual([
      ...OCTAVE,
      "1", "2", "3", "4", "5", "6", "7",
      "rest",
    ]);
    expect(level(1).prompt.every((e) => e.duration === "quarter")).toBe(true);
  });

  it("L2 leans on the leading tone at the end of each climb", () => {
    const halves = level(2).prompt.filter((e) => e.duration === "half");
    expect(halves.map((e) => formatDegreeToken(e.degree!))).toEqual(["7", "7"]);
    expect(halves.map((e) => e.startBeat)).toEqual([6, 14]);
  });

  it("L3 walks the top of the octave in quarters, resting between each step", () => {
    const tokens = level(3).prompt.map((e) => (e.degree ? formatDegreeToken(e.degree) : "rest"));
    expect(tokens).toEqual([
      "4", "rest", "5", "rest", "6", "rest", "7", "rest",
      "4", "5", "6", "7", "b1", "rest",
    ]);
    // The rests drop away for the second half: the same four steps, no breath.
    expect(level(3).prompt.slice(8).some((e) => e.type === "rest" && e.startBeat < 14)).toBe(false);
  });

  it("L4 climbs in overlapping three-note groups, each cut off by a rest", () => {
    const tokens = level(4).prompt.map((e) => (e.degree ? formatDegreeToken(e.degree) : "rest"));
    expect(tokens).toEqual([
      "3", "4", "5", "rest",
      "4", "5", "6", "rest",
      "5", "6", "7", "rest",
      "6", "7", "b1",
    ]);
    // The octave root is the arrival, and it is held: a half note to finish.
    expect(level(4).prompt.at(-1)?.duration).toBe("half");
  });

  it("L5 repeats the eight-note eighth octave twice after a half note on 7", () => {
    const eighths = level(5).prompt.filter((e) => e.duration === "eighth");
    expect(eighths).toHaveLength(16);
    expect(eighths.map((e) => formatDegreeToken(e.degree!))).toEqual([...OCTAVE, ...OCTAVE]);
    // The eighth run starts on beat 8 -- the second half of the attempt.
    expect(eighths[0]?.startBeat).toBe(8);
  });

  it("L6 is the octave plus a truncated second climb and a rest, played twice", () => {
    const tokens = level(6).prompt.map((e) => (e.degree ? formatDegreeToken(e.degree) : "rest"));
    const half = [...OCTAVE, "1", "2", "3", "4", "5", "6", "7", "rest"];
    expect(tokens).toEqual([...half, ...half]);
    expect(level(6).prompt.every((e) => e.duration === "eighth")).toBe(true);
    // Second pass starts exactly halfway through the attempt.
    expect(level(6).prompt[16]?.startBeat).toBe(8);
  });

  it.each(LEVELS)("L%i stays inside the one-octave vocabulary", (difficulty) => {
    for (const event of level(difficulty).prompt) {
      if (!event.degree) continue;
      expect(OCTAVE).toContain(formatDegreeToken(event.degree));
    }
  });

  /*
   * The authored route survives as an authoring check and nothing else.
   *
   * Its coordinates described positions in a scenario art panel; the actors
   * moved onto the note bars and nothing has read them since, so
   * `ClimbMinigame.parseLevel` validates the one thing they still assert about
   * the *music* — one waypoint per note opportunity — and discards the rest.
   * Testing the coordinates would be testing a space that no longer exists.
   */
  it.each(LEVELS)("L%i authors one waypoint per note opportunity", (difficulty) => {
    // Every Rocky level loads, which is the invariant passing. This pins the
    // count it is checked against.
    expect(level(difficulty).noteOpportunityCount).toBe(EXPECTED_OPPORTUNITIES[difficulty]);
  });

  it("refuses a route that has drifted from the phrase", () => {
    // The whole level object, not just its visual half: `parseLevel` is handed
    // the level and decides for itself which of it means anything to a climb.
    const level = {
      measurePlan: { visualSpanMeasures: 4, resetBetweenMeasures: false },
      visual: { route: { waypoints: [{ x: 0, y: 0 }] } },
    };
    expect(() => CLIMB_MINIGAME.parseLevel(level, { noteOpportunityCount: 15, measures: 4 })).toThrow(
      /one successful note must advance exactly one waypoint/
    );
  });

  it.each(LEVELS)("L%i star thresholds ascend and three stars means all Perfect", (difficulty) => {
    const data = level(difficulty);
    const { passThreshold, star2Threshold, star3Threshold } = data.stars;
    expect(passThreshold).toBeLessThan(star2Threshold);
    expect(star2Threshold).toBeLessThan(star3Threshold);
    // 10 judgment points per Perfect note -- see src/config/tuning.ts -- across
    // the whole attempt, which plays the authored phrase ATTEMPT_REPEATS times.
    expect(star3Threshold).toBe(data.noteOpportunityCount * 10 * ATTEMPT_REPEATS);
    expect(data.stars.provisional).toBe(true);
  });

  it.each(LEVELS)("L%i pass bar is a single clean pass, not a scaled one", (difficulty) => {
    // The one threshold the repeat deliberately does NOT scale. Passing is the
    // gate that ends a run, and leaving it where a four-measure attempt put it
    // is what lets a good second pass redeem a bad first read.
    const data = level(difficulty);
    const onePass = data.noteOpportunityCount * 10;
    expect(data.stars.passThreshold).toBe(Math.round(onePass * 0.45));
    expect(data.stars.passThreshold).toBeLessThan(onePass);
  });

  it("is eligible for the difficulties it authors and no others", () => {
    for (const difficulty of LEVELS) {
      expect(scenariosForDifficulty(difficulty)).toContain(ROCKY_ASCENT);
    }
    // Not "the pool is empty" — Rocky Ascent High authors 7, and this
    // scenario's own boundary is what is under test here. The registry's
    // pooling across scenarios is covered in scenario-registry.test.ts.
    for (const difficulty of [7]) {
      expect(scenariosForDifficulty(difficulty)).not.toContain(ROCKY_ASCENT);
    }
  });

  it("binds every class asset slot to a resolvable URL", () => {
    const bindings = ASCENT_CONFIG;
    expect(bindings.climberPoses).toHaveLength(4);
    expect(bindings.stepEffects).toHaveLength(2);
    const ids = [
      bindings.background,
      ...bindings.climberPoses,
      bindings.finishPose,
      ...bindings.waypointVisuals,
      bindings.destinationVisual,
      ...bindings.stepEffects,
    ];
    for (const id of ids) expect(ROCKY_ASCENT.assetUrls[id]).toMatch(/\.png$/);
  });
});
