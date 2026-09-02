/**
 * Integration: guitar event -> beat -> judgment -> energy -> scenario.
 *
 * Everything here runs on the deterministic test input provider, so the whole
 * causal chain is exercised without a microphone. The visual layer is not
 * involved; what is asserted is that the goat moves exactly when the design
 * says it moves.
 */

import { describe, expect, it } from "vitest";

import { planAutoPerformance, type AutoplayMode } from "../src/dev/auto-performance.js";
import { AttemptRuntime, type AttemptEvent, type AttemptResult } from "../src/game/attempt.js";
import { rankForStars, GOAT_RANKS } from "../src/game/ranks.js";
import { DIFFICULTY_SEQUENCE, RunState, RUN_SLOT_COUNT } from "../src/game/run.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import type { Judged, Scene, Sprite } from "../src/minigame/api.js";
import {
  ClimbMinigame,
  climbConfig,
  climbLevelData,
} from "../src/scenario/minigames/climb-minigame.js";
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

/* -------------------------------------------------------------------------- */
/* Scene helpers                                                               */
/*                                                                             */
/* The minigame reaches the screen only through `renderScene`, so these read    */
/* what would actually be drawn rather than an internal state object. That is   */
/* the point of a scene being a value: this file asserts the picture without a  */
/* canvas anywhere near it.                                                    */
/* -------------------------------------------------------------------------- */

/** Rocky Ascent's climb config and per-level data, narrowed for assertions. */
const ASCENT = climbConfig(ROCKY_ASCENT.config);
const ascentLevel = (difficulty: number) =>
  climbLevelData(ROCKY_ASCENT.levels.get(difficulty)!.data);

/**
 * The attempt's minigame, as the concrete class.
 *
 * `AttemptRuntime.minigame` is a `Minigame` -- the runtime genuinely does not
 * know it is running a climb -- so a climb-specific assertion has to say so.
 */
function climbIn(attempt: AttemptRuntime): ClimbMinigame {
  const minigame = attempt.minigame;
  if (!(minigame instanceof ClimbMinigame)) throw new Error("attempt is not a climb");
  return minigame;
}

function scene(minigame: ClimbMinigame, beat = 0): Scene {
  return minigame.renderScene(beat);
}

function spriteAt(minigame: ClimbMinigame, key: string, beat = 0): Sprite {
  const found = scene(minigame, beat).sprites.find((entry) => entry.key === key);
  if (!found) throw new Error(`no sprite keyed ${key}`);
  return found;
}

function climberAt(minigame: ClimbMinigame, beat = 0): Sprite {
  return spriteAt(minigame, "climber", beat);
}

/** Effect sprites, split by which `stepEffects` slot they came from. */
function effectsAt(
  minigame: ClimbMinigame,
  beat = 0
): { contact: Sprite[]; accent: Sprite[] } {
  const [contactId, accentId] = ASCENT.bindings.stepEffects;
  const fx = scene(minigame, beat).sprites.filter((entry) => entry.key.startsWith("fx-"));
  return {
    contact: fx.filter((entry) => entry.assetId === contactId),
    accent: fx.filter((entry) => entry.assetId === accentId),
  };
}

/** A judged note of the given outcome, as the attempt runtime would deliver it. */
function judged(outcome: Judged["outcome"], beat: number): Judged {
  return { id: 1, outcome, opportunityIndex: 0, playedMidi: 60, lane: 0, beat };
}

describe("ClimbMinigame progress", () => {
  it("starts at the route's start position, on no waypoint", () => {
    const { attempt } = harness(1);
    const progress = climbIn(attempt).progress;
    expect(progress.waypointIndex).toBe(-1);
    expect(progress.successfulNotes).toBe(0);
    const start = ascentLevel(1).route.startPosition;
    const climber = climberAt(climbIn(attempt));
    expect({ x: climber.x, y: climber.y }).toEqual(start);
  });

  it("advances exactly one waypoint on a Perfect note", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(0.01);
    expect(climbIn(h.attempt).progress.waypointIndex).toBe(0);
    expect(climbIn(h.attempt).progress.successfulNotes).toBe(1);
  });

  it("advances exactly one waypoint on a Good note too", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat, 0.4); // late, but successful
    h.advanceTo(0.45);
    expect(h.events.some((e) => e.type === "judgment" && e.judgment.type === "GoodNote")).toBe(true);
    expect(climbIn(h.attempt).progress.waypointIndex).toBe(0);
  });

  it("does not advance on a wrong note, and does not lose earned progress", () => {
    const h = harness(1);
    const first = h.attempt.targets[0]!;
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(0.01);
    const earned = climbIn(h.attempt).progress.waypointIndex;

    const second = h.attempt.targets[1]!;
    h.playAt(second.midi + 1, second.startBeat); // a semitone off
    h.advanceTo(second.startBeat + 0.01);

    const progress = climbIn(h.attempt).progress;
    expect(progress.waypointIndex).toBe(earned);
    expect(progress.successfulNotes).toBe(1);
    // Wobble is a lean, not a fall: the climber tilts and is still on the same
    // foothold.
    expect(climberAt(climbIn(h.attempt), second.startBeat).rotationDeg).not.toBe(0);
  });

  it("does not advance on a miss", () => {
    const h = harness(1);
    h.advanceTo(2); // let the first two targets expire unplayed
    expect(climbIn(h.attempt).progress.waypointIndex).toBe(-1);
    expect(h.events.filter((e) => e.type === "judgment" && e.judgment.type === "MissedNote").length)
      .toBeGreaterThan(0);
  });

  it("settles the wobble back to the same waypoint", () => {
    // Driven directly, because in a live attempt every expiring target sends
    // its own bad energy and would keep re-triggering the wobble.
    const level = ascentLevel(1);
    const climb = new ClimbMinigame({
      route: level.route,
      bindings: ASCENT.bindings,
      parameters: {
        badNotePolicy: ASCENT.badNotePolicy,
        showDestinationFromStart: ASCENT.showDestinationFromStart,
      },
      resetBetweenMeasures: level.resetBetweenMeasures,
    });

    climb.onJudged(judged("perfect", 0), 0);
    const settled = climberAt(climb, 0);
    const before = { x: settled.x, y: settled.y };

    climb.onJudged(judged("wrong", 1), 1);
    climb.update(1.05);
    const leaning = climberAt(climb, 1.05);
    expect(leaning.rotationDeg).not.toBe(0);
    expect(leaning.y).toBe(before.y);

    climb.update(2);
    const after = climberAt(climb, 2);
    expect(after.rotationDeg).toBe(0);
    // Back to exactly the foothold it was on. Earned progress is never taken.
    expect({ x: after.x, y: after.y }).toEqual(before);
    expect(climb.progress.waypointIndex).toBe(0);
  });

  it("cycles the climber pose so consecutive steps do not look identical", () => {
    const h = harness(1);
    const poses: string[] = [];
    for (const target of h.attempt.targets.slice(0, 5)) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.01);
      poses.push(climberAt(climbIn(h.attempt), target.startBeat + 0.01).assetId);
    }
    expect(new Set(poses).size).toBeGreaterThan(1);
    for (const pose of poses) expect(ASCENT.bindings.climberPoses).toContain(pose);
  });

  it("shows a contact effect and an accent, weaker for Good than for Perfect", () => {
    const perfect = harness(1);
    const first = perfect.attempt.targets[0]!;
    perfect.playAt(first.midi, first.startBeat);
    perfect.advanceTo(0.01);
    const perfectFx = effectsAt(climbIn(perfect.attempt), first.startBeat);
    expect(perfectFx.contact).toHaveLength(1);
    expect(perfectFx.accent).toHaveLength(1);

    const good = harness(1);
    good.playAt(first.midi, first.startBeat, 0.4);
    good.advanceTo(0.45);
    const goodFx = effectsAt(climbIn(good.attempt), first.startBeat + 0.4);
    // Same asset, drawn smaller: Perfect reads stronger than Good.
    expect(goodFx.accent[0]!.scale).toBeLessThan(perfectFx.accent[0]!.scale!);
  });

  it("draws one foothold per authored waypoint, lighting them as they are reached", () => {
    const h = harness(1);
    const level = ascentLevel(1);
    const footholds = () =>
      scene(climbIn(h.attempt)).sprites.filter((entry) => entry.key.startsWith("step-"));

    expect(footholds()).toHaveLength(level.route.waypoints.length);
    expect(footholds().every((entry) => entry.opacity !== 1)).toBe(true);

    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(0.01);
    expect(footholds()[0]!.opacity).toBe(1);
    expect(footholds()[1]!.opacity).not.toBe(1);
  });

  it("keeps sprite keys stable across frames, so nothing re-identifies mid-climb", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(0.01);
    const keysAt = (beat: number) => scene(climbIn(h.attempt), beat).sprites.map((s) => s.key);
    // The climber advances between these two frames; its key does not change.
    expect(keysAt(0.01)).toContain("climber");
    expect(keysAt(0.02)).toContain("climber");
    const first = keysAt(0.01);
    expect(new Set(first).size).toBe(first.length);
  });

  it("keeps climbing across all four measures with no reset", () => {
    const h = harness(1);
    const seen: number[] = [];
    for (const target of h.attempt.targets) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.001);
      seen.push(climbIn(h.attempt).progress.waypointIndex);
    }
    // Strictly increasing, one per note, right through the measure boundaries.
    expect(seen).toEqual([...Array(15).keys()]);
    expect(h.events.filter((e) => e.type === "measureComplete")).toHaveLength(3);
  });

  it("maps every successful note onto its own waypoint at L4's 30 steps", () => {
    const { attempt } = playFlawlessly(4);
    expect(climbIn(attempt).progress.successfulNotes).toBe(30);
    expect(climbIn(attempt).progress.waypointCount).toBe(30);
  });

  it("finishes at the destination when the attempt passes", () => {
    const { attempt, result } = playFlawlessly(1);
    expect(result.passed).toBe(true);
    expect(climbIn(attempt).progress.finished).toBe(true);
    const climber = climberAt(climbIn(attempt), 16);
    expect({ x: climber.x, y: climber.y }).toEqual(ascentLevel(1).route.destination);
    expect(climber.assetId).toBe(ASCENT.bindings.finishPose);
  });

  it("freezes at the furthest earned waypoint when the attempt fails", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(16);

    const result = h.attempt.result!;
    expect(result.stars).toBe(0);
    expect(result.passed).toBe(false);
    expect(climbIn(h.attempt).progress.finished).toBe(false);
    expect(climbIn(h.attempt).progress.frozen).toBe(true);
    expect(climbIn(h.attempt).progress.waypointIndex).toBe(0);
    // No bespoke failure art: it is still a climbing pose, just not the finish.
    expect(climberAt(climbIn(h.attempt), 16).assetId).not.toBe(
      ASCENT.bindings.finishPose
    );
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
  for (let beat = 0; beat <= 16; beat += 0.125) h.advanceTo(beat);
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
