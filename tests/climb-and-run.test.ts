/**
 * Integration: guitar event -> beat -> judgment -> energy -> scenario.
 *
 * Everything here runs on the deterministic test input provider, so the whole
 * causal chain is exercised without a microphone. The visual layer is not
 * involved; what is asserted is that the goat moves exactly when the design
 * says it moves.
 */

import { describe, expect, it } from "vitest";

import { AttemptRuntime, type AttemptEvent, type AttemptResult } from "../src/game/attempt.js";
import { rankForStars, GOAT_RANKS } from "../src/game/ranks.js";
import { DIFFICULTY_SEQUENCE, RunState, RUN_SLOT_COUNT } from "../src/game/run.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import { ClimbMinigame } from "../src/scenario/minigames/climb-minigame.js";
import { ROCKY_ASCENT, scenariosForDifficulty } from "../src/scenario/registry.js";
import type { RunKey } from "../src/music/keys.js";
import type { ClimbAssetBindings, ClimbClassParameters } from "../src/scenario/types.js";

/**
 * Rocky Ascent is a `ClimbMinigame`, so it has climb bindings, climb parameters
 * and a route on every level. Narrowing that once here keeps the assertions
 * below readable — and makes the failure mode "Rocky Ascent stopped being a
 * climb scenario" rather than a wall of non-null assertions.
 */
const ASCENT_BINDINGS: ClimbAssetBindings = (() => {
  const bindings = ROCKY_ASCENT.assetBindings;
  if (bindings.kind !== "climb") throw new Error("Rocky Ascent must bind ClimbMinigame slots");
  return bindings;
})();

const ASCENT_PARAMETERS: ClimbClassParameters = (() => {
  const parameters = ROCKY_ASCENT.classParameters;
  if (parameters.kind !== "climb") throw new Error("Rocky Ascent must carry ClimbMinigame parameters");
  return parameters;
})();

function routeOf(difficulty: number) {
  const route = ROCKY_ASCENT.levels.get(difficulty)?.route;
  if (!route) throw new Error(`Rocky Ascent L${difficulty} must author a route`);
  return route;
}


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
  attempt.onEvent((event) => {
    events.push(event);
    // Headless: energy is delivered to the scenario as soon as it is emitted.
    if (event.type === "energy") {
      attempt.deliverEnergy(event.energy, attempt.toAttemptBeat(toBeat(clock.time)));
    }
  });

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
  h.advanceTo(16);
  const result = h.attempt.result;
  if (!result) throw new Error("attempt did not complete");
  return { attempt: h.attempt, result };
}

describe("ClimbMinigame progress", () => {
  it("starts at the route's start position, on no waypoint", () => {
    const { attempt } = harness(1);
    const state = attempt.climb!.state;
    expect(state.waypointIndex).toBe(-1);
    expect(state.successfulNotes).toBe(0);
    expect(state.position).toEqual(routeOf(1).startPosition);
  });

  it("advances exactly one waypoint on a Perfect note", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(0.01);
    expect(h.attempt.climb!.state.waypointIndex).toBe(0);
    expect(h.attempt.climb!.state.successfulNotes).toBe(1);
  });

  it("advances exactly one waypoint on a Good note too", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat, 0.4); // late, but successful
    h.advanceTo(0.45);
    expect(h.events.some((e) => e.type === "judgment" && e.judgment.type === "GoodNote")).toBe(true);
    expect(h.attempt.climb!.state.waypointIndex).toBe(0);
  });

  it("does not advance on a wrong note, and does not lose earned progress", () => {
    const h = harness(1);
    const first = h.attempt.targets[0]!;
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(0.01);
    const earned = h.attempt.climb!.state.waypointIndex;

    const second = h.attempt.targets[1]!;
    h.playAt(second.midi + 1, second.startBeat); // a semitone off
    h.advanceTo(second.startBeat + 0.01);

    const state = h.attempt.climb!.state;
    const waypoint = routeOf(1).waypoints[earned]!;
    expect(state.waypointIndex).toBe(earned);
    expect(state.successfulNotes).toBe(1);
    // Wobble is a lean, not a fall.
    expect(state.wobble).toBeGreaterThan(0);
    expect(state.position).toEqual({ x: waypoint.x, y: waypoint.y });
  });

  it("does not advance on a miss", () => {
    const h = harness(1);
    h.advanceTo(2); // let the first two targets expire unplayed
    expect(h.attempt.climb!.state.waypointIndex).toBe(-1);
    expect(h.events.filter((e) => e.type === "judgment" && e.judgment.type === "MissedNote").length)
      .toBeGreaterThan(0);
  });

  it("settles the wobble back to the same waypoint", () => {
    // Driven directly, because in a live attempt every expiring target sends
    // its own bad energy and would keep re-triggering the wobble.
    const level = ROCKY_ASCENT.levels.get(1)!;
    const climb = new ClimbMinigame({
      route: routeOf(1),
      bindings: ASCENT_BINDINGS,
      parameters: ASCENT_PARAMETERS,
    });

    climb.applyEnergy({ polarity: "good", strength: "perfect" }, 0);
    const before = { ...climb.state.position };

    climb.applyEnergy({ polarity: "bad", cause: "wrong" }, 1);
    climb.update(1.05);
    expect(climb.state.wobble).toBeGreaterThan(0);
    expect(climb.state.position).toEqual(before);

    climb.update(2);
    expect(climb.state.wobble).toBe(0);
    expect(climb.state.position).toEqual(before);
    expect(climb.state.waypointIndex).toBe(0);
  });

  it("cycles the climber pose so consecutive steps do not look identical", () => {
    const h = harness(1);
    const poses: string[] = [];
    for (const target of h.attempt.targets.slice(0, 5)) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.01);
      poses.push(h.attempt.climb!.state.poseAssetId);
    }
    expect(new Set(poses).size).toBeGreaterThan(1);
    for (const pose of poses) expect(ASCENT_BINDINGS.climberPoses).toContain(pose);
  });

  it("shows a contact effect and an accent, weaker for Good than for Perfect", () => {
    const perfect = harness(1);
    const first = perfect.attempt.targets[0]!;
    perfect.playAt(first.midi, first.startBeat);
    perfect.advanceTo(0.01);
    const perfectAccent = perfect.attempt.climb!.state.effects.find((e) => e.kind === "accent");
    expect(perfect.attempt.climb!.state.effects.some((e) => e.kind === "contact")).toBe(true);
    expect(perfectAccent?.strength).toBe(1);

    const good = harness(1);
    good.playAt(first.midi, first.startBeat, 0.4);
    good.advanceTo(0.45);
    const goodAccent = good.attempt.climb!.state.effects.find((e) => e.kind === "accent");
    expect(goodAccent?.strength).toBeLessThan(1);
  });

  it("keeps climbing across all four measures with no reset", () => {
    const h = harness(1);
    const seen: number[] = [];
    for (const target of h.attempt.targets) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.001);
      seen.push(h.attempt.climb!.state.waypointIndex);
    }
    // Strictly increasing, one per note, right through the measure boundaries.
    expect(seen).toEqual([...Array(15).keys()]);
    expect(h.events.filter((e) => e.type === "measureComplete")).toHaveLength(3);
  });

  it("maps every successful note onto its own waypoint at L4's 30 steps", () => {
    const { attempt } = playFlawlessly(4);
    expect(attempt.climb!.state.successfulNotes).toBe(30);
    expect(attempt.climb!.waypointCount).toBe(30);
  });

  it("finishes at the destination when the attempt passes", () => {
    const { attempt, result } = playFlawlessly(1);
    expect(result.passed).toBe(true);
    expect(attempt.climb!.state.finished).toBe(true);
    expect(attempt.climb!.state.position).toEqual(routeOf(1).destination);
    expect(attempt.climb!.state.poseAssetId).toBe(ASCENT_BINDINGS.finishPose);
  });

  it("freezes at the furthest earned waypoint when the attempt fails", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(16);

    const result = h.attempt.result!;
    expect(result.stars).toBe(0);
    expect(result.passed).toBe(false);
    expect(h.attempt.climb!.state.finished).toBe(false);
    expect(h.attempt.climb!.state.frozen).toBe(true);
    expect(h.attempt.climb!.state.waypointIndex).toBe(0);
  });
});

describe("a whole attempt", () => {
  it("earns three stars for a flawless L1 and updates every counter", () => {
    const { result } = playFlawlessly(1);
    expect(result).toMatchObject({
      scenarioId: "rocky_ascent",
      difficulty: 1,
      stars: 3,
      passed: true,
      perfect: 15,
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
    h.advanceTo(16);
    expect(h.attempt.result).toMatchObject({ stars: 0, passed: false, missed: 14 });
  });

  it("survives with one star on a scruffy but mostly-right attempt", () => {
    const h = harness(1);
    h.attempt.targets.forEach((target, index) => {
      h.advanceTo(target.startBeat);
      if (index % 5 !== 0) h.playAt(target.midi, target.startBeat, 0.35); // Good
      h.advanceTo(target.startBeat + 0.4);
    });
    h.advanceTo(16);
    const result = h.attempt.result!;
    expect(result.passed).toBe(true);
    expect(result.stars).toBeGreaterThanOrEqual(1);
    expect(result.stars).toBeLessThan(3);
    expect(result.good).toBeGreaterThan(0);
  });

  it("emits energy for every judgment, with the right polarity", () => {
    const h = harness(1);
    const first = h.attempt.targets[0]!;
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(0.01);
    h.playAt(first.midi + 1, 1.4);
    h.advanceTo(2.4);

    const energies = h.events.filter((e) => e.type === "energy").map((e) => e.energy);
    expect(energies[0]).toMatchObject({ polarity: "good", cause: "perfect", lane: 0 });
    expect(energies.some((e) => e.polarity === "bad" && e.cause === "wrong")).toBe(true);
    expect(energies.some((e) => e.polarity === "bad" && e.cause === "miss")).toBe(true);
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
