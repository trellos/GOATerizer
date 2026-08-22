/**
 * The timeline canvas — Key View and Tablature View.
 *
 * Both modes render the same {@link TimelineModel}. Only the vertical axis
 * differs: Key View has eight diatonic pitch lanes — one octave, root to root —
 * and Tablature View has six string rows. Time, duration, the strike line,
 * judgment colouring and the played-note overlay are shared, so the two views
 * cannot disagree about what happened.
 *
 * Type size is derived from the row height rather than fixed, because the
 * labels are gameplay information read at a glance while both hands are busy
 * (`AGENTS.md` §12). Nothing is ever hidden for being small: if a label does
 * not fit, the row is too short, not the label too long.
 *
 * Horizontal position comes from the transport, every frame:
 *
 *     x(beat) = strikeX + (beat - nowBeat) * pixelsPerBeat
 *
 * A note enters at the right edge two beats early, crosses the strike line
 * exactly on its beat, and leaves at the left two beats later. Nothing
 * accumulates frame deltas, so a dropped frame moves nothing.
 */

import {
  TIMELINE_FUTURE_BEATS,
  TIMELINE_HISTORY_BEATS,
  BEATS_PER_MEASURE,
} from "../../config/tuning.js";
import type { Fingering } from "../../music/fingering.js";
import { formatFretPosition, OPEN_STRING_MIDI, STRING_NAMES } from "../../music/fingering.js";
import { laneLabel, laneMidiNotes, type RunKey } from "../../music/keys.js";
import { LANE_COUNT } from "../../music/degrees.js";
import { midiToName } from "../../music/pitch.js";
import type { RepeatVisualState } from "../../scenario/minigames/repeat-minigame.js";
import type { TimelineActorState } from "../../scenario/minigames/timeline-actor.js";
import { drawTimelineActor } from "./actor-layer.js";
import { drawRepeatPerformer } from "./repeat-layer.js";
import type {
  PlayedNote,
  TargetNote,
  TimelineModel,
  TimelineSnapshot,
} from "./timeline-model.js";

export type TimelineViewMode = "key" | "tab";

/** One monospace stack for every label the timeline draws. */
const MONO = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * How much of an overlay canvas the eight lanes occupy, centred vertically.
 *
 * The overlay shares its space with the scenario art, so the lanes cannot
 * simply spread to fill it: they need to be a band the eye can take in at once,
 * with the goat visible above and below it.
 */
export const OVERLAY_BAND_FRACTION = 0.5;

const THEME = {
  ground: "#0d1014",
  gutter: "#12161c",
  laneLine: "#1e242c",
  // Root and fifth get distinct hues, not just brighter versions of the plain
  // row — the player should be able to find "where the root is" at a glance,
  // the way a keyboard player finds middle C by feel. Root is the primary
  // landmark (warm), fifth is secondary (cool), both kept duller than the
  // judgment colours (perfect/good/target) so a lit-up note on top of the row
  // never gets mistaken for the row accent itself.
  laneLineRoot: "#5a4426",
  laneLineFifth: "#2f3f52",
  laneText: "#8fa0b0",
  laneTextRoot: "#f0c674",
  laneTextFifth: "#9fc7e8",
  beatLine: "#171c23",
  measureLine: "#28313c",
  strike: "#f4f7fb",
  strikeGlow: "rgba(244,247,251,0.18)",
  target: "#3fb9d6",
  targetEdge: "#8be5f7",
  perfect: "#ffd34d",
  good: "#59d98a",
  miss: "#6a737d",
  wrong: "#ff5b5b",
  played: "#e8eef5",
  bass: "#2b3a4d",
  bassEdge: "#3c5570",
  outOfRange: "#b06a2c",
} as const;

export class TimelineView {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  #mode: TimelineViewMode = "key";
  /** Drawn over the scenario rather than in a pane of its own. */
  #overlay = false;
  /** PROTOTYPE: the actor standing on the note bars, or null when off. */
  #actor: TimelineActorState | null = null;
  #actorBeat = 0;
  /** PROTOTYPE: the repeat performer, when the scenario is a `RepeatMinigame`. */
  #repeat: RepeatVisualState | null = null;
  #key: RunKey;
  #fingering: Fingering | null = null;
  #showFingeringLabels = false;
  #width = 0;
  #height = 0;

  constructor(canvas: HTMLCanvasElement, key: RunKey) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#key = key;
  }

  get mode(): TimelineViewMode {
    return this.#mode;
  }

  setMode(mode: TimelineViewMode): void {
    this.#mode = mode;
  }

  /**
   * Draw over the scenario instead of beside it.
   *
   * The player has to watch the timeline to know what note is coming, so in a
   * two-pane layout their eyes never reach the scenario and the payoff is
   * invisible. Overlaid, one gaze covers both.
   */
  setOverlay(overlay: boolean): void {
    this.#overlay = overlay;
  }

  /**
   * PROTOTYPE: the actor to draw on the bars, and the attempt-relative beat to
   * draw it at. Null clears it — pregame has no attempt, so it has no actor.
   */
  setActor(actor: TimelineActorState | null, attemptBeat: number): void {
    this.#actor = actor;
    this.#actorBeat = attemptBeat;
  }

  /**
   * PROTOTYPE: the repeat performer to draw, sharing `setActor`'s beat. Setting
   * one replaces the climbing actor rather than joining it — a scenario has one
   * character on the bars, and which one is a fact about its minigame class.
   */
  setRepeat(repeat: RepeatVisualState | null): void {
    this.#repeat = repeat;
  }

  setKey(key: RunKey): void {
    this.#key = key;
  }

  setFingering(fingering: Fingering | null): void {
    this.#fingering = fingering;
  }

  /** Pregame shows the physical shape; the run shows scale degrees. */
  setShowFingeringLabels(show: boolean): void {
    this.#showFingeringLabels = show;
  }

  /* ------------------------------------------------------------------ */
  /* Geometry                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Row-label type size.
   *
   * Derived from the row height so the labels grow with the timeline instead of
   * staying at the size that suited fifteen lanes. The floor keeps them legible
   * on a short viewport; the ceiling stops eight fat rows turning into posters.
   */
  get #labelFontPx(): number {
    return Math.round(Math.max(12, Math.min(22, this.#rowHeight * 0.46)));
  }

  /** Advance width of the monospace face at the current label size. */
  get #labelCharPx(): number {
    return this.#labelFontPx * 0.62;
  }

  /**
   * Fret-number type size in Tablature View.
   *
   * Larger than a Key View label: in tablature the number *is* the note, so it
   * carries the same weight a coloured bar does in Key View.
   */
  get #tabFontPx(): number {
    return Math.round(Math.max(14, Math.min(28, this.#rowHeight * 0.48)));
  }

  /**
   * A note bar's thickness: the full row, less a hairline.
   *
   * Adjacent rows are exactly `rowHeight` apart, so a bar this tall stops two
   * pixels short of the next one's — near enough that a step reads as a
   * continuous contour, far enough that two notes never merge into one block.
   */
  get #noteHeight(): number {
    return Math.max(4, this.#rowHeight - 2);
  }

  /** The player's own note, inset inside the target it is sitting on. */
  get #playedHeight(): number {
    return Math.max(3, this.#rowHeight * 0.4);
  }

  get #gutterWidth(): number {
    // Sized from the widest label each mode actually draws: `b3 (Bb)` in Key
    // View, and in Tablature the string name plus the whole selected shape
    // (`A  5  7  9`), which is what gives the player a physical reference
    // before the run starts.
    const columns = this.#mode === "key" ? 9 : 12;
    return Math.min(Math.round(columns * this.#labelCharPx) + 12, Math.round(this.#width * 0.3));
  }

  get #playLeft(): number {
    return this.#gutterWidth;
  }

  get #playWidth(): number {
    return Math.max(1, this.#width - this.#gutterWidth);
  }

  get #strikeX(): number {
    return this.#playLeft + this.#playWidth / 2;
  }

  get #pixelsPerBeat(): number {
    return this.#playWidth / 2 / TIMELINE_FUTURE_BEATS;
  }

  #x(beat: number, nowBeat: number): number {
    return this.#strikeX + (beat - nowBeat) * this.#pixelsPerBeat;
  }

  get #rowCount(): number {
    return this.#mode === "key" ? LANE_COUNT : STRING_NAMES.length;
  }

  /** Height of the block of rows. Overlaid, that is a band; otherwise the pane. */
  get #bandHeight(): number {
    return this.#overlay
      ? this.#height * OVERLAY_BAND_FRACTION
      : this.#height * (this.#rowCount / (this.#rowCount + 1));
  }

  /** Top of the block of rows. Centred vertically when overlaid. */
  get #bandTop(): number {
    return this.#overlay ? (this.#height - this.#bandHeight) / 2 : this.#rowHeight;
  }

  get #rowHeight(): number {
    return this.#overlay
      ? (this.#height * OVERLAY_BAND_FRACTION) / this.#rowCount
      : this.#height / (this.#rowCount + 1);
  }

  /** Row 0 is drawn at the bottom: higher pitch reads as higher on screen. */
  #rowY(row: number): number {
    if (!this.#overlay) return this.#height - this.#rowHeight * (row + 1);
    // Centred on its own cell, so the band's outer rows sit half a row inside
    // its edges rather than on them.
    return this.#bandTop + this.#bandHeight - this.#rowHeight * (row + 0.5);
  }

  /**
   * Canvas-space point for a lane/beat, so the energy streak can launch from
   * the note the player actually saw.
   */
  pointFor(lane: number, beat: number, nowBeat: number): { x: number; y: number } {
    return { x: this.#x(beat, nowBeat), y: this.#rowY(this.#rowForLane(lane)) };
  }

  /** Pitch lane -> the row it is drawn on, in whichever mode is active. */
  #rowForLane(lane: number): number {
    if (this.#mode === "key") return lane;
    const index = Math.max(0, Math.min(LANE_COUNT - 1, Math.round(lane)));
    return this.#fingering?.positions[index]?.stringIndex ?? Math.min(5, Math.floor(index / 3));
  }

  /* ------------------------------------------------------------------ */

  render(model: TimelineModel, nowBeat: number): void {
    this.#resize();
    const ctx = this.#ctx;
    if (this.#overlay) {
      // The scenario is behind this canvas, so the ground is cleared rather
      // than painted — but a scrim goes back under the lane band, because a
      // cyan note on a pale mountain is not a readable note.
      ctx.clearRect(0, 0, this.#width, this.#height);
      this.#drawBandScrim();
    } else {
      ctx.fillStyle = THEME.ground;
      ctx.fillRect(0, 0, this.#width, this.#height);
    }

    const snapshot = model.snapshot(nowBeat, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);

    this.#drawBeatGrid(nowBeat);
    this.#drawRows();
    for (const note of snapshot.bass) this.#drawBass(note, nowBeat);
    for (const note of snapshot.targets) this.#drawTarget(note, nowBeat);
    for (const note of snapshot.played) this.#drawPlayed(note, nowBeat);
    this.#drawActor(snapshot, nowBeat);
    this.#drawStrikeLine();
    this.#drawGutter();
  }

  /**
   * PROTOTYPE: whichever character this scenario puts on the bars. Key View
   * only — tablature's string rows carry no pitch contour, so a character
   * hopping them would be hopping nothing meaningful.
   */
  #drawActor(snapshot: TimelineSnapshot, nowBeat: number): void {
    if (this.#mode !== "key") return;
    const repeat = this.#repeat;
    const actor = this.#actor;
    if (!repeat && !actor) return;

    const ctx = this.#ctx;
    ctx.save();
    this.#clipPlayfield();
    const geometry = {
      // Continuous, so the hop between lanes interpolates smoothly rather
      // than snapping between integer rows.
      laneY: (lane: number) => this.#rowY(lane) - this.#noteHeight / 2,
      strikeX: this.#strikeX,
      rowHeight: this.#rowHeight,
      floorY: this.#bandTop + this.#bandHeight + this.#rowHeight * 0.7,
    };
    if (repeat) {
      // A can rides in every bar that has not reached the strike line yet.
      // Once the note is judged the performer's own state owns that can, so
      // the two never draw the same one twice.
      const pending = snapshot.targets
        .filter((note) => note.outcome === null && note.startBeat >= nowBeat)
        .map((note) => ({
          x: this.#x(note.startBeat, nowBeat),
          y: geometry.laneY(note.lane),
        }));
      drawRepeatPerformer(
        ctx,
        repeat,
        { ...geometry, pixelsPerBeat: this.#pixelsPerBeat },
        this.#actorBeat,
        pending
      );
    } else if (actor) {
      drawTimelineActor(ctx, actor, geometry, this.#actorBeat);
    }
    ctx.restore();
  }

  /**
   * The darkened band the lanes sit in, faded out at top and bottom.
   *
   * A hard-edged panel would just be the two-pane layout with the art peeking
   * round it. Fading the edges lets the scenario continue through the overlay,
   * so the goat is climbing *behind* the notes rather than in a separate box.
   */
  #drawBandScrim(): void {
    const ctx = this.#ctx;
    const top = this.#bandTop;
    const height = this.#bandHeight;
    const fade = Math.min(height * 0.35, this.#rowHeight * 2.2);

    const gradient = ctx.createLinearGradient(0, top - fade, 0, top + height + fade);
    // Light enough that the route still reads through it. The notes carry
    // their own contrast (saturated fills with a dark edge); the scrim only has
    // to stop a pale sky washing out a cyan bar.
    gradient.addColorStop(0, "rgba(7,10,13,0)");
    gradient.addColorStop(0.5 - height / (2 * (height + 2 * fade)), "rgba(7,10,13,0.46)");
    gradient.addColorStop(0.5 + height / (2 * (height + 2 * fade)), "rgba(7,10,13,0.46)");
    gradient.addColorStop(1, "rgba(7,10,13,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, top - fade, this.#width, height + fade * 2);
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
    this.#ctx.imageSmoothingEnabled = false;
  }

  #drawBeatGrid(nowBeat: number): void {
    const ctx = this.#ctx;
    const from = Math.floor(nowBeat - TIMELINE_HISTORY_BEATS);
    const to = Math.ceil(nowBeat + TIMELINE_FUTURE_BEATS);
    // Overlaid, the grid stops at the band: full-height beat lines would rule
    // the scenario art into columns.
    const gridTop = this.#overlay ? this.#bandTop : 0;
    const gridBottom = this.#overlay ? this.#bandTop + this.#bandHeight : this.#height;

    for (let beat = from; beat <= to; beat += 1) {
      const x = this.#x(beat, nowBeat);
      if (x < this.#playLeft) continue;
      const isMeasure = ((beat % BEATS_PER_MEASURE) + BEATS_PER_MEASURE) % BEATS_PER_MEASURE === 0;
      ctx.strokeStyle = isMeasure ? THEME.measureLine : THEME.beatLine;
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, gridTop);
      ctx.lineTo(Math.round(x) + 0.5, gridBottom);
      ctx.stroke();
    }
  }

  /**
   * Root/fifth for a Key View row.
   *
   * Lane index is `octaveBand * 7 + (degree - 1)` (`music/degrees.ts`), so
   * degree 1 (root) always falls on `row % 7 === 0` and degree 5 (fifth) on
   * `row % 7 === 4`, in every octave band and every key — this needs no key
   * lookup, unlike the label text next to it.
   */
  #rowAccent(row: number): "root" | "fifth" | null {
    if (this.#mode !== "key") return null;
    const degreeIndex = row % 7;
    if (degreeIndex === 0) return "root";
    if (degreeIndex === 4) return "fifth";
    return null;
  }

  #drawRows(): void {
    const ctx = this.#ctx;
    for (let row = 0; row < this.#rowCount; row += 1) {
      const y = this.#rowY(row);
      const accent = this.#rowAccent(row);
      ctx.strokeStyle =
        accent === "root"
          ? THEME.laneLineRoot
          : accent === "fifth"
            ? THEME.laneLineFifth
            : THEME.laneLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.#playLeft, Math.round(y) + 0.5);
      ctx.lineTo(this.#width, Math.round(y) + 0.5);
      ctx.stroke();
    }
  }

  #drawGutter(): void {
    const ctx = this.#ctx;
    // Overlaid, the gutter is a panel over the band only — the labels still
    // need a solid ground to sit on, but not a column down the whole scene.
    const top = this.#overlay ? this.#bandTop : 0;
    const height = this.#overlay ? this.#bandHeight : this.#height;
    ctx.fillStyle = this.#overlay ? "rgba(11,15,20,0.9)" : THEME.gutter;
    ctx.fillRect(0, top, this.#gutterWidth, height);
    ctx.strokeStyle = THEME.laneLineRoot;
    ctx.beginPath();
    ctx.moveTo(this.#gutterWidth + 0.5, top);
    ctx.lineTo(this.#gutterWidth + 0.5, top + height);
    ctx.stroke();

    ctx.textBaseline = "middle";
    const font = this.#labelFontPx;
    for (let row = 0; row < this.#rowCount; row += 1) {
      // Centred on the row line, where the notes are, rather than floating in
      // the space above it.
      const y = this.#rowY(row);
      if (this.#mode === "key") {
        const accent = this.#rowAccent(row);
        const label = laneLabel(row, this.#key);
        const fingering = this.#fingering?.positions[row];
        ctx.fillStyle =
          accent === "root" ? THEME.laneTextRoot : accent === "fifth" ? THEME.laneTextFifth : THEME.laneText;
        // Bold marks the root only — it stays the one landmark you can find
        // without reading colour, the fifth is colour-only so it stays secondary.
        ctx.font = `${accent === "root" ? "700 " : "500 "}${font}px ${MONO}`;
        ctx.textAlign = "left";
        // Scale degree first, note name retained: the player should be able to
        // read the note but is being taught the harmonic role.
        const text =
          this.#showFingeringLabels && fingering
            ? `${label.degree.padEnd(2)} ${formatFretPosition(fingering)}`
            : `${label.degree.padEnd(2)} (${label.note})`;
        ctx.fillText(text, 8, y);
      } else {
        // String name, then every fret of the selected shape on that string —
        // the one-octave scale laid out the way a hand would find it.
        const frets = (this.#fingering?.positions ?? [])
          .filter((position) => position.stringIndex === row)
          .map((position) => String(position.fret));
        ctx.textAlign = "left";
        ctx.fillStyle = frets.length > 0 ? THEME.laneTextRoot : THEME.laneText;
        ctx.font = `700 ${font}px ${MONO}`;
        ctx.fillText(STRING_NAMES[row] ?? "", 8, y);
        // Dimmed, never hidden: a string the shape does not use still has to
        // read as a string, so the six rows stay countable.
        ctx.fillStyle = THEME.laneText;
        ctx.font = `600 ${font}px ${MONO}`;
        ctx.fillText(frets.join(" ") || "·", 8 + this.#labelCharPx * 2.4, y);
      }
    }
  }

  /**
   * The strike line runs the full height even when overlaid.
   *
   * It is the one mark that has to be found instantly, and letting it cross the
   * scenario is what ties the two together: the note reaching it and the goat
   * taking a step are visibly the same instant.
   */
  #drawStrikeLine(): void {
    const ctx = this.#ctx;
    const x = Math.round(this.#strikeX) + 0.5;
    ctx.fillStyle = THEME.strikeGlow;
    ctx.fillRect(x - 5, 0, 10, this.#height);
    ctx.strokeStyle = THEME.strike;
    ctx.lineWidth = 2;
    ctx.globalAlpha = this.#overlay ? 0.55 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.#height);
    ctx.stroke();
    // Solid through the band, ghosted over the art.
    ctx.globalAlpha = 1;
    if (this.#overlay) {
      ctx.beginPath();
      ctx.moveTo(x, this.#bandTop);
      ctx.lineTo(x, this.#bandTop + this.#bandHeight);
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Notes                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Colour for a note.
   *
   * A judged *target* takes its judgment's colour. A *played* note stays
   * near-white unless it was wrong, so the player can see their own attack
   * sitting inside the target it hit — two gold bars on top of each other would
   * hide exactly the thing worth looking at.
   */
  #outcomeColour(note: TargetNote | PlayedNote): string {
    if (note.kind === "played") return note.wrong ? THEME.wrong : THEME.played;
    switch (note.outcome) {
      case "perfect":
        return THEME.perfect;
      case "good":
        return THEME.good;
      case "miss":
        return THEME.miss;
      default:
        // An unjudged target: still to come, or still recoverable.
        return THEME.target;
    }
  }

  #drawBass(
    note: { startBeat: number; durationBeats: number; lane: number },
    nowBeat: number
  ): void {
    const ctx = this.#ctx;
    const x = this.#x(note.startBeat, nowBeat);
    const width = Math.max(3, note.durationBeats * this.#pixelsPerBeat - 3);
    const y = this.#rowY(this.#rowForLane(note.lane));
    const height = Math.max(3, this.#rowHeight * 0.16);

    if (x + width < this.#playLeft) return;
    ctx.save();
    this.#clipPlayfield();
    // Darker and thinner than anything else: harmonic context, not a target.
    ctx.fillStyle = THEME.bass;
    ctx.fillRect(x, y - height / 2, width, height);
    ctx.strokeStyle = THEME.bassEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - height / 2 + 0.5, width - 1, height - 1);
    ctx.restore();
  }

  /**
   * A target: one bar, the same shape in both views.
   *
   * It fills its row from halfway to the row above to halfway to the row below,
   * so a step from one note to the next reads as two blocks whose corners meet
   * — the contour of the phrase is the silhouette, before you read a single
   * label. Only a hairline separates adjacent rows, and the corner radius is
   * small for the same reason: rounded ends would open a visible gap exactly
   * where the eye is tracking the line.
   *
   * Tablature draws its fret number on top of that bar rather than instead of
   * it, so the two views differ only in what the vertical axis means.
   */
  #drawTarget(note: TargetNote, nowBeat: number): void {
    const ctx = this.#ctx;
    const x = this.#x(note.startBeat, nowBeat);
    const width = Math.max(6, note.durationBeats * this.#pixelsPerBeat - 2);
    const height = this.#noteHeight;
    const y = this.#rowY(this.#rowForLane(note.lane));
    const colour = this.#outcomeColour(note);

    ctx.save();
    this.#clipPlayfield();

    ctx.globalAlpha = note.outcome === "miss" ? 0.4 : 1;
    ctx.fillStyle = colour;
    this.#roundRect(x, y - height / 2, width, height, 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = note.outcome ? colour : THEME.targetEdge;
    ctx.lineWidth = 1;
    this.#roundRect(x + 0.5, y - height / 2 + 0.5, width - 1, height - 1, 2);
    ctx.stroke();

    if (this.#mode === "tab") {
      this.#drawTabFret(note, x, width, y, colour);
    }

    ctx.restore();
  }

  /**
   * The fret number, on the target's own bar.
   *
   * Dark ink on the bright bar while it fits; a short note whose bar is
   * narrower than its digits gets them alongside in the note's own colour
   * instead. Never abbreviated and never dropped — in tablature the number *is*
   * the note.
   */
  #drawTabFret(note: TargetNote, x: number, width: number, y: number, colour: string): void {
    const ctx = this.#ctx;
    const position = this.#fingering?.positions[note.lane];
    const text = position ? String(position.fret) : "?";
    const size = this.#tabFontPx;

    ctx.font = `800 ${size}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = note.outcome === "miss" ? 0.55 : 1;

    const textWidth = ctx.measureText(text).width;
    if (textWidth + 8 <= width) {
      ctx.fillStyle = THEME.ground;
      ctx.fillText(text, x + 4, y);
    } else {
      ctx.fillStyle = colour;
      ctx.fillText(text, x + width + 3, y);
    }
    ctx.globalAlpha = 1;
  }

  #drawPlayed(note: PlayedNote, nowBeat: number): void {
    const ctx = this.#ctx;
    const endBeat = note.endBeat ?? nowBeat;
    const x = this.#x(note.startBeat, nowBeat);
    const width = Math.max(4, (endBeat - note.startBeat) * this.#pixelsPerBeat);
    const colour = this.#outcomeColour(note);

    ctx.save();
    this.#clipPlayfield();

    if (this.#mode === "key" && note.lanePosition !== null) {
      const y = this.#rowY(note.lanePosition);
      const height = this.#playedHeight;
      if (note.diatonic) {
        ctx.fillStyle = colour;
        ctx.fillRect(x, y - height / 2, width, height);
        // A dark hairline, so a white bar inside a gold target still reads as
        // two separate things at a glance.
        ctx.strokeStyle = "rgba(8,10,14,0.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y - height / 2 + 0.5, Math.max(1, width - 1), height - 1);
      } else {
        // Non-diatonic: between the clean lanes, and deliberately fuzzy. It is
        // a mistake, it must remain visible, and it must not look like a lane.
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = colour;
        for (let i = -2; i <= 2; i += 1) {
          ctx.globalAlpha = 0.16;
          ctx.fillRect(x - 1, y - height / 2 + i * 2, width + 2, height);
        }
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y - 1, width, 2);
        ctx.globalAlpha = 1;
      }
    } else if (this.#mode === "tab") {
      this.#drawPlayedTab(note, x, width, colour);
    } else {
      // Off the octave entirely: pinned to the edge it left through,
      // in a colour that says "out of range" rather than vanishing.
      const y = note.midi > 0 && note.lanePosition === null ? this.#edgeYFor(note.midi) : 0;
      ctx.fillStyle = THEME.outOfRange;
      ctx.fillRect(x, y - 2, width, 4);
    }

    ctx.restore();
  }

  /**
   * The player's own note in tablature: an inset bar on the string they
   * actually sounded, matching Key View's treatment exactly.
   *
   * No fret number on a note that hit its target — the target's own number
   * already says which fret, and two numbers in one row is noise. A *wrong*
   * note gets one, because that is precisely the case where "what did I just
   * play?" is the question and there is no target underneath answering it.
   */
  #drawPlayedTab(note: PlayedNote, x: number, width: number, colour: string): void {
    const ctx = this.#ctx;
    const size = Math.round(this.#tabFontPx * 0.72);
    const mapped = this.#tabPositionFor(note.midi);
    ctx.font = `700 ${size}px ${MONO}`;
    ctx.textAlign = "left";

    if (mapped) {
      const y = this.#rowY(mapped.stringIndex);
      const height = this.#playedHeight;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y - height / 2, width, height);
      // A dark hairline, so a white bar inside a coloured target still reads as
      // two separate things at a glance.
      ctx.strokeStyle = "rgba(8,10,14,0.85)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y - height / 2 + 0.5, Math.max(1, width - 1), height - 1);

      if (note.wrong) {
        ctx.fillStyle = colour;
        ctx.textBaseline = "middle";
        ctx.fillText(String(mapped.fret), x + width + 3, y);
      }
      return;
    }
    // A pitch the chosen shape cannot express still has to appear. It is drawn
    // above the stave with its note name, rather than silently dropped.
    ctx.fillStyle = THEME.wrong;
    ctx.textBaseline = "top";
    ctx.fillText(midiToName(note.midi), x, 3);
    ctx.fillRect(x, 3 + size * 1.15, Math.max(4, width), 2);
  }

  /**
   * Nearest playable string/fret for an arbitrary played pitch, preferring the
   * region the chosen fingering sits in.
   */
  #tabPositionFor(midi: number): { stringIndex: number; fret: number } | null {
    const anchor = this.#fingering?.lowestFret ?? 0;
    let best: { stringIndex: number; fret: number; distance: number } | null = null;
    for (let stringIndex = 0; stringIndex < OPEN_STRING_MIDI.length; stringIndex += 1) {
      const open = OPEN_STRING_MIDI[stringIndex];
      if (open === undefined) continue;
      const fret = midi - open;
      if (fret < 0 || fret > 20) continue;
      const distance = Math.abs(fret - anchor);
      if (!best || distance < best.distance) best = { stringIndex, fret, distance };
    }
    return best ? { stringIndex: best.stringIndex, fret: best.fret } : null;
  }

  #edgeYFor(midi: number): number {
    // Above the top lane or below the bottom one — decided against the key's
    // own octave, not a fixed pitch, so it stays right in all 24 keys.
    const notes = laneMidiNotes(this.#key);
    const above = midi > (notes[notes.length - 1] ?? 0);
    return above ? this.#rowY(this.#rowCount - 1) - this.#rowHeight * 0.4 : this.#height - 4;
  }

  #clipPlayfield(): void {
    this.#ctx.beginPath();
    this.#ctx.rect(this.#playLeft, 0, this.#playWidth, this.#height);
    this.#ctx.clip();
  }

  #roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    const ctx = this.#ctx;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}
