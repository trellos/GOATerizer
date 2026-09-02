/**
 * Validation primitives for authored scenario JSON.
 *
 * Shared by the host's loader and by the built-in minigames' own parsers,
 * because both have the same contract: **throw, loudly, on anything you cannot
 * map**. Authored data is the authority — nothing here repairs it, infers
 * missing content, or generates an exercise — so a bad edit fails a test rather
 * than transposing a note in a run.
 *
 * A third-party minigame is free to validate however it likes; this is a
 * convenience, not part of the API contract.
 */

export class ScenarioDataError extends Error {
  constructor(where: string, reason: string) {
    super(`Invalid scenario data at ${where}: ${reason}`);
    this.name = "ScenarioDataError";
  }
}

export type Json = Record<string, unknown>;

export function obj(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScenarioDataError(where, "expected an object");
  }
  return value as Json;
}

export function arr(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new ScenarioDataError(where, "expected an array");
  return value;
}

export function str(value: unknown, where: string): string {
  if (typeof value !== "string") throw new ScenarioDataError(where, "expected a string");
  return value;
}

export function num(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ScenarioDataError(where, "expected a finite number");
  }
  return value;
}

export function bool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new ScenarioDataError(where, "expected a boolean");
  return value;
}

export function strings(value: unknown, where: string): string[] {
  return arr(value, where).map((entry, i) => str(entry, `${where}[${i}]`));
}
