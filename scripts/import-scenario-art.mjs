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

import { lcg, Pixels } from "./lib/png.mjs";
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

/* -------------------------------------------------------------------------- */
/* The Rocky goat tiers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The Scale family's goat gets more badass with difficulty
 * (`ClimbMinigame.climberTiers`): L1-3 keep the generated 24x18 goat, and
 * L4-L7 escalate through Sevarihk's ram. The pack ships four goat variants
 * (white/brown x small/large horns), of which only the white large-horn `-m`
 * sheets are vendored, so the escalation past tier 1 is dressing rather than
 * a different animal: gold horns, then a crown, then a fire mane. Those
 * ornaments are drawn here, over the CC-BY frames, and are original work for
 * this repository. Fetching the brown and small-horn variants — which would
 * let tiers 1-3 be three genuinely different goats — is recorded as an open
 * thread in `docs/IDEAS.md`; the network policy of the session that built this
 * refused the art host.
 *
 * Every tier is four walk frames, the same pose cycle as the base goat, so the
 * layer swaps one for another without knowing a tier from a tier.
 */
const ROCKY_SCENARIOS = ["rocky_ascent", "rocky_ascent_high", "rocky_descent", "rocky_descent_high"];
const GOLD = [236, 186, 70];
const CROWN = [
  "g.g.g.g",
  "ggggggg",
  ".ggggg.",
];
const CROWN_PALETTE = { g: [255, 211, 77, 255] };

/** True for the ram's horn browns: warm, darker than its coat, not grey. */
function isHorn([r, g, b, a]) {
  return a > 0 && r > g && g > b && r - b > 34 && r < 215;
}

/** The ram with its horns recoloured gold, shading kept. */
function goldHorns(image) {
  const out = { width: image.width, height: image.height, data: image.data.slice() };
  for (let i = 0; i < out.data.length; i += 4) {
    const px = [out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]];
    if (!isHorn(px)) continue;
    const lum = (px[0] * 0.3 + px[1] * 0.59 + px[2] * 0.11) / 150;
    for (let c = 0; c < 3; c += 1) out.data[i + c] = Math.max(0, Math.min(255, Math.round(GOLD[c] * lum)));
  }
  return out;
}

/** The topmost opaque row in each column, or -1 where the column is empty. */
function topEdge(image) {
  const tops = [];
  for (let x = 0; x < image.width; x += 1) {
    let top = -1;
    for (let y = 0; y < image.height; y += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > 0) {
        top = y;
        break;
      }
    }
    tops.push(top);
  }
  return tops;
}

/** Room above the image for what gets stamped over its head. */
function withHeadroom(image, rows) {
  const canvas = new Pixels(image.width, image.height + rows);
  const raised = over({ width: image.width, height: image.height + rows, data: canvas.data }, image, 0, rows);
  return raised;
}

/** A gold crown on the head, which for a right-facing ram is the right-hand third. */
function crowned(image) {
  const raised = withHeadroom(image, CROWN.length + 1);
  const tops = topEdge(raised);
  // The head is the highest point in the right-hand 40% of the frame.
  let headX = Math.round(raised.width * 0.7);
  let headY = raised.height;
  for (let x = Math.round(raised.width * 0.5); x < raised.width; x += 1) {
    if (tops[x] >= 0 && tops[x] < headY) {
      headY = tops[x];
      headX = x;
    }
  }
  const canvas = new Pixels(raised.width, raised.height);
  canvas.data.set(raised.data);
  canvas.stamp(headX - 3, headY - CROWN.length, CROWN, CROWN_PALETTE);
  return { width: raised.width, height: raised.height, data: canvas.data };
}

/** Fire along the back: licks above the body's top edge, seeded so it is stable. */
function fireMane(image, seed) {
  const raised = withHeadroom(image, 7);
  const tops = topEdge(raised);
  const canvas = new Pixels(raised.width, raised.height);
  canvas.data.set(raised.data);
  const random = lcg(seed);
  const from = Math.round(raised.width * 0.12);
  const to = Math.round(raised.width * 0.55);
  for (let x = from; x < to; x += 1) {
    if (tops[x] < 0) continue;
    const height = 2 + Math.floor(random() * 5);
    for (let k = 1; k <= height; k += 1) {
      const y = tops[x] - k;
      if (y < 0) break;
      const hot = k / height;
      const colour = hot < 0.35 ? [255, 224, 102, 255] : hot < 0.7 ? [255, 138, 61, 255] : [255, 91, 43, 220];
      canvas.set(x, y, colour);
    }
  }
  return { width: raised.width, height: raised.height, data: canvas.data };
}

const WALK = [0, 1, 2, 3].map((column) => ram("bergschaf-laufanimation-m.png", column));
const TIERS = {
  1: WALK,
  2: WALK.map(goldHorns),
  3: WALK.map((frame) => crowned(goldHorns(frame))),
  4: WALK.map((frame, i) => fireMane(crowned(goldHorns(frame)), 7 + i)),
};

let written = 0;
for (const scenario of ROCKY_SCENARIOS) {
  const dir = path.resolve(here, "..", "public", "assets", "scenarios", scenario.replace(/_/g, "-"));
  mkdirSync(dir, { recursive: true });
  for (const [tier, frames] of Object.entries(TIERS)) {
    frames.forEach((image, i) => {
      const id = `goat_${scenario}_t${tier}_advance_${String(i + 1).padStart(2, "0")}`;
      writeFileSync(path.join(dir, `${id}.png`), toPng(image));
      written += 1;
    });
  }
}
process.stdout.write(`${written} Rocky goat tier files -> public/assets/scenarios/rocky-*/\n`);
