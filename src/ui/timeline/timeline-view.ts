/**
 * The timeline canvas — Key View.
 *
 * Renders {@link TimelineModel} onto eight diatonic pitch lanes: one octave,
 * root to root. The vertical axis is harmonic role, which is what the game is
 * teaching; the physical neck position is a pregame choice shown as a fingering
 * diagram, not a second way to read the same notes.
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
import { formatFretPosition } from "../../music/fingering.js";
import { laneLabel, laneMidiNotes, type RunKey } from "../../music/keys.js";
import { LANE_COUNT } from "../../music/degrees.js";
import type { NoteArt, PlacedNote, Sprite, Stage, StageView } from "../../minigame/api.js";
import type { AssetStore } from "../assets.js";
import type { PlayedNote, TargetNote, TimelineModel } from "./timeline-model.js";

/**
 * Resolves the skin for one attempt's target notes.
 *
 * Keyed by attempt because two are on the timeline at once around a transition:
 * the outgoing scenario's notes scroll out to the left while the incoming one's
 * scroll in from the right, so each is skinned by the minigame that owns it and
 * they never contend for the same pixels.
 *
 * Returning `null` — which is also what happens when no source is installed at
 * all — gives the host's default look.
 */
export type StageSource = (attemptKey: string, view: StageView) => Stage | null;

/**
 * The golden ratio. One measure is a golden rectangle (GDD §11.3), so
 * pixels-per-beat is a consequence of the lane band's height rather than a
 * tuning number, and the visible span is whatever the play width then allows.
 */
const PHI = 1.618033988749895;

/** GDD §11.3: at least one whole measure each side of the current-time bar. */
const MIN_VISIBLE_MEASURES = 2;

/**
 * Height of a `scale: 1` sprite, as a fraction of the lane band.
 *
 * One number so a minigame never sees a pixel and its art keeps its proportions
 * at any pane size. Roughly a lane and a half, which is what an actor standing
 * on a bar wants.
 */
const SPRITE_BAND_FRACTION = 0.19;

/**
 * The most of the pane the lane band may take.
 *
 * The rest is play area above and below the lanes: room for an actor standing
 * on a bar, and for debris falling off one.
 */
const BAND_MAX_FRACTION = 0.62;

/** One monospace stack for every label the timeline draws. */
const MONO = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * How strongly a skinned note is washed with its own colour.
 *
 * Enough that upcoming, Perfect, Good and Miss stay tellable apart across any
 * art a scenario supplies; light enough that the art still reads under it.
 */
const JUDGMENT_WASH = 0.62;

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
  #key: RunKey;
  #fingering: Fingering | null = null;
  #showFingeringLabels = false;
  #assets: AssetStore | null = null;
  #stageFor: StageSource | null = null;
  #width = 0;
  #height = 0;

  constructor(canvas: HTMLCanvasElement, key: RunKey) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#key = key;
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

  /**
   * Installs per-minigame note art. Without this every note gets the default.
   *
   * The pregame timeline never sets one: there is no attempt yet, so there is
   * nothing whose look a scenario could own.
   */
  setStageSource(assets: AssetStore | null, stageFor: StageSource | null): void {
    this.#assets = assets;
    this.#stageFor = stageFor;
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
    // Sized from the PANE, not from `#rowHeight`. The row height now derives
    // from the lane band, the band from the play width, and the play width from
    // the gutter this font sizes — reading `#rowHeight` here closes that loop
    // and recurses until the stack gives out.
    const nominalRow = this.#height / (this.#rowCount + 1);
    return Math.round(Math.max(12, Math.min(22, nominalRow * 0.46)));
  }

  /** Advance width of the monospace face at the current label size. */
  get #labelCharPx(): number {
    return this.#labelFontPx * 0.62;
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
    // Sized from the widest label actually drawn: `b3 (Bb)` in a run, or the
    // slightly wider `b3 E7` form the pregame uses to show the fingering.
    const columns = 9;
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

  /**
   * The lane band: the rows a note can sit on.
   *
   * Not the whole canvas. A measure is a golden rectangle, so the band's height
   * decides how wide a measure is, and at least two must fit (GDD §11.3) — the
   * band is therefore capped at `playWidth / (2 * PHI)` however tall the pane
   * gets. What is left above and below is the play area the minigame's
   * background fills, and where an actor stands when it hops onto a bar.
   */
  get #laneBandHeight(): number {
    const widest = this.#playWidth / (MIN_VISIBLE_MEASURES * PHI);
    return Math.min(this.#height * BAND_MAX_FRACTION, widest);
  }

  /** Vertical centre of the lane band within the pane. */
  get #bandBottom(): number {
    return (this.#height + this.#laneBandHeight) / 2;
  }

  /**
   * Derived, never chosen: one measure is `PHI` times the lane band's height, so
   * the scroll speed falls out of the layout (GDD §11.3).
   *
   * If the pane is ever laid out too tall for two whole measures to fit, the
   * band is treated as the widest that does fit rather than silently showing
   * less than a measure either side of the current-time bar.
   */
  get #pixelsPerBeat(): number {
    return (PHI * this.#laneBandHeight) / BEATS_PER_MEASURE;
  }

  /** Beats either side of the current-time bar. Half the visible span. */
  get #halfSpanBeats(): number {
    return this.#playWidth / 2 / this.#pixelsPerBeat;
  }

  #x(beat: number, nowBeat: number): number {
    return this.#strikeX + (beat - nowBeat) * this.#pixelsPerBeat;
  }

  get #rowCount(): number {
    return LANE_COUNT;
  }

  get #rowHeight(): number {
    return this.#laneBandHeight / this.#rowCount;
  }

  /** Row 0 is drawn at the bottom: higher pitch reads as higher on screen. */
  #rowY(row: number): number {
    return this.#bandBottom - this.#rowHeight * (row + 0.5);
  }

  /**
   * Canvas-space point for a lane/beat, so the energy streak can launch from
   * the note the player actually saw.
   */
  pointFor(lane: number, beat: number, nowBeat: number): { x: number; y: number } {
    return { x: this.#x(beat, nowBeat), y: this.#rowY(lane) };
  }

  /* ------------------------------------------------------------------ */

  render(model: TimelineModel, nowBeat: number): void {
    this.#resize();
    const ctx = this.#ctx;
    ctx.fillStyle = THEME.ground;
    ctx.fillRect(0, 0, this.#width, this.#height);

    const span = this.#halfSpanBeats;
    const snapshot = model.snapshot(nowBeat, span, span);
    const stages = this.#resolveStages(model, nowBeat);
    const notes = new Map();
    for (const entry of stages.values()) {
      for (const [id, art] of entry.stage.notes ?? []) notes.set(id, art);
    }

    this.#drawBeatGrid(nowBeat);
    this.#drawRows();
    // Each minigame's background covers only its own measures, so around a
    // handover the outgoing one scrolls off while the incoming one arrives.
    for (const entry of stages.values()) this.#drawBackground(entry);
    for (const entry of stages.values()) this.#drawSprites(entry.stage.sprites, "under");
    for (const note of snapshot.bass) this.#drawBass(note, nowBeat);
    for (const note of snapshot.targets) this.#drawTarget(note, nowBeat, notes.get(note.id));
    for (const entry of stages.values()) this.#drawSprites(entry.stage.sprites, "over");
    // Above every minigame, always: the player's own note and the exact moment
    // are the two things its art may compose around but never obscure.
    for (const note of snapshot.played) this.#drawPlayed(note, nowBeat);
    this.#drawStrikeLine();
    this.#drawGutter();
  }

  /* ------------------------------------------------------------------ */
  /* Skinning                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Places every visible target, then asks each attempt's minigame what it
   * wants drawn on its own notes.
   *
   * Placement is entirely the host's: a minigame receives rects it cannot
   * change, so a skin can never move a note in time or pitch, resize it, or
   * make a challenge harder through visual ambiguity (`AGENTS.md` §12).
   *
   * Rects are normalised against the **playfield** — the area right of the
   * gutter — because that is where notes live and where a backdrop belongs.
   */
  #resolveStages(
    model: TimelineModel,
    nowBeat: number
  ): Map<string, { stage: Stage; span: { from: number; to: number } }> {
    const resolved = new Map<string, { stage: Stage; span: { from: number; to: number } }>();
    const stageFor = this.#stageFor;
    if (!stageFor) return resolved;

    for (const attemptKey of model.attemptKeys) {
      const targets = model.targetsFor(attemptKey);
      const first = targets[0];
      if (!first) continue;

      // EVERY note of the attempt, not just the visible ones: an actor anchored
      // to a note needs a coordinate after that note has scrolled off, or a
      // climber loses its footing at the left edge.
      const band = this.#laneBandHeight;
      const placed: PlacedNote[] = targets.map((note) => {
        const x = this.#x(note.startBeat, nowBeat);
        const w = Math.max(6, note.durationBeats * this.#pixelsPerBeat - 2);
        const y = this.#rowY(note.lane);
        const h = this.#noteHeight;
        return {
          id: note.id,
          opportunityIndex: note.opportunityIndex,
          lane: note.lane,
          duration: note.duration,
          outcome: note.outcome,
          // Normalised to the LANE BAND, not the pane, so a note's rect and a
          // sprite's y are in the same space and an actor can stand on a bar.
          rect: {
            x: (x - this.#playLeft) / this.#playWidth,
            y: (y - h / 2 - (this.#bandBottom - band)) / band,
            w: w / this.#playWidth,
            h: h / band,
          },
          beatsUntilStrike: note.startBeat - nowBeat,
        };
      });

      // The attempt's own measures, which its background is clipped to.
      const last = targets[targets.length - 1]!;
      const fromBeat = Math.floor(first.startBeat / BEATS_PER_MEASURE) * BEATS_PER_MEASURE;
      const toBeat =
        Math.ceil((last.startBeat + last.durationBeats) / BEATS_PER_MEASURE) * BEATS_PER_MEASURE;
      const span = {
        from: (this.#x(fromBeat, nowBeat) - this.#playLeft) / this.#playWidth,
        to: (this.#x(toBeat, nowBeat) - this.#playLeft) / this.#playWidth,
      };

      const measureWidth = (BEATS_PER_MEASURE * this.#pixelsPerBeat) / this.#playWidth;
      const stage = stageFor(attemptKey, {
        beat: nowBeat - model.attemptStartBeat(attemptKey),
        notes: placed,
        laneCount: LANE_COUNT,
        strikeX: (this.#strikeX - this.#playLeft) / this.#playWidth,
        span,
        measure: { width: measureWidth, beatWidth: measureWidth / BEATS_PER_MEASURE },
      });
      if (stage) resolved.set(attemptKey, { stage, span });
    }
    return resolved;
  }

  /** A minigame's background, clipped to the measures it is active for. */
  #drawBackground(entry: { stage: Stage; span: { from: number; to: number } }): void {
    const assetId = entry.stage.background;
    const image = assetId ? this.#assets?.get(assetId) : null;
    if (!image) return;
    const ctx = this.#ctx;

    const left = this.#playLeft + entry.span.from * this.#playWidth;
    const right = this.#playLeft + entry.span.to * this.#playWidth;
    const clipLeft = Math.max(this.#playLeft, left);
    const clipRight = Math.min(this.#width, right);
    if (clipRight <= clipLeft) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(clipLeft, 0, clipRight - clipLeft, this.#height);
    ctx.clip();
    /*
     * Fitted to the pane's HEIGHT and tiled across the span, not cover-fitted
     * to it.
     *
     * A minigame's measures are several times wider than the pane is tall, so
     * covering that span would magnify the art by the ratio between them — a
     * 320px backdrop blown up sevenfold, showing one corner of a mountain. The
     * art is authored at the scale it should be read at; what varies is how
     * much of the timeline it has to cover, which is what tiling is for.
     */
    const scale = this.#height / image.height;
    const w = image.width * scale;
    for (let x = left; x < clipRight; x += w) {
      ctx.drawImage(image, x, 0, w, this.#height);
    }
    ctx.restore();
  }

  /**
   * A minigame's sprites for one layer, in normalised timeline space.
   *
   * `y` is normalised to the LANE BAND, and going outside 0..1 is the point:
   * above the lanes is where an actor stands on a bar, below is where debris
   * falls. Only the play area clips.
   */
  #drawSprites(sprites: readonly Sprite[] | undefined, layer: NonNullable<Sprite["layer"]>): void {
    if (!sprites || sprites.length === 0) return;
    const ctx = this.#ctx;
    const band = this.#laneBandHeight;

    const ordered = sprites
      .map((sprite, index) => ({ sprite, index }))
      .filter((entry) => (entry.sprite.layer ?? "over") === layer)
      .sort((a, b) => (a.sprite.z ?? 0) - (b.sprite.z ?? 0) || a.index - b.index);
    if (ordered.length === 0) return;

    ctx.save();
    this.#clipPlayfield();
    for (const { sprite } of ordered) {
      const image = this.#assets?.get(sprite.assetId);
      // A missing sprite leaves a visible gap and is reported in the dev panel,
      // rather than taking the frame down.
      if (!image) continue;
      const h = band * SPRITE_BAND_FRACTION * (sprite.scale ?? 1);
      const w = image.width * (h / image.height);
      const cx = this.#playLeft + sprite.x * this.#playWidth;
      const cy = this.#bandBottom - band + (sprite.y + (sprite.offsetY ?? 0)) * band;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, sprite.opacity ?? 1));
      ctx.translate(cx, cy);
      if (sprite.rotationDeg) ctx.rotate((sprite.rotationDeg * Math.PI) / 180);
      // The anchor is also the pivot: a bottom-anchored actor turns about the
      // ground it stands on, a centred prop about its middle.
      ctx.drawImage(image, -w / 2, sprite.anchor === "bottom" ? -h : -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * A skin's `underlay` or `overlay`: natural proportions, centred on the
   * note's rect, free to bleed outside it.
   *
   * `scale` 1 means "as tall as a row", so a glow at 1.6 spills into the rows
   * above and below by design. Only the playfield clips it, which is what keeps
   * ornament off the gutter labels.
   */
  #drawNoteArt(
    art: { assetId: string; scale?: number; opacity?: number },
    x: number,
    y: number,
    width: number
  ): void {
    const image = this.#assets?.get(art.assetId);
    if (!image) return;
    const ctx = this.#ctx;
    const h = this.#rowHeight * (art.scale ?? 1);
    const w = image.width * (h / image.height);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, art.opacity ?? 1));
    ctx.drawImage(image, x + width / 2 - w / 2, y - h / 2, w, h);
    ctx.restore();
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

  /**
   * Root/fifth for a Key View row.
   *
   * Lane index is `octaveBand * 7 + (degree - 1)` (`music/degrees.ts`), so
   * degree 1 (root) always falls on `row % 7 === 0` and degree 5 (fifth) on
   * `row % 7 === 4`, in every octave band and every key — this needs no key
   * lookup, unlike the label text next to it.
   */
  #rowAccent(row: number): "root" | "fifth" | null {
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
    ctx.fillStyle = THEME.gutter;
    ctx.fillRect(0, 0, this.#gutterWidth, this.#height);
    ctx.strokeStyle = THEME.laneLineRoot;
    ctx.beginPath();
    ctx.moveTo(this.#gutterWidth + 0.5, 0);
    ctx.lineTo(this.#gutterWidth + 0.5, this.#height);
    ctx.stroke();

    ctx.textBaseline = "middle";
    const font = this.#labelFontPx;
    for (let row = 0; row < this.#rowCount; row += 1) {
      // Centred on the row line, where the notes are, rather than floating in
      // the space above it.
      const y = this.#rowY(row);
      {
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
    const y = this.#rowY(note.lane);
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
   * A target: one bar.
   *
   * It fills its row from halfway to the row above to halfway to the row below,
   * so a step from one note to the next reads as two blocks whose corners meet
   * — the contour of the phrase is the silhouette, before you read a single
   * label. Only a hairline separates adjacent rows, and the corner radius is
   * small for the same reason: rounded ends would open a visible gap exactly
   * where the eye is tracking the line.
   */
  #drawTarget(note: TargetNote, nowBeat: number, art?: NoteArt): void {
    const ctx = this.#ctx;
    const x = this.#x(note.startBeat, nowBeat);
    const width = Math.max(6, note.durationBeats * this.#pixelsPerBeat - 2);
    const height = this.#noteHeight;
    const y = this.#rowY(note.lane);
    const colour = this.#outcomeColour(note);

    ctx.save();
    // The one clip a skin cannot escape. Ornament may bleed past the note as
    // far as it likes and still never reach the gutter labels.
    this.#clipPlayfield();

    if (art?.underlay) this.#drawNoteArt(art.underlay, x, y, width);

    const body = art?.body ? this.#assets?.get(art.body.assetId) : null;
    if (body) {
      // Stretched to the rect exactly, so note duration stays honest whatever
      // is drawn around it.
      ctx.save();
      ctx.globalAlpha =
        Math.max(0, Math.min(1, art?.body?.opacity ?? 1)) * (note.outcome === "miss" ? 0.4 : 1);
      ctx.drawImage(body, x, y - height / 2, width, height);
      ctx.restore();
    } else {
      ctx.globalAlpha = note.outcome === "miss" ? 0.4 : 1;
      ctx.fillStyle = colour;
      this.#roundRect(x, y - height / 2, width, height, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = note.outcome ? colour : THEME.targetEdge;
      ctx.lineWidth = 1;
      this.#roundRect(x + 0.5, y - height / 2 + 0.5, width - 1, height - 1, 2);
      ctx.stroke();
    }

    // The colour language survives any skin.
    //
    // Applied whether or not the note has been judged, because "an upcoming
    // target" is a state the player reads at a glance too -- a skin that turned
    // every note to stone and left only the judged ones coloured would make the
    // thing you are about to play the *least* visible object on the timeline.
    // A minigame that wants full control supplies an opaque body per outcome
    // and paints over this.
    if (body) {
      ctx.globalAlpha = JUDGMENT_WASH * (note.outcome === "miss" ? 0.4 : 1);
      ctx.fillStyle = colour;
      ctx.fillRect(x, y - height / 2, width, height);
      ctx.globalAlpha = 1;
    }

    if (art?.overlay) this.#drawNoteArt(art.overlay, x, y, width);

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

    if (note.lanePosition !== null) {
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
    } else {
      // Off the octave entirely: pinned to the edge it left through,
      // in a colour that says "out of range" rather than vanishing.
      const y = note.midi > 0 && note.lanePosition === null ? this.#edgeYFor(note.midi) : 0;
      ctx.fillStyle = THEME.outOfRange;
      ctx.fillRect(x, y - 2, width, 4);
    }

    ctx.restore();
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
