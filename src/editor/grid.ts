/**
 * The note editor's musical model: notes on an integer tick grid.
 *
 * Everything the editor knows about *when* a note is lives here, and it is pure
 * — no DOM, no canvas, no audio — so the awkward parts (where a triplet may
 * start, what rests fill a gap, what a one-measure loop saves as) are testable
 * without a browser.
 *
 * **Ticks, not beats.** Twelve to the beat, exactly as `scenario/load.ts` reads
 * authored data: the smallest number divisible by both the binary subdivisions
 * (a sixteenth is 3) and the triplet one (an eighth triplet is 4). A beat of
 * triplets is 4 + 4 + 4 and lands on the next beat; three floats of 0.333 do
 * not. The editor never holds a fractional position.
 *
 * **The phrase is always four measures.** A scenario authors a four-measure
 * phrase and the game plays it `ATTEMPT_REPEATS` times (`AGENTS.md` §9), so the
 * editor's loop handle does not shorten the phrase — it says how much of it the
 * author is editing, and the loop is *tiled* across the four measures on the way
 * out ({@link tileToPhrase}). A one-measure loop is a scenario that repeats its
 * bar four times, which is what the shaded area on the timeline is showing.
 */

import { BEATS_PER_MEASURE, PHRASE_MEASURES } from "../config/tuning.js";
import type { NoteDuration } from "../minigame/api.js";

/** Ticks per beat. See the header: 12 is the binary/triplet common grid. */
export const TICKS_PER_BEAT = 12;
export const TICKS_PER_MEASURE = TICKS_PER_BEAT * BEATS_PER_MEASURE;
/** The whole authored phrase, in ticks. Four measures, always. */
export const PHRASE_TICKS = TICKS_PER_MEASURE * PHRASE_MEASURES;

/** Written length in ticks. The same table `scenario/types.ts` states in beats. */
export const DURATION_TICKS: Readonly<Record<NoteDuration, number>> = {
  whole: 48,
  half: 24,
  quarter: 12,
  eighth: 6,
  eighthTriplet: 4,
  sixteenth: 3,
};

/**
 * The durations the palette offers and the resize ladder walks, shortest first.
 *
 * Ordered by length rather than by family, so dragging a note's right edge runs
 * smoothly from a sixteenth up to a whole note and the triplet sits where its
 * length actually puts it — between a sixteenth and an eighth.
 */
export const EDITABLE_DURATIONS: readonly NoteDuration[] = [
  "sixteenth",
  "eighthTriplet",
  "eighth",
  "quarter",
  "half",
  "whole",
];

/** Short label for a duration, for the palette and the status line. */
export const DURATION_LABELS: Readonly<Record<NoteDuration, string>> = {
  whole: "whole",
  half: "half",
  quarter: "quarter",
  eighth: "eighth",
  eighthTriplet: "triplet",
  sixteenth: "16th",
};

/**
 * The grid a duration may start on, in ticks.
 *
 * Binary durations start on sixteenth boundaries (every 3 ticks); a triplet
 * starts on a triplet boundary (every 4 — on the beat, or a third or two thirds
 * through it). A note is never moved to make a duration fit: a start that is not
 * on a duration's grid simply cannot take that duration.
 */
export function startGridOf(duration: NoteDuration): number {
  return duration === "eighthTriplet" ? 4 : 3;
}

/** One note as the editor holds it. Position and pitch are both integers. */
export type EditorNote = {
  /** Unique within an editing session. Stable across moves, so selection survives. */
  readonly id: number;
  readonly startTick: number;
  /** 0 at the bottom of the timeline. Meaning comes from the lane vocabulary. */
  readonly lane: number;
  readonly duration: NoteDuration;
};

export function endTick(note: EditorNote): number {
  return note.startTick + DURATION_TICKS[note.duration];
}

/** Snaps a tick to the nearest valid start for `duration`, clamped to the phrase. */
export function snapStart(tick: number, duration: NoteDuration): number {
  const grid = startGridOf(duration);
  const snapped = Math.round(tick / grid) * grid;
  const last = PHRASE_TICKS - DURATION_TICKS[duration];
  return Math.min(Math.max(snapped, 0), Math.max(0, Math.floor(last / grid) * grid));
}

/** Whether a note sits on its duration's grid and inside the phrase. */
export function isPlaceable(note: EditorNote): boolean {
  return (
    note.startTick >= 0 &&
    note.startTick % startGridOf(note.duration) === 0 &&
    endTick(note) <= PHRASE_TICKS
  );
}

/* -------------------------------------------------------------------------- */
/* Overlap                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Two notes overlap when they share any tick, *whatever lane they are on*.
 *
 * The authored prompt is a sequence, not a score: `scenario/load.ts` reads one
 * event after another and derives each position from the durations before it,
 * so two notes sounding at once cannot be written down at all. One guitar, one
 * note at a time.
 */
export function overlap(a: EditorNote, b: EditorNote): boolean {
  return a.startTick < endTick(b) && b.startTick < endTick(a);
}

/**
 * Adds notes to a set, resolving every overlap in favour of the longer note.
 *
 * "If a pasted note overlaps with an existing note then the superset of both
 * notes should remain" — a sixteenth pasted over a quarter leaves the quarter.
 * Ties go to the incoming note, so dropping a note exactly onto one of the same
 * length replaces it rather than silently doing nothing.
 */
export function mergeNotes(
  existing: readonly EditorNote[],
  incoming: readonly EditorNote[]
): EditorNote[] {
  const kept = [...existing];
  for (const note of incoming) {
    const losers: EditorNote[] = [];
    let beaten = false;
    for (const other of kept) {
      if (other.id === note.id || !overlap(note, other)) continue;
      if (DURATION_TICKS[other.duration] > DURATION_TICKS[note.duration]) beaten = true;
      else losers.push(other);
    }
    if (beaten) continue;
    for (const loser of losers) kept.splice(kept.indexOf(loser), 1);
    const at = kept.findIndex((entry) => entry.id === note.id);
    if (at === -1) kept.push(note);
    else kept[at] = note;
  }
  return sortNotes(kept);
}

export function sortNotes(notes: readonly EditorNote[]): EditorNote[] {
  return [...notes].sort((a, b) => a.startTick - b.startTick || a.lane - b.lane);
}

/* -------------------------------------------------------------------------- */
/* The loop                                                                    */
/* -------------------------------------------------------------------------- */

/** Measures the loop handle can stop on. One bar, two bars, or the phrase. */
export const LOOP_MEASURE_STOPS: readonly number[] = [1, 2, PHRASE_MEASURES];

/** Snaps a tick position to the nearest loop stop, as a measure count. */
export function snapLoopMeasures(tick: number): number {
  const measures = tick / TICKS_PER_MEASURE;
  let best = LOOP_MEASURE_STOPS[LOOP_MEASURE_STOPS.length - 1] as number;
  for (const stop of LOOP_MEASURE_STOPS) {
    if (Math.abs(stop - measures) < Math.abs(best - measures)) best = stop;
  }
  return best;
}

/**
 * Repeats the loop across the four-measure phrase.
 *
 * The saved scenario always spans four measures, so a one-measure loop is
 * written out four times. Notes outside the loop are the ones the editor
 * remembers and never saves — a shrunk loop keeps them so re-expanding it brings
 * them back, and they play no part here.
 */
export function tileToPhrase(
  notes: readonly EditorNote[],
  loopMeasures: number
): EditorNote[] {
  const loopTicks = loopMeasures * TICKS_PER_MEASURE;
  const live = notes.filter((note) => note.startTick < loopTicks);
  if (loopTicks >= PHRASE_TICKS) return sortNotes(live);

  const tiled: EditorNote[] = [];
  let nextId = 1 + live.reduce((max, note) => Math.max(max, note.id), 0);
  for (let offset = 0; offset < PHRASE_TICKS; offset += loopTicks) {
    for (const note of live) {
      // A note that would run past the end of its own repetition is dropped
      // rather than truncated: a duration is a written length, not a clip.
      if (endTick(note) > loopTicks) continue;
      tiled.push(
        offset === 0
          ? note
          : { id: nextId++, startTick: note.startTick + offset, lane: note.lane, duration: note.duration }
      );
    }
  }
  return sortNotes(tiled);
}

/** Notes the loop cannot save, because they run past its end. */
export function notesOverrunningLoop(
  notes: readonly EditorNote[],
  loopMeasures: number
): EditorNote[] {
  const loopTicks = loopMeasures * TICKS_PER_MEASURE;
  if (loopTicks >= PHRASE_TICKS) return [];
  return notes.filter((note) => note.startTick < loopTicks && endTick(note) > loopTicks);
}

/**
 * The smallest loop the notes are already a repetition of.
 *
 * Reading a scenario back gives no record of how it was authored — a bar
 * repeated four times and four identical bars are the same file — so the handle
 * comes back where it would have to have been to produce this phrase.
 */
export function inferLoopMeasures(notes: readonly EditorNote[]): number {
  for (const stop of LOOP_MEASURE_STOPS) {
    if (stop >= PHRASE_MEASURES) break;
    const candidate = tileToPhrase(notes, stop);
    if (sameShape(candidate, notes)) return stop;
  }
  return PHRASE_MEASURES;
}

function sameShape(a: readonly EditorNote[], b: readonly EditorNote[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = sortNotes(a);
  const sortedB = sortNotes(b);
  return sortedA.every((note, i) => {
    const other = sortedB[i] as EditorNote;
    return (
      note.startTick === other.startTick &&
      note.lane === other.lane &&
      note.duration === other.duration
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Rests                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How the silence between two notes is written down.
 *
 * The authored prompt has no gaps: every tick of the phrase belongs to a note or
 * to a rest, and rests carry the same six written durations notes do. So a gap
 * has to be spelled, and not every spelling is legible — a rest that straddles a
 * beat line reads as the wrong rhythm even when it adds up.
 *
 * The rules, in order of who they serve:
 *
 *   - a rest shorter than a beat stays inside one beat;
 *   - a rest of a beat or more starts on a beat;
 *   - among the spellings that survive that, the shortest list wins.
 *
 * Returns null when the gap cannot be written at all. That is not hypothetical:
 * a sixteenth ending at tick 6 followed by a triplet starting at tick 8 leaves
 * two ticks, and no rest is two ticks long. The editor reports it rather than
 * rounding somebody's rhythm.
 */
export function spellRest(fromTick: number, toTick: number): NoteDuration[] | null {
  const span = toTick - fromTick;
  if (span <= 0) return [];

  // Shortest-first breadth-first over positions: the first time a position is
  // reached is via a minimal number of rests.
  const best = new Map<number, NoteDuration[]>([[fromTick, []]]);
  let frontier = [fromTick];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const at of frontier) {
      const soFar = best.get(at) as NoteDuration[];
      for (const duration of EDITABLE_DURATIONS) {
        const ticks = DURATION_TICKS[duration];
        const to = at + ticks;
        if (to > toTick || best.has(to)) continue;
        if (!restFits(at, ticks)) continue;
        const spelling = [...soFar, duration];
        if (to === toTick) return spelling;
        best.set(to, spelling);
        next.push(to);
      }
    }
    frontier = next;
  }
  return null;
}

function restFits(at: number, ticks: number): boolean {
  if (ticks >= TICKS_PER_BEAT) return at % TICKS_PER_BEAT === 0;
  return Math.floor(at / TICKS_PER_BEAT) === Math.floor((at + ticks - 1) / TICKS_PER_BEAT);
}
