/**
 * Types for the Can Crushing art generator, so the sprites can be asserted on.
 *
 * The generator is plain ESM run by `scripts/generate-placeholder-art.mjs` and
 * has no need of TypeScript itself. This exists only because `tests/can-art`
 * checks the art against the layout that draws it — the timeline sizes a can by
 * its height and takes the width from the sprite, so the sprite's proportions
 * are part of the layout and worth a test.
 *
 * Only what that test imports is declared. Adding an export here is not needed
 * to use one from JavaScript.
 */

/** A raw RGBA bitmap, as `scripts/lib/png.mjs` builds them. */
export type PixelImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export function can(palette?: Record<string, readonly number[]>): PixelImage;
export function canCrushed(palette?: Record<string, readonly number[]>): PixelImage;
