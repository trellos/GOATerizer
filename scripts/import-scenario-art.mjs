#!/usr/bin/env node
/**
 * Derives Butt-Butt-BONK's per-slot art from the vendored external sheets.
 *
 * ## Why this exists alongside `generate-placeholder-art.mjs`
 *
 * That script *draws* the Rocky and Can Crushing art, because the environment
 * the vertical slice was built in could not reach `itch.io` or
 * `opengameart.org`. It can now, so this scenario is the first to carry real
 * third-party art — and the discipline has to survive the change:
 *
 * - nothing is fetched at build time. The sheets are vendored under
 *   `art-sources/`, with provenance in `docs/assets/ASSET_SOURCES.md`;
 * - nothing is hotlinked at runtime (`AGENTS.md` §11);
 * - every sprite the runtime loads is one **static billboard** (§10), so a
 *   five-frame strip and a 4x4 grid are cut down here, once, rather than
 *   animated later;
 * - the run is deterministic. Same sources, same bytes out, so re-running this
 *   produces an empty diff and a changed frame choice produces a reviewable one.
 *
 * ## The sources, and what each is for
 *
 * | Pack | Author | Licence | Used for |
 * |---|---|---|---|
 * | Mountain Goat Sprites | Sevarihk | CC-BY 4.0 | the ram: two taps, the leap, the finish |
 * | pixel wolf | alizard | CC0 | the target, intact and bonked |
 * | Pixel Art Mountains Parallax | DustDFG | CC0 | the moonlit backdrop |
 * | Free Pixel Effects Pack | CodeManu | CC0 | the three impact effects |
 *
 * Run with `npm run art:import`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pixels } from "./lib/png.mjs";
import {
  cornerColour,
  flipX,
  frame,
  keyColour,
  night,
  over,
  read,
  scale,
  toPng,
  trim,
} from "./lib/external-art.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.resolve(here, "..", "art-sources");
const OUT = path.resolve(here, "..", "public", "assets", "scenarios", "butt-butt-bonk");

const load = (...parts) => read(readFileSync(path.join(SOURCES, ...parts)));

/**
 * The backdrop is 384x216, matching the Rocky family and Can Crushing.
 *
 * DustDFG's layers are 160x80, which is not a whole-number fraction of that, so
 * they are upscaled by 3 to 480x240 — the only kind of scale that keeps pixel
 * art crisp — and then cropped rather than squashed. The crop takes the sky off
 * the top and keeps the ground, because the ground is where the actors stand.
 */
const BACKDROP = { width: 384, height: 216 };

/**
 * Which row of a 4x4 RPG-Maker sheet faces which way.
 *
 * The rows are down, left, right, up. The ram is the hero and stands near the
 * strike line facing the notes that are coming, which arrive from the right, so
 * every ram frame is taken from the right-facing row. The wolf is the thing
 * being headbutted and faces back at him.
 */
const RIGHT = 2;

/** Every layer of the parallax, back to front. The pack ships no ordering. */
const LAYERS = [
  "background",
  "clouds_big",
  "clouds_small",
  "mountains_2",
  "mountains_1",
  "valley",
  "christmas_trees_2",
  "christmas_trees_1",
];

/**
 * Moonlight, painted rather than found.
 *
 * The pack has no moon — it is a daytime scene — and one drawn disc is a great
 * deal less work than sourcing a second background. It sits high and to the
 * right, away from where the actors play.
 */
function addMoon(image) {
  const canvas = new Pixels(image.width, image.height);
  canvas.data.set(image.data);
  const cx = Math.round(image.width * 0.78);
  const cy = Math.round(image.height * 0.17);
  // A soft halo first, then the disc, so the edge is not a hard circle on a
  // flat sky. Alpha falls off with the square of the distance.
  for (let r = 22; r > 8; r -= 1) {
    const alpha = Math.round(26 * (1 - (r - 8) / 14) ** 2);
    canvas.fillEllipse(cx, cy, r, r, [214, 228, 255, alpha]);
  }
  canvas.fillEllipse(cx, cy, 7, 7, [238, 244, 236, 255]);
  return { width: image.width, height: image.height, data: canvas.data };
}

function background() {
  let composed = { width: 160, height: 80, data: new Uint8Array(160 * 80 * 4) };
  for (const layer of LAYERS) {
    composed = over(composed, load("dustdfg-mountains-parallax", `${layer}.png`));
  }
  const big = scale(night(composed), 3);
  // Centre horizontally, keep the bottom: 480 -> 384 takes 48 off each side,
  // and 240 -> 216 takes 24 off the top.
  const cropped = {
    width: BACKDROP.width,
    height: BACKDROP.height,
    data: new Uint8Array(BACKDROP.width * BACKDROP.height * 4),
  };
  for (let y = 0; y < BACKDROP.height; y += 1) {
    const from = ((y + 24) * big.width + 48) * 4;
    cropped.data.set(big.data.subarray(from, from + BACKDROP.width * 4), y * BACKDROP.width * 4);
  }
  return addMoon(cropped);
}

/** One frame of the ram, cut from the right-facing row and trimmed to its body. */
function ram(sheet, column) {
  return trim(frame(load("sevarihk-mountain-goat", sheet), 4, 4, column, RIGHT));
}

/** One frame of the wolf: keyed off its opaque teal, trimmed, turned to face left. */
function wolf(sheet, frames, column) {
  const sheetImage = load("alizard-pixel-wolf", sheet);
  const keyed = keyColour(sheetImage, cornerColour(sheetImage));
  return flipX(trim(frame(keyed, frames, 1, column, 0)));
}

/**
 * One effect frame, trimmed to its content.
 *
 * The frames are 100x100 cells but the art inside them is far smaller, and
 * which cell to take is not a guess: `10_weaponhit` is one expanding ring
 * growing 1px -> 37px across its 36 cells, so an early cell *is* a tight spark
 * and a late one *is* a wide shockwave. That is what makes a small tap and a
 * big headbutt two different effects rather than one asset at two scales.
 */
function effect(sheet, columns, rows, column, row) {
  return trim(frame(load("codemanu-pixel-effects", sheet), columns, rows, column, row));
}

const ASSETS = {
  bg_butt_butt_bonk: background(),

  // Two little preparatory horn taps: two contrasting frames of the walk cycle,
  // far enough apart in the stride that the second reads as a second tap.
  goat_butt_butt_bonk_step_1: ram("bergschaf-laufanimation-m.png", 0),
  goat_butt_butt_bonk_step_2: ram("bergschaf-laufanimation-m.png", 2),
  // The BONK. `bocksprung` is German for a goat's leap and this is the only
  // found art that fills step C without editing a sprite.
  goat_butt_butt_bonk_step_3: ram("bergschaf-bocksprung-m.png", 1),
  goat_butt_butt_bonk_step_3_alt: ram("bergschaf-bocksprung-m.png", 3),
  goat_butt_butt_bonk_finish: ram("bergschaf-grasend-m.png", 0),

  // The victim, and the victim afterwards. A wolf that sits down is the
  // catalogue's "humiliated" state, already drawn, at no extra cost.
  prop_butt_butt_bonk_target: wolf("wolf_run.png", 5, 2),
  prop_butt_butt_bonk_target_hit: wolf("wolf_sit.png", 4, 3),

  // The same expanding ring caught early and late: a tight spark for the two
  // horn taps, the wide shockwave for the headbutt they set up.
  fx_butt_butt_bonk_hit_small: effect("10_weaponhit_spritesheet.png", 6, 6, 4, 2),
  fx_butt_butt_bonk_hit_big: effect("10_weaponhit_spritesheet.png", 6, 6, 5, 4),
  // A vertical strike flash at its tallest, for the triplet-group punctuation.
  fx_butt_butt_bonk_accent: effect("5_magickahit_spritesheet.png", 7, 7, 5, 2),
};

mkdirSync(OUT, { recursive: true });
for (const [id, image] of Object.entries(ASSETS)) {
  writeFileSync(path.join(OUT, `${id}.png`), toPng(image));
  process.stdout.write(`${id.padEnd(34)} ${image.width}x${image.height}\n`);
}
process.stdout.write(`\n${Object.keys(ASSETS).length} files -> ${path.relative(process.cwd(), OUT)}\n`);
