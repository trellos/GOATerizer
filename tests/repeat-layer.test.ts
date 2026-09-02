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
  repeatCanMetrics,
  repeatCrushPoint,
  repeatHeadWidth,
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
 * The layer's own crush and fall windows, at the quarter-note pulse these
 * fixtures use.
 *
 * Restated here rather than exported: they are timings, not geometry, and the
 * tests that care only need to know where the windows are so they can sample
 * inside them.
 */
const CRUSH_BEATS_AT_PULSE = Math.min(0.22, 1 * 0.18);
const FALL_BEATS = 0.35;

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

type Point = { x: number; y: number };

/**
 * A canvas context that records where things landed.
 *
 * Only the transform operations this layer actually uses are modelled —
 * translate, rotate, save, restore — which is enough to resolve every draw to
 * an absolute point. Stroked paths are captured whole, because the limbs are
 * polylines and the interesting facts about them are the lengths between their
 * points. Anything else is a no-op: the test is about position, not paint.
 */
function recorder(): { ctx: CanvasRenderingContext2D; ops: Op[]; strokes: Point[][] } {
  const ops: Op[] = [];
  const strokes: Point[][] = [];
  let path: Point[] = [];
  let state = { x: 0, y: 0, rotation: 0, sx: 1, sy: 1 };
  const stack: (typeof state)[] = [];
  const at = (x: number, y: number) => ({ x: state.x + x, y: state.y + y });
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
    // Modelled rather than ignored: the crush squashes the flattened can with a
    // real transform, and a recorder that silently dropped it would report a
    // size the screen never showed.
    scale: (sx: number, sy: number) => {
      state = { ...state, sx: state.sx * sx, sy: state.sy * sy };
    },
    fillRect: (_x: number, _y: number, w: number, h: number) => {
      ops.push({
        kind: "rect",
        x: state.x,
        y: state.y,
        rotation: state.rotation,
        w: w * state.sx,
        h: h * state.sy,
      });
    },
    arc: (x: number, y: number, r: number) => {
      ops.push({ kind: "arc", x: state.x + x, y: state.y + y, rotation: state.rotation, w: r, h: r });
    },
    ellipse: (x: number, y: number, rx: number, ry: number) => {
      ops.push({ kind: "arc", x: state.x + x, y: state.y + y, rotation: state.rotation, w: rx, h: ry });
    },
    beginPath: () => void (path = []),
    closePath: () => {},
    moveTo: (x: number, y: number) => void path.push(at(x, y)),
    lineTo: (x: number, y: number) => void path.push(at(x, y)),
    stroke: () => void strokes.push(path.slice()),
    fill: () => {},
    set fillStyle(_: unknown) {},
    set strokeStyle(_: unknown) {},
    set lineWidth(_: unknown) {},
    set lineCap(_: unknown) {},
    set lineJoin(_: unknown) {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, strokes };
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

const CAN = repeatCanMetrics(ROW);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * Cans are picked out by their body **area** rather than by shape, because the
 * crusher's headband is also a wide flat rectangle and matching on proportions
 * quietly found that instead.
 *
 * Area, and not width and height separately, because the crush squashes the
 * flattened can and springs it back — and that squash is volume-preserving by
 * construction, so `w * h` is exactly the quantity it leaves alone. Matching on
 * either dimension on its own would find the can on some frames of the crush
 * and not others.
 */
const area = (size: { w: number; h: number }) => size.w * size.h;
const isFlatCan = (op: Op) => op.kind === "rect" && near(op.w * op.h, area(CAN.crushed));
const isTallCan = (op: Op) => op.kind === "rect" && near(op.w * op.h, area(CAN.upright));

function flatCan(ops: readonly Op[]): Op | undefined {
  return ops.filter(isFlatCan).at(-1);
}

function draw(state: RepeatVisualState, beat: number): Op[] {
  const { ctx, ops } = recorder();
  drawRepeatPerformer(ctx, state, GEOMETRY, beat);
  return ops;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The working arm: shoulder, elbow, hand.
 *
 * Both arms are three-point polylines, so it is picked out by reaching further
 * right than the other — the crusher works on the side the cans come from, and
 * braces on the other.
 */
function arms(state: RepeatVisualState, beat: number): [Point, Point, Point][] {
  const { ctx, strokes } = recorder();
  drawRepeatPerformer(ctx, state, GEOMETRY, beat);
  return strokes.filter((path) => path.length === 3) as [Point, Point, Point][];
}

function workingArm(state: RepeatVisualState, beat: number): [Point, Point, Point] {
  return arms(state, beat).sort((a, b) => b[2].x - a[2].x)[0]!;
}

/** His own midline: the head is drawn on it, and it is the biggest round shape. */
function midline(state: RepeatVisualState, beat: number): number {
  return draw(state, beat)
    .filter((op) => op.kind === "arc")
    .sort((a, b) => b.w - a.w)[0]!.x;
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
    const handAt = (beat: number) => workingArm(crushing, beat)[2];

    const onContact = handAt(1);
    expect(onContact.x).toBeCloseTo(point.x, 5);
    // Resting on the lid: above the can's middle by half a can, less its own
    // radius, so the hand meets the top rather than passing through it.
    expect(onContact.y).toBeLessThan(point.y);
    expect(point.y - onContact.y).toBeLessThan(ROW * 0.5);

    // Mid-swing it has swung clear, up and out to the side. Not up alone: his
    // reach is barely longer than the distance from his shoulder to his own
    // forehead, so a purely vertical swing has almost no travel in it.
    expect(dist(handAt(1.5), onContact)).toBeGreaterThan(ROW * 0.3);
  });

  it("drops out of his hands and onto the floor", () => {
    const point = repeatCrushPoint(crushing, GEOMETRY);
    // Sampled as fractions of the fall rather than at fixed beats. The fall
    // begins when the flatten ends, so shortening the crush slid this window
    // earlier and the last fixed sample fell off the end of it — a tuning
    // change turning into a failure that looked like a drawing bug.
    const fallFrom = 1 + CRUSH_BEATS_AT_PULSE;
    const heights = [0.15, 0.5, 0.9].map(
      (through) => flatCan(draw(crushing, fallFrom + FALL_BEATS * through))!.y
    );
    // Monotonically downward, and clear of where it was crushed.
    expect(heights[1]!).toBeGreaterThan(heights[0]!);
    expect(heights[2]!).toBeGreaterThan(heights[1]!);
    expect(heights[2]!).toBeGreaterThan(point.y + ROW);
  });

  it("keeps swinging whether or not there is anything to crush", () => {
    const idle = stateWith();
    expect(dist(workingArm(idle, 0)[2], workingArm(idle, 0.5)[2])).toBeGreaterThan(ROW * 0.3);
  });

  it("swings an arm of fixed length, hung off a shoulder that does not move", () => {
    // The defect this pins: the first build placed the elbow at the midpoint
    // between the shoulder and wherever the hand had got to, so lifting the
    // hand lengthened both bones and the arm ended up nearly as long as the
    // man. Bones are bones.
    const idle = stateWith();
    const arms = [0, 0.15, 0.3, 0.5, 0.7, 0.9].map((phase) => workingArm(idle, phase));
    const [shoulder, elbow, hand] = arms[0]!;
    const upper = dist(shoulder, elbow);
    const fore = dist(elbow, hand);

    for (const arm of arms) {
      expect(arm[0].x).toBeCloseTo(shoulder.x, 5);
      expect(arm[0].y).toBeCloseTo(shoulder.y, 5);
      expect(dist(arm[0], arm[1])).toBeCloseTo(upper, 5);
      expect(dist(arm[1], arm[2])).toBeCloseTo(fore, 5);
    }
  });

  it("never folds an elbow inward through his own body", () => {
    // A two-bone solve has two answers, and choosing between them by rotating
    // the shoulder-to-hand line picks the wrong one whenever the hand is low:
    // the bracing arm's elbow ended up inside its own shoulder, which is not a
    // direction an elbow goes. Both arms, right through the swing.
    const idle = stateWith();
    for (const phase of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.97]) {
      const centre = midline(idle, phase);
      for (const [shoulder, elbow] of arms(idle, phase)) {
        const shoulderOut = shoulder.x - centre;
        const elbowOut = elbow.x - centre;
        // Same side of him as its own shoulder, and no closer to the middle.
        expect(Math.sign(elbowOut)).toBe(Math.sign(shoulderOut));
        expect(Math.abs(elbowOut)).toBeGreaterThanOrEqual(Math.abs(shoulderOut));
      }
    }
  });

  it("has an arm a person could have", () => {
    // Shoulder to fingertip is a bit under half a standing height. An arm
    // approaching the whole height of the man is the stretching bug back.
    const [shoulder, elbow, hand] = workingArm(stateWith(), 0.5);
    const head = draw(stateWith(), 0.5)
      .filter((op) => op.kind === "arc")
      .sort((a, b) => b.w - a.w)[0]!;
    const standing = GEOMETRY.laneY(PERFORMER_LANE) - (head.y - head.h);
    const reach = dist(shoulder, elbow) + dist(elbow, hand);
    expect(reach / standing).toBeGreaterThan(0.35);
    expect(reach / standing).toBeLessThan(0.5);
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
    expect(can!.y).toBeCloseTo(bar - CAN.upright.w / 2, 5);
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

describe("the can against the head", () => {
  it("keeps his head wider than the can he holds against it", () => {
    // The whole gesture is a can crushed on a forehead, so the two are drawn
    // overlapping on purpose. What must not happen is the can matching or
    // beating the head for width: at that point the silhouette stops reading
    // as a man holding something and starts reading as a man with a tin head.
    //
    // Asserted rather than commented because it has now been broken twice by
    // resizing one of the two without the other — most recently by doubling
    // the can, which is what these numbers exist to allow safely.
    for (const row of [24, 40, 64, 96]) {
      expect(repeatHeadWidth(row)).toBeGreaterThan(repeatCanMetrics(row).upright.w);
    }
  });

  it("keeps the flattened can from spanning his whole face", () => {
    // A crushed can is wider than an upright one — that is what being crushed
    // means — but it is still held at his brow, and past about one and a half
    // heads it reads as a plank laid across him rather than as a flattened can.
    for (const row of [24, 40, 64, 96]) {
      expect(repeatCanMetrics(row).crushed.w).toBeLessThan(repeatHeadWidth(row) * 1.5);
    }
  });
});

describe("the crush and the hand that makes it", () => {
  const crushing = stateWith({
    crushed: 1,
    pile: 1,
    cans: [{ id: 1, lane: PERFORMER_LANE, fate: "crushed", wobbly: false, bornBeat: 0 }],
  });

  it("keeps the palm down for the whole time the can is flat", () => {
    // The flattened can is only legible as *being crushed* while the thing
    // crushing it is on it. Let the flatten outlast the hold and the last
    // frames of it are a flat can hanging at his brow with the arm already
    // climbing away — which is what happened, because the crush was capped at
    // 0.3 of a period and the hold is 0.18 of one.
    //
    // Checked across the pulses the game actually uses: a quarter, an eighth,
    // and a sixteenth. The bug only appeared at the slow end, where the cap in
    // beats stopped binding and the fraction of the period took over.
    for (const period of [1, 0.5, 0.25]) {
      const state = { ...crushing, strikePeriodBeats: period };
      const point = repeatCrushPoint(state, GEOMETRY);

      // Found by scanning for the last beat a can is still drawn flat *at the
      // crush point*, rather than computed from the constants this is meant to
      // constrain. Asserting at the beat the window is supposed to end is
      // circular: it passes whatever the window actually does, which is how the
      // first version of this test sat green over the very bug it was written
      // for.
      // Held exactly on the crush point in x while it is being crushed, and
      // carried forward toward the pile the instant it starts to fall — so x
      // separates the two phases exactly. A radius around the crush point does
      // not: the fall begins *at* that point, so the first frames of it look
      // like the crush and drag the answer past the end of the window.
      const flatAtBrow = (beat: number) => {
        const can = flatCan(draw(state, beat));
        return can !== undefined && Math.abs(can.x - point.x) < 1e-6;
      };
      let lastFlat = 1;
      for (let beat = 1; beat < 1 + period; beat += 0.002) {
        if (flatAtBrow(beat)) lastFlat = beat;
      }
      expect(lastFlat).toBeGreaterThan(1);

      const hand = workingArm(state, lastFlat)[2];
      expect(Math.abs(hand.x - point.x)).toBeLessThan(ROW * 0.35);
      expect(point.y - hand.y).toBeLessThan(ROW * 0.5);
    }
  });
});
