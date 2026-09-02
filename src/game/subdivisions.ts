/**
 * Which rhythmic grid an authored phrase actually sits on.
 *
 * The drums use this to tell the player what is coming: a quarter-note pulse is
 * enough to find beat 1, but it says nothing about whether the next four
 * measures are eighths, sixteenths or triplets — and by the time the first
 * sixteenth arrives it is far too late to start counting. Signalling the grid
 * one attempt ahead is what turns "surprise, sixteenths" into "here comes the
 * sixteenth feel, get ready".
 *
 * Read primarily off the note *positions*, not the duration names: a phrase can
 * be written in eighths and still land on the sixteenth grid (a dotted figure),
 * so position is the description that stays true for any phrase anyone writes.
 * The names are consulted only where a position cannot speak — a note long
 * enough to be the whole grid it implies, or a triplet whose other two thirds
 * are rests.
 *
 * Pure, and independent of the drum kit: this describes the music, and
 * `drum-pattern.ts` decides what to hit.
 */

import { DURATION_BEATS, type PromptEvent } from "../scenario/types.js";

/** The grids the backing can mark. Quarters are always marked, so are not here. */
export type Subdivision = "eighth" | "sixteenth" | "triplet";

export type SubdivisionSet = ReadonlySet<Subdivision>;

export const NO_SUBDIVISIONS: SubdivisionSet = new Set<Subdivision>();

/**
 * How far off a grid position a note may sit and still count as on it.
 *
 * Authored beats are exact rationals, so this only has to absorb binary
 * floating-point error, not human timing — a played note never reaches here.
 */
const EPSILON = 1e-6;

/** True when `value` is within {@link EPSILON} of any of `positions`. */
function isNear(value: number, positions: readonly number[]): boolean {
  return positions.some((position) => Math.abs(value - position) < EPSILON);
}

const EIGHTH_OFFSETS = [0.5];
const SIXTEENTH_OFFSETS = [0.25, 0.75];
const TRIPLET_OFFSETS = [1 / 3, 2 / 3];

/**
 * The grids a phrase occupies.
 *
 * Sixteenths imply eighths: a sixteenth run passes through every `and` on its
 * way, so marking the eighths under it is the same grid, stated more coarsely.
 * Nothing implies triplets — a triplet grid does not divide a binary one, which
 * is exactly why it needs its own signal.
 */
export function subdivisionsOf(prompt: readonly PromptEvent[]): SubdivisionSet {
  const found = new Set<Subdivision>();

  for (const event of prompt) {
    if (event.type !== "note") continue;

    // A note's own length puts the grid on the map even when it happens to
    // start on a beat: four sixteenths from beat 1 are still sixteenths, and a
    // lone triplet eighth on the beat is still the triplet feel — its
    // neighbours at 1/3 and 2/3 may both be rests, leaving no position to read.
    if (event.durationBeats <= DURATION_BEATS.sixteenth + EPSILON) found.add("sixteenth");
    if (event.duration === "eighthTriplet") found.add("triplet");

    const offset = event.startBeat - Math.floor(event.startBeat);
    if (isNear(offset, SIXTEENTH_OFFSETS)) found.add("sixteenth");
    else if (isNear(offset, TRIPLET_OFFSETS)) found.add("triplet");
    else if (isNear(offset, EIGHTH_OFFSETS)) found.add("eighth");
  }

  if (found.has("sixteenth")) found.add("eighth");
  return found;
}

/** The grids of several phrases at once — what the drums should be marking. */
export function unionSubdivisions(...sets: readonly SubdivisionSet[]): SubdivisionSet {
  const union = new Set<Subdivision>();
  for (const set of sets) for (const entry of set) union.add(entry);
  return union;
}

/** Stable id for a set, so a caller can tell "changed" from "same" cheaply. */
export function subdivisionKey(set: SubdivisionSet): string {
  return (["eighth", "sixteenth", "triplet"] as const).filter((entry) => set.has(entry)).join("+");
}
