#!/usr/bin/env node
/**
 * Generates placeholder pixel art for the assets that don't yet have real
 * art: the destination cairn, dust and tick effects for the four "Rocky"
 * `ClimbMinigame` scenarios; everything for the one `RepeatMinigame`
 * scenario, Can Crushing; and everything but the crowd goat for the one
 * `PerformMinigame` scenario, Goat Frontman.
 *
 * ## Why some of this is still generated
 *
 * Each Rocky scenario file names third-party CC0/CC-BY sources (karsiori's
 * mountains and rock piles, Spring Spring's goat strip and dust, CodeManu's
 * effects pack). An environment that could reach itch.io and opengameart.org
 * opened every one of them and verified licence and fit on the actual source
 * page (`docs/assets/ASSET_SOURCES.md` has the full record). Three ids per
 * family now ship that real art instead of being generated: the goat pose
 * cycle, the background, and the foothold. The destination cairn had no
 * matching shape in the rock-pile pack (it wants a tall stacked cairn; the
 * pack only has wide flat rubble piles), and the dust/tick sources were
 * rejected on fit — so those three ids per family are still drawn here:
 * original work for this repository, CC0, no third-party rights involved.
 *
 * ## Why one script for six scenarios
 *
 * Rocky Ascent, Rocky Ascent High, Rocky Descent and Rocky Descent High are the
 * same `ClimbMinigame` shapes — a goat, a foothold, a cairn, dust, a tick, a
 * mountain backdrop — wearing different route and register data. Each
 * scenario's own file says the placeholder source families may be reused from
 * the normal version, so the drawing functions for what's still generated
 * live once in `scripts/lib/rocky-art.mjs` and this script just points them
 * at four directories and four id prefixes.
 *
 * Can Crushing shares none of those shapes — it is a different class, a
 * different theme and a different palette — so its drawing functions live in
 * `scripts/lib/crusher-art.mjs` and it gets its own pass below. Goat Frontman
 * is the same story again, in `scripts/lib/frontman-art.mjs`: a stadium stage
 * under coloured light rather than a beach or an alpine dusk, deliberately
 * borrowing the Rocky goat body so the frontman is visibly the same animal.
 * What every family shares is the discipline: original CC0 work, one file per
 * bound slot, seeded so every run produces the same bytes.
 *
 * ## What the art has to be
 *
 * Readable silhouettes at gameplay speed, and nothing more. Each file is a
 * static billboard the runtime shows, hides, translates, scales and rotates —
 * no frame animation, no skeletal rig. The four `advance`/`perform` poses are a
 * pose *cycle*, swapped one per successful note, not an animation strip.
 *
 *   node scripts/generate-placeholder-art.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dust, goal, tick } from "./lib/rocky-art.mjs";
import {
  beachBackground,
  broAction,
  broFinish,
  broNeutral,
  can,
  canCrushed,
  crushImpact,
} from "./lib/crusher-art.mjs";
import * as frontman from "./lib/frontman-art.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_ROOT = path.resolve(here, "..", "public", "assets", "scenarios");

/** One entry per scenario directory that still gets generated assets. */
const FAMILIES = [
  { dir: "rocky-ascent", idPrefix: "rocky_ascent" },
  { dir: "rocky-ascent-high", idPrefix: "rocky_ascent_high" },
  { dir: "rocky-descent", idPrefix: "rocky_descent" },
  { dir: "rocky-descent-high", idPrefix: "rocky_descent_high" },
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

// Three ids per family are intentionally NOT generated here any more: the
// climber pose cycle (`goat_<idPrefix>_advance_01..04`, `_finish`), the
// background (`bg_<idPrefix>`) and the foothold (`prop_<idPrefix>_step`) all
// now ship real art (Mountain Goat Sprites by Sevarihk CC-BY 4.0, and
// karsiori's mountains/rock-pile CC0 packs — see
// docs/assets/ASSET_SOURCES.md) in all four directories below. Re-running
// this generator must not clobber any of it. The destination cairn and the
// two effects stay generated: no equivalent cairn shape was found in the
// rock-pile pack, and the dust/tick sources were rejected on fit.
for (const { dir, idPrefix } of FAMILIES) {
  writeScenarioAssets(dir, {
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

/**
 * Goat Frontman — the one `PerformMinigame` scenario. A different theme (a
 * stage under coloured light) with its own drawing functions in
 * `lib/frontman-art.mjs`, which borrow the Rocky goat body so the frontman is
 * visibly the same animal. The asset ids are the canonical ones from
 * `GOATerizer_Scenario_Asset_Slot_Bindings.md` §3 plus the two timeline
 * note-art pieces the class binds.
 *
 * `react_goat_frontman_neutral` and `_impressed` (the crowd goat, both states)
 * are deliberately absent from this dictionary: they are shipped real art now
 * (`docs/assets/ASSET_SOURCES.md`), not generated, and this script must not
 * regenerate over them.
 */
writeScenarioAssets("goat-frontman", {
  bg_goat_frontman: () => frontman.background(),
  goat_goat_frontman_perform_01: () => frontman.frontmanPose(0),
  goat_goat_frontman_perform_02: () => frontman.frontmanPose(1),
  goat_goat_frontman_perform_03: () => frontman.frontmanPose(2),
  goat_goat_frontman_perform_04: () => frontman.frontmanPose(3),
  goat_goat_frontman_bend: () => frontman.frontmanFlourish("bend"),
  goat_goat_frontman_slur: () => frontman.frontmanFlourish("slur"),
  goat_goat_frontman_finish: () => frontman.frontmanFinish(),
  prop_goat_frontman_signature: () => frontman.micStand(),
  fx_goat_frontman_swoosh: () => frontman.swoosh(),
  fx_goat_frontman_sparkle: () => frontman.sparkle(),
  fx_goat_frontman_burst: () => frontman.burst(),
  note_goat_frontman_light: () => frontman.lightBar(),
  note_goat_frontman_star: () => frontman.flourishStar(),
});
