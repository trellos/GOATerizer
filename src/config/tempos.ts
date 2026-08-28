/**
 * The five tempo choices. Fixed for the whole run once chosen (GDD §3.4).
 *
 * Tempo is a global difficulty multiplier but does not change a scenario's
 * difficulty level: a Level 4 exercise at 60bpm and the same exercise at 140bpm
 * are the same authored content. High scores are therefore tracked per tempo.
 */

export type TempoId = "baby-lamb" | "billy-goat" | "cashmere" | "ibex" | "markhor-goat";

export type Tempo = {
  id: TempoId;
  name: string;
  bpm: number;
};

export const TEMPOS: readonly Tempo[] = [
  { id: "baby-lamb", name: "Baby Lamb", bpm: 60 },
  { id: "billy-goat", name: "Billy Goat", bpm: 90 },
  { id: "cashmere", name: "Cashmere", bpm: 106 },
  { id: "ibex", name: "Ibex", bpm: 120 },
  { id: "markhor-goat", name: "Markhor GOAT", bpm: 140 },
];

/**
 * Billy Goat, 90bpm. Slow enough to read the timeline and find the note, fast
 * enough that the backing feels like music rather than a metronome.
 */
export const DEFAULT_TEMPO_ID: TempoId = "billy-goat";

export function tempoById(id: TempoId): Tempo {
  const tempo = TEMPOS.find((entry) => entry.id === id);
  if (!tempo) throw new Error(`unknown tempo ${id}`);
  return tempo;
}

/**
 * Reads a written tempo request into one of the five choices, or null.
 *
 * Accepts the id (`ibex`), the display name (`Markhor GOAT`, `markhor-goat`),
 * or a bpm number. A number that is not one of the five snaps to the nearest
 * choice rather than being rejected or honoured literally: the five tempos are
 * design (§3.4) and high scores are tracked per tempo, so `?tempo=100` means
 * "about there", not "invent a sixth tempo".
 */
export function parseTempo(text: string): TempoId | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  // Numbers first, and from the untouched text: the separator-stripping below
  // would turn `-90` into a perfectly good 90.
  if (/^[0-9.]+$/.test(trimmed)) {
    const bpm = Number(trimmed);
    return Number.isFinite(bpm) && bpm > 0 ? nearestTempo(bpm).id : null;
  }

  const cleaned = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  const named = TEMPOS.find(
    (tempo) =>
      tempo.id.replace(/-/g, "") === cleaned ||
      tempo.name.toLowerCase().replace(/\s+/g, "") === cleaned
  );
  return named?.id ?? null;
}

/** The tempo choice closest to `bpm`. Ties go to the slower one. */
export function nearestTempo(bpm: number): Tempo {
  let best = TEMPOS[0] as Tempo;
  for (const tempo of TEMPOS) {
    if (Math.abs(tempo.bpm - bpm) < Math.abs(best.bpm - bpm)) best = tempo;
  }
  return best;
}
