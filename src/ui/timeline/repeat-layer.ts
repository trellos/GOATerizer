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
  shorts: "#3b5a74",
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

/** A can's height, as a multiple of a row, and its width as a fraction of that. */
const CAN_ROWS = 0.45;
const CAN_ASPECT = 0.46;

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
   * He stands most of a head-radius left of the crush point rather than centred
   * on it, so the can he is holding covers the front of his face instead of all
   * of it. A can as wide as a head, dead centre, reads as a head.
   */
  const bodyX = homeX - geometry.rowHeight * FACE_OFFSET_ROWS;

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
  // The heap sits a can's width in front of him rather than under his boots,
  // which is where the crushed cans fall to and keeps it off his silhouette.
  const pileX = homeX + canSize * 1.4;
  drawPile(ctx, Math.max(0, state.pile - falling), pileX, geometry);

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
      // Forward as well as down, so it drops clear of him and onto the heap
      // instead of sliding down through his face and chest.
      const t = (sinceContact - crushBeats) / fallBeats;
      const from = homeY - lift;
      drawCan(
        ctx,
        homeX + (pileX - homeX) * t,
        from + (geometry.floorY - from) * (t * t),
        canSize,
        "crushed",
        0
      );
    }
    // After that it belongs to the pile, which is drawn from the count.
  }
}

/** Smoothstep. Cheap, and it takes the mechanical edge off the lift. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The figure, as fractions of his own height.
 *
 * Written out as proportions rather than sprinkled through the drawing code
 * because the first version was not a figure at all — the "elbow" was the
 * midpoint between the shoulder and wherever the hand had got to, so raising
 * the hand simply lengthened both bones and the arm ended up nearly as long as
 * the man. Bones have fixed lengths here and the elbow is solved for, which is
 * what makes the swing a fold rather than a stretch.
 *
 * Roughly a four-head figure: shorter than life, which suits a character forty
 * pixels tall, but with the joints where a person's are. The head stays a
 * little large on purpose — it has to stay wider than the can he holds against
 * it, or the can reads as his head.
 */
const FIGURE = {
  hip: 0.46,
  shoulder: 0.78,
  headCentre: 0.875,
  headR: 0.125,
  shoulderHalf: 0.155,
  hipHalf: 0.105,
  /** Half a leg's width, and how far its centre sits off the midline. */
  legHalf: 0.045,
  legSpread: 0.072,
  shorts: 0.15,
  upperArm: 0.2,
  foreArm: 0.22,
  palmR: 0.055,
  limb: 0.055,
} as const;

/** How far left of the crush point he stands, so the can covers his face and not his head. */
const FACE_OFFSET_ROWS = BODY_ROWS * FIGURE.headR * 0.8;

type Point = { x: number; y: number };

/**
 * The elbow, for a shoulder and a hand — the standard two-bone solve.
 *
 * The elbow is placed on the side the sign selects, which for this figure is
 * always outward: an elbow winging away from the body is most of what makes the
 * swing legible when the whole man is forty pixels tall, and it is also where a
 * real one goes when you put your palm on your own forehead.
 */
function solveElbow(shoulder: Point, hand: Point, upper: number, fore: number): Point {
  const dx = hand.x - shoulder.x;
  const dy = hand.y - shoulder.y;
  // Clamped inside the reachable annulus, so a target the arm cannot make
  // straightens or folds it fully instead of producing a NaN.
  const d = Math.min(upper + fore, Math.max(Math.abs(upper - fore) + 1e-6, Math.hypot(dx, dy)));
  const along = (d * d + upper * upper - fore * fore) / (2 * d);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  return {
    x: shoulder.x + ux * along + -uy * out,
    y: shoulder.y + uy * along + ux * out,
  };
}

/**
 * The performer.
 *
 * One arm loops: palm on the can at his brow, up and out to the side, then back
 * down onto the next one, once per {@link RepeatVisualState.strikePeriodBeats}.
 * The other braces. The loop is the mechanic's entire tutorial, so it runs
 * whether or not there is anything to crush — an idle crusher would teach the
 * player nothing until they had already succeeded, which is the wrong way
 * round.
 *
 * The hand travels on an arc about the shoulder rather than straight up,
 * because the arm's reach is barely longer than the distance from his shoulder
 * to his own forehead: a purely vertical swing has only a few pixels of travel
 * in it, and swinging out to the side buys the silhouette the rest.
 *
 * @param phase 0..1 through the swing, palm on the can at 0.
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
  const palmR = h * FIGURE.palmR;
  const headR = h * FIGURE.headR;
  const headY = -h * FIGURE.headCentre;
  const hipY = -h * FIGURE.hip;
  const shoulderY = -h * FIGURE.shoulder;
  const reach = h * (FIGURE.upperArm + FIGURE.foreArm);
  const shoulder = { x: h * FIGURE.shoulderHalf, y: shoulderY };

  ctx.save();
  ctx.translate(x, baseY);

  // Legs, then torso. He stands ON the bar, like the goat does.
  ctx.fillStyle = CRUSHER.skinShade;
  const legHalf = h * FIGURE.legHalf;
  for (const side of [-1, 1]) {
    // Spread far enough apart to read as two legs. At this size a pair set any
    // closer merges into a single trunk, which is most of what made the first
    // proportioned pass look spindly.
    ctx.fillRect(side * h * FIGURE.legSpread - legHalf, hipY, Math.max(1, legHalf * 2), -hipY);
  }

  // Shorts, which are mostly here to break the torso off the legs — a single
  // unbroken column from shoulder to bar does not read as a standing man.
  ctx.fillStyle = CRUSHER.shorts;
  ctx.fillRect(-h * FIGURE.hipHalf, hipY - h * 0.02, h * FIGURE.hipHalf * 2, h * FIGURE.shorts);

  ctx.fillStyle = CRUSHER.vest;
  ctx.beginPath();
  ctx.moveTo(-h * FIGURE.shoulderHalf, shoulderY);
  ctx.lineTo(h * FIGURE.shoulderHalf, shoulderY);
  ctx.lineTo(h * FIGURE.hipHalf, hipY);
  ctx.lineTo(-h * FIGURE.hipHalf, hipY);
  ctx.closePath();
  ctx.fill();

  // Head, headband, hair.
  ctx.fillStyle = CRUSHER.skin;
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CRUSHER.hair;
  ctx.fillRect(-headR, headY - headR * 1.05, headR * 2, headR * 0.5);
  ctx.fillStyle = CRUSHER.band;
  ctx.fillRect(-headR, headY - headR * 0.55, headR * 2, headR * 0.38);

  ctx.strokeStyle = CRUSHER.skin;
  ctx.lineWidth = Math.max(1.5, h * FIGURE.limb);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /**
   * One arm, always solved on his right and then mirrored if it is his left, so
   * both elbows wing away from the body rather than both leaning the same way.
   * `hand` is given in that same right-hand frame.
   */
  const drawArm = (side: number, hand: Point): void => {
    const from = { x: h * FIGURE.shoulderHalf, y: shoulderY };
    const elbow = solveElbow(from, hand, h * FIGURE.upperArm, h * FIGURE.foreArm);
    ctx.beginPath();
    ctx.moveTo(side * from.x, from.y);
    ctx.lineTo(side * elbow.x, elbow.y);
    ctx.lineTo(side * hand.x, hand.y);
    ctx.stroke();
    ctx.fillStyle = CRUSHER.skin;
    ctx.beginPath();
    ctx.arc(side * hand.x, hand.y, palmR, 0, Math.PI * 2);
    ctx.fill();
  };

  if (triumphant) {
    // The attempt is over and he passed. Both arms up, and the loop stops — he
    // is done working.
    const up = { x: h * 0.3, y: shoulderY - reach * 0.9 };
    drawArm(1, up);
    drawArm(-1, up);
  } else {
    // The bracing arm hangs on the far side from the incoming cans, so it never
    // sits between the player and the gap.
    drawArm(-1, { x: h * 0.22, y: shoulderY + reach * 0.75 });

    // Phase 0 is contact. He holds there, winds back up, then comes down on the
    // next one. The hold is what makes it a hit: without it the palm is already
    // climbing while the flattened can is still under it, and the two stop
    // looking like one event.
    const raised =
      phase < HOLD
        ? 0
        : phase < HOLD + WIND_UP
          ? (phase - HOLD) / WIND_UP
          : 1 - ease((phase - HOLD - WIND_UP) / (1 - HOLD - WIND_UP));

    // The palm comes to rest ON the can's lid, not centred on it: a hand whose
    // middle is at the top of the can looks like it went through the can.
    const restX = contact.dx;
    const restY = -contact.above + palmR;
    const toRest = Math.hypot(restX - shoulder.x, restY - shoulder.y);
    const restAngle = Math.atan2(restY - shoulder.y, restX - shoulder.x);
    // Out to the side he takes the cans from, and further from the shoulder:
    // the arm unfolds as it lifts, which is the change the eye actually reads.
    // Out rather than back over his head, which is the other natural windup but
    // puts the upper arm straight across his face at this size.
    const angle = restAngle + raised * 0.85;
    const radius = toRest + (reach * 0.95 - toRest) * raised;

    drawArm(1, {
      x: shoulder.x + Math.cos(angle) * radius,
      y: shoulder.y + Math.sin(angle) * radius,
    });
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
  const w = crushed ? size * 0.9 : size * CAN_ASPECT;
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
