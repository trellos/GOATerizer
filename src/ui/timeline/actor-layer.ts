/**
 * Draws the timeline actor — the goat standing on the note bars.
 *
 * PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md`.
 *
 * Three placement rules, all of them load-bearing:
 *
 *   1. **Just left of the strike line, never right of it.** The strike line is
 *      the instant of input, so an actor sitting after it reads as a
 *      consequence of the player's timing rather than a prediction of it. An
 *      actor at or right of the line would also occlude the read-ahead zone
 *      with the single most attention-stealing object on screen.
 *   2. **On top of its bar**, so a scale run is visibly a staircase being
 *      climbed rather than a character floating past some rectangles.
 *   3. **Fallen actors below the lane band**, small and dim. They are the
 *      failure channel and a passive histogram of the attempt — during a bad
 *      patch there is no live actor at all, and an empty screen exactly when
 *      the player is struggling is the wrong feedback.
 *
 * Drawn with primitives rather than sprites: this is a prototype whose point is
 * whether the *mechanic* reads, and a placeholder goat that can be reshaped in
 * one function is worth more here than an asset pipeline.
 */

import type { TimelineActorState } from "../../scenario/minigames/timeline-actor.js";

const ACTOR = {
  body: "#efe6d4",
  bodyDim: "rgba(239,230,212,0.35)",
  horn: "#c0a678",
  eye: "#2a2118",
  spark: "#ffd34d",
} as const;

/** Where the actor sits relative to the strike line, in bar-widths. */
const LEFT_OF_STRIKE_PX = 34;

/** How long the landing hop takes, in beats. */
const HOP_BEATS = 0.28;

export type ActorGeometry = {
  /** Canvas y for a lane, continuous — same mapping the notes use. */
  laneY: (lane: number) => number;
  strikeX: number;
  rowHeight: number;
  /** Bottom of the lane band; fallen actors live under it. */
  floorY: number;
};

/**
 * Renders the live actor and whatever has fallen off it.
 *
 * @param beat attempt-relative beat, for the hop arc and the floor's idle
 * animation. Derived from the transport every frame, never accumulated.
 */
export function drawTimelineActor(
  ctx: CanvasRenderingContext2D,
  state: TimelineActorState,
  geometry: ActorGeometry,
  beat: number
): void {
  drawFallen(ctx, state, geometry, beat);
  if (!state.alive || state.lane === null) return;

  const x = geometry.strikeX - LEFT_OF_STRIKE_PX;
  // Base size is a fraction of a row, so the actor scales with the timeline
  // rather than being a fixed number of pixels on every viewport.
  const scale = geometry.rowHeight * (0.5 + state.size * 1.0);

  // The hop: a parabola between the lane it left and the lane it landed on,
  // resolved from the beat rather than a frame counter, so a dropped frame
  // moves nothing.
  const sinceLanding = Math.max(0, beat - state.landedBeat);
  const t = Math.min(1, sinceLanding / HOP_BEATS);
  const fromY = geometry.laneY(state.fromLane ?? state.lane);
  const toY = geometry.laneY(state.lane);
  const y = fromY + (toY - fromY) * t - Math.sin(t * Math.PI) * geometry.rowHeight * 0.55;

  // Between notes, lean at the lane the next one is on. Same animation budget
  // as an idle, and it points at what is coming.
  const lean =
    state.nextLane !== null && t >= 1
      ? Math.max(-1, Math.min(1, (geometry.laneY(state.nextLane) - toY) / (geometry.rowHeight * 3)))
      : 0;

  drawGoat(ctx, x, y, scale, -lean, state.decorations);
}

/**
 * A placeholder goat, from primitives.
 *
 * Deliberately crude and deliberately one function: the question this prototype
 * answers is whether a character standing on the note bars reads at all, and
 * that is not a question better art changes the answer to.
 */
function drawGoat(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  scale: number,
  lean: number,
  decorations: number
): void {
  const w = scale * 0.9;
  const h = scale * 0.62;

  ctx.save();
  ctx.translate(x, baseY);
  ctx.rotate(lean * 0.18);

  // Body, sitting ON the bar: the bar's top edge is the ground.
  ctx.fillStyle = ACTOR.body;
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.75, w * 0.5, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs.
  ctx.fillRect(-w * 0.3, -h * 0.42, Math.max(1, w * 0.1), h * 0.42);
  ctx.fillRect(w * 0.16, -h * 0.42, Math.max(1, w * 0.1), h * 0.42);

  // Head, forward — it is looking where it is going.
  const headX = w * 0.42;
  const headY = -h * 1.12;
  ctx.beginPath();
  ctx.ellipse(headX, headY, w * 0.24, h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Horns, which is most of what makes the silhouette read as a goat at 20px.
  ctx.strokeStyle = ACTOR.horn;
  ctx.lineWidth = Math.max(1, scale * 0.07);
  ctx.beginPath();
  ctx.moveTo(headX - w * 0.04, headY - h * 0.2);
  ctx.quadraticCurveTo(headX + w * 0.2, headY - h * 0.6, headX + w * 0.32, headY - h * 0.2);
  ctx.stroke();

  ctx.fillStyle = ACTOR.eye;
  ctx.beginPath();
  ctx.arc(headX + w * 0.1, headY, Math.max(0.8, scale * 0.035), 0, Math.PI * 2);
  ctx.fill();

  // Beard, because a goat without one is a sheep.
  ctx.fillStyle = ACTOR.body;
  ctx.beginPath();
  ctx.moveTo(headX + w * 0.06, headY + h * 0.2);
  ctx.lineTo(headX + w * 0.2, headY + h * 0.2);
  ctx.lineTo(headX + w * 0.12, headY + h * 0.5);
  ctx.closePath();
  ctx.fill();

  // Decorations: earned past the size cap, so a long streak still registers
  // once growing has stopped.
  ctx.fillStyle = ACTOR.spark;
  for (let i = 0; i < decorations; i += 1) {
    const angle = -Math.PI * 0.75 + i * 0.42;
    drawStar(ctx, Math.cos(angle) * w * 0.85, -h * 0.8 + Math.sin(angle) * h * 0.9, scale * 0.13);
  }

  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * The floor of fallen actors.
 *
 * They mill — a slow horizontal drift keyed off the beat and their own id, so
 * the floor is visibly alive rather than a row of corpses. This is what fills
 * the screen during a bad patch, which is exactly when the live actor is absent.
 */
function drawFallen(
  ctx: CanvasRenderingContext2D,
  state: TimelineActorState,
  geometry: ActorGeometry,
  beat: number
): void {
  if (state.fallen.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ACTOR.bodyDim;

  state.fallen.forEach((actor, index) => {
    const spread = geometry.rowHeight * 1.6;
    const wander = Math.sin(beat * 0.6 + actor.id * 1.7) * geometry.rowHeight * 0.35;
    const x = geometry.strikeX - LEFT_OF_STRIKE_PX - spread + index * spread * 0.42 + wander;
    const scale = geometry.rowHeight * (0.34 + actor.size * 0.3);
    drawGoat(ctx, x, geometry.floorY, scale, 0, 0);
  });

  ctx.restore();
}
