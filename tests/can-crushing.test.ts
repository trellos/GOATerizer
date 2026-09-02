/**
 * The `RepeatMinigame` half of the timeline-actor prototype: the class itself,
 * the Can Crushing scenario's authored data, and the loader's ability to hold
 * two minigame classes at once without either leaking into the other.
 *
 * See `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 */

import { describe, expect, it } from "vitest";

import { ATTEMPT_BEATS, ATTEMPT_REPEATS } from "../src/config/tuning.js";
import { AttemptRuntime } from "../src/game/attempt.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import { formatDegreeToken } from "../src/music/degrees.js";
import type { RunKey } from "../src/music/keys.js";
import { MAX_PILE, RepeatMinigame } from "../src/scenario/minigames/repeat-minigame.js";
import { CAN_CRUSHING, ROCKY_ASCENT } from "../src/scenario/registry.js";
import { loadScenario } from "../src/scenario/load.js";
import type { RepeatAssetBindings, RepeatClassParameters } from "../src/scenario/types.js";
import canCrushingJson from "../docs/scenarios/can-crushing/can_crushing.scenario.json";

const LEVELS = [1, 2, 3, 4] as const;

/** difficulty -> note opportunities, from scripts/author-can-crushing.mjs. */
const EXPECTED_OPPORTUNITIES: Record<number, number> = { 1: 12, 2: 16, 3: 24, 4: 28 };

const CRUSHER_BINDINGS: RepeatAssetBindings = (() => {
  const bindings = CAN_CRUSHING.assetBindings;
  if (bindings.kind !== "repeat") throw new Error("Can Crushing must bind RepeatMinigame slots");
  return bindings;
})();

const CRUSHER_PARAMETERS: RepeatClassParameters = (() => {
  const parameters = CAN_CRUSHING.classParameters;
  if (parameters.kind !== "repeat") {
    throw new Error("Can Crushing must carry RepeatMinigame parameters");
  }
  return parameters;
})();

describe("the repeat performer", () => {
  const crusher = () => new RepeatMinigame({ performerLane: 3 });

  it("crushes a can placed on its own lane", () => {
    const repeat = crusher();
    repeat.place(3, 1);
    expect(repeat.state.crushed).toBe(1);
    expect(repeat.state.uncrushed).toBe(0);
    expect(repeat.state.cans[0]).toMatchObject({ lane: 3, fate: "crushed", wobbly: false });
    expect(repeat.state.lastCrushBeat).toBe(1);
  });

  it("puts a can where the player actually played, not where it was asked for", () => {
    const repeat = crusher();
    repeat.place(5, 1);
    // Two lanes above the crusher, which is what "you overshot by a third"
    // looks like before the player has time to think about it.
    expect(repeat.state.cans[0]).toMatchObject({ lane: 5, fate: "wrong" });
    expect(repeat.state.crushed).toBe(0);
    expect(repeat.state.uncrushed).toBe(1);
  });

  it("spawns an unplaceable note's can wobbling rather than snapping it to a lane", () => {
    const repeat = crusher();
    repeat.place(null, 1);
    expect(repeat.state.cans[0]).toMatchObject({ wobbly: true, fate: "wrong" });
  });

  it("leaves a missed note's can in its bar rather than lifting it", () => {
    const repeat = crusher();
    repeat.miss(6, 2);
    // The can exists — it was already on screen — but it is never placed, so it
    // rides its own lane at bar height and goes past him untouched.
    expect(repeat.state.cans[0]).toMatchObject({ lane: 6, fate: "missed", bornBeat: 2 });
    expect(repeat.state.uncrushed).toBe(1);
    expect(repeat.state.crushed).toBe(0);
  });

  it("does not punish a missed note with a second failure", () => {
    const repeat = crusher();
    repeat.miss(3, 2);
    // Nothing hits him and nothing lands on the pile: the note is already its
    // own punishment in the score.
    expect(repeat.state.crushed).toBe(0);
    expect(repeat.state.pile).toBe(0);
    expect(repeat.state.lastCrushBeat).toBeLessThan(0);
  });

  it("swings once per beat by default, and at whatever the grid asks otherwise", () => {
    expect(crusher().strikePeriodBeats).toBe(1);
    expect(new RepeatMinigame({ performerLane: 3, strikePeriodBeats: 0.5 }).state
      .strikePeriodBeats).toBe(0.5);
    // A nonsense period would freeze or invert the loop, so it falls back.
    expect(new RepeatMinigame({ performerLane: 3, strikePeriodBeats: 0 }).strikePeriodBeats).toBe(1);
  });

  it("ignores a miss once the attempt is over", () => {
    const repeat = crusher();
    repeat.complete(false, 16);
    repeat.miss(3, 16.5);
    expect(repeat.state.cans).toHaveLength(0);
    expect(repeat.state.uncrushed).toBe(0);
  });

  it("drops cans once they have flown off, and keeps the pile", () => {
    const repeat = crusher();
    repeat.place(3, 0);
    repeat.update(0.5);
    expect(repeat.state.cans).toHaveLength(1);
    repeat.update(4);
    expect(repeat.state.cans).toHaveLength(0);
    expect(repeat.state.crushed).toBe(1);
  });

  it("saturates the drawn pile so a long attempt stays on screen", () => {
    const repeat = crusher();
    for (let i = 0; i < 200; i += 1) repeat.place(3, i);
    expect(repeat.state.crushed).toBe(200);
    expect(repeat.state.pile).toBe(MAX_PILE);
  });

  it("stops accepting cans once the attempt is over", () => {
    const repeat = crusher();
    repeat.complete(true, 16);
    repeat.place(3, 16.5);
    expect(repeat.state.crushed).toBe(0);
    expect(repeat.state.complete).toBe(true);
    expect(repeat.state.passed).toBe(true);
  });
});

describe("Can Crushing scenario", () => {
  it("is a RepeatMinigame supporting exactly L1-L4", () => {
    expect(CAN_CRUSHING.id).toBe("can_crushing");
    expect(CAN_CRUSHING.minigameClass).toBe("RepeatMinigame");
    expect([...CAN_CRUSHING.supportedLevels]).toEqual([1, 2, 3, 4]);
    expect([...CAN_CRUSHING.levels.keys()]).toEqual([1, 2, 3, 4]);
  });

  it("authors no route, because its performer stands still", () => {
    for (const difficulty of LEVELS) {
      expect(CAN_CRUSHING.levels.get(difficulty)?.route).toBeNull();
    }
  });

  it.each(LEVELS)("L%i totals exactly 16 beats", (difficulty) => {
    const data = CAN_CRUSHING.levels.get(difficulty)!;
    const total = data.prompt.reduce((sum, event) => sum + event.durationBeats, 0);
    expect(total).toBe(16);
    expect(data.authoredBeatCount).toBe(16);
  });

  it.each(LEVELS)("L%i has the authored number of note opportunities", (difficulty) => {
    const data = CAN_CRUSHING.levels.get(difficulty)!;
    expect(data.noteOpportunityCount).toBe(EXPECTED_OPPORTUNITIES[difficulty]);
  });

  /**
   * The load-bearing authoring constraint. A can is only crushed when it
   * arrives at the performer's lane, and he does not move, so a note authored
   * anywhere else would ask the player to play correctly and then show them the
   * failure animation for it.
   */
  it.each(LEVELS)("L%i keeps every note on the performer's one lane", (difficulty) => {
    const tokens = new Set(
      CAN_CRUSHING.levels
        .get(difficulty)!
        .prompt.filter((event) => event.degree)
        .map((event) => formatDegreeToken(event.degree!))
    );
    expect([...tokens]).toEqual(["1"]);
  });

  it("escalates by rhythm alone", () => {
    const shortest = (difficulty: number) =>
      Math.min(
        ...CAN_CRUSHING.levels
          .get(difficulty)!
          .prompt.filter((event) => event.type === "note")
          .map((event) => event.durationBeats)
      );
    // Notes only ever get denser, and never longer, as the level rises.
    for (const difficulty of [2, 3, 4]) {
      expect(EXPECTED_OPPORTUNITIES[difficulty]!).toBeGreaterThan(
        EXPECTED_OPPORTUNITIES[difficulty - 1]!
      );
      expect(shortest(difficulty)).toBeLessThanOrEqual(shortest(difficulty - 1));
    }
  });

  it.each(LEVELS)("L%i star thresholds ascend and three stars means all Perfect", (difficulty) => {
    const data = CAN_CRUSHING.levels.get(difficulty)!;
    expect(data.stars.passThreshold).toBeLessThan(data.stars.star2Threshold);
    expect(data.stars.star2Threshold).toBeLessThan(data.stars.star3Threshold);
    // Every can in the attempt, and an attempt is the phrase ATTEMPT_REPEATS
    // times over — the repeat buys the player a second pass, not a lower bar
    // for the perfection badge.
    expect(data.stars.star3Threshold).toBe(data.noteOpportunityCount * 10 * ATTEMPT_REPEATS);
    // Pass is the exception, and is left at a single clean pass on purpose.
    expect(data.stars.passThreshold).toBeLessThan(data.noteOpportunityCount * 10);
  });

  it("binds every RepeatMinigame slot to a resolvable URL", () => {
    const ids = [
      CRUSHER_BINDINGS.background,
      CRUSHER_BINDINGS.performerNeutral,
      CRUSHER_BINDINGS.performerAction,
      CRUSHER_BINDINGS.performerFinish,
      CRUSHER_BINDINGS.repeatTarget,
      CRUSHER_BINDINGS.targetCompletedState,
      ...CRUSHER_BINDINGS.impactEffects,
    ];
    for (const id of ids) expect(CAN_CRUSHING.assetUrls[id]).toMatch(/\.png$/);
  });

  it("declares the canonical 1m visual span and a stationary performer", () => {
    expect(CRUSHER_PARAMETERS.visualSpanMeasures).toBe(1);
    expect(CRUSHER_PARAMETERS.repeatMode).toBe("sequence");
    expect(CRUSHER_PARAMETERS.performerMovesBetweenMeasures).toBe(false);
  });
});

describe("Can Crushing, played", () => {
  const KEY: RunKey = { tonic: 7, mode: "minor" };
  const SECONDS_PER_BEAT = 60 / 120;

  /** The same shape as `climb-and-run.test.ts`'s harness, on a repeat scenario. */
  function harness(difficulty: number, startBeat = 20) {
    const provider = new TestGuitarInputProvider();
    const toBeat = (contextTime: number) => contextTime / SECONDS_PER_BEAT;
    const attempt = new AttemptRuntime({
      scenario: CAN_CRUSHING,
      difficulty,
      key: KEY,
      startBeat,
      toBeat,
    });
    const clock = { time: startBeat * SECONDS_PER_BEAT };
    provider.onEvent((event) => attempt.handleGuitarEvent(event));
    void provider.start();

    const advanceTo = (attemptBeat: number) => {
      clock.time = (startBeat + attemptBeat) * SECONDS_PER_BEAT;
      provider.pump(clock.time);
      attempt.update(startBeat + attemptBeat);
    };
    const playAt = (midi: number, attemptBeat: number) => {
      const at = (startBeat + attemptBeat) * SECONDS_PER_BEAT;
      clock.time = Math.max(clock.time, at);
      provider.attack(midi, at);
    };
    return { attempt, advanceTo, playAt };
  }

  it("builds a repeat performer", () => {
    const { attempt } = harness(1);
    expect(attempt.repeat).not.toBeNull();
  });

  it("stations the performer on the lane the material repeats on", () => {
    const { attempt } = harness(1);
    // Every target is the root, so the modal lane is the root's lane.
    expect(attempt.repeat!.performerLane).toBe(attempt.targets[0]!.lane);
  });

  it("swings at a rate the authored grid actually lands on", () => {
    // The loop is the tutorial: his palm has to be down whenever a can can
    // arrive, so the period has to divide the tightest gap in the material.
    for (const difficulty of LEVELS) {
      const { attempt } = harness(difficulty);
      const period = attempt.repeat!.strikePeriodBeats;
      expect(period).toBeGreaterThan(0);
      for (const target of attempt.targets) {
        const swings = target.startBeat / period;
        expect(Math.abs(swings - Math.round(swings))).toBeLessThan(1e-6);
      }
    }
  });

  it("crushes every can on a flawless attempt", () => {
    const h = harness(1);
    for (const target of h.attempt.targets) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.001);
    }
    h.advanceTo(ATTEMPT_BEATS);
    expect(h.attempt.repeat!.state.crushed).toBe(h.attempt.targets.length);
    expect(h.attempt.repeat!.state.uncrushed).toBe(0);
    expect(h.attempt.result?.stars).toBe(3);
  });

  it("throws the can at the lane the player overshot to", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.advanceTo(target.startBeat);
    // A fifth above the root: right rhythm, wrong pitch, still in the key.
    h.playAt(target.midi + 7, target.startBeat);
    h.advanceTo(target.startBeat + 0.001);

    const can = h.attempt.repeat!.state.cans.at(-1)!;
    expect(can.fate).toBe("wrong");
    expect(can.wobbly).toBe(false);
    expect(can.lane).toBeGreaterThan(h.attempt.repeat!.performerLane);
  });

  it("wobbles a can the player's pitch cannot be placed by", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.advanceTo(target.startBeat);
    // A major third in a minor key: off the scale entirely, so there is no
    // lane it belongs on and none is invented for it.
    h.playAt(target.midi + 4, target.startBeat);
    h.advanceTo(target.startBeat + 0.001);

    expect(h.attempt.repeat!.state.cans.at(-1)).toMatchObject({ wobbly: true, fate: "wrong" });
  });
});

describe("the loader holds two classes without mixing them", () => {
  it("gives each scenario only its own class's slots and parameters", () => {
    expect(ROCKY_ASCENT.assetBindings.kind).toBe("climb");
    expect(ROCKY_ASCENT.classParameters.kind).toBe("climb");
    expect(CAN_CRUSHING.assetBindings.kind).toBe("repeat");
    expect(CAN_CRUSHING.classParameters.kind).toBe("repeat");
  });

  it("refuses a repeat scenario that binds climb slots", () => {
    const raw = structuredClone(canCrushingJson) as Record<string, unknown>;
    raw["assetBindings"] = { background: ["bg_can_crushing"] };
    expect(() => loadScenario(raw, CAN_CRUSHING.assetUrls)).toThrow(/performerNeutral/);
  });

  it("refuses a repeat scenario whose repeat mode is not one of the two", () => {
    const raw = structuredClone(canCrushingJson) as Record<string, unknown>;
    raw["classParameters"] = {
      ...(raw["classParameters"] as Record<string, unknown>),
      repeatMode: "whenever",
    };
    expect(() => loadScenario(raw, CAN_CRUSHING.assetUrls)).toThrow(/repeatMode/);
  });

  it("still requires a climb scenario to author one waypoint per note", () => {
    const raw = structuredClone(canCrushingJson) as Record<string, unknown>;
    raw["minigameClass"] = "ClimbMinigame";
    // Now it needs a route it does not have, and climb bindings it does not
    // have — either failure is the loader refusing to invent the missing half.
    expect(() => loadScenario(raw, CAN_CRUSHING.assetUrls)).toThrow(/Invalid scenario data/);
  });
});
