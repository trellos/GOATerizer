/**
 * The Scale family's reward loop, at the family boundary and in the layer.
 *
 * The playtest report this answers: "the goat often seems to disappear for no
 * reason, even when it looks like I'm playing correct notes". The cause was
 * the climb felling its actor on every `WrongNote`, including the ones the
 * judge promotes to a hit a moment later — so a correct note the recognizer
 * briefly misheard killed the goat and spawned a tiny new one. Only a miss
 * fells it now; a wrong note shakes it.
 */

import { describe, expect, it } from "vitest";

import { AttemptRuntime } from "../src/game/attempt.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import type { RunKey } from "../src/music/keys.js";
import {
  CLIMB_MINIGAME,
  climbActor,
  climbCapStreak,
  climbConfig,
  climbTierFor,
  climbTierIds,
  CLIMB_TIER_FROM_DIFFICULTY,
} from "../src/scenario/minigames/climb-minigame.js";
import { TimelineActor } from "../src/scenario/minigames/timeline-actor.js";
import { ROCKY_ASCENT } from "../src/scenario/registry.js";
import {
  actorX,
  FALL_BEATS,
  fallenPose,
  GROWTH_PULSE_BEATS,
  growthPulse,
  HOP_BEATS,
  WOBBLE_BEATS,
  wobbleAt,
  type ActorGeometry,
} from "../src/ui/timeline/actor-layer.js";

const G_MINOR: RunKey = { tonic: 7, mode: "minor" };
const SECONDS_PER_BEAT = 60 / 90;

function harness(difficulty: number, startBeat = 20) {
  const provider = new TestGuitarInputProvider();
  const toBeat = (contextTime: number) => contextTime / SECONDS_PER_BEAT;
  const attempt = new AttemptRuntime({ scenario: ROCKY_ASCENT, difficulty, key: G_MINOR, startBeat, toBeat });
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
    const id = provider.attack(midi, at);
    // A note is judged when it ends: hold it for the written length of the
    // target it is aimed at (or a beat, aimed at nothing) and let it go then.
    const aimed = attempt.targets.find((t) => t.midi === midi && Math.abs(t.startBeat - attemptBeat) <= 0.5);
    const heldBeats = aimed ? aimed.durationBeats : 1;
    provider.schedule([{ at: at + heldBeats * SECONDS_PER_BEAT, kind: "release", id }]);
    return id;
  };
  return { attempt, advanceTo, playAt };
}

describe("a wrong note shakes the goat; only a miss fells it", () => {
  it("keeps the goat alive through a wrong note and lands the correction on the same target", () => {
    const h = harness(1);
    const [first, second] = h.attempt.targets;
    if (!first || !second) throw new Error("need two targets");
    h.advanceTo(first.startBeat);
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(first.startBeat + first.durationBeats + 0.001);
    expect(climbActor(h.attempt.minigame).alive).toBe(true);

    // A wrong note *before* the second target's window — it matches nothing.
    h.playAt(first.midi + 1, second.startBeat - 0.6);
    h.advanceTo(second.startBeat - 0.59);
    const shaken = climbActor(h.attempt.minigame);
    expect(shaken.alive).toBe(true);
    expect(shaken.streak).toBe(1);
    expect(shaken.fallen).toHaveLength(0);
    expect(shaken.wobbledAtBeat).not.toBeNull();

    // The correct note still lands, on the same goat, one step longer.
    h.playAt(second.midi, second.startBeat);
    h.advanceTo(second.startBeat + second.durationBeats + 0.001);
    const landed = climbActor(h.attempt.minigame);
    expect(landed.alive).toBe(true);
    expect(landed.streak).toBe(2);
    expect(landed.lane).toBe(second.lane);
  });

  it("fells the goat when a target's window closes unhit, and records where it fell from", () => {
    const h = harness(1);
    const [first, second] = h.attempt.targets;
    if (!first || !second) throw new Error("need two targets");
    h.advanceTo(first.startBeat);
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(second.startBeat + 2);
    const state = climbActor(h.attempt.minigame);
    expect(state.alive).toBe(false);
    expect(state.fallen).toHaveLength(1);
    expect(state.fallen[0]?.lane).toBe(first.lane);
  });

  it("leaps a rest: the note after a gap lands from the lane before it", () => {
    const h = harness(1);
    const targets = h.attempt.targets;
    // Find the first pair with a gap larger than the note between them.
    const gapAt = targets.findIndex(
      (t, i) => i > 0 && t.startBeat - (targets[i - 1]!.startBeat + targets[i - 1]!.durationBeats) > 0.01
    );
    expect(gapAt).toBeGreaterThan(0);
    for (let i = 0; i <= gapAt; i += 1) {
      const target = targets[i]!;
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + target.durationBeats + 0.001);
    }
    const state = climbActor(h.attempt.minigame);
    expect(state.alive).toBe(true);
    expect(state.streak).toBe(gapAt + 1);
    expect(state.fromLane).toBe(targets[gapAt - 1]!.lane);
    expect(state.lane).toBe(targets[gapAt]!.lane);
  });
});

describe("growth", () => {
  it("maxes the goat after two clean measures, whatever the level authors in them", () => {
    for (const difficulty of [1, 3, 6]) {
      const h = harness(difficulty);
      const cap = climbActor(h.attempt.minigame).capStreak;
      const inFirstTwo = h.attempt.targets.filter((t) => t.startBeat < 8).length;
      expect(cap).toBe(Math.max(1, inFirstTwo));
      for (const target of h.attempt.targets.filter((t) => t.startBeat < 8)) {
        h.advanceTo(target.startBeat);
        h.playAt(target.midi, target.startBeat);
        h.advanceTo(target.startBeat + target.durationBeats + 0.001);
      }
      const state = climbActor(h.attempt.minigame);
      expect(state.size).toBe(1);
      expect(state.horned).toBe(true);
    }
  });

  it("pulses on a landing that grew the goat, and not on one past the cap", () => {
    const actor = new TimelineActor({ capStreak: 2 });
    actor.land(0, 10);
    const grew = actor.state;
    expect(growthPulse(grew, 10 + HOP_BEATS + GROWTH_PULSE_BEATS / 2)).toBeGreaterThan(1.1);
    expect(growthPulse(grew, 10 + HOP_BEATS + GROWTH_PULSE_BEATS + 0.01)).toBe(1);
    actor.land(1, 11);
    actor.land(2, 12);
    const capped = actor.state;
    expect(capped.horned).toBe(true);
    // The third landing did not grow it, so the pulse is the second's, long over.
    expect(growthPulse(capped, 12 + HOP_BEATS + GROWTH_PULSE_BEATS / 2)).toBe(1);
  });

  it("uses a taller goat per difficulty tier, and the next tier's goat as its horns", () => {
    const config = climbConfig(ROCKY_ASCENT.config);
    expect(config.climberTiers).toHaveLength(CLIMB_TIER_FROM_DIFFICULTY.length);
    expect(climbTierFor(config.climberTiers, 1).poses).toEqual(config.climberPoses);
    expect(climbTierFor(config.climberTiers, 3).poses).toEqual(config.climberPoses);
    expect(climbTierFor(config.climberTiers, 4).poses).toEqual(climbTierIds("rocky_ascent", 1));
    expect(climbTierFor(config.climberTiers, 7).poses).toEqual(climbTierIds("rocky_ascent", 4));
    // Horns at L1-3 are a preview of the L4 goat.
    expect(climbTierFor(config.climberTiers, 1).hornedPoses).toEqual(climbTierIds("rocky_ascent", 1));
    // Every tier's art is declared, so the host preloads it.
    const ids = CLIMB_MINIGAME.assetIds(ROCKY_ASCENT.config, []);
    for (const tier of config.climberTiers) for (const id of tier.poses) expect(ids).toContain(id);
    expect(climbTierFor(config.climberTiers, 7).plume).toBe("fire");
  });

  it("derives the cap from the phrase, not from a constant", () => {
    const h = harness(1);
    expect(climbCapStreak({
      config: null,
      data: null,
      assets: [],
      plan: { measures: 8, beatsPerMeasure: 4, totalBeats: 32, phraseBeats: 16 },
      opportunities: h.attempt.targets.map((t, index) => ({ ...t, index })),
    })).toBe(h.attempt.targets.filter((t) => t.startBeat < 8).length);
  });
});

describe("waiting through a rest", () => {
  const ROW = 40;
  const GEOMETRY: ActorGeometry = {
    laneY: (lane) => 400 - lane * ROW,
    strikeX: 600,
    rowHeight: ROW,
    floorY: 520,
    xOfBeat: (beat) => 600 + (beat - 10) * 100, // beat 10 is at the strike line
  };

  it("stands in its usual place while its bar is still under it", () => {
    // A bar ending 2 beats after now is well right of the strike line.
    expect(actorX(GEOMETRY, 12)).toBe(600 - 34);
  });

  it("rides the trailing edge of its bar once the bar has scrolled past", () => {
    // The bar ended 1.5 beats ago: its right edge is 150px left of the line.
    const x = actorX(GEOMETRY, 8.5);
    expect(x).toBeLessThan(600 - 34);
    expect(x).toBeCloseTo(450 - 34 * 0.35, 6);
  });

  it("is pinned left of the line with no bar geometry to ride", () => {
    expect(actorX({ ...GEOMETRY, xOfBeat: undefined }, 8.5)).toBe(600 - 34);
    expect(actorX(GEOMETRY, null)).toBe(600 - 34);
  });

  it("remembers where each bar ends so the hop starts from the old one", () => {
    const actor = new TimelineActor();
    actor.land(1, 0, 1);
    actor.land(2, 3, 4);
    expect(actor.state.fromEndBeat).toBe(1);
    expect(actor.state.standingEndBeat).toBe(4);
  });
});

describe("the fall", () => {
  const ROW = 40;
  const GEOMETRY: ActorGeometry = {
    laneY: (lane) => 400 - lane * ROW,
    strikeX: 600,
    rowHeight: ROW,
    floorY: 520,
  };
  const fallen = { id: 1, lane: 3, size: 0.5, bornBeat: 10 };

  it("drops from the lane it stood on to the floor, spinning and blinking red, then lies there", () => {
    const start = fallenPose(fallen, 0, GEOMETRY, 10);
    expect(start.y).toBe(GEOMETRY.laneY(3));
    expect(start.falling).toBe(true);
    expect(start.tint?.colour).toBe("#ff3b3b");

    const mid = fallenPose(fallen, 0, GEOMETRY, 10 + FALL_BEATS / 2);
    expect(mid.y).toBeGreaterThan(start.y);
    expect(mid.y).toBeLessThan(GEOMETRY.floorY);
    expect(mid.rotation).toBeGreaterThan(0);

    const down = fallenPose(fallen, 0, GEOMETRY, 10 + FALL_BEATS + 0.01);
    expect(down.y).toBeCloseTo(GEOMETRY.floorY, 6);
    expect(down.falling).toBe(false);
    expect(down.tint).toBeNull();
    expect(down.rotation).toBe(0);
  });

  it("is drawn at full strength on the floor and turns round every few beats", () => {
    const facings = new Set<boolean>();
    for (let beat = 11; beat < 30; beat += 0.5) facings.add(fallenPose(fallen, 0, GEOMETRY, beat).flipX);
    expect(facings).toEqual(new Set([true, false]));
    expect(fallenPose(fallen, 0, GEOMETRY, 20).scale).toBeGreaterThan(ROW * 0.7);
  });

  it("shakes and flashes on a wrong note, and settles", () => {
    const actor = new TimelineActor();
    actor.land(2, 5);
    actor.wobble(6);
    const shaking = wobbleAt(actor.state, 6.05);
    expect(shaking.tint?.amount).toBeGreaterThan(0);
    expect(Math.abs(shaking.tilt)).toBeGreaterThan(0);
    const settled = wobbleAt(actor.state, 6 + WOBBLE_BEATS);
    expect(settled.tint).toBeNull();
    expect(settled.tilt).toBe(0);
  });

  it("does not shake a dead goat, and a fall clears the shake", () => {
    const actor = new TimelineActor();
    actor.wobble(1);
    expect(actor.state.wobbledAtBeat).toBeNull();
    actor.land(1, 2);
    actor.wobble(3);
    actor.fall(4);
    expect(actor.state.wobbledAtBeat).toBeNull();
  });
});
