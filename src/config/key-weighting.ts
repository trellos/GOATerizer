/**
 * Weighted random selection of the run key.
 *
 * The GDD (§3.2, §23) says all 24 major/minor keys are available, selection
 * should favour guitar-friendly keys, and unusual keys must keep a nonzero
 * chance — but leaves the actual distribution TBD. This table is that TBD made
 * explicit: **provisional tuning data**, not design.
 *
 * The shape of it: open-position and barre-friendly keys weigh most, keys a
 * guitarist meets often but has to think about weigh middle, and the awkward
 * flat/sharp keys keep a small but real share. Nothing is zero — rolling Db
 * major occasionally is the point.
 *
 * Roughly, with these numbers: ~62% of runs land in the eight most common keys,
 * ~28% in the middle group, ~10% in the awkward ones.
 */

import type { RunKey } from "../music/keys.js";
import type { PitchClassIndex } from "../music/pitch.js";

export type KeyWeight = {
  key: RunKey;
  weight: number;
  /** Why this weight. Kept in the data so a tuner can argue with it. */
  note: string;
};

const k = (tonic: number, mode: "major" | "minor"): RunKey => ({
  tonic: tonic as PitchClassIndex,
  mode,
});

/** Provisional. Sum is not normalised; {@link pickWeightedKey} handles that. */
export const KEY_WEIGHTS: readonly KeyWeight[] = [
  // Open-position home turf.
  { key: k(7, "major"), weight: 10, note: "G major — open chords, low root on E3" },
  { key: k(0, "major"), weight: 9, note: "C major — no accidentals" },
  { key: k(2, "major"), weight: 9, note: "D major — open strings ring" },
  { key: k(9, "major"), weight: 9, note: "A major" },
  { key: k(4, "major"), weight: 8, note: "E major — the guitar's root note" },
  { key: k(9, "minor"), weight: 10, note: "A minor — the first scale everyone learns" },
  { key: k(4, "minor"), weight: 10, note: "E minor — open low E" },
  { key: k(2, "minor"), weight: 8, note: "D minor" },
  { key: k(7, "minor"), weight: 7, note: "G minor" },
  { key: k(11, "minor"), weight: 7, note: "B minor — barre, but common" },

  // Known, slightly more work.
  { key: k(5, "major"), weight: 6, note: "F major — barre chords start here" },
  { key: k(10, "major"), weight: 5, note: "Bb major — horn key, guitarists survive it" },
  { key: k(11, "major"), weight: 4, note: "B major" },
  { key: k(0, "minor"), weight: 4, note: "C minor" },
  { key: k(5, "minor"), weight: 4, note: "F minor" },
  { key: k(6, "minor"), weight: 4, note: "F# minor" },
  { key: k(8, "minor"), weight: 3, note: "G# minor" },
  { key: k(3, "major"), weight: 3, note: "Eb major" },

  // Awkward, and deliberately still possible.
  { key: k(1, "major"), weight: 2, note: "Db major" },
  { key: k(6, "major"), weight: 2, note: "F# major" },
  { key: k(8, "major"), weight: 2, note: "Ab major" },
  { key: k(1, "minor"), weight: 2, note: "C# minor — common in metal, rare elsewhere" },
  { key: k(3, "minor"), weight: 2, note: "Eb minor" },
  { key: k(10, "minor"), weight: 2, note: "Bb minor" },
];

/** Picks one key. `random` is injectable so tests are deterministic. */
export function pickWeightedKey(random: () => number = Math.random): RunKey {
  const total = KEY_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of KEY_WEIGHTS) {
    roll -= entry.weight;
    if (roll < 0) return entry.key;
  }
  const last = KEY_WEIGHTS[KEY_WEIGHTS.length - 1];
  if (!last) throw new Error("KEY_WEIGHTS is empty");
  return last.key;
}
