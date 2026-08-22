/**
 * Draws the `RepeatMinigame` performer — the can crusher standing on one bar
 * while the player throws cans at him.
 *
 * PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 *
 * The one idea this layer exists to test: **a can travels with the timeline.**
 * It is born in the note bar at the strike line, on the lane the player
 * actually played, and from there it scrolls left at exactly the speed the bars
 * scroll — so it stays inside its note rather than being a separate object
 * flying over it. The crusher stands at one lane. A can on his lane reaches his
 * hands and is flattened; a can on any other lane sails past at its own height
 * and he never touches it. Nothing about that needs explaining in words the
 * first time a player overshoots by a third and watches the can go over his
 * head.
 *
 * Same drawing budget and same reasoning as `actor-layer.ts`: primitives, not
 * sprites, because the question is whether the mechanic reads.
 */

import type { RepeatVisualState } from "../../scenario/minigames/repeat-minigame.js";
import type { ActorGeometry } from "./actor-layer.js";

const CRUSHER = {
  skin: "#e8b892",
  skinShade: "#b98a66",
  vest: "#e86a6a",
  band: "#f8dc60",
  hair: "#3a2b26",
  can: "#dfe4ec",
  canDark: "#8c93a3",
  canLabel: "#e05a5a",
  spark: "#fff2b8",
  pile: "rgba(223,228,236,0.75)",
  outline: "#151a20",
} as const;

/**
 * Where the crusher stands, in **beats** left of the strike line.
 *
 * Not a pixel offset, because what it really buys is time: a can placed at the
 * strike line takes this long to reach him, and that flight is the whole read.
 * At 34px — where the climbing actor stands — the flight is under a third of a
 * beat and the crush is over before the eye finds it. A beat and a bit is long
 * enough to watch a can go past his head and know why.
 */
const STANDS_BACK_BEATS = 1.2;

/** How long the flattening reads for, in beats, once a can reaches him. */
const CRUSH_BEATS = 0.3;

export type RepeatGeometry = ActorGeometry & {
  /** Timeline scroll speed. A can travels at exactly this speed. */
  pixelsPerBeat: number;
};

/**
 * A can riding in a note bar that has not been played yet, already positioned
 * by the caller — the note bars and the actor layer count beats differently
 * (absolute transport against attempt-relative), and resolving that once at the
 * call site beats passing two clocks into a drawing function.
 */
export type PendingCan = { x: number; y: number };

export function drawRepeatPerformer(
  ctx: CanvasRenderingContext2D,
  state: RepeatVisualState,
  geometry: RepeatGeometry,
  beat: number,
  pending: readonly PendingCan[] = []
): void {
  const travelPx = STANDS_BACK_BEATS * geometry.pixelsPerBeat;
  const homeX = geometry.strikeX - travelPx;
  const homeY = geometry.laneY(state.performerLane);
  const canSize = geometry.rowHeight * 0.7;

  drawPile(ctx, state.pile, homeX, geometry);
  drawCrusher(
    ctx,
    homeX,
    homeY,
    geometry.rowHeight,
    beat - state.lastCrushBeat - STANDS_BACK_BEATS,
    state.complete && state.passed
  );

  // Cans still approaching the strike line, sitting in the bars they belong to.
  // The container premise, drawn: a note *is* a can coming at you.
  for (const can of pending) drawCan(ctx, can.x, can.y, canSize, false, 0);

  // Cans the player has placed, travelling left with the timeline at exactly
  // the speed the bars scroll, so a can never drifts out of its own note.
  for (const can of state.cans) {
    const age = Math.max(0, beat - can.bornBeat);
    const x = geometry.strikeX - age * geometry.pixelsPerBeat;
    if (!can.crushed) {
      // Off his lane: it keeps going at its own height, past his head, and
      // wobbles if the input was not a pitch that could be placed at all.
      const tilt = can.wobbly ? Math.sin(age * 9 + can.id) * 0.4 : 0;
      drawCan(ctx, x, geometry.laneY(can.lane), canSize, false, tilt);
      continue;
    }
    const sinceContact = age - STANDS_BACK_BEATS;
    if (sinceContact < 0) {
      drawCan(ctx, x, homeY, canSize, false, 0);
    } else if (sinceContact < CRUSH_BEATS) {
      drawCan(ctx, homeX, homeY, canSize, true, 0);
      drawSpark(ctx, homeX, homeY - canSize * 0.4, canSize * (1 - sinceContact / CRUSH_BEATS));
    }
    // After that it belongs to the pile, which is drawn from the count.
  }
}

/**
 * The performer.
 *
 * Two poses from one body — arms up ready, arms down crushing — which is the
 * same trick the placeholder sprites use, so this prototype and the art it will
 * be replaced by are describing the same character.
 */
function drawCrusher(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  rowHeight: number,
  sinceCrush: number,
  triumphant: boolean
): void {
  const swinging = sinceCrush >= 0 && sinceCrush < CRUSH_BEATS;
  const h = rowHeight * 1.25;
  const w = h * 0.5;

  ctx.save();
  ctx.translate(x, baseY);

  // Legs and torso. He stands ON the bar, like the goat does.
  ctx.fillStyle = CRUSHER.skinShade;
  ctx.fillRect(-w * 0.28, -h * 0.34, Math.max(1, w * 0.16), h * 0.34);
  ctx.fillRect(w * 0.12, -h * 0.34, Math.max(1, w * 0.16), h * 0.34);

  ctx.fillStyle = CRUSHER.vest;
  ctx.fillRect(-w * 0.34, -h * 0.72, w * 0.68, h * 0.4);

  // Head, headband, hair.
  const headR = w * 0.3;
  const headY = -h * 0.86;
  ctx.fillStyle = CRUSHER.skin;
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CRUSHER.hair;
  ctx.fillRect(-headR, headY - headR * 1.1, headR * 2, headR * 0.55);
  ctx.fillStyle = CRUSHER.band;
  ctx.fillRect(-headR, headY - headR * 0.55, headR * 2, headR * 0.4);

  // Arms: up and open when waiting, down and closed on the beat he crushes,
  // straight up when the attempt is over and he passed.
  ctx.strokeStyle = CRUSHER.skin;
  ctx.lineWidth = Math.max(1.5, w * 0.16);
  ctx.lineCap = "round";
  const shoulderY = -h * 0.68;
  const reach = triumphant ? -h * 0.55 : swinging ? -h * 0.62 : -h * 0.95;
  const spread = triumphant ? w * 0.75 : swinging ? w * 0.3 : w * 0.55;
  ctx.beginPath();
  ctx.moveTo(-w * 0.32, shoulderY);
  ctx.lineTo(-spread, shoulderY + reach + h * 0.62);
  ctx.moveTo(w * 0.32, shoulderY);
  ctx.lineTo(spread, shoulderY + reach + h * 0.62);
  ctx.stroke();

  ctx.restore();
}

/** One can. Upright and tall, or dealt with and squat. */
function drawCan(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  size: number,
  crushed: boolean,
  tilt: number
): void {
  const w = crushed ? size * 0.9 : size * 0.52;
  const h = crushed ? size * 0.3 : size;

  ctx.save();
  ctx.translate(x, baseY);
  if (tilt !== 0) ctx.rotate(tilt);

  // An outline first: a can spends most of its flight sitting on a bright note
  // bar, and a pale grey cylinder on a cyan rectangle is not a can.
  ctx.fillStyle = CRUSHER.outline;
  ctx.fillRect(-w / 2 - 1.5, -h - 1.5, w + 3, h + 3);

  ctx.fillStyle = CRUSHER.can;
  ctx.fillRect(-w / 2, -h, w, h);
  ctx.fillStyle = CRUSHER.canDark;
  ctx.fillRect(-w / 2, -h, w, Math.max(1, h * 0.14));
  ctx.fillRect(-w / 2, -Math.max(1, h * 0.14), w, Math.max(1, h * 0.14));
  ctx.fillStyle = CRUSHER.canLabel;
  ctx.fillRect(-w / 2, -h * 0.62, w, Math.max(1, h * 0.28));

  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  if (r <= 0) return;
  ctx.save();
  ctx.strokeStyle = CRUSHER.spark;
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.moveTo(x + Math.cos(angle) * r * 0.4, y + Math.sin(angle) * r * 0.4);
    ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The pile of crushed cans, on the floor strip below the lane band.
 *
 * This is the REPEAT theme's answer to the goat's size: the accumulating record
 * of the attempt, sitting where the fallen goats sit in a climb, so the same
 * strip of screen always means "what this attempt has produced so far".
 */
function drawPile(
  ctx: CanvasRenderingContext2D,
  pile: number,
  homeX: number,
  geometry: ActorGeometry
): void {
  if (pile === 0) return;
  const unit = geometry.rowHeight * 0.34;
  const perRow = 8;

  ctx.save();
  ctx.fillStyle = CRUSHER.pile;
  for (let i = 0; i < pile; i += 1) {
    const row = Math.floor(i / perRow);
    const column = i % perRow;
    // Each row is inset, so a long attempt builds a heap rather than a wall.
    const x = homeX - unit * (perRow / 2) + column * unit + row * unit * 0.5;
    const y = geometry.floorY - row * unit * 0.55;
    ctx.fillRect(x, y - unit * 0.34, unit * 0.9, unit * 0.34);
  }
  ctx.restore();
}
