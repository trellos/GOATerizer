/**
 * Suggested two-octave guitar fingerings for the run key.
 *
 * A fingering is a **visual convenience**, never an input requirement.
 * Tuninator judges the pitch that was produced; a player who reaches the right
 * note somewhere else on the neck is right. What the fingering decides is:
 *
 *   - the physical reference shown over the pitch lanes in pregame, and
 *   - which string and fret a target is drawn on in Tablature View.
 */

import { laneMidiNotes, type RunKey } from "./keys.js";

/** Standard tuning, low to high. Index 0 is the low E string. */
export const OPEN_STRING_MIDI: readonly number[] = [40, 45, 50, 55, 59, 64];

/** Row labels, low to high. `e` is the high E, as tablature always writes it. */
export const STRING_NAMES: readonly string[] = ["E", "A", "D", "G", "B", "e"];

export type FretPosition = {
  /** 0 = low E. */
  stringIndex: number;
  fret: number;
};

export type Fingering = {
  id: string;
  label: string;
  /** One position per pitch lane, low to high. Always 15 entries. */
  positions: readonly FretPosition[];
  lowestFret: number;
  highestFret: number;
};

/** `E3` — low-E string, third fret. GDD §13.3 notation. */
export function formatFretPosition(position: FretPosition): string {
  return `${STRING_NAMES[position.stringIndex] ?? "?"}${position.fret}`;
}

/**
 * Notes-per-string patterns, in the order the shapes are offered.
 *
 * The first two are ordinary three-notes-per-string shapes over five strings —
 * fifteen notes divides exactly, which is why a two-octave diatonic scale is
 * the shape guitarists actually learn first. The third is a compact box across
 * all six strings for players who would rather stay in position.
 */
const SHAPES: readonly { id: string; label: string; startString: number; perString: number[] }[] = [
  {
    id: "e-string-3nps",
    label: "Low E root, three per string",
    startString: 0,
    perString: [3, 3, 3, 3, 3],
  },
  {
    id: "a-string-3nps",
    label: "A string root, three per string",
    startString: 1,
    perString: [3, 3, 3, 3, 3],
  },
  {
    id: "six-string-box",
    label: "Position box, all six strings",
    startString: 0,
    perString: [2, 3, 3, 2, 3, 2],
  },
];

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
      if (fret < 0 || fret > 17) return null;
      positions.push({ stringIndex, fret });
      note += 1;
    }
  }

  return note === laneNotes.length ? positions : null;
}

/** Every shape that physically fits this key. Never empty in practice. */
export function fingeringsForKey(key: RunKey): Fingering[] {
  const laneNotes = laneMidiNotes(key);
  const fingerings: Fingering[] = [];

  for (const shape of SHAPES) {
    const positions = buildShape(laneNotes, shape.startString, shape.perString);
    if (!positions) continue;
    const frets = positions.map((position) => position.fret);
    const lowestFret = Math.min(...frets);
    fingerings.push({
      id: shape.id,
      label: `${shape.label} — fret ${lowestFret}`,
      positions,
      lowestFret,
      highestFret: Math.max(...frets),
    });
  }

  if (fingerings.length === 0) {
    // Every key fits at least one shape today; if a future tuning change breaks
    // that, fail visibly rather than rendering an empty tablature.
    throw new Error("no playable two-octave fingering for this key");
  }
  return fingerings;
}
