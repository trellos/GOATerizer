/**
 * The minigame library.
 *
 * A {@link MinigameId} is an open string, resolved here rather than being a
 * union the engine knows at compile time. That is the whole difference between
 * "the game supports six minigames" and "the game can be given a minigame":
 * nothing outside a minigame's own module needs to name it, and adding one is a
 * registration rather than an edit to the loader, the runtime and the renderer.
 *
 * Registration happens at the composition root — `scenario/registry.ts`, which
 * is already the module that knows which content this build ships — so this
 * file never imports a minigame and the dependency runs one way.
 */

import { MINIGAME_API_VERSION, type MinigameId, type MinigameModule } from "./api.js";

const modules = new Map<MinigameId, MinigameModule>();

/**
 * Adds a minigame to the library.
 *
 * Refuses a module built against a different API revision rather than letting
 * it fail later inside a render call, and refuses a duplicate id rather than
 * silently letting one package shadow another.
 */
export function registerMinigame(module: MinigameModule): void {
  if (module.apiVersion !== MINIGAME_API_VERSION) {
    throw new Error(
      `minigame "${module.id}" targets API v${module.apiVersion}, ` +
        `this host is v${MINIGAME_API_VERSION}`
    );
  }
  const existing = modules.get(module.id);
  if (existing && existing !== module) {
    throw new Error(`minigame "${module.id}" is already registered`);
  }
  modules.set(module.id, module);
}

export function minigameById(id: MinigameId): MinigameModule | undefined {
  return modules.get(id);
}

/**
 * Resolves an id or throws with the ids that *are* available.
 *
 * A scenario naming a minigame nobody registered is a content error worth
 * failing on: the alternative is playing it as whatever happens to be first,
 * which is exactly what this design exists to prevent.
 */
export function requireMinigame(id: MinigameId, where: string): MinigameModule {
  const module = modules.get(id);
  if (!module) {
    const known = [...modules.keys()].sort().join(", ") || "none";
    throw new Error(`${where}: no minigame registered for "${id}" (registered: ${known})`);
  }
  return module;
}

export function registeredMinigameIds(): readonly MinigameId[] {
  return [...modules.keys()].sort();
}
