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
 * The goat itself is the scenario's own `climberPoses[]` art, cycled one pose
 * per landing exactly as the old scenario panel cycled it. An earlier pass drew
 * it from canvas primitives on the argument that the prototype was testing the
 * mechanic rather than the art — but the art already existed, is the right pixel
 * density, and a crude ellipse-and-horns goat beside a pixel-art backdrop reads
 * as a bug rather than as a placeholder. The primitives survive only as the
 * fallback for an asset that failed to load.
 */

import type { TimelineActorState } from "../../scenario/minigames/timeline-actor.js";

const ACTOR = {
  fallback: "#efe6d4",
  spark: "#ffd34d",
} as const;

/** Where the actor sits relative to the strike line, in bar-widths. */
const LEFT_OF_STRIKE_PX = 34;

/** How long the landing hop takes, in beats. */
const HOP_BEATS = 0.28;

/**
 * The scenario's climber art: a pose cycle, one pose per successful note.
 *
 * Passed in already resolved rather than looked up here — this module has no
 * business knowing about asset ids or the store, and the caller already holds
 * both.
 */
export type ActorSprites = {
  poses: readonly HTMLImageElement[];
};

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
  beat: number,
  sprites: ActorSprites
): void {
  drawFallen(ctx, state, geometry, beat, sprites);
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

  // One pose per landing, so consecutive steps do not look identical. Keyed off
  // the streak rather than a counter of its own: the streak is already the
  // number of steps this actor has taken.
  drawGoat(ctx, x, y, scale, -lean, poseFor(sprites, state.streak), state.decorations);
}

function poseFor(sprites: ActorSprites, step: number): HTMLImageElement | null {
  const poses = sprites.poses;
  if (poses.length === 0) return null;
  return poses[Math.abs(step) % poses.length] ?? null;
}

/**
 * The goat, standing on the bar.
 *
 * Drawn bottom-anchored: the bar's top edge is the ground, which is what makes
 * a scale run read as a staircase rather than as a sprite tracking a line.
 */
function drawGoat(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  scale: number,
  lean: number,
  pose: HTMLImageElement | null,
  decorations: number
): void {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.rotate(lean * 0.18);

  if (pose && pose.width > 0) {
    const height = scale * 0.72;
    const width = height * (pose.width / pose.height);
    ctx.drawImage(pose, -width / 2, -height, width, height);
  } else {
    // The asset failed to load. A block is honest about that; inventing a goat
    // here would hide a missing file behind something that looks deliberate.
    ctx.fillStyle = ACTOR.fallback;
    ctx.fillRect(-scale * 0.3, -scale * 0.55, scale * 0.6, scale * 0.55);
  }

  // Decorations: earned past the size cap, so a long streak still registers
  // once growing has stopped.
  ctx.fillStyle = ACTOR.spark;
  for (let i = 0; i < decorations; i += 1) {
    const angle = -Math.PI * 0.75 + i * 0.42;
    drawStar(
      ctx,
      Math.cos(angle) * scale * 0.7,
      -scale * 0.5 + Math.sin(angle) * scale * 0.55,
      scale * 0.13
    );
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
  beat: number,
  sprites: ActorSprites
): void {
  if (state.fallen.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.5;

  state.fallen.forEach((actor, index) => {
    const spread = geometry.rowHeight * 1.6;
    const wander = Math.sin(beat * 0.6 + actor.id * 1.7) * geometry.rowHeight * 0.35;
    const x = geometry.strikeX - LEFT_OF_STRIKE_PX - spread + index * spread * 0.42 + wander;
    const scale = geometry.rowHeight * (0.34 + actor.size * 0.3);
    drawGoat(ctx, x, geometry.floorY, scale, 0, poseFor(sprites, actor.id), 0);
  });

  ctx.restore();
}
