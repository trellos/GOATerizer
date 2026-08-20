/**
 * The scenario library.
 *
 * Adding another `ClimbMinigame` scenario means: author a JSON file, drop its
 * art in `public/assets/scenarios/<id>/`, and add one entry here. No gameplay
 * code changes — which is the property the run shell and `ClimbMinigame` exist
 * to preserve.
 *
 * The vertical slice ships one scenario. The run shell below still models all
 * 16 slots and the real difficulty sequence.
 */

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
 * The ten `ClimbMinigame` asset ids every Rocky-family scenario binds, derived
 * from the scenario id rather than retyped per scenario: background, four
 * advance poses, a finish pose, a foothold, a destination, and two effects.
 * Every Rocky scenario's `assetBindings` follows this exact naming convention,
 * so generating it once removes a per-scenario chance to typo an id that
 * `loadScenario` would otherwise only catch at runtime.
 */
function climbAssetIds(scenarioId: string): readonly string[] {
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

export const SCENARIOS: readonly ScenarioDefinition[] = [
  ROCKY_ASCENT,
  ROCKY_ASCENT_HIGH,
  ROCKY_DESCENT,
  ROCKY_DESCENT_HIGH,
];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/** Every scenario that has authored level data for this difficulty. */
export function scenariosForDifficulty(difficulty: number): ScenarioDefinition[] {
  return SCENARIOS.filter((scenario) => scenario.levels.has(difficulty));
}
