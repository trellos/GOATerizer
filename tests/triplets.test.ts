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
import {
  ATTEMPT_REPEATS,
  GOOD_WINDOW_FLOOR_BEATS,
  TIMING_WINDOWS_BEATS,
} from "../src/config/tuning.js";
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

/** Where the fixture's asset ids resolve to. The loader checks nothing else. */
const ASSET_URL = (id: string): string => `/${id}.png`;

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
    // A repeat scenario, because it is the family that authors no route: the
    // fixture is about the content model, and forty-eight waypoints of climb
    // geometry would be noise around it.
    minigameClass: "RepeatMinigame",
    family: "Triplets",
    visualVerb: "THREE-STEP",
    scenarioPremise: "a phrase of eighth-note triplets",
    supportedLevels: [1],
    classParameters: {
      visualSpanMeasures: 4,
      repeatMode: "sequence",
      performerMovesBetweenMeasures: false,
    },
    assetBindings: {
      background: ["bg"],
      performerNeutral: ["ready"],
      performerAction: ["action"],
      performerFinish: ["finish"],
      repeatTarget: ["can"],
      targetCompletedState: ["crushed"],
      impactEffects: ["impact"],
    },
    levels: {
      1: {
        difficulty: 1,
        measurePlan: {
          attemptMeasures: 4,
          beatsPerMeasure: 4,
          visualSpanMeasures: 4,
          resetBetweenMeasures: false,
        },
        prompt,
        noteOpportunityCount: prompt.filter((e) => e["type"] === "note").length,
        authoredBeatCount: 16,
        visual: {},
        stars: { passThreshold: 1, star2Threshold: 2, star3Threshold: 3 },
        scoring: { streakBonusEligible: true },
      },
    },
  };
}

function loadPrompt(prompt: readonly RawEvent[]): readonly PromptEvent[] {
  const scenario = loadScenario(scenarioWith(prompt), ASSET_URL);
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

  it("stays exact through the repeat that doubles the attempt", () => {
    // An attempt plays the phrase `ATTEMPT_REPEATS` times, and `resolveTargets`
    // expands it by adding whole phrases of 16 beats. The offset is an integer,
    // so the second pass's thirds are the first pass's thirds — but only
    // because the positions were exact to begin with. Float-summed, the drift
    // would be doubled here rather than merely carried.
    const level = loadScenario(scenarioWith(tripletPrompt()), ASSET_URL).levels.get(1)!;
    const targets = resolveTargets(level, KEY);
    const phrase = level.measurePlan.attemptMeasures * level.measurePlan.beatsPerMeasure;

    expect(targets).toHaveLength(48 * ATTEMPT_REPEATS);
    for (let i = 0; i < 48; i += 1) {
      expect(targets[48 + i]!.startBeat).toBe(targets[i]!.startBeat + phrase);
    }
    expect(targets[48 + 1]!.startBeat).toBe(phrase + THIRD);
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

  it("widens a triplet's window to its neighbour, and not one beat further", () => {
    const level = loadScenario(scenarioWith(tripletPrompt()), ASSET_URL).levels.get(1)!;
    const targets = resolveTargets(level, KEY);
    const windows = computeWindows(targets);
    const gap = targets[2]!.startBeat - targets[1]!.startBeat;

    // The rule: a Good window may reach as far as the next target's own attack,
    // but never past it. The neighbour clamp alone would give 1/6 here and
    // `GOOD_WINDOW_FLOOR_BEATS` alone would give 0.5 -- three times the gap,
    // which on one-pitch triplet material is unattributable.
    expect(windows[1]!.good).toBeCloseTo(gap, 12);
    expect(windows[1]!.good).toBeGreaterThan(TIMING_WINDOWS_BEATS.eighthTriplet.good);
    expect(windows[1]!.good).toBeLessThan(GOOD_WINDOW_FLOOR_BEATS);
    expect(windows[1]!.perfect).toBe(TIMING_WINDOWS_BEATS.eighthTriplet.perfect);
  });

  it("leaves every shipped duration's window exactly where main put it", () => {
    // The floor change has to be invisible to the material that exists. Half,
    // quarter and eighth all have a nearest neighbour of half a beat or more,
    // so the flat floor and the capped one agree on all of them.
    for (const gap of [0.5, 1, 2, 4]) {
      const at = (i: number) => ({
        opportunityIndex: i,
        promptIndex: i,
        pass: 0,
        startBeat: i * gap,
        durationBeats: gap,
        duration: gap >= 2 ? ("half" as const) : gap === 1 ? ("quarter" as const) : ("eighth" as const),
        degree: { degree: 1, accidental: null } as never,
        lane: 0,
        midi: 60,
      });
      const windows = computeWindows([at(0), at(1), at(2)]);
      expect(windows[1]!.good).toBe(GOOD_WINDOW_FLOOR_BEATS);
    }
  });

  it("scores three notes a third of a beat apart without one stealing another", () => {
    const level = loadScenario(scenarioWith(tripletPrompt()), ASSET_URL).levels.get(1)!;
    const targets = resolveTargets(level, KEY);
    const events: JudgmentEvent[] = [];
    const judge = new TargetJudge({ targets, key: KEY });
    judge.onEvent((event) => events.push(event));

    // The first beat's three notes, each played dead on its own third.
    for (let i = 0; i < 3; i += 1) {
      judge.attack(`a${i}`, targets[i]!.midi, targets[i]!.startBeat);
      judge.release(`a${i}`, targets[i]!.startBeat + targets[i]!.durationBeats);
    }
    // Past the third note's window (2/3 + 1/6) but not the fourth's, so any
    // miss reported here is one of these three.
    judge.tick(0.9);

    expect(judge.outcomes.slice(0, 3)).toEqual(["perfect", "perfect", "perfect"]);
    expect(events.filter((e) => e.type === "PerfectNote")).toHaveLength(3);
    expect(events.filter((e) => e.type === "MissedNote")).toHaveLength(0);
  });

  it("will not let a triplet attack reach a target past its own neighbour", () => {
    const level = loadScenario(scenarioWith(tripletPrompt()), ASSET_URL).levels.get(1)!;
    const targets = resolveTargets(level, KEY);
    const judge = new TargetJudge({ targets, key: KEY });
    const gap = targets[1]!.startBeat - targets[0]!.startBeat;

    // Two whole triplets early. Inside a flat 0.5-beat floor, outside the
    // capped one -- this is the case the cap exists for.
    judge.attack("early", targets[2]!.midi, targets[2]!.startBeat - gap * 2 - 1e-6);
    expect(judge.outcomes[2]).toBeNull();
  });

  it("still resolves one played note to exactly one target", () => {
    // The windows now overlap -- each triplet's reaches its neighbour's attack
    // -- so the guarantee is structural rather than geometric: `#findMatch`
    // filters by pitch and never re-offers a resolved target.
    const level = loadScenario(scenarioWith(tripletPrompt()), ASSET_URL).levels.get(1)!;
    const targets = resolveTargets(level, KEY);
    const judge = new TargetJudge({ targets, key: KEY });

    judge.attack("a", targets[1]!.midi, targets[1]!.startBeat);
    // Claimed by the attack, judged at the release: one target either way.
    expect(judge.pendingTargetCount).toBe(1);
    judge.release("a", targets[1]!.startBeat + targets[1]!.durationBeats);
    const resolved = judge.outcomes.filter((outcome) => outcome !== null);
    expect(resolved).toHaveLength(1);
  });
});
