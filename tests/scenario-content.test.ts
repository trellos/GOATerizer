/**
 * The whole scenario library, checked as *content* rather than as a transcript.
 *
 * The tests here never name a note, a level number or a scenario id that is not
 * structural, and that is the entire point. The suite used to assert things like
 * `GOAT_FRONTMAN.supportedLevels` is `[1, 2, 3, 4]` and that L1's prompt reads
 * `"p1 p2 p3 p4 p5 p6 R …"` verbatim — true when written, and false the next
 * time anybody opened the minigame editor, which is a tool that exists to make
 * them false. A test that goes red on ordinary authoring trains its owner to
 * ignore it, and it went red on six real edits without noticing the one thing
 * that actually broke: three Goat Frontman levels lost every flourish they had.
 *
 * So these are invariants over whatever is authored. They pass for content that
 * does not exist yet, they survive the ladder being reordered or a difficulty
 * being deleted, and they fail for a level that has quietly stopped working.
 *
 * The family half is `MinigameAuthoring.reviewLevel`: each minigame reports when
 * its own mechanic cannot happen in a level as authored, and this is where that
 * report is binding. The editor shows the same findings without blocking a save,
 * because an author mid-edit is allowed to be half-finished and a repository is
 * not.
 */

import { describe, expect, it } from "vitest";

import { ATTEMPT_REPEATS, BEATS_PER_MEASURE, PHRASE_MEASURES } from "../src/config/tuning.js";
import { MAX_INTENSITY, MIN_INTENSITY } from "../src/audio/drum-pattern.js";
import { requireMinigame } from "../src/minigame/registry.js";
import {
  SCENARIOS,
  SCENARIO_SOURCES,
  scenariosForDifficulty,
} from "../src/scenario/registry.js";
import type { ScenarioDefinition } from "../src/scenario/types.js";

/** The authored JSON of each scenario, by id — what a family reviews. */
const SOURCES = new Map(
  SCENARIO_SOURCES.map((source) => [
    (source.raw as { id: string }).id,
    (source.raw as { levels: Record<string, Record<string, unknown>> }).levels,
  ])
);

/**
 * Every (scenario, difficulty) pair the library authors, as test cases.
 *
 * Derived from the registry rather than listed, so a scenario added by dropping
 * a file into `docs/scenarios/` is covered by everything below without anybody
 * remembering to add it — which is the same rule `registry.ts` itself follows.
 */
const AUTHORED: [string, number, ScenarioDefinition][] = SCENARIOS.flatMap((scenario) =>
  [...scenario.levels.keys()]
    .sort((a, b) => a - b)
    .map((difficulty) => [scenario.id, difficulty, scenario] as [string, number, ScenarioDefinition])
);

/** The raw authored level, which is what `reviewLevel` reads. */
function rawLevel(id: string, difficulty: number): Record<string, unknown> {
  const level = SOURCES.get(id)?.[String(difficulty)];
  if (!level) throw new Error(`no authored JSON for ${id} L${difficulty}`);
  return level;
}

describe("the scenario library", () => {
  it("authors at least one level, or there is nothing to test", () => {
    expect(AUTHORED.length).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------------- */
  /* What a scenario says about itself                                       */
  /* ---------------------------------------------------------------------- */

  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    "%s declares exactly the levels it authors",
    (_id, scenario) => {
      // The invariant the old literal lists were reaching for. A scenario that
      // advertises a difficulty it has no data for is picked by `run.ts` and
      // then cannot be played, which is the failure worth catching; which
      // difficulties it happens to author today is the designer's business.
      expect([...scenario.supportedLevels].sort((a, b) => a - b)).toEqual(
        [...scenario.levels.keys()].sort((a, b) => a - b)
      );
    }
  );

  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    "%s belongs to a registered minigame family",
    (_id, scenario) => {
      expect(() => requireMinigame(scenario.minigameId, "the content test")).not.toThrow();
      expect(scenario.family.length).toBeGreaterThan(0);
    }
  );

  it("covers every difficulty the run can ask for", () => {
    // `run.ts` walks `DIFFICULTY_SEQUENCE`, and a difficulty no scenario
    // authors is a run that cannot fill a slot. This is the claim the
    // per-difficulty id lists were making, without pinning which scenarios
    // happen to satisfy it.
    for (let difficulty = MIN_INTENSITY; difficulty <= MAX_INTENSITY; difficulty += 1) {
      expect(
        scenariosForDifficulty(difficulty).length,
        `nothing authors difficulty ${difficulty}`
      ).toBeGreaterThan(0);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* What a level has to be                                                  */
  /* ---------------------------------------------------------------------- */

  it.each(AUTHORED)("%s L%i is a whole phrase with notes in it", (_id, difficulty, scenario) => {
    const level = scenario.levels.get(difficulty)!;
    // `toBeCloseTo`, and the tolerance is the point rather than a shrug. The
    // loader is where "totals sixteen beats" is enforced *exactly*, on an
    // integer tick grid, precisely because a triplet is a third of a beat and
    // three of them do not sum to 1 in binary floating point — a scenario that
    // failed it would have thrown on import and taken this whole file with it.
    // This is the weaker claim that the runtime model still agrees, and summing
    // its floats is how a bar of triplets lands on 16.00000000000001.
    const beats = level.prompt.reduce((sum, event) => sum + event.durationBeats, 0);
    expect(beats).toBeCloseTo(PHRASE_MEASURES * BEATS_PER_MEASURE, 6);
    expect(level.prompt.filter((event) => event.type === "note")).toHaveLength(
      level.noteOpportunityCount
    );
    // A difficulty with nothing to play is not a difficulty (DECISION-057), and
    // by the time it reaches the registry it should have left the ladder.
    expect(level.noteOpportunityCount).toBeGreaterThan(0);
  });

  it.each(AUTHORED)("%s L%i has a star ladder that ascends", (_id, difficulty, scenario) => {
    const { passThreshold, star2Threshold, star3Threshold } = scenario.levels.get(difficulty)!.stars;
    expect(passThreshold).toBeLessThan(star2Threshold);
    expect(star2Threshold).toBeLessThan(star3Threshold);
    expect(passThreshold).toBeGreaterThan(0);
  });

  it.each(AUTHORED)("%s L%i states the difficulty it is filed under", (_id, difficulty, scenario) => {
    expect(scenario.levels.get(difficulty)!.difficulty).toBe(difficulty);
  });

  /* ---------------------------------------------------------------------- */
  /* What the family says about it                                           */
  /* ---------------------------------------------------------------------- */

  it.each(AUTHORED)("%s L%i satisfies its own minigame family", (_id, difficulty, scenario) => {
    const minigame = requireMinigame(scenario.minigameId, "the content test");
    const review = minigame.authoring?.reviewLevel;
    if (!review) return;

    const level = scenario.levels.get(difficulty)!;
    const findings = review(rawLevel(scenario.id, difficulty), {
      difficulty,
      noteOpportunityCount: level.noteOpportunityCount,
      measures: PHRASE_MEASURES,
      attemptRepeats: ATTEMPT_REPEATS,
      noteStartBeats: level.prompt
        .filter((event) => event.type === "note")
        .map((event) => event.startBeat),
    });
    expect(findings, `${scenario.displayName} L${difficulty}: ${findings.join("; ")}`).toEqual([]);
  });

  it("records the family's verdict in the level's own validation block", () => {
    // The block exists in every authored level and used to be stamped `ok`
    // unconditionally by the editor, which made it a field that could only say
    // one thing. It is written from the review now, so a file carries its own
    // findings and a reviewer reading the diff can see them.
    for (const [id, difficulty] of AUTHORED) {
      const validation = rawLevel(id, difficulty)["validation"] as { status?: string } | undefined;
      expect(validation?.status, `${id} L${difficulty}`).toBeDefined();
    }
  });
});
