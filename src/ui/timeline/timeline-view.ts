/**
 * The timeline canvas — Key View and Tablature View.
 *
 * Both modes render the same {@link TimelineModel}. Only the vertical axis
 * differs: Key View has fifteen diatonic pitch lanes, Tablature View has six
 * string rows. Time, duration, the strike line, judgment colouring and the
 * played-note overlay are shared, so the two views cannot disagree about what
 * happened.
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
import { laneLabel, type RunKey } from "../../music/keys.js";
import { LANE_COUNT } from "../../music/degrees.js";
import { midiToName } from "../../music/pitch.js";
import type { PlayedNote, TargetNote, TimelineModel } from "./timeline-model.js";

export type TimelineViewMode = "key" | "tab";

const THEME = {
  ground: "#0d1014",
  gutter: "#12161c",
  laneLine: "#1e242c",
  laneLineRoot: "#2f3a46",
  laneText: "#8fa0b0",
  laneTextRoot: "#dbe6f0",
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

  get #gutterWidth(): number {
    // Tablature's gutter carries the whole selected shape (`E 6 8 10`), which
    // is what gives the player a physical reference before the run starts.
    return this.#mode === "key" ? 74 : 96;
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

  get #rowHeight(): number {
    return this.#height / (this.#rowCount + 1);
  }

  /** Row 0 is drawn at the bottom: higher pitch reads as higher on screen. */
  #rowY(row: number): number {
    return this.#height - this.#rowHeight * (row + 1);
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
    ctx.fillStyle = THEME.ground;
    ctx.fillRect(0, 0, this.#width, this.#height);

    const snapshot = model.snapshot(nowBeat, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);

    this.#drawBeatGrid(nowBeat);
    this.#drawRows();
    for (const note of snapshot.bass) this.#drawBass(note, nowBeat);
    for (const note of snapshot.targets) this.#drawTarget(note, nowBeat);
    for (const note of snapshot.played) this.#drawPlayed(note, nowBeat);
    this.#drawStrikeLine();
    this.#drawGutter();
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
    for (let beat = from; beat <= to; beat += 1) {
      const x = this.#x(beat, nowBeat);
      if (x < this.#playLeft) continue;
      const isMeasure = ((beat % BEATS_PER_MEASURE) + BEATS_PER_MEASURE) % BEATS_PER_MEASURE === 0;
      ctx.strokeStyle = isMeasure ? THEME.measureLine : THEME.beatLine;
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.#height);
      ctx.stroke();
    }
  }

  #drawRows(): void {
    const ctx = this.#ctx;
    for (let row = 0; row < this.#rowCount; row += 1) {
      const y = this.#rowY(row);
      const isRoot = this.#mode === "key" && row % 7 === 0;
      ctx.strokeStyle = isRoot ? THEME.laneLineRoot : THEME.laneLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.#playLeft, Math.round(y) + 0.5);
      ctx.lineTo(this.#width, Math.round(y) + 0.5);
      ctx.stroke();
    }
  }

  #drawGutter(): void {
    const ctx = this.#ctx;
    ctx.fillStyle = THEME.gutter;
    ctx.fillRect(0, 0, this.#gutterWidth, this.#height);
    ctx.strokeStyle = THEME.laneLineRoot;
    ctx.beginPath();
    ctx.moveTo(this.#gutterWidth + 0.5, 0);
    ctx.lineTo(this.#gutterWidth + 0.5, this.#height);
    ctx.stroke();

    ctx.textBaseline = "middle";
    for (let row = 0; row < this.#rowCount; row += 1) {
      const y = this.#rowY(row);
      if (this.#mode === "key") {
        const isRoot = row % 7 === 0;
        const label = laneLabel(row, this.#key);
        const fingering = this.#fingering?.positions[row];
        ctx.fillStyle = isRoot ? THEME.laneTextRoot : THEME.laneText;
        ctx.font = `${isRoot ? "600 " : ""}11px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = "left";
        // Scale degree first, note name retained: the player should be able to
        // read the note but is being taught the harmonic role.
        const text =
          this.#showFingeringLabels && fingering
            ? `${label.degree.padEnd(2)} ${formatFretPosition(fingering)}`
            : `${label.degree.padEnd(2)} (${label.note})`;
        ctx.fillText(text, 6, y - this.#rowHeight / 2);
      } else {
        // String name, then every fret of the selected shape on that string —
        // the two-octave scale laid out the way a hand would find it.
        const frets = (this.#fingering?.positions ?? [])
          .filter((position) => position.stringIndex === row)
          .map((position) => position.fret);
        ctx.textAlign = "left";
        ctx.fillStyle = THEME.laneTextRoot;
        ctx.font = "700 12px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(STRING_NAMES[row] ?? "", 8, y - this.#rowHeight / 2);
        ctx.fillStyle = THEME.laneText;
        ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(frets.join(" "), 26, y - this.#rowHeight / 2);
      }
    }
  }

  #drawStrikeLine(): void {
    const ctx = this.#ctx;
    const x = Math.round(this.#strikeX) + 0.5;
    ctx.fillStyle = THEME.strikeGlow;
    ctx.fillRect(x - 5, 0, 10, this.#height);
    ctx.strokeStyle = THEME.strike;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.#height);
    ctx.stroke();
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

  #drawTarget(note: TargetNote, nowBeat: number): void {
    const ctx = this.#ctx;
    const x = this.#x(note.startBeat, nowBeat);
    const width = Math.max(6, note.durationBeats * this.#pixelsPerBeat - 4);
    const height = this.#rowHeight * 0.52;
    const colour = this.#outcomeColour(note);

    ctx.save();
    this.#clipPlayfield();

    if (this.#mode === "key") {
      const y = this.#rowY(note.lane);
      ctx.globalAlpha = note.outcome === "miss" ? 0.4 : 1;
      ctx.fillStyle = colour;
      this.#roundRect(x, y - height / 2, width, height, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = note.outcome ? colour : THEME.targetEdge;
      ctx.lineWidth = 1;
      this.#roundRect(x + 0.5, y - height / 2 + 0.5, width - 1, height - 1, 3);
      ctx.stroke();
    } else {
      const position = this.#fingering?.positions[note.lane];
      const y = this.#rowY(this.#rowForLane(note.lane));
      // Tablature: a fret number sitting on its string, with a duration bar so
      // the rhythm is still readable.
      ctx.fillStyle = THEME.ground;
      ctx.fillRect(x - 2, y - height / 2, Math.min(width, 22), height);
      ctx.globalAlpha = note.outcome === "miss" ? 0.45 : 1;
      ctx.fillStyle = colour;
      ctx.font = "700 13px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(position ? String(position.fret) : "?", x, y);
      ctx.fillRect(x, y + height / 2 - 2, width, 2);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
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
      const height = this.#rowHeight * 0.26;
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
      // Off the two-octave span entirely: pinned to the edge it left through,
      // in a colour that says "out of range" rather than vanishing.
      const y = note.midi > 0 && note.lanePosition === null ? this.#edgeYFor(note.midi) : 0;
      ctx.fillStyle = THEME.outOfRange;
      ctx.fillRect(x, y - 2, width, 4);
    }

    ctx.restore();
  }

  #drawPlayedTab(note: PlayedNote, x: number, width: number, colour: string): void {
    const ctx = this.#ctx;
    const mapped = this.#tabPositionFor(note.midi);
    if (mapped) {
      const y = this.#rowY(mapped.stringIndex);
      ctx.fillStyle = colour;
      ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(mapped.fret), x, y + this.#rowHeight * 0.32);
      ctx.fillRect(x, y + this.#rowHeight * 0.32 + 8, width, 2);
      return;
    }
    // A pitch the chosen shape cannot express still has to appear. It is drawn
    // above the stave with its note name, rather than silently dropped.
    ctx.fillStyle = THEME.wrong;
    ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(midiToName(note.midi), x, 4);
    ctx.fillRect(x, 18, Math.max(4, width), 2);
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
    // Above the top lane or below the bottom one.
    return midi > 60 ? this.#rowY(this.#rowCount - 1) - this.#rowHeight * 0.4 : this.#height - 4;
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
