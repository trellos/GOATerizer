/**
 * Integration: guitar event -> beat -> judgment -> score, stars and the run.
 *
 * Everything here runs on the deterministic test input provider, so the whole
 * causal chain is exercised without a microphone. The visual layer is not
 * involved.
 *
 * What the actors do with a judgment lives in `timeline-actors.test.ts` (the
 * goat) and `can-crushing.test.ts` (the crusher). This file is the layer under
 * them: that an attempt scores and stars what it should, and that the run shell
 * sequences sixteen of them.
 */

import { describe, expect, it } from "vitest";

import { ATTEMPT_BEATS, ATTEMPT_REPEATS } from "../src/config/tuning.js";
import { planAutoPerformance, type AutoplayMode } from "../src/dev/auto-performance.js";
import { AttemptRuntime, type AttemptEvent, type AttemptResult } from "../src/game/attempt.js";
import { rankForStars, GOAT_RANKS } from "../src/game/ranks.js";
import { DIFFICULTY_SEQUENCE, RunState, RUN_SLOT_COUNT } from "../src/game/run.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import { ROCKY_ASCENT, scenariosForDifficulty } from "../src/scenario/registry.js";
import type { RunKey } from "../src/music/keys.js";

const KEY: RunKey = { tonic: 7, mode: "minor" };
const BPM = 120;
const SECONDS_PER_BEAT = 60 / BPM;

/**
 * An attempt driven by injected guitar input on a fake audio clock.
 *
 * `startBeat` is deliberately not 0: an attempt begins wherever the continuous
 * transport happens to be, and off-by-one errors there would otherwise hide.
 */
function harness(difficulty: number, startBeat = 20) {
  const provider = new TestGuitarInputProvider();
  const toBeat = (contextTime: number) => contextTime / SECONDS_PER_BEAT;
  const attempt = new AttemptRuntime({
    scenario: ROCKY_ASCENT,
    difficulty,
    key: KEY,
    startBeat,
    toBeat,
  });

  const events: AttemptEvent[] = [];
  attempt.onEvent((event) => events.push(event));

  const clock = { time: startBeat * SECONDS_PER_BEAT };
  provider.onEvent((event) => attempt.handleGuitarEvent(event));
  void provider.start();

  const advanceTo = (attemptBeat: number) => {
    clock.time = (startBeat + attemptBeat) * SECONDS_PER_BEAT;
    provider.pump(clock.time);
    attempt.update(startBeat + attemptBeat);
  };

  const playAt = (midi: number, attemptBeat: number, offsetBeats = 0) => {
    const at = (startBeat + attemptBeat + offsetBeats) * SECONDS_PER_BEAT;
    clock.time = Math.max(clock.time, at);
    provider.attack(midi, at);
  };

  return { attempt, provider, events, advanceTo, playAt, clock };
}

/** Plays a whole level perfectly, note by note, advancing the clock as it goes. */
function playFlawlessly(difficulty: number): {
  attempt: AttemptRuntime;
  result: AttemptResult;
} {
  const h = harness(difficulty);
  for (const target of h.attempt.targets) {
    h.advanceTo(target.startBeat);
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(target.startBeat + 0.001);
  }
  h.advanceTo(ATTEMPT_BEATS);
  const result = h.attempt.result;
  if (!result) throw new Error("attempt did not complete");
  return { attempt: h.attempt, result };
}

describe("a whole attempt", () => {
  it("earns three stars for a flawless L1 and updates every counter", () => {
    const { attempt, result } = playFlawlessly(1);
    // Every opportunity in the attempt, which is the authored phrase played
    // ATTEMPT_REPEATS times over.
    expect(attempt.targets).toHaveLength(15 * ATTEMPT_REPEATS);
    expect(result).toMatchObject({
      scenarioId: "rocky_ascent",
      difficulty: 1,
      stars: 3,
      passed: true,
      perfect: attempt.targets.length,
      good: 0,
      missed: 0,
      wrongNotes: 0,
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.judgmentPoints).toBe(ROCKY_ASCENT.levels.get(1)!.stars.star3Threshold);
  });

  it.each([1, 2, 3, 4])("can be three-starred at L%i", (difficulty) => {
    const { result } = playFlawlessly(difficulty);
    expect(result.stars).toBe(3);
  });

  it("fails with zero stars when nothing is played", () => {
    const h = harness(2);
    h.advanceTo(ATTEMPT_BEATS);
    expect(h.attempt.result).toMatchObject({
      stars: 0,
      passed: false,
      missed: h.attempt.targets.length,
    });
  });

  it("lets a clean second pass rescue a botched first one", () => {
    // The reason an attempt plays its phrase twice. The player meets the
    // material cold, makes a mess of it, and the repeat is their chance to
    // put it right — so the same performance that would have failed a
    // single-pass attempt now clears the bar.
    const h = harness(1);
    const half = h.attempt.targets.length / ATTEMPT_REPEATS;
    h.attempt.targets.forEach((target, index) => {
      h.advanceTo(target.startBeat);
      if (index >= half) h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.001);
    });
    h.advanceTo(ATTEMPT_BEATS);
    const result = h.attempt.result!;

    expect(result.missed).toBe(half);
    expect(result.perfect).toBe(half);
    expect(result.passed).toBe(true);
    // And it is genuinely a rescue, not a free pass: one clean half is worth a
    // star, not three.
    expect(result.stars).toBeLessThan(3);
    // The same points would have been a fail before the repeat, because the
    // bar is deliberately still a single clean pass rather than half of two.
    expect(result.judgmentPoints).toBeGreaterThanOrEqual(
      ROCKY_ASCENT.levels.get(1)!.stars.passThreshold
    );
  });

  it("survives with one star on a scruffy but mostly-right attempt", () => {
    const h = harness(1);
    h.attempt.targets.forEach((target, index) => {
      h.advanceTo(target.startBeat);
      if (index % 5 !== 0) h.playAt(target.midi, target.startBeat, 0.35); // Good
      h.advanceTo(target.startBeat + 0.4);
    });
    h.advanceTo(ATTEMPT_BEATS);
    const result = h.attempt.result!;
    expect(result.passed).toBe(true);
    expect(result.stars).toBeGreaterThanOrEqual(1);
    expect(result.stars).toBeLessThan(3);
    expect(result.good).toBeGreaterThan(0);
  });

  it("refuses a difficulty the scenario does not author", () => {
    expect(
      () =>
        new AttemptRuntime({
          scenario: ROCKY_ASCENT,
          difficulty: 6,
          key: KEY,
          startBeat: 0,
          toBeat: (t) => t,
        })
    ).toThrow(/no authored level 6/);
  });
});

describe("run shell", () => {
  it("models 16 slots on the real difficulty sequence", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    expect(run.slots).toHaveLength(RUN_SLOT_COUNT);
    expect(run.slots.map((slot) => slot.difficulty)).toEqual([...DIFFICULTY_SEQUENCE]);
    expect(DIFFICULTY_SEQUENCE).toEqual([1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7]);
  });

  it("fills only the slots the library actually authors", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    for (const slot of run.slots) {
      const eligibleIds = scenariosForDifficulty(slot.difficulty).map((scenario) => scenario.id);
      if (eligibleIds.length === 0) {
        expect(slot.scenario).toBeNull();
      } else {
        expect(slot.scenario).not.toBeNull();
        expect(eligibleIds).toContain(slot.scenario!.id);
      }
    }
  });

  it("pins every eligible slot to one scenario, for developer use", () => {
    const run = new RunState({
      key: KEY,
      bpm: BPM,
      random: () => 0,
      pinnedScenarioId: "can_crushing",
    });
    for (const slot of run.slots) {
      const eligible = scenariosForDifficulty(slot.difficulty).map((scenario) => scenario.id);
      // Where it is not eligible, selection carries on as normal rather than
      // leaving the slot empty.
      if (eligible.includes("can_crushing")) expect(slot.scenario?.id).toBe("can_crushing");
      else if (eligible.length > 0) expect(slot.scenario).not.toBeNull();
    }
  });

  it("ignores a pin naming a scenario that does not exist", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0, pinnedScenarioId: "nope" });
    const normal = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    expect(run.slots.map((slot) => slot.scenario?.id ?? null)).toEqual(
      normal.slots.map((slot) => slot.scenario?.id ?? null)
    );
  });

  it("ends the run at the first slot nothing authors, as a content limit", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    const pass = (stars: number): AttemptResult => ({
      scenarioId: run.currentSlot!.scenario!.id,
      difficulty: run.currentSlot!.difficulty,
      stars,
      passed: stars >= 1,
      score: 100,
      judgmentPoints: 100,
      perfect: 1,
      good: 0,
      missed: 0,
      wrongNotes: 0,
      streak: 1,
      bestStreak: 1,
    });

    // DIFFICULTY_SEQUENCE is [1,2,3,4,2,3,4,5,3,4,5,6,4,5,6,7]. With Rocky
    // Ascent High and Rocky Descent High registered, every difficulty up to 6
    // is authored by something -- slots 0..14 are all difficulties 1..6, and
    // only the final slot (difficulty 7) is a real content limit.
    for (let i = 0; i < 14; i += 1) expect(run.recordResult(pass(2))).toBeNull();
    // Passing slot 14 (difficulty 6, the last authored slot) lands on slot 15,
    // difficulty 7, which nothing in the library authors.
    expect(run.recordResult(pass(2))).toBe("content-limit");
    expect(run.over).toBe(true);
    expect(run.slotsPlayed).toBe(15);
    expect(run.totalStars).toBe(30);
    expect(run.summary.ending).toBe("content-limit");
  });

  it("ends immediately on a zero-star attempt", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    const ending = run.recordResult({
      scenarioId: "rocky_ascent",
      difficulty: 1,
      stars: 0,
      passed: false,
      score: 0,
      judgmentPoints: 0,
      perfect: 0,
      good: 0,
      missed: 15,
      wrongNotes: 0,
      streak: 0,
      bestStreak: 0,
    });
    expect(ending).toBe("failed");
    expect(run.summary.rank).toBe("Hairless Baby Lamb");
  });

  it("shows the upcoming scenario before the current one ends", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    expect(run.currentSlot?.ordinal).toBe(0);
    expect(run.nextSlot?.ordinal).toBe(1);
    expect(run.previousSlot).toBeNull();
  });

  it("has a rank for every possible star total", () => {
    expect(GOAT_RANKS).toHaveLength(49);
    expect(rankForStars(0)).toBe("Hairless Baby Lamb");
    expect(rankForStars(48)).toBe("GOAT Markhor");
    expect(new Set(GOAT_RANKS).size).toBe(49);
  });
});

/**
 * Autoplay, end to end, through the same sink the app uses.
 *
 * The planner's own tests prove the gestures are well-formed; these prove the
 * tiers mean what they claim once a real judge, a real score and a real star
 * meter have had them — which is the only definition of "50% correct" that
 * matters. Scheduling `attack` + `release` pairs rather than bare attacks
 * mirrors `#scheduleAutoPerformance` exactly, releases included.
 */
function playAutoPerformance(difficulty: number, mode: AutoplayMode, seed = 7) {
  const startBeat = 20;
  const h = harness(difficulty, startBeat);
  const performance = planAutoPerformance({
    targets: h.attempt.targets,
    mode,
    seed,
    attemptIndex: 0,
  });

  performance.gestures.forEach((gesture, index) => {
    const at = (startBeat + gesture.beat) * SECONDS_PER_BEAT;
    const id = `auto-${index}`;
    h.provider.schedule([
      { at, kind: "attack", midi: gesture.midi, id },
      { at: at + gesture.durationBeats * SECONDS_PER_BEAT, kind: "release", id },
    ]);
  });

  // Small steps, so the queue drains in order and `tick` expires targets on
  // time rather than all at once at the end.
  for (let beat = 0; beat <= ATTEMPT_BEATS; beat += 0.125) h.advanceTo(beat);
  const result = h.attempt.result;
  if (!result) throw new Error("attempt did not complete");
  return { performance, result };
}

describe("autoplay tiers", () => {
  it("plays a flawless attempt at 100%, worth three stars", () => {
    // The unit-level guard on browser-validate's "three stars for a flawless
    // attempt": if this tier ever stops being perfect, the browser suite starts
    // failing for a reason that has nothing to do with the browser.
    for (const difficulty of [1, 2, 3, 4]) {
      const { result } = playAutoPerformance(difficulty, "perfect");
      expect(result).toMatchObject({ missed: 0, wrongNotes: 0, good: 0, stars: 3 });
      expect(result.passed).toBe(true);
    }
  });

  it("fumbles audibly at 50%: some hits, some wrong notes, some misses", () => {
    const { result } = playAutoPerformance(3, "50");
    expect(result.perfect + result.good).toBeGreaterThan(0);
    expect(result.missed).toBeGreaterThan(0);
    expect(result.wrongNotes).toBeGreaterThan(0);
    expect(result.stars).toBeLessThan(3);
  });

  it("hits less often at 25% than at 50%, on the same seed", () => {
    for (const seed of [1, 7, 42]) {
      const half = playAutoPerformance(3, "50", seed).result;
      const quarter = playAutoPerformance(3, "25", seed).result;
      expect(quarter.perfect + quarter.good).toBeLessThan(half.perfect + half.good);
      expect(quarter.stars).toBeLessThanOrEqual(half.stars);
    }
  });

  it("intends exactly what the judge then sees, on the deterministic sink", () => {
    // The test provider injects already-judged events, so intent and outcome
    // must agree exactly here. Any drift means the planner and the judge
    // disagree about what counts as a hit.
    const { performance, result } = playAutoPerformance(2, "50");
    expect(result.perfect + result.good).toBe(performance.counts.hits);
    expect(result.missed).toBe(performance.counts.wrong + performance.counts.dropped);
  });
});
