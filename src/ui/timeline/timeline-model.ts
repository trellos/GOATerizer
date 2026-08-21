/**
 * What the timeline draws — one model, both views.
 *
 * Key View and Tablature View are two presentations of *this*. Neither owns a
 * note, a judgment or a score; they read from here and place things differently
 * (`AGENTS.md` §12: do not build separate scoring engines for different
 * timeline presentations).
 *
 * Every position is in **absolute transport beats**. The renderer turns a beat
 * into an x coordinate; nothing here knows about pixels.
 */

import { laneOfMidi, lanePositionOfMidi, type RunKey } from "../../music/keys.js";
import { TIMELINE_HISTORY_BEATS } from "../../config/tuning.js";
import type { BassLine } from "../../audio/bass-line.js";
import type { JudgmentOutcome } from "../../game/judgment.js";
import type { ResolvedTarget } from "../../game/targets.js";
import type { NoteDuration } from "../../scenario/types.js";

export type TargetNote = {
  kind: "target";
  id: string;
  /** Which attempt authored this target. Two overlap across a transition. */
  attemptKey: string;
  opportunityIndex: number;
  startBeat: number;
  durationBeats: number;
  duration: NoteDuration;
  lane: number;
  midi: number;
  outcome: JudgmentOutcome | null;
};

export type PlayedNote = {
  kind: "played";
  id: string;
  startBeat: number;
  /** Grows while the note sounds; frozen on release. */
  endBeat: number | null;
  midi: number;
  /** Continuous lane coordinate. Null when outside the one-octave span. */
  lanePosition: number | null;
  diatonic: boolean;
  /** Null until this played note is judged, or if it never matched a target. */
  outcome: JudgmentOutcome | null;
  wrong: boolean;
};

export type BassNoteView = {
  kind: "bass";
  id: string;
  startBeat: number;
  durationBeats: number;
  /** Lane of the bass note's scale degree, drawn on the timeline's octave. */
  lane: number;
  midi: number;
};

export type TimelineSnapshot = {
  targets: readonly TargetNote[];
  played: readonly PlayedNote[];
  bass: readonly BassNoteView[];
};

/**
 * How long a played note lingers before it is dropped.
 *
 * Derived, not chosen: a note must survive until it has scrolled off the left
 * edge, so anything less than what the view actually shows deletes notes while
 * they are still on screen. The margin covers the drop happening on a later
 * frame than the note's last draw.
 */
const HISTORY_BEATS = TIMELINE_HISTORY_BEATS + 2;

export class TimelineModel {
  #key: RunKey;
  #targets: TargetNote[] = [];
  #played: PlayedNote[] = [];
  #bass: BassNoteView[] = [];
  #bassLine: BassLine | null = null;

  constructor(key: RunKey) {
    this.#key = key;
  }

  get key(): RunKey {
    return this.#key;
  }

  setKey(key: RunKey): void {
    this.#key = key;
    // Played notes are re-placed against the new key: the same physical note is
    // a different scale degree once the key changes under it, and a note that
    // was in the old key may be outside the new one.
    for (const note of this.#played) {
      note.lanePosition = lanePositionOfMidi(note.midi, key);
      note.diatonic = laneOfMidi(note.midi, key) !== null;
    }
    this.#rebuildBass();
  }

  /**
   * Adds one attempt's targets.
   *
   * Two attempts are on the timeline at once around a transition: the next
   * attempt's first note enters the visible window two beats before its own
   * beat 1, which is before the current attempt has finished. Keying by attempt
   * is what keeps their judgments from being written to each other.
   */
  addTargets(attemptKey: string, targets: readonly ResolvedTarget[], attemptStartBeat: number): void {
    this.removeTargets(attemptKey);
    for (const target of targets) {
      this.#targets.push({
        kind: "target",
        id: `${attemptKey}-${target.opportunityIndex}`,
        attemptKey,
        opportunityIndex: target.opportunityIndex,
        startBeat: attemptStartBeat + target.startBeat,
        durationBeats: target.durationBeats,
        duration: target.duration,
        lane: target.lane,
        midi: target.midi,
        outcome: null,
      });
    }
  }

  removeTargets(attemptKey: string): void {
    this.#targets = this.#targets.filter((target) => target.attemptKey !== attemptKey);
  }

  clearTargets(): void {
    this.#targets = [];
  }

  markTargetOutcome(attemptKey: string, opportunityIndex: number, outcome: JudgmentOutcome): void {
    const target = this.#targets.find(
      (entry) => entry.attemptKey === attemptKey && entry.opportunityIndex === opportunityIndex
    );
    if (target) target.outcome = outcome;
  }

  /** The looping bass line, laid out across the visible window on demand. */
  setBassLine(line: BassLine | null): void {
    this.#bassLine = line;
    this.#rebuildBass();
  }

  /* ------------------------------------------------------------------ */

  /** Records a played note. Called for every attack, scored or not. */
  addPlayed(id: string, midi: number, beat: number): void {
    this.#played.push({
      kind: "played",
      id,
      startBeat: beat,
      endBeat: null,
      midi,
      lanePosition: lanePositionOfMidi(midi, this.#key),
      diatonic: laneOfMidi(midi, this.#key) !== null,
      outcome: null,
      wrong: false,
    });
  }

  /** The recognizer revised a note it already announced. Same note, new pitch. */
  revisePlayed(id: string, midi: number): void {
    const note = this.#played.find((entry) => entry.id === id);
    if (!note) return;
    note.midi = midi;
    note.lanePosition = lanePositionOfMidi(midi, this.#key);
    note.diatonic = laneOfMidi(midi, this.#key) !== null;
  }

  endPlayed(id: string, beat: number): void {
    const note = this.#played.find((entry) => entry.id === id);
    if (note && note.endBeat === null) note.endBeat = beat;
  }

  markPlayedOutcome(id: string, outcome: JudgmentOutcome | null, wrong: boolean): void {
    const note = this.#played.find((entry) => entry.id === id);
    if (!note) return;
    note.outcome = outcome;
    note.wrong = wrong;
  }

  /** Drops played notes that have scrolled well past the left edge. */
  prune(nowBeat: number): void {
    this.#played = this.#played.filter((note) => nowBeat - note.startBeat < HISTORY_BEATS);
  }

  clearPlayed(): void {
    this.#played = [];
  }

  /** Everything inside the visible window, targets and history included. */
  snapshot(nowBeat: number, futureBeats: number, historyBeats: number): TimelineSnapshot {
    const from = nowBeat - historyBeats;
    const to = nowBeat + futureBeats;
    const visible = <T extends { startBeat: number; durationBeats?: number }>(note: T): boolean => {
      const end = note.startBeat + (note.durationBeats ?? 0);
      return end >= from && note.startBeat <= to;
    };

    return {
      targets: this.#targets.filter(visible),
      played: this.#played.filter(
        (note) => (note.endBeat ?? note.startBeat) >= from && note.startBeat <= to
      ),
      bass: this.#bassAcross(from, to),
    };
  }

  #rebuildBass(): void {
    this.#bass = [];
  }

  /**
   * The bass loop, unrolled across the visible window.
   *
   * The line repeats every `loopBeats`, so the visible notes are whichever
   * repetitions overlap the window — computed on demand rather than stored, so
   * an infinite loop costs nothing.
   */
  #bassAcross(from: number, to: number): BassNoteView[] {
    const line = this.#bassLine;
    if (!line) return [];

    const notes: BassNoteView[] = [];
    const firstCycle = Math.floor(from / line.loopBeats);
    const lastCycle = Math.floor(to / line.loopBeats);

    for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
      for (const note of line.notes) {
        const startBeat = cycle * line.loopBeats + note.startBeat;
        if (startBeat + note.durationBeats < from || startBeat > to) continue;
        notes.push({
          kind: "bass",
          id: `b${cycle}-${note.startBeat}`,
          startBeat,
          durationBeats: note.durationBeats,
          // Placed by scale degree, not by absolute pitch: the bass is drawn to
          // teach the harmonic relationship, and its own octave is far below
          // the lanes.
          lane: note.degree - 1,
          midi: note.midi,
        });
      }
    }
    return notes;
  }
}
