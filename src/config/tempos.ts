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
