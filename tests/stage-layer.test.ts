/**
 * The stage layer: where a minigame's sprites land, and how big they are.
 *
 * This is the half of the contract that had no implementation at all until now,
 * which is why the two families that own no prototype actor — PERFORM (Goat
 * Frontman) and THREE-STEP (Butt-Butt-BONK) — played as an empty backdrop with
 * the host's default bars over it. The rules pinned here are the ones a family
 * places art by, so they are the ones that must not drift:
 *
 *   - the space (playfield across, lane band down, and outside 0..1 is normal);
 *   - the size (the art frame's height mapped onto the pane, aspect-independent
 *     so a placement holds at every viewport);
 *   - the order (layer, then z, then array order).
 *
 * The last check is not about layout at all: every registered scenario must be
 * able to answer for its own backdrop. `PerformMinigame` shipped once without
 * `backgroundId`, and the backdrop view asks every scenario in the strip, so a
 * Goat Frontman slot threw mid-frame and took the rest of that frame's painting
 * with it. That is fixed; this is the guard, because the interface requires the
 * method and TypeScript will only catch a module that admits its own type.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Sprite } from "../src/minigame/api.js";
import { requireMinigame } from "../src/minigame/registry.js";
import { SCENARIOS } from "../src/scenario/registry.js";
import {
  artPixelSize,
  drawStageSprites,
  orderedSprites,
  SCENARIO_ART_FRAME,
  spriteBox,
  type StageGeometry,
} from "../src/ui/timeline/stage-layer.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A 1440x900 pane whose lane band is the middle half of it. */
const GEOMETRY: StageGeometry = {
  playLeft: 140,
  playWidth: 1300,
  bandTop: 200,
  bandHeight: 400,
  paneHeight: 800,
};

/** A Rocky goat's dimensions: the size most generated scenario art is drawn at. */
const GOAT = { width: 24, height: 18 };

function sprite(overrides: Partial<Sprite> = {}): Sprite {
  return { key: "s", assetId: "a", x: 0.5, y: 0.5, ...overrides };
}

/** Records what was drawn, in order, without a canvas. */
function recorder() {
  const calls: string[] = [];
  const state = { alpha: 1, rotations: 0, translated: [0, 0] as [number, number] };
  const ctx = {
    save: () => void calls.push("save"),
    restore: () => void calls.push("restore"),
    translate: (x: number, y: number) => {
      state.translated = [x, y];
    },
    rotate: () => {
      state.rotations += 1;
    },
    drawImage: (image: { id?: string }) => void calls.push(`draw:${image.id ?? "?"}`),
    set globalAlpha(value: number) {
      state.alpha = value;
    },
    get globalAlpha() {
      return state.alpha;
    },
  };
  return { calls, state, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** An asset store stand-in: every id resolves, tagged so draws are tellable apart. */
function images(known: readonly string[]) {
  return {
    get(id: string) {
      return known.includes(id)
        ? ({ id, width: GOAT.width, height: GOAT.height } as unknown as HTMLImageElement)
        : null;
    },
  };
}

describe("sprite placement", () => {
  it("puts x across the playfield and y down the lane band", () => {
    const box = spriteBox(sprite({ x: 0, y: 0 }), GOAT, GEOMETRY);
    expect(box.anchorX).toBe(140);
    expect(box.anchorY).toBe(200);

    const far = spriteBox(sprite({ x: 1, y: 1 }), GOAT, GEOMETRY);
    expect(far.anchorX).toBe(1440);
    expect(far.anchorY).toBe(600);
  });

  it("lets a sprite leave the band, which is where an actor stands", () => {
    // `y > 1` is the floor below the lanes — where Goat Frontman's crowd walks
    // in — and `y < 0` the air above them. Neither is clamped.
    expect(spriteBox(sprite({ y: 1.27 }), GOAT, GEOMETRY).anchorY).toBeCloseTo(708, 6);
    expect(spriteBox(sprite({ y: -0.5 }), GOAT, GEOMETRY).anchorY).toBe(0);
  });

  it("adds offsetY to y in the same units", () => {
    const plain = spriteBox(sprite({ y: 0.5 }), GOAT, GEOMETRY);
    const nudged = spriteBox(sprite({ y: 0.5, offsetY: 0.1 }), GOAT, GEOMETRY);
    expect(nudged.anchorY - plain.anchorY).toBeCloseTo(0.1 * GEOMETRY.bandHeight, 6);
  });

  it("draws art at the size it was drawn at, in the nominal scene", () => {
    // The rule in one assertion: a sprite as tall as the whole art frame, at
    // scale 1, is as tall as the pane. Everything else is a fraction of that.
    const full = spriteBox(sprite(), SCENARIO_ART_FRAME, GEOMETRY);
    expect(full.height).toBe(GEOMETRY.paneHeight);
    expect(full.width).toBe(
      (SCENARIO_ART_FRAME.width / SCENARIO_ART_FRAME.height) * GEOMETRY.paneHeight
    );

    const goat = spriteBox(sprite(), GOAT, GEOMETRY);
    expect(goat.height).toBeCloseTo((GOAT.height / SCENARIO_ART_FRAME.height) * 800, 6);
    // A little under two lanes tall, which is the range every actor in the
    // game occupies. A frontman at 1.45 is 1.9 lanes.
    const lane = GEOMETRY.bandHeight / 8;
    expect((goat.height * 1.45) / lane).toBeCloseTo(1.93, 2);
  });

  it("scales both axes together, so the art keeps its proportions", () => {
    const tall = spriteBox(sprite({ scale: 2 }), { width: 15, height: 60 }, GEOMETRY);
    expect(tall.height / tall.width).toBe(4);
    expect(tall.height).toBeCloseTo(2 * 60 * artPixelSize(GEOMETRY.paneHeight), 6);
  });

  it("sizes from the pane's height alone, never its width", () => {
    // Aspect-independence is what lets a family place an actor by arithmetic —
    // hooves at 1.27, horns reaching 0.994 — and have it hold at every window.
    const wide = spriteBox(sprite(), GOAT, { ...GEOMETRY, playWidth: 3000 });
    expect(wide.height).toBe(spriteBox(sprite(), GOAT, GEOMETRY).height);
  });

  it("hangs a sprite from its centre, or stands it on its feet", () => {
    const centred = spriteBox(sprite(), GOAT, GEOMETRY);
    expect(centred.top).toBe(-centred.height / 2);

    const standing = spriteBox(sprite({ anchor: "bottom" }), GOAT, GEOMETRY);
    // Anchored at the feet: the whole sprite is above the point it was placed
    // at, so an actor put on a note bar stands on it rather than through it.
    expect(standing.top).toBe(-standing.height);
    expect(standing.left).toBe(-standing.width / 2);
  });
});

describe("draw order", () => {
  it("keeps each layer to itself, and defaults to the front", () => {
    const sprites = [
      sprite({ key: "scenery", layer: "under" }),
      sprite({ key: "actor", layer: "over" }),
      sprite({ key: "effect" }),
    ];
    expect(orderedSprites(sprites, "under").map((s) => s.key)).toEqual(["scenery"]);
    expect(orderedSprites(sprites, "over").map((s) => s.key)).toEqual(["actor", "effect"]);
  });

  it("orders by z, then by the order the minigame listed them", () => {
    const sprites = [
      sprite({ key: "a", z: 2 }),
      sprite({ key: "b" }),
      sprite({ key: "c", z: 2 }),
      sprite({ key: "d", z: -1 }),
    ];
    expect(orderedSprites(sprites, "over").map((s) => s.key)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("drawing", () => {
  it("draws one layer, in order", () => {
    const { calls, ctx } = recorder();
    drawStageSprites(
      ctx,
      [
        sprite({ key: "1", assetId: "front", z: 5 }),
        sprite({ key: "2", assetId: "back", z: 0 }),
        sprite({ key: "3", assetId: "scenery", layer: "under" }),
      ],
      "over",
      GEOMETRY,
      images(["front", "back", "scenery"])
    );
    expect(calls.filter((call) => call.startsWith("draw:"))).toEqual(["draw:back", "draw:front"]);
  });

  it("leaves a gap for art that did not load, rather than a stand-in", () => {
    const { calls, ctx } = recorder();
    drawStageSprites(
      ctx,
      [sprite({ assetId: "missing" }), sprite({ key: "b", assetId: "present" })],
      "over",
      GEOMETRY,
      images(["present"])
    );
    expect(calls.filter((call) => call.startsWith("draw:"))).toEqual(["draw:present"]);
  });

  it("skips a fully faded sprite and rotates only one that asked to be", () => {
    const faded = recorder();
    drawStageSprites(faded.ctx, [sprite({ opacity: 0 })], "over", GEOMETRY, images(["a"]));
    expect(faded.calls).toEqual([]);

    const upright = recorder();
    drawStageSprites(upright.ctx, [sprite()], "over", GEOMETRY, images(["a"]));
    expect(upright.state.rotations).toBe(0);

    const leaning = recorder();
    drawStageSprites(leaning.ctx, [sprite({ rotationDeg: -14 })], "over", GEOMETRY, images(["a"]));
    expect(leaning.state.rotations).toBe(1);
    // Rotation happens about the anchor, so a leaning actor pivots on the
    // point it was placed at rather than swinging around its middle.
    expect(leaning.state.translated).toEqual([
      spriteBox(sprite(), GOAT, GEOMETRY).anchorX,
      spriteBox(sprite(), GOAT, GEOMETRY).anchorY,
    ]);
  });
});

/** A PNG's dimensions, straight out of its IHDR. */
function pngSize(url: string): { width: number; height: number } {
  const png = readFileSync(path.join(REPO, "public", url.replace(/^\/+/, "")));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("the art frame", () => {
  it("keeps the shipped art inside the size range the unit assumes", () => {
    // The hazard the frame invites: art redrawn at twice the scale is drawn
    // twice as big, silently, and a family's placement arithmetic comes apart
    // around it. Nothing in a PNG says what scale it was drawn at, so the guard
    // is the drawn size — at scale 1 every sprite in the library has to be
    // something that could stand on the lanes rather than replace them. The
    // tallest today is Butt-Butt-BONK's accent flash at 4.4 lanes, a deliberate
    // full-height streak; its ram is 3.5, and doubling either would fail here.
    const laneHeight = GEOMETRY.bandHeight / 8;
    for (const scenario of SCENARIOS) {
      const backdrop = requireMinigame(scenario.minigameId, scenario.id).backgroundId(
        scenario.config
      );
      for (const [id, url] of Object.entries(scenario.assetUrls)) {
        if (id === backdrop) continue;
        const lanes = spriteBox(sprite(), pngSize(url), GEOMETRY).height / laneHeight;
        expect(`${id}: ${lanes < 5 ? "under" : "over"} five lanes tall`).toBe(
          `${id}: under five lanes tall`
        );
      }
    }
  });

  it("every registered scenario can answer for its own backdrop", () => {
    for (const scenario of SCENARIOS) {
      const module = requireMinigame(scenario.minigameId, scenario.id);
      const id = module.backgroundId(scenario.config);
      expect(id.length, `${scenario.id} has no backdrop`).toBeGreaterThan(0);
      expect(
        scenario.assetUrls[id],
        `${scenario.id} names a backdrop it does not load`
      ).toBeDefined();
    }
  });
});
