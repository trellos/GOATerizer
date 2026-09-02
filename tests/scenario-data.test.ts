/**
 * Scenario-data validation.
 *
 * These assertions are the specification: the Rocky Ascent exercise is
 * hand-authored, and the counts below are the ones the design states. If a
 * future edit changes them, that has to be a deliberate design change, not a
 * silent one.
 */

import { describe, expect, it } from "vitest";

import { ROCKY_ASCENT, scenariosForDifficulty } from "../src/scenario/registry.js";
import { climbConfig, climbLevelData } from "../src/scenario/minigames/climb-minigame.js";
import { formatDegreeToken } from "../src/music/degrees.js";
import type { ScenarioLevelData } from "../src/scenario/types.js";

const LEVELS = [1, 2, 3, 4] as const;

/** difficulty -> note opportunities, from the Rocky Ascent specification. */
const EXPECTED_OPPORTUNITIES: Record<number, number> = { 1: 15, 2: 14, 3: 23, 4: 30 };

/** The whole authored vocabulary: one octave, root to root. */
const OCTAVE = ["1", "2", "3", "4", "5", "6", "7", "b1"] as const;

function level(difficulty: number): ScenarioLevelData {
  const data = ROCKY_ASCENT.levels.get(difficulty);
  if (!data) throw new Error(`Rocky Ascent has no level ${difficulty}`);
  return data;
}

/**
 * Rocky Ascent's climb halves, narrowed once.
 *
 * `config` and `data` are `unknown` on the scenario model: the host carries
 * them and only `ClimbMinigame` knows their shape. A test asserting on a route
 * or an asset slot is a climb test and has to say so.
 */
const ASCENT = climbConfig(ROCKY_ASCENT.config);
const climbLevel = (difficulty: number) =>
  climbLevelData(ROCKY_ASCENT.levels.get(difficulty)!.data);

describe("Rocky Ascent scenario", () => {
  it("is a ClimbMinigame supporting exactly L1-L4", () => {
    expect(ROCKY_ASCENT.id).toBe("rocky_ascent");
    expect(ROCKY_ASCENT.minigameId).toBe("ClimbMinigame");
    expect(ROCKY_ASCENT.family).toBe("Scale");
    expect([...ROCKY_ASCENT.supportedLevels]).toEqual([1, 2, 3, 4]);
    expect([...ROCKY_ASCENT.levels.keys()]).toEqual([1, 2, 3, 4]);
  });

  it("runs one continuous four-measure visual arc with no measure reset", () => {
    // Span and reset are per level now: a scenario whose visual cycle changes
    // with difficulty is exactly what BATTLE needs, and a scenario-wide flag
    // could not express it.
    for (const difficulty of LEVELS) {
      expect(climbLevel(difficulty).visualSpanMeasures).toBe(4);
      expect(climbLevel(difficulty).resetBetweenMeasures).toBe(false);
    }
    expect(ASCENT.badNotePolicy).toBe("Wobble");
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

  it("L3 repeats the eight-note eighth octave twice after a half note on 7", () => {
    const eighths = level(3).prompt.filter((e) => e.duration === "eighth");
    expect(eighths).toHaveLength(16);
    expect(eighths.map((e) => formatDegreeToken(e.degree!))).toEqual([...OCTAVE, ...OCTAVE]);
    // The eighth run starts on beat 8 -- the second half of the attempt.
    expect(eighths[0]?.startBeat).toBe(8);
  });

  it("L4 is the octave plus a truncated second climb and a rest, played twice", () => {
    const tokens = level(4).prompt.map((e) => (e.degree ? formatDegreeToken(e.degree) : "rest"));
    const half = [...OCTAVE, "1", "2", "3", "4", "5", "6", "7", "rest"];
    expect(tokens).toEqual([...half, ...half]);
    expect(level(4).prompt.every((e) => e.duration === "eighth")).toBe(true);
    // Second pass starts exactly halfway through the attempt.
    expect(level(4).prompt[16]?.startBeat).toBe(8);
  });

  it.each(LEVELS)("L%i stays inside the one-octave vocabulary", (difficulty) => {
    for (const event of level(difficulty).prompt) {
      if (!event.degree) continue;
      expect(OCTAVE).toContain(formatDegreeToken(event.degree));
    }
  });

  it.each(LEVELS)("L%i authors one waypoint per note opportunity", (difficulty) => {
    const data = level(difficulty);
    expect(climbLevel(difficulty).route.waypoints).toHaveLength(data.noteOpportunityCount);
  });

  it.each(LEVELS)("L%i waypoints stay inside normalised scenario space", (difficulty) => {
    for (const wp of climbLevel(difficulty).route.waypoints) {
      expect(wp.x).toBeGreaterThanOrEqual(0);
      expect(wp.x).toBeLessThanOrEqual(1);
      expect(wp.y).toBeGreaterThanOrEqual(0);
      expect(wp.y).toBeLessThanOrEqual(1);
    }
  });

  it.each(LEVELS)("L%i climbs: every waypoint is above the previous one", (difficulty) => {
    const waypoints = climbLevel(difficulty).route.waypoints;
    for (let i = 1; i < waypoints.length; i += 1) {
      // y is downwards, so "higher up the mountain" is a smaller y.
      expect(waypoints[i]!.y).toBeLessThan(waypoints[i - 1]!.y);
    }
    expect(waypoints[0]!.y).toBeLessThan(climbLevel(difficulty).route.startPosition.y);
  });

  it("escalates visually with difficulty", () => {
    const rise = (difficulty: number) => {
      const route = climbLevel(difficulty).route;
      const last = route.waypoints[route.waypoints.length - 1]!;
      return route.startPosition.y - last.y;
    };
    // L4's climb covers more vertical frame than L1's, on twice the steps.
    expect(rise(4)).toBeGreaterThan(rise(1));
    expect(rise(3)).toBeGreaterThan(rise(1));
    // ...and its summit sits nearer the top of the frame.
    const summitY = (d: number) => climbLevel(d).route.destination.y;
    expect(summitY(4)).toBeLessThan(summitY(3));
    expect(summitY(3)).toBeLessThan(summitY(2));
    expect(summitY(2)).toBeLessThan(summitY(1));
  });

  it.each(LEVELS)("L%i star thresholds ascend and three stars means all Perfect", (difficulty) => {
    const data = level(difficulty);
    const { passThreshold, star2Threshold, star3Threshold } = data.stars;
    expect(passThreshold).toBeLessThan(star2Threshold);
    expect(star2Threshold).toBeLessThan(star3Threshold);
    // 10 judgment points per Perfect note -- see src/config/tuning.ts.
    expect(star3Threshold).toBe(data.noteOpportunityCount * 10);
    expect(data.stars.provisional).toBe(true);
  });

  it("is eligible for the difficulties it authors and no others", () => {
    for (const difficulty of LEVELS) {
      expect(scenariosForDifficulty(difficulty)).toContain(ROCKY_ASCENT);
    }
    // Not "the pool is empty" — Rocky Ascent High now authors 5 and 6, and
    // this scenario's own boundary is what is under test here. The registry's
    // pooling across scenarios is covered in scenario-registry.test.ts.
    for (const difficulty of [5, 6, 7]) {
      expect(scenariosForDifficulty(difficulty)).not.toContain(ROCKY_ASCENT);
    }
  });

  it("binds every class asset slot to a resolvable URL", () => {
    const bindings = ASCENT.bindings;
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
