/**
 * The host-shipped helpers in `minigame/api.ts` that are pure functions of a
 * `StageView`. A family's motion is its own, but "where does an actor that
 * waits at the strike line actually stand" is answered once, here, for all of
 * them — otherwise every strike-line family stands at the line during the
 * previous minigame and vanishes the instant its own ends.
 */

import { describe, expect, it } from "vitest";

import { spanAnchorX, type StageView } from "../src/minigame/api.js";

function view(span: { from: number; to: number }, strikeX = 0.5): StageView {
  return { beat: 0, notes: [], laneCount: 8, strikeX, span, measure: { width: 0.4, beatWidth: 0.1 } };
}

describe("spanAnchorX", () => {
  it("is the strike line while the attempt's measures straddle it", () => {
    expect(spanAnchorX(view({ from: 0.1, to: 1.7 }))).toBe(0.5);
    expect(spanAnchorX(view({ from: 0.5, to: 2.1 }))).toBe(0.5);
  });

  it("rides in with the first measure line before the attempt has arrived", () => {
    // The next minigame's notes are on the timeline before its beat 0; its
    // span starts right of the line, and so must its actor.
    expect(spanAnchorX(view({ from: 0.9, to: 2.5 }))).toBe(0.9);
    expect(spanAnchorX(view({ from: 1.3, to: 2.9 }))).toBe(1.3);
  });

  it("rides out with the last measure line once the attempt is over", () => {
    expect(spanAnchorX(view({ from: -1.4, to: 0.2 }))).toBe(0.2);
    expect(spanAnchorX(view({ from: -2.0, to: -0.4 }))).toBe(-0.4);
  });

  it("moves at exactly the timeline's speed at both ends", () => {
    // Two frames a tenth of the playfield apart move the anchor by that tenth.
    const a = spanAnchorX(view({ from: 0.9, to: 2.5 }));
    const b = spanAnchorX(view({ from: 0.8, to: 2.4 }));
    expect(a - b).toBeCloseTo(0.1, 9);
  });
});
