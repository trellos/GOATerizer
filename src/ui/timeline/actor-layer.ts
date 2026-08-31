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
  dust: "#f0e6d0",
  ring: "#fff4cf",
  shadow: "rgba(0,0,0,0.38)",
} as const;

/** Where the actor sits relative to the strike line, in bar-widths. */
const LEFT_OF_STRIKE_PX = 34;

/** How long the landing hop takes, in beats. */
const HOP_BEATS = 0.28;

/**
 * How big the goat is, as a multiple of a lane row: floor, plus what the streak
 * buys.
 *
 * Roughly doubled from the first pass, which put a fresh actor at half a row.
 * At that size it was smaller than the note bars it stands on and lost against
 * a pixel-art backdrop with its own moving parts — the one object on screen
 * that is *about the player* was the one hardest to find. A goat at max streak
 * now stands about one and a half rows, which is large enough to be the
 * subject of the frame and still short of the read-ahead zone, which it sits
 * left of anyway.
 */
const SIZE_FLOOR_ROWS = 0.95;
const SIZE_STREAK_ROWS = 1.35;

/**
 * The landing, as squash and stretch.
 *
 * `LAND_SQUASH` is how far it compresses on contact, `LAND_DECAY` how quickly
 * that dies away in beats, and `LAND_WOBBLE` the rate of the bounce underneath
 * the decay — about one full oscillation before it is gone, so it reads as a
 * body absorbing an impact rather than as a wobble effect. `STRETCH` is the
 * opposite, applied in the air: a thing moving fast vertically elongates.
 *
 * All of it is resolved from `beat - landedBeat`, never accumulated, so a
 * dropped frame moves nothing — the same rule the hop arc already followed.
 */
const STRETCH = 0.16;
const LAND_SQUASH = 0.22;
const LAND_DECAY = 0.18;
const LAND_WOBBLE = 22;

/** How long the dust and the impact ring last, in beats. */
const DUST_BEATS = 0.55;
const RING_BEATS = 0.3;
const DUST_MOTES = 7;

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
  const scale = geometry.rowHeight * (SIZE_FLOOR_ROWS + state.size * SIZE_STREAK_ROWS);

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

  // Everything that marks the arrival is drawn at the lane it landed on and
  // under the goat, so it reads as kicked up by the landing rather than as
  // something stuck to the sprite.
  const land = Math.max(0, sinceLanding - HOP_BEATS);
  if (t >= 1) {
    drawLandingRing(ctx, x, toY, scale, land);
    drawLandingDust(ctx, x, toY, scale, land, state.streak);
  }

  // One pose per landing, so consecutive steps do not look identical. Keyed off
  // the streak rather than a counter of its own: the streak is already the
  // number of steps this actor has taken.
  drawGoat(ctx, x, y, scale, -lean, poseFor(sprites, state.streak), state.decorations, {
    squash: squashAt(t, land),
    grounded: t >= 1,
  });
}

/**
 * How compressed the body is: negative in the air, positive on contact.
 *
 * In flight it stretches along the direction of travel, peaking at the apex
 * where it is moving fastest. On contact it compresses hard and springs back
 * through a damped oscillation, which is the part that actually reads as
 * weight — a landing without it is a sprite that stops.
 */
function squashAt(hop: number, land: number): number {
  if (hop < 1) return -STRETCH * Math.sin(hop * Math.PI);
  return LAND_SQUASH * Math.exp(-land / LAND_DECAY) * Math.cos(land * LAND_WOBBLE);
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
  decorations: number,
  juice: { squash: number; grounded: boolean } = { squash: 0, grounded: true }
): void {
  ctx.save();
  ctx.translate(x, baseY);

  // A contact shadow, and it widens exactly as the body squashes. Two jobs: it
  // plants the goat on the bar instead of letting it float a pixel above one,
  // and it is a second channel carrying the same impact the body is — which is
  // what stops a landing from depending on catching one frame of squash.
  if (juice.grounded) {
    const spread = 1 + Math.max(0, juice.squash) * 1.4;
    ctx.fillStyle = ACTOR.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 0, scale * 0.3 * spread, scale * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(lean * 0.18);
  // Volume-preserving: what it loses in height it gains in width, which is what
  // separates squash from simply being scaled down for a moment. Clamped so a
  // pathological beat delta cannot invert or collapse the sprite.
  const sy = Math.max(0.35, 1 - juice.squash);
  ctx.scale(1 / sy, sy);

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

/**
 * The ring that goes out from under the feet on contact.
 *
 * Flat — a wide, shallow ellipse rather than a circle — because it is meant to
 * be read as travelling across the top of the bar the goat is standing on. A
 * circular ring at this size reads as a bubble around the character instead.
 */
function drawLandingRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  land: number
): void {
  if (land >= RING_BEATS) return;
  const t = land / RING_BEATS;
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.75;
  ctx.strokeStyle = ACTOR.ring;
  ctx.lineWidth = Math.max(1, scale * 0.05 * (1 - t));
  ctx.beginPath();
  ctx.ellipse(x, y, scale * (0.2 + t * 0.75), scale * (0.05 + t * 0.16), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Dust off the bar, kicked outward and slightly up.
 *
 * The motes are placed from the streak rather than from a random seed or any
 * stored particle state: the same landing draws the same dust on every frame
 * and after any dropped frame, which keeps this on the same footing as
 * everything else here — position is a pure function of the beat.
 */
function drawLandingDust(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  land: number,
  streak: number
): void {
  if (land >= DUST_BEATS) return;
  const t = land / DUST_BEATS;
  ctx.save();
  ctx.globalAlpha = (1 - t) * (1 - t) * 0.8;
  ctx.fillStyle = ACTOR.dust;
  for (let i = 0; i < DUST_MOTES; i += 1) {
    // Spread across the two lower quadrants, alternating sides so the puff is
    // symmetrical about the feet however few motes there are.
    const side = i % 2 === 0 ? 1 : -1;
    const spin = (i * 2.399 + streak * 0.7) % 1;
    const angle = side * (0.35 + spin * 0.9);
    // Starts already clear of the boots and stays low. The first version began
    // at a tenth of a body width and rose a fifth of one, which put half the
    // puff behind the goat — the motes that were meant to read as spray came
    // out on one side only, because the other side was inside the sprite.
    const reach = scale * (0.22 + spin * 0.3) * (0.5 + t * 1.2);
    // Sizes vary with the mote, because seven identical circles in a row read
    // as gravel rather than as dust however they are coloured.
    const mote = scale * 0.055 * (0.55 + spin * 0.9) * (1 - t * 0.5);
    ctx.beginPath();
    ctx.arc(
      x + Math.sin(angle) * reach,
      // Fanned rather than laid out along the ground: the motes thrown nearly
      // straight up carry most of their reach vertically, the ones thrown wide
      // carry almost none of it. Plus the whole puff rises and falls back,
      // because dust kicked up by a landing does not travel in a straight line
      // away from it.
      y +
        scale * 0.02 -
        Math.abs(Math.cos(angle)) * reach * 0.55 -
        Math.sin(t * Math.PI) * scale * 0.12,
      Math.max(0.5, mote),
      0,
      Math.PI * 2
    );
    ctx.fill();
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
    // Bigger with the live actor, but not by as much: the floor is a histogram
    // and it has to stay legible as a crowd rather than becoming a second row
    // of protagonists.
    const scale = geometry.rowHeight * (0.5 + actor.size * 0.4);
    drawGoat(ctx, x, geometry.floorY, scale, 0, poseFor(sprites, actor.id), 0);
  });

  ctx.restore();
}
