/**
 * The timeline-actor prototype: the actor's state machine, and the star rule
 * that lets consistency pay without ever becoming a second way to fail.
 *
 * See `docs/game-design/PROPOSED_Timeline_Actors.md`.
 */

import { describe, expect, it } from "vitest";

import { CONSISTENCY_POINTS_PER_NOTE, JUDGMENT_POINTS } from "../src/config/tuning.js";
import { StarMeter } from "../src/game/stars.js";
import {
  ACTOR_SIZE_CAP_STREAK,
  TimelineActor,
} from "../src/scenario/minigames/timeline-actor.js";
import type { StarThresholds } from "../src/scenario/types.js";

/** A 20-note attempt: 200 all-Perfect points, thresholds at 45/80/100%. */
const THRESHOLDS: StarThresholds = {
  passThreshold: 90,
  star2Threshold: 160,
  star3Threshold: 200,
  provisional: true,
  note: "",
};

describe("the timeline actor", () => {
  it("spawns on the first good note and stands on the target's lane", () => {
    const actor = new TimelineActor();
    expect(actor.state.alive).toBe(false);
    actor.land(3, 0);
    expect(actor.state.alive).toBe(true);
    expect(actor.state.lane).toBe(3);
  });

  it("dies on a break and comes back on the next good note", () => {
    const actor = new TimelineActor();
    actor.land(2, 0);
    actor.land(3, 1);
    actor.fall(2);
    expect(actor.state.alive).toBe(false);
    expect(actor.state.streak).toBe(0);
    expect(actor.state.fallen).toHaveLength(1);

    // No recovery period: the very next good note has a live actor again.
    actor.land(5, 3);
    expect(actor.state.alive).toBe(true);
    expect(actor.state.lane).toBe(5);
  });

  it("never lands anywhere but the lane it is given", () => {
    // Position is deterministic and comes from the TARGET, so no sequence of
    // failures can strand the actor somewhere the next note is unreachable
    // from. This is the property that stops one flub ending a run.
    const actor = new TimelineActor();
    for (const lane of [0, 7, 1, 6, 2]) {
      actor.land(lane, 0);
      expect(actor.state.lane).toBe(lane);
    }
  });

  it("grows with the streak, fast at first and slowly later", () => {
    const actor = new TimelineActor();
    const sizeAfter = (notes: number): number => {
      const fresh = new TimelineActor();
      for (let i = 0; i < notes; i += 1) fresh.land(0, i);
      return fresh.size;
    };
    expect(sizeAfter(1)).toBeGreaterThan(0);
    // The first note is worth more than the twelfth.
    expect(sizeAfter(1) - sizeAfter(0)).toBeGreaterThan(sizeAfter(12) - sizeAfter(11));
    expect(actor.size).toBe(0);
  });

  it("caps its size where a clean L1 can reach it", () => {
    const actor = new TimelineActor();
    for (let i = 0; i < ACTOR_SIZE_CAP_STREAK; i += 1) actor.land(0, i);
    expect(actor.size).toBe(1);
    // Rocky Ascent L1 authors 15 notes, so a clean L1 maxes the actor exactly
    // as a clean L6 does. Size means "did you hold it together", not "which
    // scenario did you draw".
    expect(ACTOR_SIZE_CAP_STREAK).toBeLessThan(15);
    for (let i = 0; i < 20; i += 1) actor.land(0, i);
    expect(actor.size).toBe(1);
  });

  it("spends streak past the cap on decoration instead of mass", () => {
    const actor = new TimelineActor();
    for (let i = 0; i < ACTOR_SIZE_CAP_STREAK; i += 1) actor.land(0, i);
    expect(actor.decorations).toBe(0);
    for (let i = 0; i < 12; i += 1) actor.land(0, i);
    expect(actor.decorations).toBeGreaterThan(0);
    expect(actor.size).toBe(1);
  });

  it("loses everything on a break — the streak is one readable object", () => {
    const actor = new TimelineActor();
    for (let i = 0; i < 20; i += 1) actor.land(0, i);
    expect(actor.decorations).toBeGreaterThan(0);
    actor.fall(21);
    expect(actor.size).toBe(0);
    expect(actor.decorations).toBe(0);
  });

  it("takes its size cap from whoever owns it", () => {
    const actor = new TimelineActor({ capStreak: 3 });
    actor.land(0, 0);
    actor.land(0, 1);
    expect(actor.size).toBeLessThan(1);
    actor.land(0, 2);
    expect(actor.size).toBe(1);
    expect(actor.state.horned).toBe(true);
    expect(actor.state.capStreak).toBe(3);
  });

  it("keeps the floor bounded", () => {
    const actor = new TimelineActor();
    for (let i = 0; i < 30; i += 1) {
      actor.land(1, i);
      actor.fall(i);
    }
    expect(actor.state.fallen.length).toBeLessThanOrEqual(8);
  });
});

describe("the three-comparison star rule", () => {
  /** Points for `notes` taken at Perfect. */
  const perfect = (notes: number) => notes * JUDGMENT_POINTS.perfect;

  it("never lets consistency buy a pass", () => {
    // The whole point: zero stars ends a run, so the pass has to be a pure
    // accuracy verdict. This holds for ANY bonus size because the bonus is not
    // in the comparison — it is structural, not a tuned cap.
    const meter = new StarMeter(THRESHOLDS);
    const justShort = THRESHOLDS.passThreshold - 1;
    expect(meter.update(justShort, 10_000)).toBe(0);
  });

  it("lets consistency earn the second star", () => {
    const meter = new StarMeter(THRESHOLDS);
    const shortOfTwo = THRESHOLDS.star2Threshold - 10;
    expect(meter.update(shortOfTwo, 0)).toBe(1);
    expect(new StarMeter(THRESHOLDS).update(shortOfTwo, 10)).toBe(2);
  });

  it("keeps three stars a perfection badge", () => {
    const meter = new StarMeter(THRESHOLDS);
    // One note short of flawless, with a monstrous streak bonus.
    expect(meter.update(THRESHOLDS.star3Threshold - 10, 10_000)).toBe(2);
    expect(new StarMeter(THRESHOLDS).update(THRESHOLDS.star3Threshold, 0)).toBe(3);
  });

  it("is unchanged from the old behaviour when no bonus is supplied", () => {
    const meter = new StarMeter(THRESHOLDS);
    expect(meter.update(THRESHOLDS.passThreshold)).toBe(1);
    expect(meter.update(THRESHOLDS.star2Threshold)).toBe(2);
    expect(meter.update(THRESHOLDS.star3Threshold)).toBe(3);
  });

  it("still locks a star once earned", () => {
    const meter = new StarMeter(THRESHOLDS);
    meter.update(THRESHOLDS.star2Threshold, 0);
    // A later frame reporting less — a streak that broke — cannot take it back.
    expect(meter.update(0, 0)).toBe(2);
  });

  it("prices a flawless attempt's bonus at a tenth of its own maximum", () => {
    // One point per unbroken note against ten for a Perfect, so the bonus is
    // 10% of the all-Perfect maximum at any note count — no per-scenario tuning.
    for (const notes of [14, 15, 23, 30, 32]) {
      const bonus = notes * CONSISTENCY_POINTS_PER_NOTE;
      expect(bonus / perfect(notes)).toBeCloseTo(0.1, 9);
    }
  });
});
