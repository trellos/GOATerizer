/**
 * What the editor is editing: one scenario file, one difficulty at a time.
 *
 * Holds the notes, the selection, the loop handle and the undo stack, and knows
 * how to turn all of that back into an authored scenario. Pure — no DOM, no
 * canvas — so every editing rule (what a drag does to a group, what a paste does
 * to an overlap, what shrinking the loop remembers) is testable directly.
 *
 * **Remembered notes.** The document holds every note across the four measures,
 * whatever the loop is set to. Notes outside the loop are not saved and not
 * played; they are kept so that shrinking the loop and re-expanding it brings
 * them back exactly, which is the difference between a loop handle and a
 * destructive crop.
 */

import type { NoteDuration } from "../minigame/api.js";
import {
  DURATION_TICKS,
  EDITABLE_DURATIONS,
  PHRASE_TICKS,
  TICKS_PER_MEASURE,
  endTick,
  inferLoopMeasures,
  isPlaceable,
  mergeNotes,
  snapStart,
  sortNotes,
  startGridOf,
  type EditorNote,
} from "./grid.js";
import { buildLevel, withLevel } from "./level.js";
import { notesFromPrompt } from "./prompt.js";
import { laneVocabularyOf, type LaneVocabulary } from "./vocabulary.js";
import { PHRASE_MEASURES } from "../config/tuning.js";

type Json = Record<string, unknown>;

/** One undoable state of the timeline. Snapshots, because they cannot drift. */
type Snapshot = {
  notes: readonly EditorNote[];
  loopMeasures: number;
  selection: readonly number[];
};

const UNDO_DEPTH = 200;

export class EditorDocument {
  /** The scenario file with every edit made in this session applied. */
  #raw: Json;
  #difficulty: number;
  #vocabulary: LaneVocabulary;
  #notes: EditorNote[] = [];
  #loopMeasures: number = PHRASE_MEASURES;
  #selection = new Set<number>();
  #undo: Snapshot[] = [];
  #nextId = 1;
  #dirty = false;
  /** Problems reading the level, if any. Shown rather than thrown. */
  #readProblems: readonly string[] = [];

  constructor(raw: unknown, difficulty: number) {
    this.#raw = structuredClone(raw) as Json;
    this.#difficulty = difficulty;
    this.#vocabulary = laneVocabularyOf(this.#raw);
    this.#readLevel(difficulty);
  }

  get raw(): Json {
    return this.#raw;
  }

  get scenarioId(): string {
    return String(this.#raw["id"] ?? "");
  }

  get minigameId(): string {
    return String(this.#raw["minigameClass"] ?? "");
  }

  get difficulty(): number {
    return this.#difficulty;
  }

  get vocabulary(): LaneVocabulary {
    return this.#vocabulary;
  }

  get notes(): readonly EditorNote[] {
    return this.#notes;
  }

  get loopMeasures(): number {
    return this.#loopMeasures;
  }

  get loopTicks(): number {
    return this.#loopMeasures * TICKS_PER_MEASURE;
  }

  get selection(): ReadonlySet<number> {
    return this.#selection;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  get readProblems(): readonly string[] {
    return this.#readProblems;
  }

  get supportedLevels(): readonly number[] {
    const supported = this.#raw["supportedLevels"];
    return Array.isArray(supported)
      ? supported.filter((entry): entry is number => typeof entry === "number")
      : [];
  }

  get premise(): string {
    return String(this.#raw["scenarioPremise"] ?? "");
  }

  setPremise(text: string): void {
    if (this.premise === text) return;
    this.#raw = { ...this.#raw, scenarioPremise: text };
    this.#dirty = true;
  }

  /** Whether a note may be placed on this lane, per the scenario's vocabulary. */
  laneAllowed(lane: number): boolean {
    return this.#vocabulary.allowed.has(lane);
  }

  /* ---------------------------------------------------------------- */
  /* Levels                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Switches difficulty, keeping this session's edits to the level being left.
   *
   * A level this scenario has never authored comes up empty, with the family's
   * own data copied from the nearest difficulty it *has* authored — its art
   * bindings and choreography belong to the scenario, not to the level, and
   * asking a designer to retype them to add a level would be the editor getting
   * in the way.
   */
  selectLevel(difficulty: number): readonly string[] {
    if (difficulty === this.#difficulty) return [];
    // A timeline that cannot be written down does not stop you leaving it — but
    // it does not silently vanish either: the level keeps whatever is on disk
    // and the reasons come back for the screen to show.
    const problems = this.#stashLevel();
    this.#difficulty = difficulty;
    this.#readLevel(difficulty);
    return problems;
  }

  /** The authored level for a difficulty, or null. */
  levelAt(difficulty: number): Json | null {
    const levels = (this.#raw["levels"] ?? {}) as Json;
    const level = levels[String(difficulty)];
    return level && typeof level === "object" ? (level as Json) : null;
  }

  /** The level whose family data a new difficulty should start from. */
  #templateLevel(difficulty: number): Json | null {
    const supported = [...this.supportedLevels].sort(
      (a, b) => Math.abs(a - difficulty) - Math.abs(b - difficulty)
    );
    for (const level of supported) {
      const authored = this.levelAt(level);
      if (authored) return authored;
    }
    return null;
  }

  #readLevel(difficulty: number): void {
    const level = this.levelAt(difficulty);
    if (level) {
      const read = notesFromPrompt(level["prompt"], this.#vocabulary);
      this.#notes = sortNotes(read.notes);
      this.#readProblems = read.problems;
    } else {
      this.#notes = [];
      this.#readProblems = [];
    }
    this.#nextId = 1 + this.#notes.reduce((max, note) => Math.max(max, note.id), 0);
    this.#loopMeasures = this.#notes.length > 0 ? inferLoopMeasures(this.#notes) : PHRASE_MEASURES;
    this.#selection = new Set();
    this.#undo = [];
  }

  /**
   * Folds the level being edited back into the scenario object.
   *
   * Called when the level or scenario changes and before saving, so an edit is
   * never lost by clicking away from it. A timeline that cannot be written down
   * leaves the file's existing level alone and says so instead.
   */
  #stashLevel(): string[] {
    const template = this.levelAt(this.#difficulty) ?? this.#templateLevel(this.#difficulty);
    const built = buildLevel({
      existing: template,
      difficulty: this.#difficulty,
      minigameId: this.minigameId,
      notes: this.#notes,
      loopMeasures: this.#loopMeasures,
      vocabulary: this.#vocabulary,
    });
    if (!built.level) return [...built.problems];
    this.#raw = withLevel(this.#raw, this.#difficulty, built.level);
    return [];
  }

  /**
   * The whole scenario file as it would be saved, or the reasons it cannot be.
   *
   * Validation beyond this — one waypoint per note, whole triplet groups, a
   * minigame that refuses its own data — belongs to `loadScenario`, which the
   * editor runs over this before offering to write it.
   */
  toScenario(): { raw: Json | null; problems: readonly string[] } {
    const problems = this.#stashLevel();
    return problems.length > 0 ? { raw: null, problems } : { raw: this.#raw, problems: [] };
  }

  markSaved(): void {
    this.#dirty = false;
  }

  /* ---------------------------------------------------------------- */
  /* Editing                                                           */
  /* ---------------------------------------------------------------- */

  #snapshot(): void {
    this.#undo.push({
      notes: this.#notes,
      loopMeasures: this.#loopMeasures,
      selection: [...this.#selection],
    });
    if (this.#undo.length > UNDO_DEPTH) this.#undo.shift();
    this.#dirty = true;
  }

  /** Ctrl-Z. Returns false when there is nothing left to undo. */
  undo(): boolean {
    const previous = this.#undo.pop();
    if (!previous) return false;
    this.#notes = [...previous.notes];
    this.#loopMeasures = previous.loopMeasures;
    this.#selection = new Set(previous.selection);
    return true;
  }

  setLoopMeasures(measures: number): void {
    if (measures === this.#loopMeasures) return;
    this.#snapshot();
    this.#loopMeasures = measures;
  }

  /** Notes the loop actually saves and plays. */
  liveNotes(): readonly EditorNote[] {
    return this.#notes.filter((note) => note.startTick < this.loopTicks);
  }

  /** Notes kept from a wider loop, drawn dim and saved by nobody. */
  rememberedNotes(): readonly EditorNote[] {
    return this.#notes.filter((note) => note.startTick >= this.loopTicks);
  }

  noteAt(tick: number, lane: number): EditorNote | null {
    return (
      this.#notes.find(
        (note) => note.lane === lane && tick >= note.startTick && tick < endTick(note)
      ) ?? null
    );
  }

  /** Places one new note, resolving overlaps in favour of the longer note. */
  addNote(startTick: number, lane: number, duration: NoteDuration): EditorNote | null {
    const note: EditorNote = {
      id: this.#nextId++,
      startTick: snapStart(startTick, duration),
      lane,
      duration,
    };
    if (!isPlaceable(note) || !this.laneAllowed(lane)) return null;
    this.#snapshot();
    this.#notes = mergeNotes(this.#notes, [note]);
    this.#selection = new Set([note.id]);
    return note;
  }

  /**
   * Moves the selection by a whole number of ticks and lanes.
   *
   * Notes pushed off the end of the phrase are deleted — "if a group of notes is
   * released with some past the end of the timeline, those notes are deleted" —
   * and a note landing on a lane the scenario cannot play is refused, which
   * cancels the whole move rather than silently dropping half of it.
   */
  moveSelection(deltaTicks: number, deltaLanes: number, duplicate: boolean): boolean {
    const moving = this.#notes.filter((note) => this.#selection.has(note.id));
    if (moving.length === 0) return false;

    const moved: EditorNote[] = [];
    for (const note of moving) {
      const lane = note.lane + deltaLanes;
      if (lane < 0 || lane >= this.#vocabulary.tokens.length || !this.laneAllowed(lane)) return false;
      const startTick = note.startTick + deltaTicks;
      if (startTick < 0) return false;
      if (startTick % startGridOf(note.duration) !== 0) return false;
      // Past the end of the timeline: dropped, not clamped.
      if (startTick + DURATION_TICKS[note.duration] > PHRASE_TICKS) continue;
      moved.push({
        id: duplicate ? this.#nextId++ : note.id,
        startTick,
        lane,
        duration: note.duration,
      });
    }

    this.#snapshot();
    const survivors = duplicate
      ? this.#notes
      : this.#notes.filter((note) => !this.#selection.has(note.id));
    this.#notes = mergeNotes(survivors, moved);
    this.#selection = new Set(moved.map((note) => note.id));
    return true;
  }

  /** Changes one note's written length, keeping where it starts. */
  resize(id: number, duration: NoteDuration): boolean {
    const note = this.#notes.find((entry) => entry.id === id);
    if (!note || note.duration === duration) return false;
    const resized: EditorNote = { ...note, duration };
    if (!isPlaceable(resized)) return false;
    this.#snapshot();
    this.#notes = mergeNotes(
      this.#notes.filter((entry) => entry.id !== id),
      [resized]
    );
    return true;
  }

  /**
   * The written length closest to a dragged width, from this note's start.
   *
   * Only durations whose grid the note's start already satisfies are offered: a
   * note on an odd sixteenth cannot become a triplet without being moved, and
   * moving somebody's note to make a duration fit is not a resize.
   */
  durationForWidth(note: EditorNote, ticks: number): NoteDuration {
    let best = note.duration;
    let distance = Infinity;
    for (const duration of EDITABLE_DURATIONS) {
      if (note.startTick % startGridOf(duration) !== 0) continue;
      if (note.startTick + DURATION_TICKS[duration] > PHRASE_TICKS) continue;
      const gap = Math.abs(DURATION_TICKS[duration] - ticks);
      // A tie goes to the binary duration: a triplet is 4 ticks and an eighth
      // 6, so a 5-tick drag is equally close to both, and a triplet should be
      // something an author reaches for rather than something a drag lands on.
      if (gap < distance || (gap === distance && best === "eighthTriplet")) {
        distance = gap;
        best = duration;
      }
    }
    return best;
  }

  deleteSelection(): boolean {
    if (this.#selection.size === 0) return false;
    this.#snapshot();
    this.#notes = this.#notes.filter((note) => !this.#selection.has(note.id));
    this.#selection = new Set();
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Selection                                                         */
  /* ---------------------------------------------------------------- */

  select(ids: readonly number[]): void {
    this.#selection = new Set(ids);
  }

  toggleSelected(id: number): void {
    if (this.#selection.has(id)) this.#selection.delete(id);
    else this.#selection.add(id);
  }

  clearSelection(): void {
    this.#selection = new Set();
  }

  /** Every note the marquee touches, however slightly. */
  selectWithin(fromTick: number, toTick: number, fromLane: number, toLane: number): void {
    const lowTick = Math.min(fromTick, toTick);
    const highTick = Math.max(fromTick, toTick);
    const lowLane = Math.min(fromLane, toLane);
    const highLane = Math.max(fromLane, toLane);
    this.#selection = new Set(
      this.#notes
        .filter(
          (note) =>
            note.lane >= lowLane &&
            note.lane <= highLane &&
            note.startTick < highTick &&
            endTick(note) > lowTick
        )
        .map((note) => note.id)
    );
  }

  /* ---------------------------------------------------------------- */
  /* Clipboard                                                         */
  /* ---------------------------------------------------------------- */

  /** The selection, as offsets from its own first note. */
  copy(): readonly Omit<EditorNote, "id">[] {
    const selected = sortNotes(this.#notes.filter((note) => this.#selection.has(note.id)));
    const first = selected[0];
    if (!first) return [];
    return selected.map((note) => ({
      startTick: note.startTick - first.startTick,
      lane: note.lane,
      duration: note.duration,
    }));
  }

  /** Pastes a copied group starting at `atTick`. Overlaps keep the longer note. */
  paste(clipboard: readonly Omit<EditorNote, "id">[], atTick: number): boolean {
    if (clipboard.length === 0) return false;
    const pasted: EditorNote[] = [];
    for (const note of clipboard) {
      const startTick = snapStart(atTick + note.startTick, note.duration);
      if (startTick + DURATION_TICKS[note.duration] > PHRASE_TICKS) continue;
      if (!this.laneAllowed(note.lane)) continue;
      pasted.push({ id: this.#nextId++, startTick, lane: note.lane, duration: note.duration });
    }
    if (pasted.length === 0) return false;
    this.#snapshot();
    this.#notes = mergeNotes(this.#notes, pasted);
    this.#selection = new Set(pasted.map((note) => note.id));
    return true;
  }
}
