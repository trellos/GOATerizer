/**
 * The scenario library.
 *
 * **Nothing is registered by hand.** Every `*.scenario.json` in
 * `docs/scenarios/` is the library, discovered at build time by
 * `import.meta.glob`, so adding a scenario of a class that already exists means:
 * author a JSON file, drop its art in `public/assets/scenarios/<dir>/`, and
 * that is all. No code changes — which is the property the run shell and the
 * minigame classes exist to preserve, and the property the minigame editor
 * (`src/editor/`) needs in order to create a scenario at all.
 *
 * Which asset ids a scenario needs is likewise nobody's list: the minigame
 * answers it (`MinigameModule.assetIds`) and `load.ts` asks, so this module only
 * says where an id lives on disk. The four hand-maintained id lists this file
 * used to carry were exactly a restatement of those answers, and a restatement
 * is a thing that can disagree.
 */

import { registerMinigame } from "../minigame/registry.js";
import { CLIMB_MINIGAME } from "./minigames/climb-minigame.js";
import { PERFORM_MINIGAME } from "./minigames/perform-minigame.js";
import { REPEAT_MINIGAME } from "./minigames/repeat-module.js";
import { THREE_STEP_MINIGAME } from "./minigames/three-step-minigame.js";
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
 * The authored files, keyed by path. Eager, because the run shell needs the
 * whole library synchronously to fill its 16 slots before play starts.
 *
 * Sorted by path below, so the library's order is the directory's order rather
 * than a bundler's traversal.
 */
const SCENARIO_MODULES = import.meta.glob("../../docs/scenarios/*.scenario.json", {
  eager: true,
  import: "default",
}) as Readonly<Record<string, unknown>>;

/** One authored file, as it sits on disk. What the editor reads and writes. */
export type ScenarioSource = {
  /** Repository-relative path, e.g. `docs/scenarios/rocky_ascent.scenario.json`. */
  readonly path: string;
  readonly id: string;
  /** The parsed JSON, unvalidated. */
  readonly raw: unknown;
};

/**
 * Where a scenario's art lives under `public/assets/scenarios/`.
 *
 * Derived from the id rather than declared, because every scenario in the
 * repository already follows the convention (`rocky_ascent` ->
 * `rocky-ascent/`). A scenario may still say so explicitly with
 * `assetDirectory`, which is what lets a new scenario authored in the editor
 * borrow the art of the one it was cloned from instead of shipping with none.
 */
export function assetDirectoryOf(raw: unknown): string {
  const root = raw as Record<string, unknown>;
  const declared = root["assetDirectory"];
  if (typeof declared === "string" && declared !== "") return declared;
  const id = root["id"];
  if (typeof id !== "string" || id === "") throw new Error("scenario has no id");
  return id.replace(/_/g, "-");
}

/**
 * Whose art a scenario uses, for the ids a family derives by convention.
 *
 * The companion to {@link assetDirectoryOf}: one says where the art lives, this
 * says what it is called. Both default to the scenario's own id and are only
 * ever set on a scenario the editor cloned from another.
 */
export function assetScenarioIdOf(raw: unknown): string {
  const root = raw as Record<string, unknown>;
  const declared = root["assetScenarioId"];
  if (typeof declared === "string" && declared !== "") return declared;
  const id = root["id"];
  if (typeof id !== "string" || id === "") throw new Error("scenario has no id");
  return id;
}

/** Placeholder art lives in the project's own asset tree, never hotlinked. */
export function assetUrlResolver(raw: unknown): (assetId: string) => string {
  const directory = assetDirectoryOf(raw);
  return (assetId) => `${BASE_URL}assets/scenarios/${directory}/${assetId}.png`;
}

export const SCENARIO_SOURCES: readonly ScenarioSource[] = Object.entries(SCENARIO_MODULES)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([path, raw]) => {
    const id = (raw as Record<string, unknown>)["id"];
    if (typeof id !== "string" || id === "") {
      throw new Error(`${path} has no scenario id`);
    }
    return { path: path.replace(/^(\.\.\/)+/, ""), id, raw };
  });

/*
 * Mutable, and deliberately so: the minigame editor installs the scenario it is
 * editing over the shipped one so Preview plays the unsaved edit
 * (`installAuthoredScenario`). Everything else treats it as read-only, which is
 * what the exported type says.
 */
const LIBRARY: ScenarioDefinition[] = SCENARIO_SOURCES.map((source) =>
  loadScenario(source.raw, assetUrlResolver(source.raw))
);

export const SCENARIOS: readonly ScenarioDefinition[] = LIBRARY;

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return LIBRARY.find((scenario) => scenario.id === id);
}

function requireScenario(id: string): ScenarioDefinition {
  const scenario = scenarioById(id);
  if (!scenario) {
    throw new Error(
      `docs/scenarios/ has no scenario ${id} (found: ${LIBRARY.map((s) => s.id).join(", ")})`
    );
  }
  return scenario;
}

/**
 * Replaces (or adds) one scenario in the live library.
 *
 * **Authoring-time only.** The editor holds an edited scenario that is not on
 * disk yet, and Preview has to play *that* one — the run shell picks scenarios
 * through `scenariosForDifficulty`, so the only way to hand it an edit is to put
 * the edit in the library. Returns the definition that was installed.
 */
export function installAuthoredScenario(definition: ScenarioDefinition): ScenarioDefinition {
  const at = LIBRARY.findIndex((scenario) => scenario.id === definition.id);
  if (at === -1) LIBRARY.push(definition);
  else LIBRARY[at] = definition;
  return definition;
}

/** Drops a scenario from the live library. Authoring-time only, like the above. */
export function uninstallAuthoredScenario(id: string): void {
  const at = LIBRARY.findIndex((scenario) => scenario.id === id);
  if (at !== -1) LIBRARY.splice(at, 1);
}

/** Every scenario that has authored level data for this difficulty. */
export function scenariosForDifficulty(difficulty: number): ScenarioDefinition[] {
  return LIBRARY.filter((scenario) => scenario.levels.has(difficulty));
}

/*
 * Named handles for the scenarios this build ships.
 *
 * Tests and the timeline-actor prototypes reach for specific scenarios by name;
 * these are lookups rather than the definitions themselves, so the library stays
 * the directory and these stay convenience.
 */
export const ROCKY_ASCENT: ScenarioDefinition = requireScenario("rocky_ascent");
/**
 * A higher-register companion to Rocky Ascent: same route/rhythm shapes as
 * L1-4, transposed up one octave and relabelled L3-6 (see the scenario file's
 * `runTransposition` and `difficultyOffsetFromNormalVersion`).
 */
export const ROCKY_ASCENT_HIGH: ScenarioDefinition = requireScenario("rocky_ascent_high");
/** The same class, descending: every scale fragment falls from b1 toward 1. */
export const ROCKY_DESCENT: ScenarioDefinition = requireScenario("rocky_descent");
/** Rocky Descent's higher-register companion, at L3-6. */
export const ROCKY_DESCENT_HIGH: ScenarioDefinition = requireScenario("rocky_descent_high");
/**
 * The one `RepeatMinigame` scenario: a performer who stands still while the
 * player places cans at him. PROTOTYPE — see
 * `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 */
export const CAN_CRUSHING: ScenarioDefinition = requireScenario("can_crushing");
/**
 * The one `PerformMinigame` scenario: a goat frontman working a crowd of goats
 * that grows with every flourish it lands. Authored in pentatonic degrees —
 * see `scripts/author-goat-frontman.mjs` for the notation.
 */
export const GOAT_FRONTMAN: ScenarioDefinition = requireScenario("goat_frontman");
/**
 * The one `ThreeStepMinigame` scenario: two horn taps and a headbutt, delivered
 * to a wolf by moonlight. The first authored triplet content in the game, and so
 * the first thing that selects the drum kit's triplet rhythm variant.
 */
export const BUTT_BUTT_BONK: ScenarioDefinition = requireScenario("butt_butt_bonk");
