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

const ROCKY_ASCENT_ASSET_IDS = [
  "bg_rocky_ascent",
  "goat_rocky_ascent_advance_01",
  "goat_rocky_ascent_advance_02",
  "goat_rocky_ascent_advance_03",
  "goat_rocky_ascent_advance_04",
  "goat_rocky_ascent_finish",
  "prop_rocky_ascent_step",
  "prop_rocky_ascent_goal",
  "fx_rocky_ascent_dust",
  "fx_rocky_ascent_tick",
] as const;

export const ROCKY_ASCENT: ScenarioDefinition = loadScenario(
  rockyAscentJson,
  assetUrls("rocky-ascent", ROCKY_ASCENT_ASSET_IDS)
);

export const SCENARIOS: readonly ScenarioDefinition[] = [ROCKY_ASCENT];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/** Every scenario that has authored level data for this difficulty. */
export function scenariosForDifficulty(difficulty: number): ScenarioDefinition[] {
  return SCENARIOS.filter((scenario) => scenario.levels.has(difficulty));
}
