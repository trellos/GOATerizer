/**
 * The run key: selection, transposition, and the labels the timeline shows.
 *
 * One key is chosen for a whole run. Every authored scenario prompt is written
 * in {@link ScaleDegreeRef}s and resolved into MIDI here, so the same Rocky
 * Ascent level plays in any of the 24 keys.
 *
 * The pitch space is one octave, root to root: eight lanes (`music/degrees.ts`).
 */

import type { Degree, ScaleDegreeRef } from "./degrees.js";
import { ALL_LANES } from "./degrees.js";
import { FLAT_NAMES, midiToName, mod, SHARP_NAMES, type PitchClassIndex } from "./pitch.js";

export type Mode = "major" | "minor";

export type RunKey = {
  /** 0 = C. */
  tonic: PitchClassIndex;
  mode: Mode;
};

/** Semitones above the tonic for degrees 1..7. */
const SCALE_STEPS: Readonly<Record<Mode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  /** Natural minor. The game's minor scale-degree labels follow it. */
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/**
 * Harmonic degree labels — what the player reads on the lane, e.g. `b3` in a
 * minor key.
 *
 * This `b` is a FLAT. It is not the authored octave-band prefix of the same
 * letter (see `degrees.ts`), and the two never meet: authored tokens are parsed
 * into `ScaleDegreeRef` before anything asks for a label.
 */
const DEGREE_LABELS: Readonly<Record<Mode, readonly string[]>> = {
  major: ["1", "2", "3", "4", "5", "6", "7"],
  minor: ["1", "2", "b3", "4", "5", "b6", "b7"],
};

/**
 * Keys conventionally written with flats. Purely a spelling choice for display;
 * every pitch is a pitch class internally.
 */
const FLAT_MAJOR_TONICS: ReadonlySet<number> = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db
const FLAT_MINOR_TONICS: ReadonlySet<number> = new Set([2, 7, 0, 5, 10]); // Dm Gm Cm Fm Bbm

export function usesFlats(key: RunKey): boolean {
  return key.mode === "major"
    ? FLAT_MAJOR_TONICS.has(key.tonic)
    : FLAT_MINOR_TONICS.has(key.tonic);
}

/** `"G minor"`, `"Bb major"`. */
export function keyDisplayName(key: RunKey): string {
  const names = usesFlats(key) ? FLAT_NAMES : SHARP_NAMES;
  return `${names[key.tonic]} ${key.mode}`;
}

/**
 * The chart-style short name: `"Bb"`, `"Bbm"`, `"F#"`, `"F#m"`.
 *
 * For the one place the key is read at a glance mid-run. Major is unmarked
 * because major is the default a musician assumes; minor gets a lowercase `m`,
 * as it does on any chord chart.
 *
 * Spelled by the same flat/sharp convention as everything else
 * ({@link usesFlats}) rather than forced to sharps. The lanes are already
 * labelled `Bb` in Bb major, and a header reading `A#` over them would be the
 * UI disagreeing with itself about what note the player is looking at.
 */
export function keyShortName(key: RunKey): string {
  const names = usesFlats(key) ? FLAT_NAMES : SHARP_NAMES;
  return `${names[key.tonic]}${key.mode === "minor" ? "m" : ""}`;
}

/** Stable, spelling-independent id for persistence and tests. */
export function keyId(key: RunKey): string {
  return `${SHARP_NAMES[key.tonic]}-${key.mode}`;
}

/**
 * Reads a written key name into a {@link RunKey}, or null if it is not one.
 *
 * Deliberately generous about spelling, because the thing typing it is a human
 * writing a link: `Eb`, `eb`, `D#`, `Eb minor`, `Ebm`, `eb-min`, `EbMajor` all
 * arrive here. Enharmonics are accepted as written and stored as the pitch
 * class they are — ask for `D#` and the readouts will say `Eb`, because the
 * spelling of a key on screen follows {@link usesFlats}, not the request.
 *
 * Mode defaults to major when unwritten, as it does on any chord chart.
 */
export function parseKeyName(text: string): RunKey | null {
  const cleaned = text.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const match = /^([a-g])(b|#|♭|♯)?(.*)$/.exec(cleaned);
  if (!match) return null;

  const [, letter = "", accidental = "", rest = ""] = match;
  const mode = parseMode(rest);
  if (mode === null) return null;

  const base = NATURAL_PITCH_CLASSES[letter];
  if (base === undefined) return null;
  const shift = accidental === "b" || accidental === "♭" ? -1 : accidental === "" ? 0 : 1;
  return { tonic: mod(base + shift, 12) as PitchClassIndex, mode };
}

const NATURAL_PITCH_CLASSES: Readonly<Record<string, number>> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/** The mode suffix of a written key name. `""` is major; anything odd is null. */
function parseMode(suffix: string): Mode | null {
  if (suffix === "" || suffix === "maj" || suffix === "major") return "major";
  if (suffix === "m" || suffix === "min" || suffix === "minor") return "minor";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Register                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The lowest MIDI note the run's tonic may take: A2, the fifth fret of the low
 * E string.
 *
 * PROVISIONAL TUNING. The tonic is placed in the octave starting there, so the
 * one-octave span `tonic .. tonic+12` lands between A2 (45) and G#4 (68)
 * whatever the key, and sits inside Tuninator's default 70–1400Hz analysis
 * range with room at both ends.
 *
 * Why not E2, where the two-octave timeline started: a one-octave span is half
 * as tall, and anchoring it at the open low E pins every key to first position,
 * where only shapes rooted on the low E string are reachable. Starting at A2
 * puts every key's octave inside the stretch of neck where shapes rooted on
 * three different strings all fit, which is what makes the pregame fingering
 * choice ("where on the neck do I want to practise this") a real choice.
 */
export const LOWEST_TONIC_MIDI = 45;

export function tonicMidi(key: RunKey): number {
  return LOWEST_TONIC_MIDI + mod(key.tonic - (LOWEST_TONIC_MIDI % 12), 12);
}

/* -------------------------------------------------------------------------- */
/* Transposition                                                               */
/* -------------------------------------------------------------------------- */

/** Resolves one authored degree into a concrete MIDI note in the run key. */
export function degreeToMidi(ref: ScaleDegreeRef, key: RunKey): number {
  const step = SCALE_STEPS[key.mode][ref.degree - 1];
  if (step === undefined) throw new RangeError(`degree ${ref.degree} out of range`);
  return tonicMidi(key) + 12 * ref.octaveBand + step;
}

/** The 8 lane MIDI notes, low to high — root to root. Index === lane index. */
export function laneMidiNotes(key: RunKey): number[] {
  return ALL_LANES.map((ref) => degreeToMidi(ref, key));
}

/** Every MIDI note diatonic to the key, in any octave. */
export function isDiatonic(midi: number, key: RunKey): boolean {
  const interval = mod(Math.round(midi) - tonicMidi(key), 12);
  return SCALE_STEPS[key.mode].includes(interval);
}

/**
 * The lane a played MIDI note belongs to, or `null` when it is not diatonic or
 * falls outside the one-octave span.
 */
export function laneOfMidi(midi: number, key: RunKey): number | null {
  const notes = laneMidiNotes(key);
  const index = notes.indexOf(Math.round(midi));
  return index === -1 ? null : index;
}

/**
 * Where a played pitch sits on the lane axis as a *continuous* coordinate, so a
 * non-diatonic note can be drawn between the lanes it falls between and a bend
 * can slide.
 *
 * Returns null below the bottom lane or above the top one — those are drawn
 * clamped at the edge with an out-of-range treatment rather than silently
 * dropped.
 */
export function lanePositionOfMidi(midi: number, key: RunKey): number | null {
  const notes = laneMidiNotes(key);
  const lowest = notes[0];
  const highest = notes[notes.length - 1];
  if (lowest === undefined || highest === undefined) return null;
  if (midi < lowest || midi > highest) return null;

  for (let i = 0; i < notes.length - 1; i += 1) {
    const low = notes[i];
    const high = notes[i + 1];
    if (low === undefined || high === undefined) continue;
    if (midi >= low && midi <= high) {
      return high === low ? i : i + (midi - low) / (high - low);
    }
  }
  return notes.length - 1;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

export function degreeLabel(degree: Degree, key: RunKey): string {
  return DEGREE_LABELS[key.mode][degree - 1] ?? String(degree);
}

/** The in-game lane label: scale degree first, absolute note name retained. */
export function laneLabel(lane: number, key: RunKey): { degree: string; note: string } {
  const ref = ALL_LANES[lane];
  if (!ref) throw new RangeError(`lane ${lane} out of range`);
  const midi = degreeToMidi(ref, key);
  return {
    degree: degreeLabel(ref.degree, key),
    note: midiToName(midi, usesFlats(key)).replace(/\d+$/, ""),
  };
}
