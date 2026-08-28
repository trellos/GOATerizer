/**
 * The can crusher's geometry, asserted rather than eyeballed.
 *
 * The `RepeatMinigame` read rests on four spatial claims, and every one of them
 * was got wrong at least once while building it by looking at screenshots:
 *
 *   - the crushed can is at the point the palm comes down on;
 *   - the palm is actually on it at the moment of the crush, and up between;
 *   - a can played on the wrong lane misses that point by exactly the interval
 *     the player missed by, one row per scale degree;
 *   - a missed can never leaves its bar.
 *
 * Screenshots cannot settle any of those: the swing is phase-locked to the note
 * grid, so a burst of frames aliases against it and shows the same pose over and
 * over — which is exactly what happened, and cost an afternoon. So the layer is
 * driven here against a context that records where it drew, and the claims are
 * checked as numbers.
 *
 * See `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 */

import { describe, expect, it } from "vitest";

import type { RepeatVisualState } from "../src/scenario/minigames/repeat-minigame.js";
import {
  drawRepeatPerformer,
  repeatCrushPoint,
  type RepeatGeometry,
} from "../src/ui/timeline/repeat-layer.js";

const ROW = 40;
const GEOMETRY: RepeatGeometry = {
  // Lane 0 at the bottom of the band, climbing upwards, exactly as the view maps
  // it — a bigger lane number is a higher pitch and a smaller y.
  laneY: (lane) => 400 - lane * ROW,
  strikeX: 600,
  rowHeight: ROW,
  floorY: 520,
  pixelsPerBeat: 120,
};

const PERFORMER_LANE = 3;

/**
 * One drawing op, resolved to the origin the layer had translated to.
 *
 * The origin is what the assertions want: every can is drawn centred on its
 * own translate, so the origin *is* the can's position, and it stays correct
 * for the rolling cans that are drawn rotated.
 */
type Op = {
  kind: "rect" | "arc";
  /** Where the layer had translated to — the shape's own centre. */
  x: number;
  y: number;
  rotation: number;
  /** Local rect size, or the arc's radius in both. */
  w: number;
  h: number;
};

/**
 * A canvas context that records where things landed.
 *
 * Only the transform operations this layer actually uses are modelled —
 * translate, rotate, save, restore — which is enough to resolve every draw to
 * an absolute point. Anything else is a no-op: the test is about position, not
 * about paint.
 */
function recorder(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  let state = { x: 0, y: 0, rotation: 0 };
  const stack: (typeof state)[] = [];
  const ctx = {
    save: () => void stack.push({ ...state }),
    restore: () => void (state = stack.pop() ?? state),
    translate: (dx: number, dy: number) => {
      // Rotation before a translate never happens in this layer, so composing
      // translations is enough and the test stays readable.
      state = { ...state, x: state.x + dx, y: state.y + dy };
    },
    rotate: (angle: number) => {
      state = { ...state, rotation: state.rotation + angle };
    },
    fillRect: (_x: number, _y: number, w: number, h: number) => {
      ops.push({ kind: "rect", x: state.x, y: state.y, rotation: state.rotation, w, h });
    },
    arc: (x: number, y: number, r: number) => {
      ops.push({ kind: "arc", x: state.x + x, y: state.y + y, rotation: state.rotation, w: r, h: r });
    },
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    set fillStyle(_: unknown) {},
    set strokeStyle(_: unknown) {},
    set lineWidth(_: unknown) {},
    set lineCap(_: unknown) {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

function stateWith(overrides: Partial<RepeatVisualState> = {}): RepeatVisualState {
  return {
    performerLane: PERFORMER_LANE,
    strikePeriodBeats: 1,
    crushed: 0,
    pile: 0,
    uncrushed: 0,
    cans: [],
    lastCrushBeat: -99,
    complete: false,
    passed: false,
    ...overrides,
  };
}

const CAN = ROW * 0.5;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * Cans are picked out by their exact body size rather than by shape, because
 * the crusher's headband is also a wide flat rectangle and matching on
 * proportions quietly found that instead.
 */
const isFlatCan = (op: Op) => op.kind === "rect" && near(op.w, CAN * 0.9) && near(op.h, CAN * 0.3);
const isTallCan = (op: Op) => op.kind === "rect" && near(op.w, CAN * 0.52) && near(op.h, CAN);

function flatCan(ops: readonly Op[]): Op | undefined {
  return ops.filter(isFlatCan).at(-1);
}

/** The palm, which is the smaller of the two circles he is made of. */
function palm(ops: readonly Op[]): Op | undefined {
  return ops.filter((op) => op.kind === "arc").sort((a, b) => a.w - b.w)[0];
}

function draw(state: RepeatVisualState, beat: number): Op[] {
  const { ctx, ops } = recorder();
  drawRepeatPerformer(ctx, state, GEOMETRY, beat);
  return ops;
}

describe("the crush point", () => {
  it("is a whole beat of travel left of the strike line", () => {
    const point = repeatCrushPoint(stateWith(), GEOMETRY);
    // A whole beat, so a can born on the note grid arrives on the note grid —
    // which is to say on one of his swings.
    expect(point.x).toBe(GEOMETRY.strikeX - GEOMETRY.pixelsPerBeat);
  });

  it("is above the performer's own bar, not on it", () => {
    const point = repeatCrushPoint(stateWith(), GEOMETRY);
    const bar = GEOMETRY.laneY(PERFORMER_LANE);
    expect(bar - point.y).toBeGreaterThan(ROW);
  });
});

describe("a can the player placed correctly", () => {
  const crushing = stateWith({
    crushed: 1,
    pile: 1,
    cans: [{ id: 1, lane: PERFORMER_LANE, fate: "crushed", wobbly: false, bornBeat: 0 }],
  });

  it("is flattened at the crush point on the beat it arrives", () => {
    const can = flatCan(draw(crushing, 1));
    const point = repeatCrushPoint(crushing, GEOMETRY);
    expect(can).toBeDefined();
    expect(can!.x).toBeCloseTo(point.x, 5);
    expect(can!.y).toBeCloseTo(point.y, 5);
  });

  it("has the palm on it at that instant, and not a moment before", () => {
    const point = repeatCrushPoint(crushing, GEOMETRY);
    const palmAt = (beat: number) => palm(draw(crushing, beat))!;

    const onContact = palmAt(1);
    expect(onContact.x).toBeCloseTo(point.x, 5);
    // Resting on the lid: above the can's middle by half a can, less its own
    // radius, so the hand meets the top rather than passing through it.
    expect(onContact.y).toBeLessThan(point.y);
    expect(point.y - onContact.y).toBeLessThan(ROW * 0.5);

    // Mid-swing it is a long way up. Half a period after contact is the top of
    // the wind-up, which is what makes the gap under it visible from across the
    // screen.
    expect(palmAt(1.5).y).toBeLessThan(onContact.y - ROW * 0.4);
  });

  it("drops out of his hands and onto the floor", () => {
    const point = repeatCrushPoint(crushing, GEOMETRY);
    const heights = [1.25, 1.4, 1.55].map((beat) => flatCan(draw(crushing, beat))!.y);
    // Monotonically downward, and clear of where it was crushed.
    expect(heights[1]!).toBeGreaterThan(heights[0]!);
    expect(heights[2]!).toBeGreaterThan(heights[1]!);
    expect(heights[2]!).toBeGreaterThan(point.y + ROW);
  });

  it("keeps swinging whether or not there is anything to crush", () => {
    const idle = stateWith();
    const low = palm(draw(idle, 0))!;
    const high = palm(draw(idle, 0.5))!;
    expect(low.y - high.y).toBeGreaterThan(ROW * 0.4);
  });
});

describe("a can the player put somewhere else", () => {
  const wrongBy = (degrees: number) =>
    stateWith({
      uncrushed: 1,
      cans: [
        {
          id: 1,
          lane: PERFORMER_LANE + degrees,
          fate: "wrong",
          wobbly: false,
          bornBeat: 0,
        },
      ],
    });

  it("misses the crush point by one row per scale degree", () => {
    const point = repeatCrushPoint(stateWith(), GEOMETRY);
    for (const degrees of [-2, -1, 1, 2]) {
      const state = wrongBy(degrees);
      const can = draw(state, 1).filter(isTallCan).at(-1)!;
      expect(can.y).toBeCloseTo(point.y - degrees * ROW, 5);
    }
  });

  it("is never flattened, however long it is on screen", () => {
    for (const beat of [1, 1.2, 1.5, 2]) {
      expect(flatCan(draw(wrongBy(1), beat))).toBeUndefined();
    }
  });
});

describe("a can nobody played at", () => {
  const missed = stateWith({
    uncrushed: 1,
    cans: [{ id: 1, lane: PERFORMER_LANE, fate: "missed", wobbly: false, bornBeat: 0 }],
  });

  it("never leaves the bar it arrived in", () => {
    const point = repeatCrushPoint(missed, GEOMETRY);
    const bar = GEOMETRY.laneY(PERFORMER_LANE);
    const can = draw(missed, 1).filter((op) => isTallCan(op) && op.rotation !== 0).at(-1);
    expect(can).toBeDefined();
    // Resting on the bar it arrived in, nowhere near his hands.
    expect(can!.y).toBeCloseTo(bar - (CAN * 0.52) / 2, 5);
    expect(bar - point.y).toBeGreaterThan(ROW);
  });

  it("is lying down, and keeps rolling", () => {
    const at = (beat: number) =>
      draw(missed, beat).filter((op) => isTallCan(op) && op.rotation !== 0).at(-1)!;
    // A quarter turn is the difference between a can and a can nobody caught.
    expect(at(1).rotation).toBeGreaterThan(Math.PI / 2);
    expect(at(1.5).rotation).toBeGreaterThan(at(1).rotation);
  });

  it("is never flattened", () => {
    expect(flatCan(draw(missed, 1))).toBeUndefined();
  });
});
