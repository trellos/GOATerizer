#!/usr/bin/env node
/**
 * Generates placeholder pixel art for the whole "Rocky" scenario family.
 *
 * ## Why generated rather than downloaded
 *
 * Each scenario file names third-party CC0 sources (karsiori's mountains and
 * rock piles, Spring Spring's goat strip and dust, CodeManu's effects pack).
 * They are the right *kind* of placeholder and are recorded in
 * `docs/assets/ASSET_SOURCES.md` as the intended swap-in. They are not what
 * ships today: the environment Rocky Ascent was first built in could not reach
 * itch.io or opengameart.org, so the honest options were to ship unverified art
 * or to draw substitutes.
 *
 * These are the substitutes: original work for this repository, CC0, no
 * third-party rights involved. Every one fills exactly the slot the scenario
 * binds, at the same pixel scale, so swapping the real sources in later is a
 * file replacement and nothing else.
 *
 * ## Why one script for four scenarios
 *
 * Rocky Ascent, Rocky Ascent High, Rocky Descent and Rocky Descent High are the
 * same `ClimbMinigame` shapes — a goat, a foothold, a cairn, dust, a tick, a
 * mountain backdrop — wearing different route and register data. Each
 * scenario's own file says the placeholder source families may be reused from
 * the normal version, so the drawing functions live once in
 * `scripts/lib/rocky-art.mjs` and this script just points them at four
 * directories and four id prefixes, with a distinct RNG seed per family so the
 * backgrounds and dust are not byte-identical across scenarios.
 *
 * ## What the art has to be
 *
 * Readable silhouettes at gameplay speed, and nothing more. Each file is a
 * static billboard the runtime shows, hides, translates, scales and rotates —
 * no frame animation, no skeletal rig. The four `advance` poses are a pose
 * *cycle*, swapped one per successful note, not an animation strip.
 *
 *   node scripts/generate-placeholder-art.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { background, dust, goal, goatFinish, goatPose, GOAT_LEGS, step, tick } from "./lib/rocky-art.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_ROOT = path.resolve(here, "..", "public", "assets", "scenarios");

/**
 * One entry per scenario directory. `seed` only varies the background/dust
 * noise pattern — same palette, same shapes, so the four families read as one
 * consistent visual set while not being literal duplicate files.
 */
const FAMILIES = [
  { dir: "rocky-ascent", idPrefix: "rocky_ascent", seed: 0x60a7 },
  { dir: "rocky-ascent-high", idPrefix: "rocky_ascent_high", seed: 0x60a7 + 1 },
  { dir: "rocky-descent", idPrefix: "rocky_descent", seed: 0x60a7 + 2 },
  { dir: "rocky-descent-high", idPrefix: "rocky_descent_high", seed: 0x60a7 + 3 },
];

for (const { dir, idPrefix, seed } of FAMILIES) {
  const outDir = path.join(SCENARIOS_ROOT, dir);
  const assets = {
    [`bg_${idPrefix}`]: () => background(undefined, seed),
    [`goat_${idPrefix}_advance_01`]: () => goatPose(GOAT_LEGS[0]),
    [`goat_${idPrefix}_advance_02`]: () => goatPose(GOAT_LEGS[1]),
    [`goat_${idPrefix}_advance_03`]: () => goatPose(GOAT_LEGS[2]),
    [`goat_${idPrefix}_advance_04`]: () => goatPose(GOAT_LEGS[3]),
    [`goat_${idPrefix}_finish`]: () => goatFinish(),
    [`prop_${idPrefix}_step`]: () => step(),
    [`prop_${idPrefix}_goal`]: () => goal(),
    // Dust keeps its own default seed regardless of family: it is a small,
    // generic effect, unlike the background, so there is no reason to vary it
    // and every reason to keep Rocky Ascent's original file reproducible.
    [`fx_${idPrefix}_dust`]: () => dust(),
    [`fx_${idPrefix}_tick`]: () => tick(),
  };

  mkdirSync(outDir, { recursive: true });
  for (const [id, make] of Object.entries(assets)) {
    const image = make();
    writeFileSync(path.join(outDir, `${id}.png`), image.toPng());
    console.log(`${dir}/${id}.png  ${image.width}x${image.height}`);
  }
  console.log(`Wrote ${Object.keys(assets).length} placeholder assets to ${path.relative(process.cwd(), outDir)}\n`);
}
