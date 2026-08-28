/**
 * Draws the `RepeatMinigame` performer — the can crusher standing on one bar
 * while the timeline brings him cans.
 *
 * PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 *
 * An earlier pass had him idle with his arms up and drop them for a third of a
 * beat whenever a can happened to arrive, and drew every can down at bar level.
 * Nothing about that said *crushing*: a can appeared at his feet and turned
 * squat, and a player who had never crushed one could not tell what they were
 * supposed to aim for.
 *
 * So the read is now built out of three things, in this order of importance:
 *
 *   1. **The hand never stops.** It loops to his forehead and back on the
 *      pulse, hit or miss, note or no note. That loop is the instruction —
 *      it names the place (his forehead) and the instant (the swing) that a can
 *      has to occupy — and it is legible before the player has got a single
 *      note right. It is phase-locked to the note grid, not free-running, so
 *      the palm is always down exactly when a can can arrive.
 *   2. **A well played note lifts its can into that gap.** Cans ride in sitting
 *      in their bars, down at shin height. Over the beat of flight between the
 *      strike line and the performer, a placed can rises to forehead height —
 *      the lift is a constant offset above its own lane, so a can played on the
 *      wrong lane rises just as eagerly and arrives just as far over his head
 *      or under his feet as the interval the player missed by.
 *   3. **The crushed can falls.** It does not blink into the pile: it drops
 *      from his forehead onto the heap at his feet, which is the pile that
 *      becomes the trophy. The player watches every point they scored land.
 *
 * A missed note gets neither the lift nor the crush. Its can tips over and
 * rolls past his shins while the palm comes down on nothing.
 *
 * Primitives, not sprites, because the question is whether the mechanic reads.
 */

import type {
  FlyingCan,
  RepeatVisualState,
} from "../../scenario/minigames/repeat-minigame.js";
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
 * A whole beat, and a whole beat exactly, for two reasons. It has to be long
 * enough that the flight is watchable — at 34px, where the climbing actor
 * stands, a can is past him before the eye finds it. And it has to be a whole
 * number of beats, because his swing is phase-locked to the note grid: a can
 * born on the grid then arrives on the grid, which is to say precisely when his
 * palm is down. Change this to a fraction and every can arrives while his hand
 * is somewhere else.
 */
const STANDS_BACK_BEATS = 1;

/**
 * The performer's height, as a multiple of a lane row.
 *
 * He is the tallest thing on the timeline, and deliberately: he is the only
 * object on screen that is always moving and never moves *anywhere*, so he is
 * where the eye rests between notes, and the swing has to be legible from
 * there.
 */
const BODY_ROWS = 1.5;

/** A can's height, as a multiple of a row. */
const CAN_ROWS = 0.5;

/**
 * How high above its own lane a placed can rides, centre to bar, as a multiple
 * of a row.
 *
 * Tuned to his brow, so a can on his lane arrives held against the front of his
 * face with the palm coming down on its lid. It is a *constant offset* rather
 * than a per-lane lookup, which is the whole trick: a can played one lane high
 * clears his head entirely, one lane low goes past his hip. The size of the gap
 * is the size of the interval the player missed by, and no line of code here
 * knows what an interval is.
 */
const LIFT_ROWS = 1.4;

/**
 * The swing, as fractions of one period. The palm holds on the can, winds back
 * up, then falls onto the next one.
 *
 * Weighted so contact reads as a hit rather than as a hand passing through a
 * position: it lingers where it landed, gets most of the cycle to travel, and
 * arrives fast.
 */
const HOLD = 0.18;
const WIND_UP = 0.42;

/**
 * How long the flattening reads for, capped in beats but really a fraction of
 * a swing.
 *
 * It has to end while the palm is still low, or the flat can hangs at his brow
 * with nothing on it — which is what it looked like when this was a constant.
 * In sixteenths a swing is a quarter of a beat and the whole crush has to fit
 * inside it.
 */
const CRUSH_BEATS = 0.22;
const CRUSH_SWINGS = 0.3;

/** How long a flattened can takes to drop from his brow onto the pile. */
const FALL_BEATS = 0.35;

export type RepeatGeometry = ActorGeometry & {
  /** Timeline scroll speed. A can travels at exactly this speed. */
  pixelsPerBeat: number;
};

/**
 * A can riding in a note bar that has not been judged yet, already positioned
 * by the caller — the note bars and the actor layer count beats differently
 * (absolute transport against attempt-relative), and resolving that once at the
 * call site beats passing two clocks into a drawing function.
 */
export type PendingCan = { x: number; y: number };

/**
 * The one place on screen a can has to be to get crushed: the point his palm
 * comes down on, every swing, forever.
 *
 * Exported because it is the mechanic stated as a coordinate. Everything else
 * in this file is an answer to "how far is this can from here" — the lift, the
 * flight, the row of daylight between a wrong can and this point — so it is
 * worth being able to ask the question directly, and to test it.
 */
export function repeatCrushPoint(
  state: RepeatVisualState,
  geometry: RepeatGeometry
): { x: number; y: number } {
  return {
    x: geometry.strikeX - STANDS_BACK_BEATS * geometry.pixelsPerBeat,
    y: geometry.laneY(state.performerLane) - geometry.rowHeight * LIFT_ROWS,
  };
}

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
  const canSize = geometry.rowHeight * CAN_ROWS;
  const lift = geometry.rowHeight * LIFT_ROWS;
  /** Where his palm lands: on the lid of a can held at the crush height. */
  const palmAbove = lift + canSize / 2;
  /**
   * He stands half a head left of the crush point rather than centred on it, so
   * the can he is holding covers the front of his face instead of all of it.
   * A can as wide as a head, dead centre, reads as a head.
   */
  const bodyX = homeX - geometry.rowHeight * BODY_ROWS * 0.5 * 0.27;

  // How far through the current swing he is, 0..1, palm on the can at 0.
  // Phase-locked to the note grid rather than accumulated, so a dropped frame
  // moves nothing and the palm is down on every grid position a can can be
  // born on.
  const period = state.strikePeriodBeats;
  const swingPhase = state.complete ? 0.5 : (((beat % period) + period) % period) / period;
  const crushBeats = Math.min(CRUSH_BEATS, period * CRUSH_SWINGS);
  const fallBeats = Math.min(FALL_BEATS, period * 1.4);

  const age = (can: FlyingCan) => Math.max(0, beat - can.bornBeat);
  const scrollX = (can: FlyingCan) => geometry.strikeX - age(can) * geometry.pixelsPerBeat;
  /**
   * A placed can rises out of its bar into the crush gap over the beat of
   * flight, easing so it settles rather than arriving still climbing. Standing
   * on the bar to hanging at crush height, both measured centre to centre so
   * the two ends of the lift line up with what is drawn.
   */
  const flyingY = (can: FlyingCan) => {
    const rise = ease(Math.min(1, age(can) / STANDS_BACK_BEATS));
    return geometry.laneY(can.lane) - (canSize / 2) * (1 - rise) - lift * rise;
  };

  // Anything that has already dropped onto the heap. Cans still in the air on
  // their way down are drawn individually, so they are not counted twice.
  const crushed = state.cans.filter((can) => can.fate === "crushed");
  const falling = crushed.filter((can) => {
    const since = age(can) - STANDS_BACK_BEATS;
    return since >= 0 && since < crushBeats + fallBeats;
  }).length;
  drawPile(ctx, Math.max(0, state.pile - falling), bodyX, geometry);

  // Everything he does not touch goes behind him, and the one can he does goes
  // in front. That ordering is itself part of the read: the can in front of the
  // crusher is the one being crushed, and there is never more than one.
  //
  // Cans still approaching the strike line sit in the bars they belong to —
  // the container premise, drawn: a note *is* a can coming at you.
  for (const can of pending) drawCan(ctx, can.x, can.y - canSize / 2, canSize, "upright", 0);

  for (const can of state.cans) {
    if (can.fate === "missed") {
      // Never got up. It lies down in its bar and rolls past his boots, which
      // is what a can does when nobody picks it up.
      drawCan(ctx, scrollX(can), geometry.laneY(can.lane), canSize, "rolling", age(can) * 2.6);
    } else if (can.fate === "wrong") {
      // Right idea, wrong place. Nothing stops it, so it holds the height the
      // player gave it and keeps going — over his head or past his hip by
      // exactly the interval they missed by.
      const tilt = can.wobbly ? Math.sin(age(can) * 9 + can.id) * 0.4 : 0;
      drawCan(ctx, scrollX(can), flyingY(can), canSize, "upright", tilt);
    }
  }

  drawCrusher(
    ctx,
    bodyX,
    homeY,
    geometry.rowHeight,
    { dx: homeX - bodyX, above: palmAbove },
    swingPhase,
    state.complete && state.passed
  );

  // Inbound first, then whatever is happening at his brow — in sixteenths the
  // next can is only a few pixels behind the one being crushed, and painting it
  // afterwards hides the single frame the whole mechanic is about.
  for (const can of crushed) {
    if (age(can) < STANDS_BACK_BEATS) drawCan(ctx, scrollX(can), flyingY(can), canSize, "upright", 0);
  }
  for (const can of crushed) {
    const sinceContact = age(can) - STANDS_BACK_BEATS;
    if (sinceContact < 0) continue;
    if (sinceContact < crushBeats) {
      // The palm is down. Flat, against his brow, with the impact on it.
      drawCan(ctx, homeX, homeY - lift, canSize, "crushed", 0);
      drawSpark(ctx, homeX, homeY - lift, canSize * 0.9 * (1 - sinceContact / crushBeats));
    } else if (sinceContact < crushBeats + fallBeats) {
      // ...and down it goes, onto the pile. Accelerating, because a can that
      // drifts down reads as floating rather than as something dropped.
      const t = (sinceContact - crushBeats) / fallBeats;
      const from = homeY - lift;
      drawCan(ctx, homeX, from + (geometry.floorY - from) * (t * t), canSize, "crushed", 0);
    }
    // After that it belongs to the pile, which is drawn from the count.
  }
}

/** Smoothstep. Cheap, and it takes the mechanical edge off the lift. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The performer.
 *
 * One arm loops: up over the head, then down onto the forehead, then up again,
 * once per {@link RepeatVisualState.strikePeriodBeats}. The other braces. The
 * loop is the mechanic's entire tutorial, so it runs whether or not there is
 * anything to crush — an idle crusher would teach the player nothing until they
 * had already succeeded, which is the wrong way round.
 *
 * @param phase 0..1 through the swing, palm on the forehead at 0.
 */
function drawCrusher(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  rowHeight: number,
  contact: { dx: number; above: number },
  phase: number,
  triumphant: boolean
): void {
  const h = rowHeight * BODY_ROWS;
  const w = h * 0.5;
  const palmR = w * 0.16;
  // The palm comes to rest ON the lid, not centred on it: a hand whose middle
  // is at the top of the can looks like it went through the can.
  const contactY = -contact.above + palmR;

  // Phase 0 is contact. He holds there, winds back up, then drops onto the next
  // one. The hold is what makes it a hit: without it the palm is already
  // climbing while the flattened can is still under it, and the two stop
  // looking like one event.
  const raised =
    phase < HOLD
      ? 0
      : phase < HOLD + WIND_UP
        ? (phase - HOLD) / WIND_UP
        : 1 - ease((phase - HOLD - WIND_UP) / (1 - HOLD - WIND_UP));
  const handX = contact.dx;
  const handY = contactY - raised * h * 0.55;

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

  ctx.strokeStyle = CRUSHER.skin;
  ctx.lineWidth = Math.max(1.5, w * 0.16);
  ctx.lineCap = "round";
  const shoulderY = -h * 0.68;

  if (triumphant) {
    // The attempt is over and he passed. Both arms up, and the loop stops —
    // he is done working.
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, shoulderY);
    ctx.lineTo(-w * 0.75, shoulderY - h * 0.4);
    ctx.moveTo(w * 0.32, shoulderY);
    ctx.lineTo(w * 0.75, shoulderY - h * 0.4);
    ctx.stroke();
  } else {
    // Bracing arm, held out on the far side from the incoming cans so it never
    // sits between the player and the gap.
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, shoulderY);
    ctx.lineTo(-w * 0.7, shoulderY + h * 0.16);
    ctx.stroke();

    // The working arm: shoulder, elbow winging out to the side, palm above the
    // can. Two segments, so the arm folds as it comes down instead of
    // telescoping — the elbow swinging wide is most of what makes the loop
    // legible when the whole man is forty pixels tall.
    const elbowX = Math.max(handX, w * 0.32) + w * 0.75;
    const elbowY = (shoulderY + handY) / 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.32, shoulderY);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    // The palm itself. A blob, but it is the thing the player is timing to, so
    // it gets to be the widest part of the arm.
    ctx.fillStyle = CRUSHER.skin;
    ctx.beginPath();
    ctx.arc(handX, handY, palmR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

type CanPose = "upright" | "crushed" | "rolling";

/**
 * One can.
 *
 * Upright and tall while it still has a chance, squat once it has been dealt
 * with, on its side once it is clear nobody is going to.
 *
 * Drawn centred on `y` rather than standing on it: a can in flight is held at
 * its middle by the hand that is about to hit it, and centring is what lets the
 * lift land its body on the forehead instead of its base.
 */
function drawCan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pose: CanPose,
  spin: number
): void {
  const crushed = pose === "crushed";
  const w = crushed ? size * 0.9 : size * 0.52;
  const h = crushed ? size * 0.3 : size;
  const rim = Math.max(1, h * 0.14);

  ctx.save();
  // A rolling can turns about its own middle and rests that middle half its
  // width above the bar, so it lies ON the note rather than through it.
  ctx.translate(x, pose === "rolling" ? y - w / 2 : y);
  if (pose === "rolling") ctx.rotate(Math.PI / 2 + spin);
  else if (spin !== 0) ctx.rotate(spin);

  const top = -h / 2;

  // An outline first: a can spends most of its flight over a bright note bar,
  // and a pale grey cylinder on a cyan rectangle is not a can.
  ctx.fillStyle = CRUSHER.outline;
  ctx.fillRect(-w / 2 - 1.5, top - 1.5, w + 3, h + 3);

  ctx.fillStyle = CRUSHER.can;
  ctx.fillRect(-w / 2, top, w, h);
  ctx.fillStyle = CRUSHER.canDark;
  ctx.fillRect(-w / 2, top, w, rim);
  ctx.fillRect(-w / 2, top + h - rim, w, rim);
  ctx.fillStyle = CRUSHER.canLabel;
  ctx.fillRect(-w / 2, top + h * 0.38, w, Math.max(1, h * 0.28));

  ctx.restore();
}

/**
 * The impact, above the can only.
 *
 * A full starburst around the can was a mistake: the lower spokes land on the
 * crusher's face and the ones pointing along the timeline read as an arrow, so
 * at thirty pixels the whole thing came out as a pale blob stuck to the can.
 * Four ticks in the upper hemisphere have nothing to collide with and say the
 * same thing.
 */
function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  if (r <= 0) return;
  ctx.save();
  ctx.strokeStyle = CRUSHER.spark;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (const angle of [-2.5, -1.9, -1.25, -0.65]) {
    ctx.moveTo(x + Math.cos(angle) * r * 0.55, y + Math.sin(angle) * r * 0.55);
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
 * strip of screen always means "what this attempt has produced so far" — and
 * every can in it was watched falling out of his hands into it.
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
