/**
 * The scenario library.
 *
 * Adding another scenario of a class that already exists means: author a JSON
 * file, drop its art in `public/assets/scenarios/<id>/`, and add one entry here.
 * No gameplay code changes — which is the property the run shell and the
 * minigame classes exist to preserve.
 *
 * The vertical slice ships one scenario. The run shell below still models all
 * 16 slots and the real difficulty sequence.
 */

import { registerMinigame } from "../minigame/registry.js";
import { climbNoteArtIds, CLIMB_MINIGAME } from "./minigames/climb-minigame.js";
import { PERFORM_MINIGAME } from "./minigames/perform-minigame.js";
import { REPEAT_MINIGAME } from "./minigames/repeat-module.js";
import { THREE_STEP_MINIGAME } from "./minigames/three-step-minigame.js";
import buttButtBonkJson from "../../docs/scenarios/butt-butt-bonk/butt_butt_bonk.scenario.json";
import canCrushingJson from "../../docs/scenarios/can-crushing/can_crushing.scenario.json";
import goatFrontmanJson from "../../docs/scenarios/goat-frontman/goat_frontman.scenario.json";
import rockyAscentJson from "../../docs/scenarios/rocky-ascent/rocky_ascent.scenario.json";
import rockyAscentHighJson from "../../docs/scenarios/rocky-ascent-high/rocky_ascent_high.scenario.json";
import rockyDescentJson from "../../docs/scenarios/rocky-descent/rocky_descent.scenario.json";
import rockyDescentHighJson from "../../docs/scenarios/rocky-descent-high/rocky_descent_high.scenario.json";
import { loadScenario } from "./load.js";
import type { ScenarioDefinition } from "./types.js";

/**
 * Vite's base path. A GitHub Pages project site serves from a subpath, so a
 * root-absolute `/assets/...` would 404 there while working in local dev.
 */
const BASE_URL: string = import.meta.env?.BASE_URL ?? "/";

/*
 * The composition root for minigames.
 *
 * Registration lives here, with the content, rather than inside
 * `minigame/registry.ts`: the registry must not import a family, or the generic
 * half of the game would name a specific one again. This module already knows
 * which scenarios this build ships, so it is the honest place to say which
 * families it ships too.
 */
registerMinigame(CLIMB_MINIGAME);
registerMinigame(REPEAT_MINIGAME);
registerMinigame(PERFORM_MINIGAME);
registerMinigame(THREE_STEP_MINIGAME);

/**
 * Placeholder art lives in the project's own asset tree, never hotlinked.
 * Provenance for every file is recorded in `docs/assets/ASSET_SOURCES.md`.
 */
function assetUrls(scenarioDir: string, ids: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    ids.map((id) => [id, `${BASE_URL}assets/scenarios/${scenarioDir}/${id}.png`])
  );
}

/**
 * The ids each Rocky-family scenario binds, derived from the scenario id rather
 * than retyped per scenario. `assetIds()` on the module decides *which* ids a
 * family needs; this only says where they live on disk.
 */
function climbAssetIds(scenarioId: string): readonly string[] {
  const art = climbNoteArtIds(scenarioId);
  return [
    `bg_${scenarioId}`,
    `goat_${scenarioId}_advance_01`,
    `goat_${scenarioId}_advance_02`,
    `goat_${scenarioId}_advance_03`,
    `goat_${scenarioId}_advance_04`,
    `goat_${scenarioId}_finish`,
    `prop_${scenarioId}_step`,
    `prop_${scenarioId}_goal`,
    `fx_${scenarioId}_dust`,
    `fx_${scenarioId}_tick`,
    art.body,
    art.crag,
  ];
}

export const ROCKY_ASCENT: ScenarioDefinition = loadScenario(
  rockyAscentJson,
  assetUrls("rocky-ascent", climbAssetIds("rocky_ascent"))
);

/**
 * A higher-register companion to Rocky Ascent: same route/rhythm shapes as
 * L1-4, transposed up one octave and relabelled L3-6 (see the scenario file's
 * `runTransposition` and `difficultyOffsetFromNormalVersion`).
 */
export const ROCKY_ASCENT_HIGH: ScenarioDefinition = loadScenario(
  rockyAscentHighJson,
  assetUrls("rocky-ascent-high", climbAssetIds("rocky_ascent_high"))
);

/** The same class, descending: every scale fragment falls from b1 toward 1. */
export const ROCKY_DESCENT: ScenarioDefinition = loadScenario(
  rockyDescentJson,
  assetUrls("rocky-descent", climbAssetIds("rocky_descent"))
);

/** Rocky Descent's higher-register companion, at L3-6. */
export const ROCKY_DESCENT_HIGH: ScenarioDefinition = loadScenario(
  rockyDescentHighJson,
  assetUrls("rocky-descent-high", climbAssetIds("rocky_descent_high"))
);

/**
 * The `RepeatMinigame` slots, likewise derived rather than retyped. Unlike the
 * Rocky family these ids are not a function of the scenario id — they follow
 * the canonical catalogue naming (`hero80_`, `prop_`, `fx_`), so this one is
 * spelled out rather than templated.
 */
const CAN_CRUSHING_ASSET_IDS: readonly string[] = [
  "bg_can_crushing",
  "hero80_can_crushing_ready",
  "hero80_can_crushing_action",
  "hero80_can_crushing_finish",
  "prop_can_crushing_intact",
  "prop_can_crushing_done",
  "fx_can_crushing_impact",
];

/**
 * The one `RepeatMinigame` scenario: a performer who stands still while the
 * player places cans at him. PROTOTYPE — see
 * `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 */
export const CAN_CRUSHING: ScenarioDefinition = loadScenario(
  canCrushingJson,
  assetUrls("can-crushing", CAN_CRUSHING_ASSET_IDS)
);

/**
 * The `PerformMinigame` slots: the canonical `PerformMinigame` ids from
 * `GOATerizer_Scenario_Asset_Slot_Bindings.md` §3, plus the two timeline
 * note-art pieces the class binds (`noteArt.body`, `noteArt.flourish`). Not a
 * function of the scenario id, like Can Crushing's — Goat Frontman is the one
 * scenario this class has, and its ids follow the canonical catalogue naming.
 */
const GOAT_FRONTMAN_ASSET_IDS: readonly string[] = [
  "bg_goat_frontman",
  "goat_goat_frontman_perform_01",
  "goat_goat_frontman_perform_02",
  "goat_goat_frontman_perform_03",
  "goat_goat_frontman_perform_04",
  "goat_goat_frontman_bend",
  "goat_goat_frontman_slur",
  "goat_goat_frontman_finish",
  "prop_goat_frontman_signature",
  "react_goat_frontman_neutral",
  "react_goat_frontman_impressed",
  "fx_goat_frontman_swoosh",
  "fx_goat_frontman_sparkle",
  "fx_goat_frontman_burst",
  "note_goat_frontman_light",
  "note_goat_frontman_star",
];

/**
 * The one `PerformMinigame` scenario: a goat frontman working a crowd of goats
 * that grows with every flourish it lands. Authored in pentatonic degrees —
 * see `scripts/author-goat-frontman.mjs` for the notation.
 */
export const GOAT_FRONTMAN: ScenarioDefinition = loadScenario(
  goatFrontmanJson,
  assetUrls("goat-frontman", GOAT_FRONTMAN_ASSET_IDS)
);

/**
 * The `ThreeStepMinigame` slots. Spelled out rather than templated, like Can
 * Crushing's and for the same reason: these follow the catalogue's naming
 * (`goat_`, `prop_`, `fx_`) rather than being a function of the scenario id.
 *
 * `targetVisuals` binds two ids where the catalogue lists one. That is not an
 * invented slot — the array is the catalogue's — and the second state is what
 * makes a headbutt land: [0] is the wolf standing, [1] the wolf sitting down.
 */
const BUTT_BUTT_BONK_ASSET_IDS: readonly string[] = [
  "bg_butt_butt_bonk",
  "goat_butt_butt_bonk_step_1",
  "goat_butt_butt_bonk_step_2",
  "goat_butt_butt_bonk_step_3",
  "goat_butt_butt_bonk_step_3_alt",
  "goat_butt_butt_bonk_finish",
  "prop_butt_butt_bonk_target",
  "prop_butt_butt_bonk_target_hit",
  "fx_butt_butt_bonk_hit_small",
  "fx_butt_butt_bonk_hit_big",
  "fx_butt_butt_bonk_accent",
];

/**
 * The one `ThreeStepMinigame` scenario: two horn taps and a headbutt, delivered
 * to a wolf by moonlight.
 *
 * The first scenario with no generated placeholder in it at all — every slot is
 * third-party art, vendored under `art-sources/` and cut down by
 * `scripts/import-scenario-art.mjs` (see `docs/assets/ASSET_SOURCES.md`). It is
 * also the first authored triplet content in the game, so it is the first thing
 * that selects the drum kit's triplet rhythm variant.
 */
export const BUTT_BUTT_BONK: ScenarioDefinition = loadScenario(
  buttButtBonkJson,
  assetUrls("butt-butt-bonk", BUTT_BUTT_BONK_ASSET_IDS)
);

export const SCENARIOS: readonly ScenarioDefinition[] = [
  ROCKY_ASCENT,
  ROCKY_ASCENT_HIGH,
  ROCKY_DESCENT,
  ROCKY_DESCENT_HIGH,
  CAN_CRUSHING,
  GOAT_FRONTMAN,
  BUTT_BUTT_BONK,
];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/** Every scenario that has authored level data for this difficulty. */
export function scenariosForDifficulty(difficulty: number): ScenarioDefinition[] {
  return SCENARIOS.filter((scenario) => scenario.levels.has(difficulty));
}
