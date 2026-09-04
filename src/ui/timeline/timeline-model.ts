/**
 * What the timeline draws — one model, any presentation.
 *
 * The renderer is a presentation of *this*. It owns no note, judgment or score;
 * it reads from here and decides placement (`AGENTS.md` §12: do not build
 * separate scoring engines for different timeline presentations). A per-minigame
 * skin is a further presentation of the same model, never a second model.
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
  /**
   * The target this attack resolved, once judged Perfect or Good. What lets the
   * view draw the played bar *against* the note it landed in — snapped flush
   * on a Perfect, outlined where it overlaps on a Good.
   */
  target: { attemptKey: string; opportunityIndex: number } | null;
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
  /** Absolute beat each attempt's beat 0 lands on. */
  #attemptStarts = new Map<string, number>();
  #played: PlayedNote[] = [];
  #unreleasedPruned = 0;
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
    this.#attemptStarts.set(attemptKey, attemptStartBeat);
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

  /**
   * Every target of one attempt, on screen or not.
   *
   * A minigame anchors its art and its actors to notes, so it needs a
   * coordinate for a note that has already scrolled off the left edge — a
   * climber does not lose its footing when the foothold it is standing on
   * leaves the window.
   */
  targetsFor(attemptKey: string): readonly TargetNote[] {
    return this.#targets.filter((target) => target.attemptKey === attemptKey);
  }

  /** Attempt keys currently holding targets, in insertion order. */
  get attemptKeys(): readonly string[] {
    const keys: string[] = [];
    for (const target of this.#targets) {
      if (!keys.includes(target.attemptKey)) keys.push(target.attemptKey);
    }
    return keys;
  }

  /**
   * Absolute beat one attempt's beat 0 lands on.
   *
   * A minigame is always given attempt-relative time, so the view needs this to
   * convert; deriving it from a note would assume the prompt opens on beat 0.
   */
  attemptStartBeat(attemptKey: string): number {
    return this.#attemptStarts.get(attemptKey) ?? 0;
  }

  removeTargets(attemptKey: string): void {
    this.#targets = this.#targets.filter((target) => target.attemptKey !== attemptKey);
    this.#attemptStarts.delete(attemptKey);
  }

  clearTargets(): void {
    this.#targets = [];
    this.#attemptStarts.clear();
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
      target: null,
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

  markPlayedOutcome(
    id: string,
    outcome: JudgmentOutcome | null,
    wrong: boolean,
    target: { attemptKey: string; opportunityIndex: number } | null = null
  ): void {
    const note = this.#played.find((entry) => entry.id === id);
    if (!note) return;
    note.outcome = outcome;
    note.wrong = wrong;
    note.target = target;
  }

  /**
   * How many played notes have been dropped while still unreleased.
   *
   * A played note grows until its `release` arrives, which is correct — a
   * sustained note should draw as a long bar, and capping the length would
   * quietly truncate real sustain. But `HISTORY_BEATS` is longer than any
   * authored note, so a note that reaches pruning without ending is, by
   * construction, a producer that stopped emitting note-offs: an injected
   * script with no `release`, or real Tuninator dropping a `noteEnded`. Counted
   * rather than hidden, and surfaced in the dev panel.
   */
  get unreleasedPruned(): number {
    return this.#unreleasedPruned;
  }

  /**
   * Drops what has scrolled well past the left edge: played notes, and whole
   * attempts once their last note has.
   *
   * An attempt is *not* dropped when it completes. Its family keeps rendering
   * while its final measure scrolls away — a notice pinned to it, a knocked-out
   * enemy lying where it fell, the last four beats of history — and a family
   * that is only asked while it holds targets would pop out at the handover.
   * `game-app.ts` used to remove the finished attempt's targets on completion
   * for exactly that reason; now the timeline decides, from geometry.
   */
  prune(nowBeat: number): void {
    this.#played = this.#played.filter((note) => {
      if (nowBeat - note.startBeat < HISTORY_BEATS) return true;
      if (note.endBeat === null) this.#unreleasedPruned += 1;
      return false;
    });

    for (const attemptKey of this.attemptKeys) {
      const targets = this.targetsFor(attemptKey);
      const lastEnd = Math.max(...targets.map((t) => t.startBeat + t.durationBeats));
      if (nowBeat - lastEnd >= HISTORY_BEATS) this.removeTargets(attemptKey);
    }
  }

  clearPlayed(): void {
    this.#played = [];
    this.#unreleasedPruned = 0;
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
