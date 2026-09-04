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
import type { Layer, NoteArt, PlacedNote, Stage, StageView } from "../../minigame/api.js";
import type { RepeatVisualState } from "../../scenario/minigames/repeat-minigame.js";
import type { TimelineActorState } from "../../scenario/minigames/timeline-actor.js";
import type { AssetStore } from "../assets.js";
import { drawTimelineActor, type ActorSprites } from "./actor-layer.js";
import {
  foreshadowArrowNudge,
  foreshadowOpacity,
  foreshadowX,
  type ForeshadowNotice,
} from "./foreshadow.js";
import { gleamIntensity } from "./gleam.js";
import { drawSparkle } from "./glyphs.js";
import { drawRepeatPerformer, NO_REPEAT_SPRITES, type RepeatSprites } from "./repeat-layer.js";
import { drawStageSprites, type StageGeometry } from "./stage-layer.js";
import type {
  PlayedNote,
  TargetNote,
  TimelineModel,
  TimelineSnapshot,
} from "./timeline-model.js";

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

/** One monospace stack for every label the timeline draws. */
const MONO = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * How strongly a skinned note is washed with its own colour.
 *
 * Enough that upcoming, Perfect, Good and Miss stay tellable apart across any
 * art a scenario supplies; light enough that the art still reads under it.
 */
const JUDGMENT_WASH = 0.62;

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
  /*
   * The triad gets distinct hues, not brighter versions of the plain row: the
   * player should be able to find the root, third and fifth at a glance, the
   * way a keyboard player finds middle C by feel. They are the three notes
   * every other degree is heard *against*, and the third is the one that says
   * whether the key is major or minor — so it is the accent, and the fifth,
   * which is the same note either way, is the secondary.
   *
   * The accent is **the row**, not its edge: the whole strip a note bar occupies
   * is washed in the colour, so the third and fifth are findable in peripheral
   * vision while both hands are busy. A hairline is not — it disappears under
   * the first lit-up note that lands on it.
   *
   * The root keeps the strongest wash and the only bold label, the third is the
   * accent under it, and the fifth is the secondary. Raising the third and fifth
   * without raising the root would have inverted that: the primary landmark
   * would have become the faintest of the three.
   *
   * Hue choice is constrained: cyan, gold, green and red are already the
   * judgment colours (target/perfect/good/wrong), so violet is the one strong
   * hue left that cannot be mistaken for an outcome. Every accent stays well
   * below them in saturation for the same reason — a row must never read as a
   * note.
   */
  laneLineRoot: "#5a4426",
  laneLineThird: "#54386b",
  laneLineFifth: "#2f3f52",
  laneBandRoot: "rgba(240,198,116,0.20)",
  laneBandThird: "rgba(196,150,232,0.20)",
  laneBandFifth: "rgba(159,199,232,0.15)",
  laneText: "#8fa0b0",
  laneTextRoot: "#f0c674",
  laneTextThird: "#c496e8",
  laneTextFifth: "#8ec3ee",
  beatLine: "#171c23",
  measureLine: "#28313c",
  strike: "#f4f7fb",
  strikeGlow: "rgba(244,247,251,0.18)",
  target: "#3fb9d6",
  targetEdge: "#8be5f7",
  perfect: "#ffd34d",
  /*
   * Good is a *lesser* Perfect, and green did not read as lesser than gold —
   * it read as a different flavour of success. Light grey does: the bar goes
   * flat, the played bar inside it stays white and is outlined where the two
   * overlap, so the player sees "you hit it, but the gold is missing".
   */
  good: "#b9c2cc",
  goodEdge: "#d9e0e8",
  miss: "#6a737d",
  wrong: "#ff5b5b",
  played: "#e8eef5",
  bass: "#2b3a4d",
  bassEdge: "#3c5570",
  outOfRange: "#b06a2c",
} as const;

/** Row accent -> its line, band and label colour. Keyed so no branch is missed. */
type RowAccent = "root" | "third" | "fifth";

const ROW_LINE: Readonly<Record<RowAccent, string>> = {
  root: THEME.laneLineRoot,
  third: THEME.laneLineThird,
  fifth: THEME.laneLineFifth,
};

const ROW_BAND: Readonly<Record<RowAccent, string>> = {
  root: THEME.laneBandRoot,
  third: THEME.laneBandThird,
  fifth: THEME.laneBandFifth,
};

const ROW_TEXT: Readonly<Record<RowAccent, string>> = {
  root: THEME.laneTextRoot,
  third: THEME.laneTextThird,
  fifth: THEME.laneTextFifth,
};

export class TimelineView {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  /**
   * Drawn over the scenario rather than in a pane of its own.
   *
   * Required at construction rather than defaulted and set later. It was `false`
   * by default and assigned afterwards, which made "nobody called `setOverlay`"
   * indistinguishable from "the two-pane layout was asked for" — and the
   * consequence of guessing wrong is total: the non-overlay path fills the whole
   * canvas with an opaque ground colour, so a backdrop drawn perfectly behind it
   * is never seen and the failure looks exactly like art that did not load.
   */
  readonly #overlay: boolean;
  /** PROTOTYPE: the actor standing on the note bars, or null when off. */
  #actor: TimelineActorState | null = null;
  #actorBeat = 0;
  /** The scenario's climber art. Empty until a scenario is being played. */
  #actorSprites: ActorSprites = { poses: [] };
  /** PROTOTYPE: the repeat performer, when the scenario is a `RepeatMinigame`. */
  #repeat: RepeatVisualState | null = null;
  #repeatSprites: RepeatSprites = NO_REPEAT_SPRITES;
  #key: RunKey;
  #fingering: Fingering | null = null;
  #snapPerfectPlayed = true;
  #foreshadow: ForeshadowNotice | null = null;
  /** This frame's targets by attempt and opportunity, for the played bars. */
  #targetsByOpportunity = new Map<string, TargetNote>();
  #showFingeringLabels = false;
  #assets: AssetStore | null = null;
  #stageFor: StageSource | null = null;
  #width = 0;
  #height = 0;

  constructor(canvas: HTMLCanvasElement, key: RunKey, overlay: boolean) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#key = key;
    this.#overlay = overlay;
  }

  /**
   * Whether the lanes are a band over the scenario, or the whole pane.
   *
   * Reported in the dev panel, because the DOM carries a `data-overlay`
   * attribute that is supposed to agree with this and is set separately. When
   * they disagree the timeline canvas fills itself opaque and hides a backdrop
   * that is drawn perfectly, which looks like art that failed to load.
   */
  get overlay(): boolean {
    return this.#overlay;
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
   * The pose cycle the actor is drawn from — the current scenario's
   * `climberPoses[]`, already resolved to images by the caller.
   */
  setActorSprites(sprites: ActorSprites): void {
    this.#actorSprites = sprites;
  }

  /**
   * PROTOTYPE: the repeat performer to draw, sharing `setActor`'s beat. Setting
   * one replaces the climbing actor rather than joining it — a scenario has one
   * character on the bars, and which one is a fact about its minigame class.
   */
  setRepeat(repeat: RepeatVisualState | null): void {
    this.#repeat = repeat;
  }

  /**
   * The can art, resolved by the caller from the scenario's `repeatTarget` and
   * `targetCompletedState` bindings. Separate from `setRepeat` because the
   * state changes every frame and the art changes once a scenario.
   */
  setRepeatSprites(sprites: RepeatSprites): void {
    this.#repeatSprites = sprites;
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
   * Whether a Perfect played bar is drawn flush with the note it landed in.
   *
   * On by default — it is the cleanest possible "you did that exactly right".
   * It also hides how early or late the attack really was, which is the one
   * thing a player with an uncompensated rig needs to see, so the dev panel can
   * turn it off.
   */
  setSnapPerfectPlayed(snap: boolean): void {
    this.#snapPerfectPlayed = snap;
  }

  /** The next-minigame notice, or null when there is nothing to foreshadow. */
  setForeshadow(notice: ForeshadowNotice | null): void {
    this.#foreshadow = notice;
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
    return Math.round(Math.max(12, Math.min(22, this.#rowHeight * 0.46)));
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
    // Sized from the widest label actually drawn: `b3 (Bb)`.
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

  get #pixelsPerBeat(): number {
    return this.#playWidth / 2 / TIMELINE_FUTURE_BEATS;
  }

  #x(beat: number, nowBeat: number): number {
    return this.#strikeX + (beat - nowBeat) * this.#pixelsPerBeat;
  }

  get #rowCount(): number {
    return LANE_COUNT;
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
    return { x: this.#x(beat, nowBeat), y: this.#rowY(lane) };
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
    // Asked once per frame, before anything is drawn: a minigame answers with
    // art for every note of its own attempt at once, so two attempts sharing
    // the timeline across a transition cannot see each other's rects.
    const stages = this.#resolveStages(model, nowBeat);

    this.#drawBeatGrid(nowBeat);
    this.#drawRows();
    // Scenery, behind the bars and behind the harmonic context both — an
    // "under" sprite is the ground a family stands its actors on.
    this.#drawStage(stages, "under");
    for (const note of snapshot.bass) this.#drawBass(note, nowBeat);
    for (const note of snapshot.targets) {
      this.#drawTarget(note, nowBeat, stages.get(note.attemptKey)?.notes?.get(note.id));
    }
    // Actors and effects, in front of the bars — but still under the played
    // row and the strike line, which stay above everything a minigame draws.
    this.#drawStage(stages, "over");
    this.#targetsByOpportunity.clear();
    for (const note of snapshot.targets) {
      this.#targetsByOpportunity.set(`${note.attemptKey}/${note.opportunityIndex}`, note);
    }
    for (const note of snapshot.played) this.#drawPlayed(note, nowBeat);
    // The gleams go on last of the note furniture: a neighbour's underlay
    // bleeds past its own bar and would otherwise paint over a corner.
    for (const note of snapshot.targets) {
      if (note.outcome === "perfect") this.#drawGleam(note, this.#targetRect(note, nowBeat), nowBeat);
    }
    this.#drawActor(snapshot, nowBeat);
    this.#drawForeshadow(nowBeat);
    this.#drawStrikeLine();
    this.#drawGutter();
  }

  /**
   * "NEXT → Ba Da Bing": the notice foreshadowing the next minigame's rhythm.
   *
   * Drawn by the host in the HUD's own language — a dark plate, mono type, a
   * chunky pixel arrow — above the lane band in the top-right of the playfield.
   * Timing and motion are `foreshadow.ts`: pinned through the final measure,
   * then carried off left with the outgoing minigame's notes.
   */
  #drawForeshadow(nowBeat: number): void {
    const notice = this.#foreshadow;
    if (!notice) return;
    const opacity = foreshadowOpacity(nowBeat, notice.revealBeat);
    if (opacity <= 0) return;

    const ctx = this.#ctx;
    // The plate fills the air above the lanes: from just under the top of the
    // canvas down to just above the band, so the call is readable in
    // peripheral vision while the eye is on the strike line.
    const top = 6;
    const bottom = Math.max(top + 24, Math.round(this.#bandTop - 8));
    const plateH = bottom - top;
    const font = Math.max(18, Math.round(plateH * 0.5));
    const pad = Math.round(plateH * 0.25);
    const arrowW = Math.round(plateH * 0.8);
    const arrowH = Math.round(plateH * 0.5);
    const gap = Math.round(plateH * 0.2);

    ctx.save();
    this.#clipPlayfield();
    ctx.globalAlpha = opacity;
    ctx.font = `700 ${font}px ${MONO}`;
    const callWidth = ctx.measureText(notice.call).width;
    const plateW = Math.round(pad + arrowW + gap + callWidth + pad);
    const margin = 12;
    const right = foreshadowX(this.#width - margin, this.#pixelsPerBeat, nowBeat, notice.scrollBeat);
    const left = right - plateW;
    if (right < this.#playLeft) {
      ctx.restore();
      return;
    }

    ctx.fillStyle = "rgba(6,8,11,0.72)";
    this.#roundRect(left, top, plateW, plateH, 6);
    ctx.fill();
    ctx.strokeStyle = THEME.perfect;
    ctx.lineWidth = 2;
    this.#roundRect(left + 1, top + 1, plateW - 2, plateH - 2, 6);
    ctx.stroke();

    const midY = top + plateH / 2;
    // The arrow: a pixel shaft and head, nudging right on each beat.
    const nudge = foreshadowArrowNudge(nowBeat) * Math.max(3, plateH * 0.06);
    const ax = left + pad + nudge;
    const shaftH = Math.max(3, Math.round(arrowH * 0.36));
    const headW = Math.round(arrowW * 0.45);
    ctx.fillStyle = THEME.perfect;
    ctx.fillRect(ax, Math.round(midY - shaftH / 2), arrowW - headW, shaftH);
    ctx.beginPath();
    ctx.moveTo(ax + arrowW - headW, midY - arrowH / 2);
    ctx.lineTo(ax + arrowW, midY);
    ctx.lineTo(ax + arrowW - headW, midY + arrowH / 2);
    ctx.closePath();
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `700 ${font}px ${MONO}`;
    ctx.fillStyle = THEME.perfect;
    ctx.fillText(notice.call, left + pad + arrowW + gap, midY);
    ctx.restore();
  }

  /**
   * Places every visible target, then asks each attempt's minigame what it
   * wants drawn on its own notes.
   *
   * Placement is entirely the host's: a minigame receives rects it cannot
   * change, so a skin can never move a note in time or pitch, resize it, or
   * make a challenge harder through visual ambiguity (`AGENTS.md` §12).
   *
   * `Stage.background` is deliberately not read here yet. The scenario backdrop
   * is still its own canvas behind this one, so a background clipped to
   * `span` would be a second, disagreeing answer to where the art goes; that
   * seam closes when the backdrop folds onto this canvas.
   */
  #resolveStages(model: TimelineModel, nowBeat: number): Map<string, Stage> {
    const resolved = new Map<string, Stage>();
    const stageFor = this.#stageFor;
    if (!stageFor) return resolved;

    const band = this.#bandHeight;
    const top = this.#bandTop;
    for (const attemptKey of model.attemptKeys) {
      const targets = model.targetsFor(attemptKey);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first || !last) continue;

      // EVERY note of the attempt, not just the visible ones: an actor anchored
      // to a note needs a coordinate after that note has scrolled off, or a
      // climber loses its footing at the left edge.
      const placed: PlacedNote[] = targets.map((note) => {
        const rect = this.#targetRect(note, nowBeat);
        return {
          id: note.id,
          opportunityIndex: note.opportunityIndex,
          lane: note.lane,
          duration: note.duration,
          outcome: note.outcome,
          // Normalised to the PLAYFIELD across and the LANE BAND down, so a
          // note's rect and a sprite's y are in the same space and an actor can
          // stand on a bar. Both may leave 0..1; only the playfield clips.
          rect: {
            x: (rect.x - this.#playLeft) / this.#playWidth,
            y: (rect.y - top) / band,
            w: rect.w / this.#playWidth,
            h: rect.h / band,
          },
          beatsUntilStrike: note.startBeat - nowBeat,
        };
      });

      // The attempt's own measures, rounded out to measure lines, which is what
      // lets two backgrounds meet on one rather than overlap mid-bar.
      const fromBeat = Math.floor(first.startBeat / BEATS_PER_MEASURE) * BEATS_PER_MEASURE;
      const toBeat =
        Math.ceil((last.startBeat + last.durationBeats) / BEATS_PER_MEASURE) * BEATS_PER_MEASURE;
      const measureWidth = (BEATS_PER_MEASURE * this.#pixelsPerBeat) / this.#playWidth;

      const stage = stageFor(attemptKey, {
        beat: nowBeat - model.attemptStartBeat(attemptKey),
        notes: placed,
        laneCount: LANE_COUNT,
        strikeX: (this.#strikeX - this.#playLeft) / this.#playWidth,
        span: {
          from: (this.#x(fromBeat, nowBeat) - this.#playLeft) / this.#playWidth,
          to: (this.#x(toBeat, nowBeat) - this.#playLeft) / this.#playWidth,
        },
        measure: { width: measureWidth, beatWidth: measureWidth / BEATS_PER_MEASURE },
      });
      if (stage) resolved.set(attemptKey, stage);
    }
    return resolved;
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
    width: number,
    dim = 1
  ): void {
    const image = this.#assets?.get(art.assetId);
    if (!image) return;
    const ctx = this.#ctx;
    const h = this.#rowHeight * (art.scale ?? 1);
    const w = image.width * (h / image.height);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, art.opacity ?? 1)) * dim;
    ctx.drawImage(image, x + width / 2 - w / 2, y - h / 2, w, h);
    ctx.restore();
  }

  /** The space a minigame's sprites are placed in. See `stage-layer.ts`. */
  get #stageGeometry(): StageGeometry {
    return {
      playLeft: this.#playLeft,
      playWidth: this.#playWidth,
      bandTop: this.#bandTop,
      bandHeight: this.#bandHeight,
      paneHeight: this.#height,
    };
  }

  /**
   * One layer of every on-screen minigame's own art.
   *
   * Attempts are drawn in the order the model holds them, so around a handover
   * the outgoing scenario's actors sit behind the incoming one's rather than
   * fighting for the same z. Within an attempt the family's own `z` decides,
   * which is the only ordering it gets to ask for.
   */
  #drawStage(stages: ReadonlyMap<string, Stage>, layer: Layer): void {
    const images = this.#assets;
    if (!images || stages.size === 0) return;

    const ctx = this.#ctx;
    ctx.save();
    // The same clip the bars and the note art get: a sprite may bleed as far
    // above or below the lanes as it likes and still never reach the gutter.
    this.#clipPlayfield();
    const geometry = this.#stageGeometry;
    for (const stage of stages.values()) {
      if (stage.sprites && stage.sprites.length > 0) {
        drawStageSprites(ctx, stage.sprites, layer, geometry, images);
      }
    }
    ctx.restore();
  }

  /**
   * PROTOTYPE: whichever character this scenario puts on the bars. It hops
   * pitch lanes, so it only means anything on an axis that is pitch — which
   * Key View, now the only presentation, always is.
   */
  #drawActor(snapshot: TimelineSnapshot, nowBeat: number): void {
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
      // A can rides in every bar that has not been judged yet — including one
      // that is already past the strike line but still inside its window, so a
      // late hit or an expiring miss hands its can over without it blinking
      // out at the line and back in a moment later. Once the note is judged the
      // performer's own state owns that can, so the two never draw one twice.
      const pending = snapshot.targets
        .filter((note) => note.outcome === null)
        .map((note) => ({
          x: this.#x(note.startBeat, nowBeat),
          y: geometry.laneY(note.lane),
        }));
      drawRepeatPerformer(
        ctx,
        repeat,
        { ...geometry, pixelsPerBeat: this.#pixelsPerBeat },
        this.#actorBeat,
        pending,
        this.#repeatSprites
      );
    } else if (actor) {
      drawTimelineActor(ctx, actor, geometry, this.#actorBeat, this.#actorSprites);
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
   * Which triad tone a Key View row is, if any.
   *
   * Lane index is `octaveBand * 7 + (degree - 1)` (`music/degrees.ts`), so
   * degree 1 (root) always falls on `row % 7 === 0`, degree 3 on `row % 7 === 2`
   * and degree 5 on `row % 7 === 4`, in every octave band and every key — this
   * needs no key lookup, unlike the label text next to it. In a minor key the
   * third is `b3` and the fifth is still `5`; both are the same lanes, which is
   * exactly why lane index rather than pitch is the right thing to test.
   */
  #rowAccent(row: number): "root" | "third" | "fifth" | null {
    switch (row % 7) {
      case 0:
        return "root";
      case 2:
        return "third";
      case 4:
        return "fifth";
      default:
        return null;
    }
  }

  #drawRows(): void {
    const ctx = this.#ctx;
    for (let row = 0; row < this.#rowCount; row += 1) {
      const y = this.#rowY(row);
      const accent = this.#rowAccent(row);

      // The band first: the row is the strip a note bar occupies, centred on
      // the line, so the accent has to be the strip and not just its edge.
      const band = accent && ROW_BAND[accent];
      if (band) {
        ctx.fillStyle = band;
        ctx.fillRect(
          this.#playLeft,
          y - this.#noteHeight / 2,
          this.#width - this.#playLeft,
          this.#noteHeight
        );
      }

      ctx.strokeStyle = accent ? ROW_LINE[accent] : THEME.laneLine;
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
      const accent = this.#rowAccent(row);
      const label = laneLabel(row, this.#key);
      const fingering = this.#fingering?.positions[row];
      ctx.fillStyle = accent ? ROW_TEXT[accent] : THEME.laneText;
      // Bold marks the root only — it stays the one landmark you can find
      // without reading colour at all. The third and fifth are colour-only,
      // which is what keeps them reading as accents under it rather than as
      // three equal landmarks.
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
   * A target: one bar, the same shape in both views.
   *
   * It fills its row from halfway to the row above to halfway to the row below,
   * so a step from one note to the next reads as two blocks whose corners meet
   * — the contour of the phrase is the silhouette, before you read a single
   * label. Only a hairline separates adjacent rows, and the corner radius is
   * small for the same reason: rounded ends would open a visible gap exactly
   * where the eye is tracking the line.
   *
   * A minigame's note art composes around this bar rather than replacing it:
   * the body stretches to the rect exactly, so duration stays honest whatever
   * is drawn over and under it.
   */
  /**
   * Where one target's bar goes, in canvas pixels.
   *
   * Computed once and used twice — to draw the bar, and as the rect handed to
   * the minigame. Two computations could drift, and a skin anchored to a rect
   * the host does not actually draw on is exactly the visual ambiguity the
   * host-owned-geometry rule exists to prevent.
   */
  #targetRect(note: TargetNote, nowBeat: number): { x: number; y: number; w: number; h: number } {
    const h = this.#noteHeight;
    return {
      x: this.#x(note.startBeat, nowBeat),
      y: this.#rowY(note.lane) - h / 2,
      w: Math.max(6, note.durationBeats * this.#pixelsPerBeat - 2),
      h,
    };
  }

  #drawTarget(note: TargetNote, nowBeat: number, art?: NoteArt): void {
    const ctx = this.#ctx;
    const rect = this.#targetRect(note, nowBeat);
    const { x, w: width, h: height } = rect;
    // The vertical centre of the row, which is what the art slots are centred
    // on — a crag wider than its bar hangs off both ends of it symmetrically.
    const y = rect.y + height / 2;
    const colour = this.#outcomeColour(note);

    ctx.save();
    // The one clip a skin cannot escape. Ornament may bleed past the note as
    // far as it likes and still never reach the gutter labels.
    this.#clipPlayfield();

    const missed = note.outcome === "miss";
    if (art?.underlay) this.#drawNoteArt(art.underlay, x, y, width, missed ? 0.4 : 1);

    const body = art?.body && !missed ? this.#assets?.get(art.body.assetId) : null;
    if (missed) {
      // A missed note is an empty frame: the outline of what should have been
      // played, with nothing in it. Whatever skin the family gave the bar goes
      // too — an outlined ledge that still looks like a ledge is not a miss.
      ctx.strokeStyle = THEME.miss;
      ctx.lineWidth = 1.5;
      this.#roundRect(x + 0.75, rect.y + 0.75, width - 1.5, height - 1.5, 2);
      ctx.stroke();
    } else if (body) {
      // Stretched to the rect exactly, so note duration stays honest whatever
      // is drawn around it.
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, art?.body?.opacity ?? 1));
      ctx.drawImage(body, x, rect.y, width, height);
      ctx.restore();
    } else {
      ctx.fillStyle = colour;
      this.#roundRect(x, rect.y, width, height, 2);
      ctx.fill();
      ctx.strokeStyle =
        note.outcome === "good" ? THEME.goodEdge : note.outcome ? colour : THEME.targetEdge;
      ctx.lineWidth = 1;
      this.#roundRect(x + 0.5, rect.y + 0.5, width - 1, height - 1, 2);
      ctx.stroke();
    }

    // The colour language survives any skin.
    //
    // Applied whether or not the note has been judged, because "an upcoming
    // target" is a state the player reads at a glance too — a skin that turned
    // every note to stone and left only the judged ones coloured would make the
    // thing you are about to play the *least* visible object on the timeline.
    // A minigame that wants full control supplies an opaque body per outcome
    // and paints over this.
    if (body) {
      ctx.globalAlpha = JUDGMENT_WASH;
      ctx.fillStyle = colour;
      ctx.fillRect(x, rect.y, width, height);
      ctx.globalAlpha = 1;
    }

    if (art?.overlay) this.#drawNoteArt(art.overlay, x, y, width, missed ? 0.4 : 1);

    ctx.restore();
  }

  /**
   * The glint on a Perfect note. See `gleam.ts` for the timing; this is only
   * the drawing — a four-point sparkle in the bar's top-right corner and a
   * sheen across it, both scaled by how bright the glint is right now.
   */
  #drawGleam(
    note: TargetNote,
    rect: { x: number; y: number; w: number; h: number },
    nowBeat: number
  ): void {
    const intensity = gleamIntensity(note.id, nowBeat);
    if (intensity <= 0) return;
    const ctx = this.#ctx;
    const right = rect.x + rect.w;
    if (right < this.#playLeft || rect.x > this.#width) return;

    ctx.save();
    // The sheen: a soft diagonal band sweeping the bar, brightest at the peak.
    ctx.globalAlpha = 0.35 * intensity;
    ctx.fillStyle = "#fff6c4";
    const band = Math.max(3, rect.h * 0.5);
    const sweep = rect.x + rect.w * (1 - intensity) - band;
    ctx.beginPath();
    ctx.moveTo(sweep, rect.y + rect.h);
    ctx.lineTo(sweep + band, rect.y + rect.h);
    ctx.lineTo(sweep + band + rect.h * 0.6, rect.y);
    ctx.lineTo(sweep + rect.h * 0.6, rect.y);
    ctx.closePath();
    ctx.save();
    this.#roundRect(rect.x, rect.y, rect.w, rect.h, 2);
    ctx.clip();
    ctx.fill();
    ctx.restore();

    // The sparkle, tucked inside the bar's top-right corner: white core on a
    // gold halo, never larger than the corner it sits in.
    const size = rect.h * (0.22 + 0.14 * intensity);
    const cx = right - rect.h * 0.34;
    const cy = rect.y + rect.h * 0.3;
    ctx.globalAlpha = Math.min(1, 0.55 + 0.45 * intensity);
    ctx.fillStyle = THEME.perfect;
    drawSparkle(ctx, cx, cy, size * 1.2);
    ctx.fillStyle = "#fffbe6";
    drawSparkle(ctx, cx, cy, size * 0.75);
    ctx.restore();
  }

  #drawPlayed(note: PlayedNote, nowBeat: number): void {
    const ctx = this.#ctx;
    const endBeat = note.endBeat ?? nowBeat;
    let x = this.#x(note.startBeat, nowBeat);
    let width = Math.max(4, (endBeat - note.startBeat) * this.#pixelsPerBeat);
    const colour = this.#outcomeColour(note);
    const target = note.target
      ? this.#targetsByOpportunity.get(`${note.target.attemptKey}/${note.target.opportunityIndex}`)
      : undefined;
    const targetRect = target ? this.#targetRect(target, nowBeat) : null;

    // A Perfect sits flush with the note it landed in: same left edge, same
    // right edge. That is the whole message — "exactly that" — and it is what
    // makes a gold bar with a white centre read as the best possible result.
    if (this.#snapPerfectPlayed && note.outcome === "perfect" && targetRect) {
      x = targetRect.x;
      width = targetRect.w;
    }

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
        // A Good is outlined where it overlaps its grey note: the played bar
        // looks a little thicker inside the bar, which is the "you got there,
        // roughly" read that green never carried.
        if (note.outcome === "good" && targetRect) {
          const left = Math.max(x, targetRect.x);
          const right = Math.min(x + width, targetRect.x + targetRect.w);
          if (right - left > 2) {
            ctx.strokeStyle = THEME.played;
            ctx.lineWidth = 2;
            ctx.strokeRect(left + 1, y - height / 2 - 1, right - left - 2, height + 2);
          }
        }
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
