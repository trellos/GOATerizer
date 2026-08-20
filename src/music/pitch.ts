/**
 * MIDI / frequency / note-name maths.
 *
 * Tuninator exports no such helper — it reports `midi`, `name` and
 * `frequencyHz` on its own detections, and this module is what the game uses to
 * go the other way (target degree -> MIDI -> name) and to render a played
 * frequency onto a pitch axis.
 */

/** Sharp-spelled, matching Tuninator's `PitchClass` ordering (C = 0). */
export const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** Flat spellings, for keys that are conventionally written with flats. */
export const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export type PitchClassIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** Positive modulo. `-1 % 12` is `-1` in JS, which is never what we want here. */
export function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

export function pitchClassOf(midi: number): PitchClassIndex {
  return mod(Math.round(midi), 12) as PitchClassIndex;
}

export function octaveOf(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

/** Scientific pitch notation, e.g. `"A4"`. `useFlats` picks the spelling. */
export function midiToName(midi: number, useFlats = false): string {
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[pitchClassOf(midi)]}${octaveOf(midi)}`;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Fractional MIDI, so a bent or out-of-tune pitch keeps its cents. */
export function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
