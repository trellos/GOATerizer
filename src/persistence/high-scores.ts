/**
 * High scores, one per tempo, in `localStorage`.
 *
 * No accounts, no cloud save, no currencies — the design is explicit that none
 * of that is wanted (GDD §21, §22). The storage key carries a version so a
 * future format change can be migrated or discarded rather than misread.
 */

import { TEMPOS, type TempoId } from "../config/tempos.js";

const STORAGE_KEY = "goaterizer.highScores.v1";

export type HighScores = Record<TempoId, number>;

function empty(): HighScores {
  return Object.fromEntries(TEMPOS.map((tempo) => [tempo.id, 0])) as HighScores;
}

/** Never throws: a private-mode browser or corrupt value reads as no scores. */
export function readHighScores(): HighScores {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty();
    const scores = empty();
    for (const tempo of TEMPOS) {
      const value = (parsed as Record<string, unknown>)[tempo.id];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        scores[tempo.id] = Math.floor(value);
      }
    }
    return scores;
  } catch {
    return empty();
  }
}

/** Returns true when this run set a new record for its tempo. */
export function recordHighScore(tempoId: TempoId, score: number): boolean {
  const scores = readHighScores();
  if (score <= scores[tempoId]) return false;
  scores[tempoId] = Math.floor(score);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // Storage unavailable. The run still counted; it just is not remembered.
    return true;
  }
  return true;
}
