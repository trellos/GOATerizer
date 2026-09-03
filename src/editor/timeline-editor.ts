/**
 * The editor's timeline: four bars, one lane per authored degree, notes as bars.
 *
 * Draws an {@link EditorDocument} and turns pointer input into edits on it. The
 * document owns every rule about what an edit *means* (`document.ts`) and the
 * grid owns every rule about where a note may sit (`grid.ts`); this owns
 * geometry and gesture, and nothing else.
 *
 * The one visual idea worth stating: a note's **width is its written duration**
 * and its **shade is that duration too**. The width is the honest reading and
 * the shade is the redundant one, which is what makes a sixteenth and a triplet
 * — three ticks and four, barely two pixels apart at this scale — tell
 * themselves apart at a glance.
 */

import { BEATS_PER_MEASURE, PHRASE_MEASURES } from "../config/tuning.js";
import type { NoteDuration } from "../minigame/api.js";
import type { EditorDocument } from "./document.js";
import {
  DURATION_TICKS,
  PHRASE_TICKS,
  TICKS_PER_BEAT,
  TICKS_PER_MEASURE,
  endTick,
  snapLoopMeasures,
  snapStart,
  tileToPhrase,
  type EditorNote,
} from "./grid.js";
import { laneLabel } from "./vocabulary.js";

/**
 * Canvas colours. Hex literals here rather than CSS tokens for the same reason
 * `ui/timeline/timeline-view.ts` has its own: a canvas cannot read a custom
 * property, and threading `getComputedStyle` through every draw call to avoid
 * repeating six values is worse than repeating them.
 */
const COLORS = {
  ground: "#0d1014",
  gutter: "#12161c",
  laneOdd: "#11161c",
  laneLocked: "#0a0d11",
  laneLine: "#1e242c",
  beatLine: "#171c23",
  sixteenthLine: "#12171d",
  measureLine: "#31404e",
  text: "#8fa0b0",
  textDim: "#4d5a67",
  ruler: "#6d7d8c",
  selected: "#ffd34d",
  ghost: "#8be5f7",
  ghostFill: "rgba(139,229,247,0.22)",
  marquee: "rgba(63,185,214,0.18)",
  marqueeEdge: "#3fb9d6",
  shade: "rgba(4,7,10,0.55)",
  loop: "#59d98a",
  playhead: "#f4f7fb",
  invalid: "#ff5b5b",
} as const;

/**
 * One shade per written duration, longest lightest.
 *
 * All the same hue as `--accent`, so the timeline reads as one object and the
 * shade is a duration cue rather than a second kind of meaning.
 */
const DURATION_FILL: Readonly<Record<NoteDuration, string>> = {
  whole: "#bdeef9",
  half: "#8be5f7",
  quarter: "#5cc9e2",
  eighth: "#3fb9d6",
  eighthTriplet: "#7f9f5e",
  sixteenth: "#2b8ba4",
};

/** The triplet is the odd one out and is drawn as one: a different hue. */
const DURATION_EDGE: Readonly<Record<NoteDuration, string>> = {
  whole: "#e8fbff",
  half: "#bdeef9",
  quarter: "#8be5f7",
  eighth: "#6bd3ea",
  eighthTriplet: "#b6d98a",
  sixteenth: "#4aa8c0",
};

const GUTTER = 46;
const HANDLE_ROW = 20;
const RULER_ROW = 18;
const NOTE_INSET = 2;
/** How close to a note's right edge the resize grip starts, in pixels. */
const RESIZE_GRIP = 7;

type Gesture =
  | { kind: "none" }
  | { kind: "marquee"; fromTick: number; fromLane: number; toTick: number; toLane: number }
  | {
      kind: "move";
      noteId: number;
      grabTick: number;
      grabLane: number;
      tick: number;
      lane: number;
      duplicate: boolean;
      moved: boolean;
    }
  | { kind: "resize"; noteId: number; duration: NoteDuration }
  | { kind: "loop"; measures: number; x: number }
  | { kind: "palette"; duration: NoteDuration; tick: number; lane: number; inside: boolean };

export type EditorViewCallbacks = {
  /** Something changed the document. Redraw the rest of the UI. */
  onEdit: () => void;
  /** A note was placed, moved or clicked: play it so the author hears the pitch. */
  onAudition: (note: EditorNote) => void;
  /** A one-line explanation for the status bar, or "" to clear it. */
  onStatus: (message: string) => void;
};

export class TimelineEditorView {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #callbacks: EditorViewCallbacks;
  #document: EditorDocument | null = null;
  #width = 1;
  #height = 1;
  #gesture: Gesture = { kind: "none" };
  #hoverNoteId: number | null = null;
  #hoverResize = false;
  /** Attempt-relative tick of the playhead while previewing, else null. */
  #playheadTick: number | null = null;
  /** What a click on empty space places. Set by the palette. */
  #activeDuration: NoteDuration = "quarter";
  /** Where the pointer last was on the timeline, so a paste lands under it. */
  #pointerTick = 0;
  #clipboard: readonly Omit<EditorNote, "id">[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EditorViewCallbacks) {
    this.#canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("the editor timeline needs a 2d canvas context");
    this.#ctx = ctx;
    this.#callbacks = callbacks;

    canvas.addEventListener("pointerdown", (event) => this.#onPointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.#onPointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.#onPointerUp(event));
    canvas.addEventListener("pointercancel", () => this.#cancelGesture());
    canvas.addEventListener("pointerleave", () => {
      if (this.#gesture.kind === "none") this.#hoverNoteId = null;
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  setDocument(document: EditorDocument | null): void {
    this.#document = document;
    this.#gesture = { kind: "none" };
    this.#hoverNoteId = null;
  }

  setActiveDuration(duration: NoteDuration): void {
    this.#activeDuration = duration;
  }

  get activeDuration(): NoteDuration {
    return this.#activeDuration;
  }

  setPlayhead(tick: number | null): void {
    this.#playheadTick = tick;
  }

  /** Starts a drag that began on a palette chip rather than on the canvas. */
  beginPaletteDrag(duration: NoteDuration): void {
    this.#gesture = { kind: "palette", duration, tick: 0, lane: 0, inside: false };
  }

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                          */
  /* ---------------------------------------------------------------- */

  /** Returns true when the key was the editor's. Wired by the screen. */
  handleKey(event: KeyboardEvent): boolean {
    const document = this.#document;
    if (!document) return false;

    const control = event.ctrlKey || event.metaKey;
    if (control && event.key.toLowerCase() === "z") {
      if (!document.undo()) this.#callbacks.onStatus("nothing left to undo");
      this.#callbacks.onEdit();
      return true;
    }
    if (control && event.key.toLowerCase() === "c") {
      this.#clipboard = document.copy();
      this.#callbacks.onStatus(
        this.#clipboard.length > 0 ? `copied ${this.#clipboard.length} notes` : "nothing selected"
      );
      return true;
    }
    if (control && event.key.toLowerCase() === "x") {
      this.#clipboard = document.copy();
      document.deleteSelection();
      this.#callbacks.onEdit();
      return true;
    }
    if (control && event.key.toLowerCase() === "v") {
      // Under the pointer, which is where the author is looking. A paste that
      // always landed at beat 1 would have to be dragged every time.
      const at = Math.max(0, Math.round(this.#pointerTick));
      if (!document.paste(this.#clipboard, at)) this.#callbacks.onStatus("nothing to paste");
      this.#callbacks.onEdit();
      return true;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!document.deleteSelection()) this.#callbacks.onStatus("nothing selected");
      this.#callbacks.onEdit();
      return true;
    }
    if (event.key === "Escape") {
      document.clearSelection();
      this.#callbacks.onEdit();
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Geometry                                                          */
  /* ---------------------------------------------------------------- */

  get #laneCount(): number {
    return this.#document?.vocabulary.tokens.length ?? 8;
  }

  get #lanesTop(): number {
    return HANDLE_ROW + RULER_ROW;
  }

  get #laneHeight(): number {
    return Math.max(8, (this.#height - this.#lanesTop) / this.#laneCount);
  }

  get #pixelsPerTick(): number {
    return (this.#width - GUTTER) / PHRASE_TICKS;
  }

  #xOfTick(tick: number): number {
    return GUTTER + tick * this.#pixelsPerTick;
  }

  #tickAtX(x: number): number {
    return (x - GUTTER) / this.#pixelsPerTick;
  }

  /** Lane 0 is drawn at the bottom, as the mockup's lane 1 is. */
  #yOfLane(lane: number): number {
    return this.#lanesTop + (this.#laneCount - 1 - lane) * this.#laneHeight;
  }

  #laneAtY(y: number): number {
    const row = Math.floor((y - this.#lanesTop) / this.#laneHeight);
    return this.#laneCount - 1 - row;
  }

  #pointAt(event: PointerEvent): { x: number; y: number } {
    const rect = this.#canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #noteUnder(tick: number, lane: number): EditorNote | null {
    return this.#document?.noteAt(Math.floor(tick), lane) ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Pointer                                                           */
  /* ---------------------------------------------------------------- */

  #onPointerDown(event: PointerEvent): void {
    const document = this.#document;
    if (!document) return;
    const point = this.#pointAt(event);
    this.#canvas.setPointerCapture(event.pointerId);

    // The loop handle owns the top strip outright.
    if (point.y < HANDLE_ROW) {
      this.#gesture = {
        kind: "loop",
        measures: snapLoopMeasures(this.#tickAtX(point.x)),
        x: point.x,
      };
      return;
    }
    if (point.x < GUTTER || point.y < this.#lanesTop) return;

    const tick = this.#tickAtX(point.x);
    const lane = this.#laneAtY(point.y);
    if (lane < 0 || lane >= this.#laneCount) return;

    const note = this.#noteUnder(tick, lane);
    if (note) {
      const rightEdge = this.#xOfTick(endTick(note));
      if (Math.abs(point.x - rightEdge) <= RESIZE_GRIP) {
        document.select([note.id]);
        this.#gesture = { kind: "resize", noteId: note.id, duration: note.duration };
        this.#callbacks.onEdit();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        // Ctrl on a note is either "add to the selection" or, once it moves,
        // "duplicate what is selected". Both start the same way.
        if (!document.selection.has(note.id)) document.toggleSelected(note.id);
      } else if (!document.selection.has(note.id)) {
        document.select([note.id]);
      }
      this.#gesture = {
        kind: "move",
        noteId: note.id,
        grabTick: tick,
        grabLane: lane,
        tick,
        lane,
        duplicate: event.ctrlKey || event.metaKey,
        moved: false,
      };
      this.#callbacks.onEdit();
      return;
    }

    // Empty space: a plain press starts a marquee, and a press that never
    // moves places a note (decided on pointer-up).
    if (!event.ctrlKey && !event.metaKey) document.clearSelection();
    this.#gesture = { kind: "marquee", fromTick: tick, fromLane: lane, toTick: tick, toLane: lane };
    this.#callbacks.onEdit();
  }

  #onPointerMove(event: PointerEvent): void {
    const document = this.#document;
    if (!document) return;
    const point = this.#pointAt(event);
    const tick = this.#tickAtX(point.x);
    const lane = this.#laneAtY(point.y);
    const inside = point.x >= GUTTER && point.y >= this.#lanesTop && lane >= 0 && lane < this.#laneCount;

    switch (this.#gesture.kind) {
      case "none": {
        if (inside) this.#pointerTick = tick;
        const note = inside ? this.#noteUnder(tick, lane) : null;
        this.#hoverNoteId = note?.id ?? null;
        this.#hoverResize =
          note !== null && Math.abs(point.x - this.#xOfTick(endTick(note))) <= RESIZE_GRIP;
        this.#canvas.style.cursor = this.#hoverResize
          ? "ew-resize"
          : note
            ? "grab"
            : point.y < HANDLE_ROW
              ? "col-resize"
              : "crosshair";
        return;
      }
      case "loop":
        this.#gesture = { kind: "loop", measures: snapLoopMeasures(tick), x: point.x };
        return;
      case "marquee":
        this.#gesture = { ...this.#gesture, toTick: tick, toLane: lane };
        document.selectWithin(
          this.#gesture.fromTick,
          this.#gesture.toTick,
          this.#gesture.fromLane,
          this.#gesture.toLane
        );
        this.#callbacks.onEdit();
        return;
      case "move": {
        const moved =
          this.#gesture.moved ||
          Math.abs(tick - this.#gesture.grabTick) > 0.5 ||
          lane !== this.#gesture.grabLane;
        this.#gesture = { ...this.#gesture, tick, lane, moved };
        return;
      }
      case "resize": {
        const resizing = this.#gesture.noteId;
        const note = document.notes.find((entry) => entry.id === resizing);
        if (!note) return;
        this.#gesture = {
          kind: "resize",
          noteId: note.id,
          duration: document.durationForWidth(note, Math.max(1, tick - note.startTick)),
        };
        return;
      }
      case "palette":
        this.#gesture = { ...this.#gesture, tick, lane, inside };
        return;
      default:
        return;
    }
  }

  #onPointerUp(event: PointerEvent): void {
    const document = this.#document;
    const gesture = this.#gesture;
    this.#gesture = { kind: "none" };
    if (!document) return;
    if (this.#canvas.hasPointerCapture(event.pointerId)) {
      this.#canvas.releasePointerCapture(event.pointerId);
    }

    switch (gesture.kind) {
      case "loop": {
        document.setLoopMeasures(gesture.measures);
        this.#callbacks.onStatus(
          gesture.measures === PHRASE_MEASURES
            ? "editing all four bars"
            : `editing ${gesture.measures} bar${gesture.measures === 1 ? "" : "s"}, repeated to fill the phrase`
        );
        break;
      }
      case "marquee": {
        const still =
          Math.abs(gesture.toTick - gesture.fromTick) < 1 && gesture.toLane === gesture.fromLane;
        if (still) this.#place(gesture.fromTick, gesture.fromLane, this.#activeDuration);
        break;
      }
      case "move": {
        if (!gesture.moved) break;
        const note = document.notes.find((entry) => entry.id === gesture.noteId);
        if (!note) break;
        const target = this.#ghostFor(note, gesture);
        if (target === null) {
          this.#callbacks.onStatus("dropped off the timeline — nothing moved");
          break;
        }
        const moved = document.moveSelection(
          target.startTick - note.startTick,
          target.lane - note.lane,
          gesture.duplicate
        );
        if (moved === "ok") this.#callbacks.onAudition(target);
        else if (moved === "locked-lane") {
          this.#callbacks.onStatus("that would put a note on a lane this scenario cannot play");
        } else if (moved === "off-grid") {
          this.#callbacks.onStatus(
            "that shift does not fit every selected note's own grid — a triplet and a " +
              "sixteenth cannot be moved together by a third of a beat"
          );
        }
        break;
      }
      case "resize": {
        const note = document.notes.find((entry) => entry.id === gesture.noteId);
        if (note && document.resize(note.id, gesture.duration)) {
          this.#callbacks.onAudition({ ...note, duration: gesture.duration });
        }
        break;
      }
      case "palette": {
        if (gesture.inside) this.#place(gesture.tick, gesture.lane, gesture.duration);
        break;
      }
      default:
        break;
    }
    this.#callbacks.onEdit();
  }

  #cancelGesture(): void {
    this.#gesture = { kind: "none" };
    this.#callbacks.onEdit();
  }

  #place(tick: number, lane: number, duration: NoteDuration): void {
    const document = this.#document;
    if (!document) return;
    if (!document.laneAllowed(lane)) {
      this.#callbacks.onStatus(
        `${laneLabel(document.vocabulary, lane)} is outside this scenario's degreeVocabulary — ` +
          "widen it in the file if the scenario really can play it"
      );
      return;
    }
    const placed = document.addNote(tick, lane, duration);
    if (placed) this.#callbacks.onAudition(placed);
    else this.#callbacks.onStatus("no room for that note there");
  }

  /**
   * Where a dragged note would land, or null when it would leave the timeline.
   *
   * Snapped to the closest valid start for its own duration, which for a triplet
   * is a third of a beat and for everything else a sixteenth.
   */
  #ghostFor(
    note: EditorNote,
    gesture: { tick: number; lane: number; grabTick: number; grabLane: number }
  ): EditorNote | null {
    if (gesture.lane < 0 || gesture.lane >= this.#laneCount) return null;
    const startTick = snapStart(
      note.startTick + (gesture.tick - gesture.grabTick),
      note.duration
    );
    const lane = note.lane + (gesture.lane - gesture.grabLane);
    if (lane < 0 || lane >= this.#laneCount) return null;
    return { ...note, startTick, lane };
  }

  /* ---------------------------------------------------------------- */
  /* Drawing                                                           */
  /* ---------------------------------------------------------------- */

  render(): void {
    this.#resize();
    const ctx = this.#ctx;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, this.#width, this.#height);

    const document = this.#document;
    if (!document) return;

    this.#drawLanes(document);
    this.#drawGrid();
    this.#drawShade(document);
    this.#drawNotes(document);
    this.#drawGesture(document);
    this.#drawRuler();
    this.#drawLoopHandle(document);
    this.#drawPlayhead();
  }

  #drawLanes(document: EditorDocument): void {
    const ctx = this.#ctx;
    const height = this.#laneHeight;
    ctx.font = `${Math.min(13, Math.max(9, height * 0.5))}px ui-monospace, monospace`;
    ctx.textBaseline = "middle";

    for (let lane = 0; lane < this.#laneCount; lane += 1) {
      const y = this.#yOfLane(lane);
      const allowed = document.laneAllowed(lane);
      ctx.fillStyle = allowed ? (lane % 2 === 0 ? COLORS.laneOdd : COLORS.ground) : COLORS.laneLocked;
      ctx.fillRect(GUTTER, y, this.#width - GUTTER, height);

      ctx.fillStyle = COLORS.gutter;
      ctx.fillRect(0, y, GUTTER, height);
      ctx.fillStyle = allowed ? COLORS.text : COLORS.textDim;
      ctx.textAlign = "right";
      ctx.fillText(laneLabel(document.vocabulary, lane), GUTTER - 8, y + height / 2);

      ctx.strokeStyle = COLORS.laneLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(GUTTER, Math.round(y) + 0.5);
      ctx.lineTo(this.#width, Math.round(y) + 0.5);
      ctx.stroke();
    }
  }

  #drawGrid(): void {
    const ctx = this.#ctx;
    const top = this.#lanesTop;
    const bottom = this.#height;
    for (let tick = 0; tick <= PHRASE_TICKS; tick += 3) {
      const onBeat = tick % TICKS_PER_BEAT === 0;
      const onMeasure = tick % TICKS_PER_MEASURE === 0;
      ctx.strokeStyle = onMeasure
        ? COLORS.measureLine
        : onBeat
          ? COLORS.beatLine
          : COLORS.sixteenthLine;
      ctx.lineWidth = onMeasure ? 1.5 : 1;
      const x = Math.round(this.#xOfTick(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, onMeasure ? HANDLE_ROW : top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
  }

  /** Everything past the loop is repeated rather than authored: shade it. */
  #drawShade(document: EditorDocument): void {
    if (document.loopMeasures >= PHRASE_MEASURES) return;
    const ctx = this.#ctx;
    const from = this.#xOfTick(document.loopTicks);
    ctx.fillStyle = COLORS.shade;
    ctx.fillRect(from, this.#lanesTop, this.#width - from, this.#height - this.#lanesTop);
  }

  #drawNotes(document: EditorDocument): void {
    const loopTicks = document.loopTicks;

    // The repetitions the loop will save, drawn as outlines in the shaded area
    // so it is obvious they are consequences rather than content.
    if (document.loopMeasures < PHRASE_MEASURES) {
      for (const note of tileToPhrase(document.notes, document.loopMeasures)) {
        if (note.startTick < loopTicks) continue;
        this.#drawNote(note, { style: "repeat" });
      }
    }
    for (const note of document.notes) {
      const remembered = note.startTick >= loopTicks;
      this.#drawNote(note, {
        style: remembered ? "remembered" : "live",
        selected: document.selection.has(note.id),
        hovered: this.#hoverNoteId === note.id,
        grip: this.#hoverNoteId === note.id && this.#hoverResize,
      });
    }
  }

  #drawNote(
    note: EditorNote,
    options: {
      style: "live" | "remembered" | "repeat" | "ghost";
      selected?: boolean;
      hovered?: boolean;
      /** The pointer is on this note's right edge, where a drag resizes it. */
      grip?: boolean;
    }
  ): void {
    const ctx = this.#ctx;
    const x = this.#xOfTick(note.startTick);
    const width = Math.max(3, DURATION_TICKS[note.duration] * this.#pixelsPerTick - 1);
    const y = this.#yOfLane(note.lane) + NOTE_INSET;
    const height = Math.max(4, this.#laneHeight - NOTE_INSET * 2);

    ctx.save();
    if (options.style === "remembered") ctx.globalAlpha = 0.32;
    if (options.style === "repeat" || options.style === "ghost") {
      ctx.globalAlpha = options.style === "ghost" ? 1 : 0.5;
      ctx.setLineDash(options.style === "ghost" ? [] : [4, 3]);
      if (options.style === "ghost") {
        ctx.fillStyle = COLORS.ghostFill;
        ctx.fillRect(x, y, width, height);
      }
      ctx.strokeStyle = options.style === "ghost" ? COLORS.ghost : DURATION_EDGE[note.duration];
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(width), Math.round(height));
      ctx.restore();
      return;
    }

    ctx.fillStyle = DURATION_FILL[note.duration];
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = options.selected
      ? COLORS.selected
      : options.hovered
        ? "#ffffff"
        : DURATION_EDGE[note.duration];
    ctx.lineWidth = options.selected ? 2 : 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(width), Math.round(height));

    // The resize grip: `<>` centred on the right edge, as the mockup draws it,
    // and shown exactly when a drag from here would resize rather than move —
    // the same moment the cursor becomes a resize arrow.
    if (options.grip && this.#gesture.kind === "none") {
      ctx.font = `bold ${Math.max(11, Math.min(15, height * 0.4))}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Outlined, because it is drawn straddling the note's own edge: half of
      // it lands on the bar and half on the lane behind it.
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.ground;
      ctx.strokeText("<>", x + width, y + height / 2);
      ctx.fillStyle = COLORS.selected;
      ctx.fillText("<>", x + width, y + height / 2);
    }
    ctx.restore();
  }

  #drawGesture(document: EditorDocument): void {
    const ctx = this.#ctx;
    const gesture = this.#gesture;

    if (gesture.kind === "marquee") {
      const x1 = this.#xOfTick(Math.min(gesture.fromTick, gesture.toTick));
      const x2 = this.#xOfTick(Math.max(gesture.fromTick, gesture.toTick));
      const lanes = [gesture.fromLane, gesture.toLane].sort((a, b) => a - b) as [number, number];
      const y1 = this.#yOfLane(lanes[1]);
      const y2 = this.#yOfLane(lanes[0]) + this.#laneHeight;
      ctx.fillStyle = COLORS.marquee;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeStyle = COLORS.marqueeEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x1) + 0.5, Math.round(y1) + 0.5, Math.round(x2 - x1), Math.round(y2 - y1));
      return;
    }

    if (gesture.kind === "move" && gesture.moved) {
      const note = document.notes.find((entry) => entry.id === gesture.noteId);
      const ghost = note ? this.#ghostFor(note, gesture) : null;
      if (!note || !ghost) return;
      const shiftTicks = ghost.startTick - note.startTick;
      const shiftLanes = ghost.lane - note.lane;
      for (const selected of document.notes) {
        if (!document.selection.has(selected.id)) continue;
        const at: EditorNote = {
          ...selected,
          startTick: selected.startTick + shiftTicks,
          lane: selected.lane + shiftLanes,
        };
        if (at.lane < 0 || at.lane >= this.#laneCount) continue;
        this.#drawNote(at, { style: "ghost" });
      }
      return;
    }

    if (gesture.kind === "resize") {
      const note = document.notes.find((entry) => entry.id === gesture.noteId);
      if (note) this.#drawNote({ ...note, duration: gesture.duration }, { style: "ghost" });
      return;
    }

    if (gesture.kind === "palette" && gesture.inside) {
      const at: EditorNote = {
        id: -1,
        startTick: snapStart(gesture.tick, gesture.duration),
        lane: gesture.lane,
        duration: gesture.duration,
      };
      this.#drawNote(at, { style: "ghost" });
    }
  }

  #drawRuler(): void {
    const ctx = this.#ctx;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, HANDLE_ROW, this.#width, RULER_ROW);
    ctx.fillStyle = COLORS.ruler;
    ctx.font = "11px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let beat = 0; beat < PHRASE_MEASURES * BEATS_PER_MEASURE; beat += 1) {
      const onMeasure = beat % BEATS_PER_MEASURE === 0;
      ctx.fillStyle = onMeasure ? COLORS.text : COLORS.textDim;
      ctx.fillText(String(beat + 1), this.#xOfTick(beat * TICKS_PER_BEAT) + 3, HANDLE_ROW + RULER_ROW / 2);
    }
  }

  /**
   * The V handle.
   *
   * It tracks the pointer freely while dragging — that is what makes it feel
   * like a handle — while the bar under it snaps to the stop it would land on,
   * so the answer is visible before the button comes up.
   */
  #drawLoopHandle(document: EditorDocument): void {
    const ctx = this.#ctx;
    const gesture = this.#gesture;
    const measures = gesture.kind === "loop" ? gesture.measures : document.loopMeasures;
    const snapX = this.#xOfTick(measures * TICKS_PER_MEASURE);
    const handleX = gesture.kind === "loop" ? gesture.x : snapX;

    ctx.fillStyle = COLORS.gutter;
    ctx.fillRect(0, 0, this.#width, HANDLE_ROW);

    ctx.strokeStyle = COLORS.loop;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(GUTTER, HANDLE_ROW - 1);
    ctx.lineTo(snapX, HANDLE_ROW - 1);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(handleX - 6, 3);
    ctx.lineTo(handleX + 6, 3);
    ctx.lineTo(handleX, HANDLE_ROW - 3);
    ctx.closePath();
    ctx.fillStyle = COLORS.loop;
    ctx.fill();

    ctx.fillStyle = COLORS.textDim;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      measures === PHRASE_MEASURES ? "whole phrase" : `${measures}-bar loop, repeated`,
      Math.min(snapX + 8, this.#width - 96),
      HANDLE_ROW / 2
    );
  }

  #drawPlayhead(): void {
    if (this.#playheadTick === null) return;
    const ctx = this.#ctx;
    const x = Math.round(this.#xOfTick(this.#playheadTick)) + 0.5;
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, HANDLE_ROW);
    ctx.lineTo(x, this.#height);
    ctx.stroke();
  }

  #resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.#canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (this.#canvas.width !== width * dpr || this.#canvas.height !== height * dpr) {
      this.#canvas.width = width * dpr;
      this.#canvas.height = height * dpr;
    }
    this.#width = width;
    this.#height = height;
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
