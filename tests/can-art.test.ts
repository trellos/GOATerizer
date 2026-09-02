/**
 * The can art, against the layout that draws it.
 *
 * The timeline sizes a can by its *height* — the lift, the crush point and the
 * palm are all vertical measurements — and lets the sprite's own aspect decide
 * the width. That makes the sprite's proportions part of the layout rather than
 * a detail of the art, and it means redrawing a can slightly wider silently
 * moves where its edge lands relative to the crusher's face.
 *
 * Two things are pinned here, both of which have already gone wrong once:
 *
 *   1. The **fallback** proportions match the sprite's. A missing asset should
 *      degrade to a plainer can in the same box, not to a differently shaped
 *      object in a different place. These disagreed by nearly two to one after
 *      the cans were resized.
 *   2. The art keeps the silhouette cues it was redrawn for. The first can was
 *      a grey rectangle with a stripe and did not read as a can at any size; the
 *      taper at the lid and base is most of what fixed that, and a taper is
 *      exactly the sort of thing a later tidy-up flattens without noticing.
 *
 * The generator is imported directly rather than the built PNGs being measured,
 * because the question is what the art *is*, not whether someone remembered to
 * re-run the generator — that is a separate failure with its own symptom.
 */

import { describe, expect, it } from "vitest";

import { can, canCrushed, type PixelImage } from "../scripts/lib/crusher-art.mjs";
import { repeatCanMetrics } from "../src/ui/timeline/repeat-layer.js";

/** Columns actually painted on a row, as `[first, last]`, or null if none. */
function span(image: PixelImage, y: number) {
  let first = -1;
  let last = -1;
  for (let x = 0; x < image.width; x += 1) {
    if (image.data[(y * image.width + x) * 4 + 3]! > 0) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return first < 0 ? null : { first, last, width: last - first + 1 };
}

/** The first painted row in each column: the object's top edge, left to right. */
function topEdge(image: PixelImage): number[] {
  const tops: number[] = [];
  for (let x = 1; x < image.width - 1; x += 1) {
    for (let y = 0; y < image.height; y += 1) {
      if (image.data[(y * image.width + x) * 4 + 3]! > 0) {
        tops.push(y);
        break;
      }
    }
  }
  return tops;
}

/** The widest row in the sprite — its barrel. */
function widestRow(image: PixelImage): number {
  let widest = 0;
  for (let y = 0; y < image.height; y += 1) widest = Math.max(widest, span(image, y)?.width ?? 0);
  return widest;
}

describe("the can sprites and the layout that draws them", () => {
  it("draws the fallback in the same box as the upright sprite", () => {
    const sprite = can();
    const metrics = repeatCanMetrics(40).upright;
    // What the layer computes for a sprite is `height * (w / h)`. The fallback
    // has to land on the same width, or a failed asset load moves the can.
    expect(metrics.h * (sprite.width / sprite.height)).toBeCloseTo(metrics.w, 6);
  });

  it("draws the fallback in the same box as the crushed sprite", () => {
    const sprite = canCrushed();
    const metrics = repeatCanMetrics(40).crushed;
    expect(metrics.h * (sprite.width / sprite.height)).toBeCloseTo(metrics.w, 6);
  });

  it("gives the upright can a taper at the lid and the base", () => {
    // The single strongest cue that a shape is a drinks can rather than a box,
    // and the one the first attempt lost by drawing the lid and the barrel as
    // overlapping rectangles.
    const image = can();
    const barrel = widestRow(image);
    const lid = span(image, 1)!;
    const base = span(image, image.height - 2)!;
    expect(lid.width).toBeLessThan(barrel);
    expect(base.width).toBeLessThan(barrel);
    // A taper the eye cannot find is not a taper. A real 12oz can's lid is
    // about four fifths of its body.
    expect(lid.width).toBeLessThanOrEqual(barrel - 2);
  });

  it("keeps the upright can symmetrical about its own axis", () => {
    // It is rotated in flight — a wrong-lane can wobbles — and an asymmetric
    // silhouette makes that rotation read as the can changing shape.
    const image = can();
    for (const y of [1, 6, 14, 20, 26]) {
      const row = span(image, y)!;
      expect(row.first + row.last).toBe(image.width - 1);
    }
  });

  it("makes the crushed can wider than it is tall, and lopsided", () => {
    // Being crushed means the metal went somewhere, so it spreads; and it
    // buckled under one hand, so it is not a neat symmetrical lozenge. The
    // version before this was a flat-topped block and read as a grey brick.
    const image = canCrushed();
    expect(image.width).toBeGreaterThan(image.height * 1.5);

    // The *body's* top edge, with the lid-end cap trimmed off both sides. That
    // trim is the point: the cap is drawn at a fixed height whatever the body
    // does, so measuring across it finds three distinct heights on a perfectly
    // flat-topped brick and passes on exactly the shape this rejects. Two
    // earlier versions of this assertion did precisely that.
    const body = topEdge(image).slice(3, -2);
    expect(new Set(body).size).toBeGreaterThan(2);
    // And it has to be lopsided rather than domed: the lid end kept its rigid
    // disc, so the tallest part is in the first half, not the middle.
    expect(body.indexOf(Math.min(...body))).toBeLessThan(body.length / 2);
  });

  it("moves the crushed can's top edge by no more than a pixel at a time", () => {
    // A silhouette that jumps faster than that stops reading as a dented object
    // and starts reading as a comb — which is what an earlier version did, with
    // every buckled column given its own height.
    const tops = topEdge(canCrushed());
    for (let i = 1; i < tops.length; i += 1) {
      expect(Math.abs(tops[i]! - tops[i - 1]!)).toBeLessThanOrEqual(1);
    }
  });
});
