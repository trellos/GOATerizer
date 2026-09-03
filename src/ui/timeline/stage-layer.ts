/**
 * The stage layer: a minigame's own sprites, on the timeline.
 *
 * `Stage.notes` dresses the bars and `prototypeLayer()` draws the two
 * prototype actors from canvas primitives. This is the third and last piece —
 * {@link Sprite}, the part of the contract a family gets its *characters,
 * props and effects* through. A family that owns none of the prototype layers
 * has nothing else: PERFORM (Goat Frontman) and THREE-STEP (Butt-Butt-BONK)
 * are sprites and nothing but, so until this existed they rendered as an empty
 * backdrop with the host's default bars over it, which is exactly what "there
 * is no art" looks like from the couch.
 *
 * The host still owns every pixel of note geometry. A sprite is placed in the
 * normalised space `minigame/api.ts` describes and drawn; it cannot move a
 * note, resize one, or reach the gutter.
 *
 * ## How big a sprite is
 *
 * `Sprite.scale` multiplies the sprite's **natural size**, and the natural size
 * is the size the art was drawn at. Scenario art is small pixel art the runtime
 * scales up, so "one art pixel" needs a fixed exchange rate to be a size at all:
 * that is {@link SCENARIO_ART_FRAME}, the nominal scene, whose *height* is
 * mapped onto the play area's. A sprite at `scale: 1` is then the size it would
 * be if it had been painted into a scene that tall — a 47px ram stands about a
 * fifth of the scene, which is what it was drawn as.
 *
 * The frame is a **host convention, not a measurement**. Every shipped scenario
 * composes into it today, backdrop and sprites alike, so it could just as well
 * be read from the scenario's own background image — but a backdrop is not a
 * statement about the art standing in front of it. An art pass that briefly
 * shipped Rocky's backdrops at 768x288 with its sprites unchanged (since
 * reverted) is the demonstration: had the unit come from that file, every actor
 * in the game would have halved without a line of code changing. It is pinned
 * here instead, where changing it is a decision.
 *
 * Two alternatives were rejected. Sizing from the row height (what note art
 * does, where `scale: 1` means one row tall) throws the art's own proportions
 * away: Butt-Butt-BONK's tall thin accent flash and its square impact burst are
 * 15x60 and 37x37, and one-row-tall would draw the first as a sliver. Matching
 * the backdrop's cover-fit scale exactly would tie sprite size to the window's
 * aspect ratio, so a wide window would grow the performer without moving the
 * `y` coordinates it was placed by — a family's careful "hooves here, horns
 * there" would come apart at some viewport and not others. Height alone is
 * aspect-independent, which is what keeps a placement honest everywhere.
 */

import type { Layer, Sprite } from "../../minigame/api.js";

/**
 * The nominal scene scenario art is drawn against: 16:9 at a pixel-art scale.
 *
 * What gives `Sprite.scale` a unit, and the size the scenario art in this
 * repository is drawn against — the generated backdrops, and both of the
 * families that draw sprites. Only the **height** is used: sizing from the width
 * too would tie a sprite to the window's aspect ratio while the `y` placing it
 * stayed put.
 */
export const SCENARIO_ART_FRAME = { width: 384, height: 216 } as const;

/**
 * Where a sprite lands, in canvas pixels.
 *
 * `playLeft`/`playWidth` are the playfield — everything right of the gutter —
 * and `bandTop`/`bandHeight` the lane band, which is what `y` is normalised to.
 * `paneHeight` is the whole canvas, because a sprite's *size* comes from the
 * art frame mapped onto the pane rather than from the band.
 */
export type StageGeometry = {
  readonly playLeft: number;
  readonly playWidth: number;
  readonly bandTop: number;
  readonly bandHeight: number;
  readonly paneHeight: number;
};

/** Just enough of {@link AssetStore} to draw with. */
export type SpriteImages = {
  get(id: string): HTMLImageElement | null;
};

/** A sprite with no `layer` is an actor or an effect, so it goes in front. */
const DEFAULT_LAYER: Layer = "over";

/** Screen pixels per art pixel: the art frame's height, over the pane's. */
export function artPixelSize(paneHeight: number): number {
  return paneHeight / SCENARIO_ART_FRAME.height;
}

/**
 * One sprite's box in canvas pixels.
 *
 * `anchorX`/`anchorY` are where the sprite's `(x, y)` landed — the point it is
 * rotated about, so a flinching performer leans on its hooves rather than
 * swinging around its middle. `left`/`top` are the image's corner *relative to
 * that anchor*, which is what a rotated `drawImage` needs.
 */
export type SpriteBox = {
  anchorX: number;
  anchorY: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export function spriteBox(
  sprite: Sprite,
  image: { readonly width: number; readonly height: number },
  geometry: StageGeometry
): SpriteBox {
  const unit = artPixelSize(geometry.paneHeight) * (sprite.scale ?? 1);
  const width = image.width * unit;
  const height = image.height * unit;
  return {
    anchorX: geometry.playLeft + sprite.x * geometry.playWidth,
    anchorY: geometry.bandTop + (sprite.y + (sprite.offsetY ?? 0)) * geometry.bandHeight,
    left: -width / 2,
    top: sprite.anchor === "bottom" ? -height : -height / 2,
    width,
    height,
  };
}

/**
 * The sprites of one layer, in the order they are drawn: `z`, then array order.
 *
 * The array order tie-break is why this sorts indices rather than the sprites
 * themselves — `Array.prototype.sort` is stable in every engine the game runs
 * in, but a family reading "then array order" out of the contract should not
 * have to know that.
 */
export function orderedSprites(sprites: readonly Sprite[], layer: Layer): Sprite[] {
  return sprites
    .map((sprite, index) => ({ sprite, index }))
    .filter((entry) => (entry.sprite.layer ?? DEFAULT_LAYER) === layer)
    .sort((a, b) => (a.sprite.z ?? 0) - (b.sprite.z ?? 0) || a.index - b.index)
    .map((entry) => entry.sprite);
}

/**
 * Draws one layer of one minigame's stage.
 *
 * A sprite whose asset is missing is skipped rather than substituted: a gap is
 * the symptom the asset store's failure list is there to explain, and a
 * stand-in box would hide a scenario that never loaded its art. The caller
 * clips to the playfield; nothing here escapes it.
 */
export function drawStageSprites(
  ctx: CanvasRenderingContext2D,
  sprites: readonly Sprite[],
  layer: Layer,
  geometry: StageGeometry,
  images: SpriteImages
): void {
  for (const sprite of orderedSprites(sprites, layer)) {
    const image = images.get(sprite.assetId);
    if (!image) continue;
    const box = spriteBox(sprite, image, geometry);
    const opacity = Math.max(0, Math.min(1, sprite.opacity ?? 1));
    if (opacity <= 0) continue;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(box.anchorX, box.anchorY);
    if (sprite.rotationDeg) ctx.rotate((sprite.rotationDeg * Math.PI) / 180);
    ctx.drawImage(image, box.left, box.top, box.width, box.height);
    ctx.restore();
  }
}
