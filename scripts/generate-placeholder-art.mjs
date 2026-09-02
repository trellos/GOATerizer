#!/usr/bin/env node
/**
 * Generates placeholder pixel art for every built scenario: the four "Rocky"
 * `ClimbMinigame` scenarios and the one `RepeatMinigame` scenario, Can Crushing.
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
 * ## Why one script for five scenarios
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
 * Can Crushing shares none of those shapes — it is a different class, a
 * different theme and a different palette — so its drawing functions live in
 * `scripts/lib/crusher-art.mjs` and it gets its own pass below. What it does
 * share is the discipline: original CC0 work, one file per bound slot, seeded
 * so every run produces the same bytes.
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

import { background, dust, goal, step, tick } from "./lib/rocky-art.mjs";
import {
  beachBackground,
  broAction,
  broFinish,
  broNeutral,
  can,
  canCrushed,
  crushImpact,
} from "./lib/crusher-art.mjs";

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

/** Writes one scenario directory. `assets` is asset id -> a factory for it. */
function writeScenarioAssets(dir, assets) {
  const outDir = path.join(SCENARIOS_ROOT, dir);
  mkdirSync(outDir, { recursive: true });
  for (const [id, make] of Object.entries(assets)) {
    const image = make();
    writeFileSync(path.join(outDir, `${id}.png`), image.toPng());
    console.log(`${dir}/${id}.png  ${image.width}x${image.height}`);
  }
  console.log(
    `Wrote ${Object.keys(assets).length} placeholder assets to ` +
      `${path.relative(process.cwd(), outDir)}\n`
  );
}

// The climber pose cycle (`goat_<idPrefix>_advance_01..04` and `_finish`) is
// intentionally NOT generated here any more: it now ships real art (Mountain
// Goat Sprites by Sevarihk, CC-BY 4.0 — see docs/assets/ASSET_SOURCES.md) in
// all four directories below. Re-running this generator must not clobber it.
for (const { dir, idPrefix, seed } of FAMILIES) {
  writeScenarioAssets(dir, {
    [`bg_${idPrefix}`]: () => background(undefined, seed),
    [`prop_${idPrefix}_step`]: () => step(),
    [`prop_${idPrefix}_goal`]: () => goal(),
    // Dust keeps its own default seed regardless of family: it is a small,
    // generic effect, unlike the background, so there is no reason to vary it
    // and every reason to keep Rocky Ascent's original file reproducible.
    [`fx_${idPrefix}_dust`]: () => dust(),
    [`fx_${idPrefix}_tick`]: () => tick(),
  });
}

/**
 * Can Crushing — the one `RepeatMinigame` scenario.
 *
 * Seven files for seven bound slots. The ids are the canonical ones from
 * `GOATerizer_Scenario_Asset_Slot_Bindings.md` §3 (Can Crushing), not invented
 * here, so the real art can drop in against the same names. The two extra slots
 * that document names — `debrisEffects[]` and `streakEffects[]` — are not bound
 * by the runtime's `RepeatAssetBindings` yet, so nothing is drawn for them.
 */
writeScenarioAssets("can-crushing", {
  bg_can_crushing: () => beachBackground(),
  hero80_can_crushing_ready: () => broNeutral(),
  hero80_can_crushing_action: () => broAction(),
  hero80_can_crushing_finish: () => broFinish(),
  prop_can_crushing_intact: () => can(),
  prop_can_crushing_done: () => canCrushed(),
  fx_can_crushing_impact: () => crushImpact(),
});
