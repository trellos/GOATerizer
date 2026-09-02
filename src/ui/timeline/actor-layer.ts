/**
 * Draws the timeline actor — the goat standing on the note bars.
 *
 * PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md`.
 *
 * Three placement rules, all of them load-bearing:
 *
 *   1. **Anchored just left of the strike line.** The strike line is the
 *      instant of input, so an actor sitting after it reads as a consequence of
 *      the player's timing rather than a prediction of it, and an actor centred
 *      right of the line would occlude the read-ahead zone with the single most
 *      attention-stealing object on screen.
 *
 *      Stated as "never right of it" for two passes, and that is no longer true
 *      of the *body*: the anchor is a fixed 34px left of the line, but the goat
 *      grew, and at a capped streak its sprite is about 110px wide — so it
 *      overhangs the line by roughly 21px at rest and 34px at the bottom of a
 *      heavy landing, which is about a fifth of a beat of read-ahead. Whether
 *      to fix that by anchoring on the body's right edge instead of its centre
 *      is a composition decision, not a bug fix, and it is parked in
 *      `docs/IDEAS.md` rather than taken here. What is *not* allowed to cross
 *      is dust — see `DUST_RIGHT_FRACTION`.
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
  shadow: "#000",
} as const;

/** Where the actor sits relative to the strike line, in bar-widths. */
const LEFT_OF_STRIKE_PX = 34;

/**
 * How long the landing hop takes, in beats.
 *
 * Exported because it is the offset between "beats since the actor landed" and
 * "beats since the impact" — everything the impact drives starts at the *end*
 * of the hop, and a test reasoning about dust or squash in transport time has
 * to know that or it silently measures the wrong window.
 */
export const HOP_BEATS = 0.28;

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
 * How much the actor elongates in the air. Constant: it is about how fast the
 * body is moving, and the hop arc does not change with the streak.
 */
const STRETCH = 0.16;

/** How long the impact ring lasts, in beats. */
const RING_BEATS = 0.3;

/**
 * Everything about a landing that changes with how big the actor has grown.
 *
 * The problem this solves: `size` used to feed exactly one thing, the actor's
 * overall scale. So a twelve-note streak was a *bigger* goat playing a
 * *smaller* goat's landing — and mass that does not change how a body moves
 * reads as a zoom rather than as weight. Every field here is the same landing
 * seen at a different weight.
 *
 * The ranges are what "heavier" means, stated once:
 *
 *   - it **deforms further** on contact, and **settles slower** — a longer
 *     decay and a slower wobble, because a heavy body oscillates lazily;
 *   - it **stops dead for a moment** at the bottom (`hold`). This is hitstop,
 *     and it is the single strongest weight cue available: the pause *is* the
 *     mass. Two frames at 90bpm at the top of the range, nothing at the bottom;
 *   - it **displaces more ground**, further, for longer;
 *   - it **presses harder into its own shadow**.
 *
 * Pure, so "does a heavy landing actually outlast a light one" is a unit test
 * rather than something you have to catch on a screenshot.
 */
export type LandingWeight = {
  /** Peak compression, as a fraction of body height. */
  squash: number;
  /** How quickly the spring dies away, in beats. */
  decay: number;
  /** Rate of the bounce under the decay, in radians per beat. */
  wobble: number;
  /** Hitstop: how long the pose is held at full compression, in beats. */
  hold: number;
  motes: number;
  /** Multiplier on how far dust is thrown. */
  dustReach: number;
  /** How long the dust lasts, in beats. */
  dustLife: number;
  /** Multiplier on each mote's size. */
  moteScale: number;
  shadowAlpha: number;
  /** Multiplier on how far the shadow spreads at full compression. */
  shadowSpread: number;
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export function landingWeightFor(size: number): LandingWeight {
  // Clamped rather than trusted: `size` is documented as 0..1 and a landing is
  // not the place to find out that something upstream disagreed.
  const s = Math.min(1, Math.max(0, size));
  return {
    squash: lerp(0.16, 0.34, s),
    decay: lerp(0.14, 0.28, s),
    wobble: lerp(26, 16, s),
    hold: lerp(0, 0.05, s),
    motes: Math.round(lerp(5, 14, s)),
    dustReach: lerp(0.8, 1.5, s),
    dustLife: lerp(0.45, 0.75, s),
    moteScale: lerp(0.9, 1.3, s),
    shadowAlpha: lerp(0.3, 0.5, s),
    shadowSpread: lerp(1.2, 1.9, s),
  };
}

/**
 * How far right of the actor dust may travel, as a fraction of the gap between
 * it and the strike line — and the margin it must leave.
 *
 * The strike line is the read-ahead boundary, and dust is the one thing here
 * that moves outward far enough to cross it: at full streak a mote already
 * reached about 100px against a 34px gap, so the biggest landings were
 * throwing debris over the notes the player is reading. Scaling the puff with
 * size, which is the whole point of this pass, would have made that worse.
 *
 * Biasing the puff leftward rather than shrinking it is not a workaround: the
 * world scrolls right to left, so dust trailing backwards is what a puff behind
 * moving ground looks like. The clamp underneath it is the backstop.
 */
const DUST_RIGHT_FRACTION = 0.45;
const DUST_RIGHT_MARGIN = 6;

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
  const weight = landingWeightFor(state.size);
  if (t >= 1) {
    drawLandingRing(ctx, x, toY, scale, land);
    // Dust is clamped against the strike line rather than against its own
    // reach: how far it may go is a fact about where the actor is standing, and
    // only the caller knows that.
    drawLandingDust(ctx, x, toY, scale, land, state.streak, weight, LEFT_OF_STRIKE_PX - DUST_RIGHT_MARGIN);
  }

  // One pose per landing, so consecutive steps do not look identical. Keyed off
  // the streak rather than a counter of its own: the streak is already the
  // number of steps this actor has taken.
  drawGoat(ctx, x, y, scale, -lean, poseFor(sprites, state.streak), state.decorations, {
    squash: squashAt(t, land, weight),
    grounded: t >= 1,
    shadowAlpha: weight.shadowAlpha,
    shadowSpread: weight.shadowSpread,
  });
}

/**
 * How compressed the body is: negative in the air, positive on contact.
 *
 * In flight it stretches along the direction of travel, peaking at the apex
 * where it is moving fastest. On contact it compresses hard and springs back
 * through a damped oscillation, which is the part that actually reads as
 * weight — a landing without it is a sprite that stops.
 *
 * The compression is *held* at its peak for `weight.hold` before the spring is
 * allowed to start. That hold is hitstop, and it is the difference between a
 * heavy landing and a large light one: the body arrives, stops, and only then
 * recovers. At the light end the hold is zero and this is exactly the spring it
 * always was.
 */
export function squashAt(hop: number, land: number, weight: LandingWeight): number {
  if (hop < 1) return -STRETCH * Math.sin(hop * Math.PI);
  const spring = Math.max(0, land - weight.hold);
  return weight.squash * Math.exp(-spring / weight.decay) * Math.cos(spring * weight.wobble);
}

function poseFor(sprites: ActorSprites, step: number): HTMLImageElement | null {
  const poses = sprites.poses;
  if (poses.length === 0) return null;
  return poses[Math.abs(step) % poses.length] ?? null;
}

/**
 * What a landing is doing to the body this frame.
 *
 * Bundled rather than passed as four arguments because they are one thing seen
 * from four sides, and because {@link RESTING} then states what "no landing" is
 * in one place — the fallen actors on the floor are not mid-impact and should
 * not have to spell that out.
 */
type Juice = {
  squash: number;
  grounded: boolean;
  shadowAlpha: number;
  shadowSpread: number;
};

/** A body at rest: no compression, and the lightest shadow. */
const RESTING: Juice = { squash: 0, grounded: true, shadowAlpha: 0.3, shadowSpread: 1.2 };

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
  juice: Juice = RESTING
): void {
  ctx.save();
  ctx.translate(x, baseY);

  // A contact shadow, and it widens exactly as the body squashes. Two jobs: it
  // plants the goat on the bar instead of letting it float a pixel above one,
  // and it is a second channel carrying the same impact the body is — which is
  // what stops a landing from depending on catching one frame of squash. A
  // heavier actor sits in a darker one and drives it wider.
  if (juice.grounded) {
    const spread = 1 + Math.max(0, juice.squash) * juice.shadowSpread;
    ctx.save();
    ctx.globalAlpha *= juice.shadowAlpha;
    ctx.fillStyle = ACTOR.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 0, scale * 0.3 * spread, scale * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.rotate(lean * 0.18);

  // The body only, inside its own squash. What it loses in height it gains in
  // width — that is what separates squash from being briefly scaled down — but
  // the width grows as the *square root*, not in proportion.
  //
  // Strict volume preservation is a 2D idea, and this is a drawing of a solid:
  // a body flattening spreads into two horizontal directions and the view only
  // shows one of them, so the visible width should grow by the square root of
  // what the height lost. Taking the whole widening in one axis made a heavy
  // landing flatten the goat to twice its own length — it stopped reading as an
  // impact and started reading as a different animal lying down.
  const sy = Math.max(0.35, 1 - juice.squash);
  ctx.save();
  ctx.scale(1 / Math.sqrt(sy), sy);

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
  ctx.restore();

  // Decorations: earned past the size cap, so a long streak still registers
  // once growing has stopped. Outside the squash — they are sparks orbiting the
  // actor rather than part of it, and a stretched star reads as a rendering
  // fault rather than as a body under load.
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
  streak: number,
  weight: LandingWeight,
  maxRight: number
): void {
  if (land >= weight.dustLife) return;
  const t = land / weight.dustLife;
  ctx.save();
  ctx.globalAlpha = (1 - t) * (1 - t) * 0.8;
  ctx.fillStyle = ACTOR.dust;
  for (let i = 0; i < weight.motes; i += 1) {
    // Spread across the two lower quadrants, alternating sides so the puff is
    // symmetrical about the feet however few motes there are.
    const side = i % 2 === 0 ? 1 : -1;
    const spin = (i * 2.399 + streak * 0.7) % 1;
    const angle = side * (0.35 + spin * 0.9);
    // Starts already clear of the boots and stays low. The first version began
    // at a tenth of a body width and rose a fifth of one, which put half the
    // puff behind the goat — the motes that were meant to read as spray came
    // out on one side only, because the other side was inside the sprite.
    const reach = scale * (0.22 + spin * 0.3) * (0.5 + t * 1.2) * weight.dustReach;
    // Sizes vary with the mote, because identical circles in a row read as
    // gravel rather than as dust however they are coloured.
    const mote = scale * 0.055 * (0.55 + spin * 0.9) * (1 - t * 0.5) * weight.moteScale;
    // Short on the right and hard-stopped short of the strike line, so a heavy
    // landing never throws debris over the notes the player is reading ahead
    // on. The mote's own radius comes out of the budget, because what must not
    // cross the line is the drawn circle, not its centre — and the radius
    // scales with the actor, so a fixed pixel margin would be right at one size
    // and wrong at every other. See `DUST_RIGHT_FRACTION`.
    const drift = Math.sin(angle) * reach;
    const dx = drift > 0 ? Math.min(drift * DUST_RIGHT_FRACTION, maxRight - mote) : drift;
    ctx.beginPath();
    ctx.arc(
      x + dx,
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
