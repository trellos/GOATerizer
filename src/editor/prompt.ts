/**
 * The editor's timeline <-> the authored `prompt[]`, both ways.
 *
 * The authored prompt is a **sequence**: one event after another, each carrying
 * its written duration, with rests spelling every silence. The editor is a
 * **grid**: notes at absolute positions with holes between them. This module is
 * the whole of the difference, and it is where the two facts that make the
 * conversion lossy-in-one-direction live —
 *
 *   - a hole has to be spelled as rests, and not every hole can be
 *     ({@link spellRest});
 *   - a sequence cannot express two notes at once, so the grid must not contain
 *     an overlap ({@link overlap}).
 *
 * Both are reported rather than repaired. An editor that quietly moved somebody's
 * note to make a file valid would be worse than one that refuses to save.
 */

import { BEATS_PER_MEASURE } from "../config/tuning.js";
import { DURATION_BEATS } from "../scenario/types.js";
import {
  DURATION_TICKS,
  PHRASE_TICKS,
  TICKS_PER_BEAT,
  endTick,
  overlap,
  sortNotes,
  spellRest,
  tileToPhrase,
  type EditorNote,
} from "./grid.js";
import { laneForToken, tokenForLane, type LaneVocabulary } from "./vocabulary.js";
import type { NoteDuration } from "../minigame/api.js";

type Json = Record<string, unknown>;

export type PromptBuild = {
  /** Authored events, ready to be written into a level. Empty when unusable. */
  readonly events: readonly Json[];
  /** Phrase-relative start beats of the note opportunities, in order. */
  readonly noteStartBeats: readonly number[];
  /** Why the timeline cannot be written down, in the author's terms. */
  readonly problems: readonly string[];
};

/**
 * Three decimals, matching every authored file in the repository.
 *
 * A third of a beat has no decimal, and `scenario/load.ts` treats these numbers
 * as a checksum with a tolerance of 0.01 beats rather than as the position
 * itself — the position is derived from the durations, on an integer tick grid.
 * So three decimals is exactly enough to catch a dropped rest and not enough to
 * pretend 0.333 is a third.
 */
function beats(ticks: number): number {
  return Math.round((ticks / TICKS_PER_BEAT) * 1000) / 1000;
}

/** Where a tick sits, in the 1-based measure/beat the authored files state. */
function position(ticks: number): { startMeasure: number; beatWithinMeasure: number } {
  const ticksPerMeasure = TICKS_PER_BEAT * BEATS_PER_MEASURE;
  return {
    startMeasure: Math.floor(ticks / ticksPerMeasure) + 1,
    beatWithinMeasure: beats(ticks % ticksPerMeasure) + 1,
  };
}

function event(
  index: number,
  atTick: number,
  duration: NoteDuration,
  token: string | null
): Json {
  const base: Json = {
    index,
    type: token === null ? "rest" : "note",
    duration,
    durationBeats: Math.round(DURATION_BEATS[duration] * 1000) / 1000,
    startBeat: beats(atTick),
    ...position(atTick),
  };
  if (token !== null) base["scaleDegree"] = token;
  return base;
}

/**
 * Writes the timeline out as an authored prompt.
 *
 * The loop is tiled to the full four-measure phrase first: the handle says how
 * much of the phrase the author is editing, never how long the phrase is
 * (`grid.ts`).
 */
export function promptFromNotes(
  notes: readonly EditorNote[],
  loopMeasures: number,
  vocabulary: LaneVocabulary
): PromptBuild {
  const tiled = sortNotes(tileToPhrase(notes, loopMeasures));
  const problems: string[] = [];
  const events: Json[] = [];
  const noteStartBeats: number[] = [];

  let cursor = 0;
  for (const note of tiled) {
    if (note.startTick < cursor) {
      problems.push(
        `two notes sound at once around beat ${beats(note.startTick) + 1} — ` +
          "the prompt is a sequence, so one note has to end before the next begins"
      );
      return { events: [], noteStartBeats: [], problems };
    }
    if (note.startTick > cursor) {
      const rests = spellRest(cursor, note.startTick);
      if (rests === null) {
        problems.push(
          `the silence before beat ${beats(note.startTick) + 1} is ` +
            `${beats(note.startTick - cursor)} of a beat long, which no rest can spell — ` +
            "it usually means a triplet and a sixteenth were placed in the same beat"
        );
        return { events: [], noteStartBeats: [], problems };
      }
      let at = cursor;
      for (const rest of rests) {
        events.push(event(events.length, at, rest, null));
        at += DURATION_TICKS[rest];
      }
    }

    let token: string;
    try {
      token = tokenForLane(vocabulary, note.lane);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return { events: [], noteStartBeats: [], problems };
    }
    noteStartBeats.push(beats(note.startTick));
    events.push(event(events.length, note.startTick, note.duration, token));
    cursor = endTick(note);
  }

  if (cursor < PHRASE_TICKS) {
    const rests = spellRest(cursor, PHRASE_TICKS);
    if (rests === null) {
      problems.push(
        `the silence after beat ${beats(cursor)} cannot be spelled as rests — ` +
          "it usually means a triplet and a sixteenth were placed in the same beat"
      );
      return { events: [], noteStartBeats: [], problems };
    }
    let at = cursor;
    for (const rest of rests) {
      events.push(event(events.length, at, rest, null));
      at += DURATION_TICKS[rest];
    }
  }

  return { events, noteStartBeats, problems };
}

export type PromptRead = {
  readonly notes: readonly EditorNote[];
  readonly problems: readonly string[];
};

/**
 * Reads an authored prompt onto the timeline.
 *
 * Positions are recomputed from the durations rather than trusted from
 * `startBeat`, for the same reason `scenario/load.ts` does it: the durations are
 * the authority, and a file whose stated positions disagree is a file that
 * disagrees with itself. A prompt this refuses is one the loader would refuse
 * too — it is not the editor being fussy.
 */
export function notesFromPrompt(raw: unknown, vocabulary: LaneVocabulary): PromptRead {
  const problems: string[] = [];
  if (!Array.isArray(raw)) return { notes: [], problems: ["the level has no prompt"] };

  const notes: EditorNote[] = [];
  let tick = 0;
  let id = 1;
  raw.forEach((entry, index) => {
    const authored = (entry ?? {}) as Json;
    const duration = authored["duration"];
    if (typeof duration !== "string" || !(duration in DURATION_TICKS)) {
      problems.push(`prompt[${index}] has an unknown duration ${JSON.stringify(duration)}`);
      return;
    }
    const ticks = DURATION_TICKS[duration as NoteDuration];
    if (authored["type"] === "note") {
      const token = authored["scaleDegree"];
      const lane = typeof token === "string" ? laneForToken(vocabulary, token) : null;
      if (lane === null) {
        problems.push(
          `prompt[${index}] is written as ${JSON.stringify(token)}, which is not a lane on ` +
            "this scenario's timeline"
        );
      } else {
        notes.push({ id: id++, startTick: tick, lane, duration: duration as NoteDuration });
      }
    }
    tick += ticks;
  });

  if (tick !== PHRASE_TICKS) {
    problems.push(
      `the prompt is ${beats(tick)} beats long; the editor's timeline is ` +
        `${beats(PHRASE_TICKS)}`
    );
  }
  for (let i = 1; i < notes.length; i += 1) {
    if (overlap(notes[i - 1] as EditorNote, notes[i] as EditorNote)) {
      problems.push(`prompt[${i}] overlaps the note before it`);
    }
  }

  return { notes, problems };
}
