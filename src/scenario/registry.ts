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
import { REPEAT_MINIGAME } from "./minigames/repeat-module.js";
import canCrushingJson from "../../docs/scenarios/can-crushing/can_crushing.scenario.json";
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

export const SCENARIOS: readonly ScenarioDefinition[] = [
  ROCKY_ASCENT,
  ROCKY_ASCENT_HIGH,
  ROCKY_DESCENT,
  ROCKY_DESCENT_HIGH,
  CAN_CRUSHING,
];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/** Every scenario that has authored level data for this difficulty. */
export function scenariosForDifficulty(difficulty: number): ScenarioDefinition[] {
  return SCENARIOS.filter((scenario) => scenario.levels.has(difficulty));
}
