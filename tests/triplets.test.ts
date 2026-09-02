/**
 * The triplet content model.
 *
 * GOATerizer could always *hear* a triplet — `subdivisionsOf` reads the grid off
 * note positions so the drums can mark it — but until this change it could not
 * *author* one: there was no `NoteDuration` for a third of a beat, the loader
 * demanded an exact `durationBeats` match, and the timing table had no row to
 * judge one against. That blocked the whole THREE-STEP family.
 *
 * These tests are the proof that a triplet now survives every stage: it loads,
 * it lands on exact positions, the drums see it, and the judge scores it without
 * three notes a third of a beat apart stealing each other's attacks.
 */

import { describe, expect, it } from "vitest";

import { DURATION_BEATS } from "../src/scenario/types.js";
import { TIMING_WINDOWS_BEATS } from "../src/config/tuning.js";
import { computeWindows, TargetJudge, type JudgmentEvent } from "../src/game/judgment.js";
import { loadScenario, ScenarioDataError } from "../src/scenario/load.js";
// Imported for its side effect: the composition root is where minigames
// register, and the fixture below names one.
import "../src/scenario/registry.js";
import { resolveTargets } from "../src/game/targets.js";
import { subdivisionsOf } from "../src/game/subdivisions.js";
import type { RunKey } from "../src/music/keys.js";
import type { PromptEvent } from "../src/scenario/types.js";

const KEY: RunKey = { tonic: 7, mode: "minor" };

const THIRD = 1 / 3;

/** One authored prompt event, written the way a scenario file writes them. */
type RawEvent = Record<string, unknown>;

/**
 * A beat of eighth-note triplets, written as an author would write it.
 *
 * `startBeat` is stated to three decimals on purpose: no decimal is exactly a
 * third, and the loader has to accept a faithful transcription while still
 * catching a wrong one.
 */
function tripletBeat(beat: number, degrees: readonly [string, string, string]): RawEvent[] {
  return degrees.map((degree, i) => ({
    type: "note",
    duration: "eighthTriplet",
    durationBeats: 0.333,
    startBeat: Number((beat + i / 3).toFixed(3)),
    scaleDegree: degree,
  }));
}

/** Four measures of triplets: twelve to a measure, forty-eight in all. */
function tripletPrompt(): RawEvent[] {
  const events: RawEvent[] = [];
  const octave = ["1", "2", "3", "4", "5", "6", "7", "b1"] as const;
  for (let beat = 0; beat < 16; beat += 1) {
    const at = (i: number) => octave[(beat * 3 + i) % octave.length]!;
    events.push(...tripletBeat(beat, [at(0), at(1), at(2)]));
  }
  return events;
}

function scenarioWith(prompt: readonly RawEvent[]): unknown {
  return {
    id: "triplet_probe",
    displayName: "Triplet Probe",
    theme: "none",
    // A real registered minigame, so the fixture exercises the whole loader
    // rather than the host half of it. Nothing here is about climbing.
    minigameClass: "ClimbMinigame",
    family: "Triplets",
    visualVerb: "THREE-STEP",
    scenarioPremise: "a phrase of eighth-note triplets",
    supportedLevels: [1],
    classParameters: { badNotePolicy: "Wobble" },
    assetBindings: {
      background: ["bg"],
      climberPoses: ["pose"],
      finishPose: ["finish"],
      destinationVisual: ["goal"],
      stepEffects: ["fx_a", "fx_b"],
      footholdArt: { body: ["body"], crag: ["crag"] },
    },
    levels: {
      1: {
        difficulty: 1,
        measurePlan: { attemptMeasures: 4, beatsPerMeasure: 4 },
        prompt,
        noteOpportunityCount: prompt.filter((e) => e["type"] === "note").length,
        authoredBeatCount: 16,
        visual: { visualSpanMeasures: 4, resetBetweenMeasures: false },
        stars: { passThreshold: 1, star2Threshold: 2, star3Threshold: 3 },
        scoring: { streakBonusEligible: true },
      },
    },
  };
}

function loadPrompt(prompt: readonly RawEvent[]): readonly PromptEvent[] {
  const scenario = loadScenario(scenarioWith(prompt), (id) => `/${id}.png`);
  return scenario.levels.get(1)!.prompt;
}

describe("authoring a triplet", () => {
  it("accepts a phrase of thirds and gives every note an exact position", () => {
    const prompt = loadPrompt(tripletPrompt());

    expect(prompt).toHaveLength(48);
    expect(prompt[0]!.startBeat).toBe(0);
    expect(prompt[1]!.startBeat).toBe(THIRD);
    expect(prompt[2]!.startBeat).toBe(2 * THIRD);
    // The authored 0.333s are discarded: the model carries the real length.
    expect(prompt[1]!.durationBeats).toBe(DURATION_BEATS.eighthTriplet);
  });

  it("lands on beat 1 rather than a hair below it", () => {
    // The whole reason positions accumulate on a tick grid. A running float sum
    // of thirds reaches 0.9999999999999999 here, and 3.999999999999999 at the
    // end — which would have put the last note in measure 3 and failed the
    // total-length check.
    const prompt = loadPrompt(tripletPrompt());

    expect(prompt[3]!.startBeat).toBe(1);
    expect(prompt[3]!.measureIndex).toBe(0);
    expect(prompt[3]!.beatWithinMeasure).toBe(1);
    expect(prompt[12]!.startBeat).toBe(4);
    expect(prompt[12]!.measureIndex).toBe(1);
    expect(prompt[12]!.beatWithinMeasure).toBe(0);
    expect(prompt[47]!.startBeat).toBeCloseTo(16 - THIRD, 12);
    expect(prompt[47]!.measureIndex).toBe(3);
  });

  it("still rejects a duration that is wrong rather than merely inexact", () => {
    const wrong = tripletPrompt();
    // A quarter where a triplet belongs: within no tolerance anyone would want.
    wrong[0] = { ...wrong[0]!, duration: "quarter", durationBeats: 1 };
    expect(() => loadPrompt(wrong)).toThrow(ScenarioDataError);
  });

  it("still catches a dropped note through the stated startBeat", () => {
    // The authored positions are what make this an error: derive the positions
    // alone and a missing note would silently shift the rest of the phrase.
    const short = tripletPrompt().slice(1);
    expect(() => loadPrompt(short)).toThrow(/startBeat/);
  });

  it("still catches a phrase that does not fill its measures", () => {
    expect(() => loadPrompt(tripletPrompt().slice(0, 45))).toThrow(/durations total/);
  });
});

describe("a triplet on the timeline and under the judge", () => {
  it("tells the drums the grid is triplets, not eighths", () => {
    const grid = subdivisionsOf(loadPrompt(tripletPrompt()));
    expect([...grid]).toEqual(["triplet"]);
  });

  it("gives each triplet its own timing window", () => {
    const level = loadScenario(scenarioWith(tripletPrompt()), (id) => id).levels.get(1)!;
    const windows = computeWindows(resolveTargets(level, KEY));

    // Neighbours a third apart, so the clamp lands exactly on the authored row.
    expect(windows[1]!.good).toBeCloseTo(TIMING_WINDOWS_BEATS.eighthTriplet.good, 12);
    expect(windows[1]!.good).toBeLessThan(TIMING_WINDOWS_BEATS.eighth.good);
    expect(windows[1]!.good).toBeGreaterThan(TIMING_WINDOWS_BEATS.sixteenth.good);
    expect(windows[1]!.perfect).toBe(TIMING_WINDOWS_BEATS.eighthTriplet.perfect);
  });

  it("scores three notes a third of a beat apart without one stealing another", () => {
    const level = loadScenario(scenarioWith(tripletPrompt()), (id) => id).levels.get(1)!;
    const targets = resolveTargets(level, KEY);
    const events: JudgmentEvent[] = [];
    const judge = new TargetJudge({ targets, key: KEY });
    judge.onEvent((event) => events.push(event));

    // The first beat's three notes, each played dead on its own third.
    for (let i = 0; i < 3; i += 1) {
      judge.attack(`a${i}`, targets[i]!.midi, targets[i]!.startBeat);
    }
    // Past the third note's window (2/3 + 1/6) but not the fourth's, so any
    // miss reported here is one of these three.
    judge.tick(0.9);

    expect(judge.outcomes.slice(0, 3)).toEqual(["perfect", "perfect", "perfect"]);
    expect(events.filter((e) => e.type === "PerfectNote")).toHaveLength(3);
    expect(events.filter((e) => e.type === "MissedNote")).toHaveLength(0);
  });

  it("will not let a triplet attack reach the target a third of a beat away", () => {
    const level = loadScenario(scenarioWith(tripletPrompt()), (id) => id).levels.get(1)!;
    const targets = resolveTargets(level, KEY);
    const judge = new TargetJudge({ targets, key: KEY });

    // The second triplet's pitch, played where the *first* one belongs. A third
    // of a beat is outside its Good window (1/6), so it matches nothing.
    judge.attack("late", targets[1]!.midi, targets[0]!.startBeat);
    expect(judge.outcomes[1]).toBeNull();
  });
});
