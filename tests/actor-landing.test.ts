/**
 * What a landing does differently when the actor is heavy.
 *
 * The actor's `size` (0..1, from the streak) used to feed exactly one thing —
 * its overall scale. A twelve-note streak was therefore a *bigger* goat playing
 * a *smaller* goat's landing, and mass that does not change how a body moves
 * reads as a zoom rather than as weight.
 *
 * These are deliberately assertions about **behaviour over time**, not about
 * the constants that produce it. `expect(heavy.squash).toBeGreaterThan(...)`
 * would restate `landingWeightFor`'s own table back at itself and pass however
 * broken the thing consuming it was — the trap the last art pass fell into four
 * times. So the questions here are the ones a player would ask: does the heavy
 * one squash further, is it still moving when the light one has stopped, and
 * does it stop dead on contact.
 *
 * The dust clamp is checked at the drawing level for the same reason: what
 * matters is where a mote is actually painted, not what the arithmetic that
 * placed it looked like.
 */

import { DEFAULT_LOOK } from "../src/scenario/minigames/timeline-actor.js";
import { describe, expect, it } from "vitest";

import type { TimelineActorState } from "../src/scenario/minigames/timeline-actor.js";
import {
  drawTimelineActor,
  HOP_BEATS,
  landingWeightFor,
  squashAt,
  type ActorGeometry,
} from "../src/ui/timeline/actor-layer.js";

const ROW = 40;
const STRIKE_X = 600;
const GEOMETRY: ActorGeometry = {
  laneY: (lane) => 400 - lane * ROW,
  strikeX: STRIKE_X,
  rowHeight: ROW,
  floorY: 520,
};

const LIGHT = landingWeightFor(0);
const HEAVY = landingWeightFor(1);

/** Landed, standing, and not leaning — `nextLane` matching `lane` zeroes it. */
function landed(overrides: Partial<TimelineActorState> = {}): TimelineActorState {
  return {
    lane: 3,
    alive: true,
    streak: 12,
    size: 1,
    decorations: 0,
    nextLane: 3,
    landedBeat: 0,
    fromLane: 2,
    standingEndBeat: null,
    fromEndBeat: null,
    fallen: [],
    capStreak: 12,
    grewAtBeat: null,
    horned: false,
    wobbledAtBeat: null,
    look: DEFAULT_LOOK,
    ...overrides,
  };
}

/**
 * A canvas context that records where circles were painted.
 *
 * Only `arc` is captured, and that is the whole trick: within this layer arcs
 * are *exactly* the dust motes. The impact ring and the contact shadow are
 * ellipses, the body is a rect or an image, and the streak decorations are
 * line paths — so nothing else can be mistaken for dust, and the test does not
 * need to know a mote's colour or size to find one.
 */
function recorder(): { ctx: CanvasRenderingContext2D; motes: { x: number; r: number }[] } {
  const motes: { x: number; r: number }[] = [];
  let state = { x: 0, y: 0, sx: 1, sy: 1 };
  const stack: (typeof state)[] = [];
  const ctx = {
    save: () => void stack.push({ ...state }),
    restore: () => void (state = stack.pop() ?? state),
    translate: (dx: number, dy: number) => {
      state = { ...state, x: state.x + dx * state.sx, y: state.y + dy * state.sy };
    },
    scale: (sx: number, sy: number) => {
      state = { ...state, sx: state.sx * sx, sy: state.sy * sy };
    },
    rotate: () => {},
    arc: (x: number, _y: number, r: number) => {
      motes.push({ x: state.x + x * state.sx, r: r * state.sx });
    },
    ellipse: () => {},
    fillRect: () => {},
    drawImage: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    set fillStyle(_: unknown) {},
    set strokeStyle(_: unknown) {},
    set lineWidth(_: unknown) {},
    set globalAlpha(_: unknown) {},
    get globalAlpha() {
      return 1;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, motes };
}

function motesAt(state: TimelineActorState, beat: number): { x: number; r: number }[] {
  const { ctx, motes } = recorder();
  drawTimelineActor(ctx, state, GEOMETRY, beat, { poses: [] });
  return motes;
}

/**
 * The last moment the body is still visibly deformed.
 *
 * Scanned rather than derived from the decay constant, because the decay is
 * one of three things that set it — the peak compression and the hitstop hold
 * move it too, and a test that only knew about the decay would sit green
 * through a change to either of the others.
 */
function settleBeats(weight: ReturnType<typeof landingWeightFor>, threshold = 0.02): number {
  let last = 0;
  for (let land = 0; land < 3; land += 0.002) {
    if (Math.abs(squashAt(1, land, weight)) > threshold) last = land;
  }
  return last;
}

describe("a heavy landing against a light one", () => {
  it("compresses further on contact", () => {
    expect(squashAt(1, 0, HEAVY)).toBeGreaterThan(squashAt(1, 0, LIGHT) * 1.5);
  });

  it("is still moving well after the light one has stopped", () => {
    // The part that actually reads as mass: a heavy body keeps absorbing the
    // impact after a light one has finished with it.
    expect(settleBeats(HEAVY)).toBeGreaterThan(settleBeats(LIGHT) * 1.5);
  });

  it("stops dead at the bottom before it springs back", () => {
    // Hitstop. For the first couple of frames a heavy landing is *held* at full
    // compression — the pause is the mass — where a light one is already
    // recovering from the moment it touches down.
    const frame = 0.03; // about two frames at 90bpm
    expect(squashAt(1, frame, HEAVY)).toBe(squashAt(1, 0, HEAVY));
    expect(squashAt(1, frame, LIGHT)).toBeLessThan(squashAt(1, 0, LIGHT));
  });

  it("recovers to rest either way, rather than settling deformed", () => {
    // A spring that does not return to zero leaves the actor permanently the
    // wrong shape, which is the failure mode of getting the decay wrong.
    for (const weight of [LIGHT, HEAVY]) {
      expect(Math.abs(squashAt(1, 2.5, weight))).toBeLessThan(0.001);
    }
  });

  it("throws more dust", () => {
    const heavy = motesAt(landed({ size: 1 }), 0.3).length;
    const light = motesAt(landed({ size: 0, streak: 0 }), 0.3).length;
    expect(heavy).toBeGreaterThan(light);
  });

  it("keeps throwing it after a light landing's dust is gone", () => {
    // In transport time, not impact time: the impact happens at the *end* of
    // the hop, so a beat has to clear `HOP_BEATS` before it is measuring dust
    // at all. Getting that wrong is how the first version of this asserted
    // that a settled light landing was still throwing dust.
    const late = HOP_BEATS + (LIGHT.dustLife + HEAVY.dustLife) / 2;
    expect(motesAt(landed({ size: 0, streak: 0 }), late)).toHaveLength(0);
    expect(motesAt(landed({ size: 1 }), late).length).toBeGreaterThan(0);
  });
});

describe("dust and the read-ahead zone", () => {
  it("never paints a mote across the strike line, at any size", () => {
    // The strike line is the boundary of what the player is reading ahead on,
    // and dust is the one thing in this layer that travels outward far enough
    // to cross it — at full streak a mote reached about a hundred pixels
    // against a thirty-four pixel gap, so the biggest landings were throwing
    // debris over the notes. Scaling the puff with size, which is the point of
    // this pass, could only have made that worse.
    //
    // The *drawn circle* is what must not cross, so the radius is included.
    for (const size of [0, 0.25, 0.5, 0.75, 1]) {
      const state = landed({ size, streak: Math.round(size * 12) });
      for (let beat = 0.28; beat < 1.2; beat += 0.01) {
        for (const mote of motesAt(state, beat)) {
          expect(mote.x + mote.r).toBeLessThanOrEqual(STRIKE_X);
        }
      }
    }
  });

  it("still throws dust leftward as far as the landing deserves", () => {
    // The clamp must not have quietly become "no dust": the puff is biased
    // backwards, into the space the world has already scrolled past, and that
    // side is unbounded.
    const spread = motesAt(landed({ size: 1 }), 0.55).map((mote) => mote.x);
    const actorX = STRIKE_X - 34;
    expect(Math.min(...spread)).toBeLessThan(actorX - ROW);
  });
});

describe("landing weight", () => {
  it("clamps a size outside the documented range instead of extrapolating", () => {
    // `size` is documented as 0..1. A landing is not where you want to discover
    // that something upstream disagreed — extrapolating would give a negative
    // hold or a decay that never settles.
    expect(landingWeightFor(-1)).toEqual(landingWeightFor(0));
    expect(landingWeightFor(5)).toEqual(landingWeightFor(1));
  });
});
