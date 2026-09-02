/**
 * Suggested one-octave guitar fingerings for the run key.
 *
 * A fingering is a **visual convenience**, never an input requirement.
 * Tuninator judges the pitch that was produced; a player who reaches the right
 * note somewhere else on the neck is right. What the fingering decides is:
 *
 *   - the physical reference shown over the pitch lanes in pregame, and
 *   - the five-fret diagram the player picks from, which is how they choose
 *     *where on the neck* to practise this run.
 *
 * It no longer places anything on the timeline: the vertical axis is harmonic
 * role, not neck position.
 *
 * Every shape offered fits inside a five-fret window, so the fretting hand
 * stays in one position for the whole exercise. A shape that would make the
 * hand travel is not a shape worth suggesting for an eight-note scale.
 */

import { laneMidiNotes, type RunKey } from "./keys.js";

/** Standard tuning, low to high. Index 0 is the low E string. */
export const OPEN_STRING_MIDI: readonly number[] = [40, 45, 50, 55, 59, 64];

/** Row labels, low to high. `e` is the high E, as tablature always writes it. */
export const STRING_NAMES: readonly string[] = ["E", "A", "D", "G", "B", "e"];

/** How many frets a suggested shape — and its diagram — may span. */
export const DIAGRAM_FRETS = 5;

/** No shape is suggested above this fret; past it the neck stops being useful. */
const MAX_FRET = 15;

export type FretPosition = {
  /** 0 = low E. */
  stringIndex: number;
  fret: number;
};

export type Fingering = {
  id: string;
  label: string;
  /** One position per pitch lane, low to high. Always {@link LANE_COUNT} entries. */
  positions: readonly FretPosition[];
  lowestFret: number;
  highestFret: number;
  /** Which string carries the low root. Index 0 = low E. */
  rootString: number;
  /**
   * Leftmost fret of the five-fret diagram window. Never negative, so an
   * open-position shape still shows the nut rather than a phantom fret 0.
   */
  windowStartFret: number;
};

/** `E3` — low-E string, third fret. GDD §13.3 notation. */
export function formatFretPosition(position: FretPosition): string {
  return `${STRING_NAMES[position.stringIndex] ?? "?"}${position.fret}`;
}

/**
 * Notes-per-string patterns, in the order the shapes are offered.
 *
 * One diatonic octave is eight notes, which splits across three adjacent
 * strings two ways. Both are shapes guitarists actually use:
 *
 *   - `3 3 2` puts the root under the first finger and reaches upward; it is
 *     the scale most people learn first.
 *   - `2 3 3` starts the same root and reaches *back* a fret, which is the
 *     compact box that keeps a major scale inside four frets.
 *
 * Which of the two is tighter depends on the mode, so both are offered and the
 * five-fret filter below decides what is actually playable.
 */
const SHAPES: readonly { id: string; label: string; perString: readonly number[] }[] = [
  { id: "3-3-2", label: "reaching up", perString: [3, 3, 2] },
  { id: "2-3-3", label: "compact box", perString: [2, 3, 3] },
];

/**
 * Strings a shape may be rooted on.
 *
 * Not the B or high e: an octave rooted there runs off the top of the neck.
 */
const ROOT_STRINGS: readonly number[] = [0, 1, 2, 3];

function buildShape(
  laneNotes: readonly number[],
  startString: number,
  perString: readonly number[]
): FretPosition[] | null {
  const positions: FretPosition[] = [];
  let note = 0;

  for (let s = 0; s < perString.length; s += 1) {
    const stringIndex = startString + s;
    const open = OPEN_STRING_MIDI[stringIndex];
    if (open === undefined) return null;

    for (let n = 0; n < (perString[s] ?? 0); n += 1) {
      const midi = laneNotes[note];
      if (midi === undefined) return null;
      const fret = midi - open;
      // A negative fret is off the end of the neck; a very high one is not a
      // shape anyone would suggest. Either way the shape is simply not offered.
      if (fret < 0 || fret > MAX_FRET) return null;
      positions.push({ stringIndex, fret });
      note += 1;
    }
  }

  return note === laneNotes.length ? positions : null;
}

/**
 * Every shape that physically fits this key, low position first.
 *
 * "Fits" means: on the neck, and inside one five-fret window. Sorting by
 * position is what turns the list into a neck map — the first chip is the
 * lowest place to play this octave, the last is the highest.
 */
export function fingeringsForKey(key: RunKey): Fingering[] {
  const laneNotes = laneMidiNotes(key);
  const fingerings: Fingering[] = [];

  for (const rootString of ROOT_STRINGS) {
    for (const shape of SHAPES) {
      const positions = buildShape(laneNotes, rootString, shape.perString);
      if (!positions) continue;

      const frets = positions.map((position) => position.fret);
      const lowestFret = Math.min(...frets);
      const highestFret = Math.max(...frets);
      // The hand must not have to travel: an eight-note scale that spans more
      // than one position is exactly the thing this rework exists to remove.
      if (highestFret - lowestFret > DIAGRAM_FRETS - 1) continue;

      fingerings.push({
        id: `${STRING_NAMES[rootString]}-${shape.id}`,
        label: `Root on the ${STRING_NAMES[rootString]} string, ${shape.label} — frets ${lowestFret}–${highestFret}`,
        positions,
        lowestFret,
        highestFret,
        rootString,
        windowStartFret: Math.max(0, Math.min(lowestFret, MAX_FRET - (DIAGRAM_FRETS - 1))),
      });
    }
  }

  if (fingerings.length === 0) {
    // Every key fits at least one shape today; if a future tuning or register
    // change breaks that, fail visibly rather than offering an empty picker.
    throw new Error("no playable one-octave fingering for this key");
  }

  fingerings.sort((a, b) => a.lowestFret - b.lowestFret || a.rootString - b.rootString);
  return fingerings;
}
