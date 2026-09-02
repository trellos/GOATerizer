/**
 * The scenario library.
 *
 * Adding a scenario means: author a JSON file naming a registered minigame,
 * drop its art in `public/assets/scenarios/<id>/`, and add one entry here. No
 * gameplay code changes — which is the property the minigame API exists to
 * preserve. Adding a whole new *kind* of scenario means one more
 * `registerMinigame` line below and a module implementing `MinigameModule`;
 * nothing in `game/`, `ui/` or the loader learns its name.
 *
 * The vertical slice ships one scenario. The run shell below still models all
 * 16 slots and the real difficulty sequence.
 */

import { registerMinigame } from "../minigame/registry.js";
import { CLIMB_MINIGAME } from "./minigames/climb-minigame.js";
import { PERFORM_MINIGAME } from "./minigames/perform-minigame.js";
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

/**
 * Placeholder art lives in the project's own asset tree, never hotlinked.
 * Provenance for every file is recorded in `docs/assets/ASSET_SOURCES.md`.
 *
 * *Which* ids a scenario needs is the minigame's answer, not this file's — the
 * loader asks the scenario's own module and resolves whatever it names. All
 * this supplies is where a given id lives on disk.
 */
function urlsIn(scenarioDir: string): (assetId: string) => string {
  return (assetId) => `${BASE_URL}assets/scenarios/${scenarioDir}/${assetId}.png`;
}

/*
 * The composition root for minigames.
 *
 * Registration lives here, with the content, rather than inside
 * `minigame/registry.ts`: the registry must not import a minigame, or the
 * generic half of the game would name a specific one again. This module already
 * knows which scenarios this build ships, so it is the honest place to say
 * which minigames it ships too.
 */
registerMinigame(CLIMB_MINIGAME);
registerMinigame(PERFORM_MINIGAME);

export const ROCKY_ASCENT: ScenarioDefinition = loadScenario(
  rockyAscentJson,
  urlsIn("rocky-ascent")
);

/**
 * A higher-register companion to Rocky Ascent: same route/rhythm shapes as
 * L1-4, transposed up one octave and relabelled L3-6 (see the scenario file's
 * `runTransposition` and `difficultyOffsetFromNormalVersion`).
 */
export const ROCKY_ASCENT_HIGH: ScenarioDefinition = loadScenario(
  rockyAscentHighJson,
  urlsIn("rocky-ascent-high")
);

/** The same class, descending: every scale fragment falls from b1 toward 1. */
export const ROCKY_DESCENT: ScenarioDefinition = loadScenario(
  rockyDescentJson,
  urlsIn("rocky-descent")
);

/** Rocky Descent's higher-register companion, at L3-6. */
export const ROCKY_DESCENT_HIGH: ScenarioDefinition = loadScenario(
  rockyDescentHighJson,
  urlsIn("rocky-descent-high")
);

/**
 * The one `PerformMinigame` scenario: a goat frontman working a crowd of goats
 * that grows with every flourish it lands. Authored in pentatonic degrees —
 * see `scripts/author-goat-frontman.mjs` for the notation.
 */
export const GOAT_FRONTMAN: ScenarioDefinition = loadScenario(
  goatFrontmanJson,
  urlsIn("goat-frontman")
);

export const SCENARIOS: readonly ScenarioDefinition[] = [
  ROCKY_ASCENT,
  ROCKY_ASCENT_HIGH,
  ROCKY_DESCENT,
  ROCKY_DESCENT_HIGH,
  GOAT_FRONTMAN,
];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/** Every scenario that has authored level data for this difficulty. */
export function scenariosForDifficulty(difficulty: number): ScenarioDefinition[] {
  return SCENARIOS.filter((scenario) => scenario.levels.has(difficulty));
}
