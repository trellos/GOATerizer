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
 * The performer is drawn from primitives, because his swing is a solved pose
 * that no fixed sprite could hold. The **cans are sprites**, which reverses an
 * earlier decision and is worth saying why: the argument for primitives was
 * that the question was whether the mechanic read, not whether the art was
 * good. That was right until the mechanic did read — at which point the cans
 * were still nine-pixel slivers of grey with a red stripe, and the object the
 * whole minigame is named after was the least legible thing on screen. The
 * scenario has had `repeatTarget` and `targetCompletedState` bound all along;
 * nothing here was using them.
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

/** A flattened can's height, as a fraction of an upright one's. */
const CRUSHED_HEIGHT = 0.28;

/**
 * The performer's height, as a multiple of a lane row.
 *
 * He is the tallest thing on the timeline, and deliberately: he is the only
 * object on screen that is always moving and never moves *anywhere*, so he is
 * where the eye rests between notes, and the swing has to be legible from
 * there.
 *
 * He grew with the cans rather than instead of them. The can is held against
 * his brow, so the two sizes are one decision: a can big enough to read that is
 * held against a head that did not grow stops being a can he is holding and
 * becomes his head. The ratio below is what actually has to hold, and it is
 * asserted rather than left to a comment.
 */
const BODY_ROWS = 2;

/**
 * A can's height as a multiple of a row, and its width as a fraction of that —
 * upright, then splayed out once it has been flattened.
 *
 * Roughly doubled, because at 0.45 of a row the can was about nine pixels wide
 * and read as a coloured splinter riding a note bar. The aspect went with it:
 * 0.42 was narrower than a real can, which is 66mm across and 122mm tall, and
 * the extra width is most of what makes it look like something you could pick
 * up. Sprites override both when they load; these stay as the fallback's
 * proportions and as the size the sprite is drawn at.
 */
const CAN_ROWS = 0.82;
const CAN_ASPECT = 0.5;
// Deliberately the crushed sprite's own aspect (24x12) multiplied by the height
// it is drawn at, so the fallback occupies the same box the sprite does. Left at
// a guessed 0.95 these disagreed by nearly two to one, which meant a missing
// asset did not degrade to a plainer can — it degraded to a differently
// proportioned object in a different place relative to his face.
const CAN_CRUSHED_ASPECT = 2 * CRUSHED_HEIGHT;

/**
 * The can art: intact, and dealt with.
 *
 * Resolved by the caller from the scenario's `repeatTarget` and
 * `targetCompletedState` bindings, exactly as the climbing actor's poses are —
 * this module has no business knowing about asset ids. Either may be null, in
 * which case the primitives below stand in; an asset that failed to load should
 * degrade to a legible shape rather than to nothing.
 */
export type RepeatSprites = {
  can: HTMLImageElement | null;
  crushed: HTMLImageElement | null;
};

export const NO_REPEAT_SPRITES: RepeatSprites = { can: null, crushed: null };

/**
 * How big a can is drawn, in both poses, when there is no sprite.
 *
 * Exported so the geometry tests can find a can in a list of drawing ops by its
 * size without restating these numbers — which they did, and which meant
 * resizing the can silently turned six spatial assertions into assertions about
 * nothing rather than into failures. The size is not what those tests are
 * about; it is only how they tell a can from the crusher's headband.
 */
export function repeatCanMetrics(rowHeight: number): {
  upright: { w: number; h: number };
  crushed: { w: number; h: number };
} {
  const size = rowHeight * CAN_ROWS;
  return {
    upright: { w: size * CAN_ASPECT, h: size },
    crushed: { w: size * CAN_CRUSHED_ASPECT, h: size * CRUSHED_HEIGHT },
  };
}

/**
 * How wide his head is drawn, for the one proportion that has to hold.
 *
 * The can is crushed against his brow, so a can as wide as his head, held over
 * his face, stops reading as a can he is holding and starts reading as his
 * head. That was a comment for two passes and the comment did not stop the can
 * from being resized past it — so it is a number the tests can ask for.
 */
export function repeatHeadWidth(rowHeight: number): number {
  return rowHeight * BODY_ROWS * FIGURE.headRX * 2;
}

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

/**
 * The crush, as everything that happens in the moment of contact.
 *
 * A flatten on its own is a sprite swap, and a sprite swap at this speed is
 * something the eye can miss entirely — which is what the old single pale
 * starburst amounted to. Four channels carry the impact instead, so no one
 * frame has to do the work:
 *
 *   - `SHAKE` — the whole man jolts down and recoils. The character reacting is
 *     the strongest signal available, and it is the one that survives being
 *     seen out of the corner of an eye.
 *   - `SQUASH` — the crushed can arrives over-flattened and springs back to its
 *     resting shape, so the flatten reads as *happening* rather than as having
 *     already happened.
 *   - `RING` — a shock ring out from the point of contact, flat rather than
 *     circular so it reads as travelling across the front of him.
 *   - `SPRAY` — what was in the can, thrown up and out.
 */
const SHAKE_ROWS = 0.13;
const SHAKE_BEATS = 0.3;
const SQUASH_OVERSHOOT = 0.3;
const RING_BEATS = 0.26;
const SPRAY_BEATS = 0.5;
const SPRAY_DROPS = 9;

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
  pending: readonly PendingCan[] = [],
  sprites: RepeatSprites = NO_REPEAT_SPRITES
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
  // Capped by the hold as well as by the swing. `CRUSH_SWINGS` alone is 0.3 of
  // a period and the palm only rests for `HOLD`, which is 0.18 — so at a
  // quarter-note pulse the flattened can outlived the hand on it by a
  // twentieth of a beat and hung at his brow with the arm already climbing.
  // That is exactly what this constant's own docstring warns about, and it was
  // wrong anyway.
  const crushBeats = Math.min(CRUSH_BEATS, period * Math.min(CRUSH_SWINGS, HOLD));
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

  const draw = (
    x: number,
    y: number,
    pose: CanPose,
    spin: number
  ): void => drawCan(ctx, x, y, canSize, pose, spin, sprites);

  // Anything that has already dropped onto the heap. Cans still in the air on
  // their way down are drawn individually, so they are not counted twice.
  const crushed = state.cans.filter((can) => can.fate === "crushed");

  /**
   * How long ago the most recent can was hit, or null if none has been.
   *
   * The jolt belongs to *him*, not to the can, so it has to be found across all
   * of them rather than inside the loop that draws one — and it is the most
   * recent contact that matters, because in sixteenths a second can arrives
   * before the recoil from the first has finished.
   */
  let sinceHit: number | null = null;
  for (const can of crushed) {
    const since = age(can) - STANDS_BACK_BEATS;
    if (since >= 0 && (sinceHit === null || since < sinceHit)) sinceHit = since;
  }
  // Sine, not cosine, so the jolt starts at rest and is driven down over the
  // first few hundredths of a beat before recoiling. A cosine put full
  // displacement on the contact frame itself, which is a step rather than an
  // impact — and it also meant the can was never actually *at* the crush point
  // on the frame it was crushed, which is the one thing about this layer that
  // is asserted as a hard equality.
  const jolt =
    sinceHit === null || sinceHit >= SHAKE_BEATS
      ? 0
      : (1 - sinceHit / SHAKE_BEATS) ** 2 * Math.sin(sinceHit * 26);
  const falling = crushed.filter((can) => {
    const since = age(can) - STANDS_BACK_BEATS;
    return since >= 0 && since < crushBeats + fallBeats;
  }).length;
  // The heap sits a can's width in front of him rather than under his boots,
  // which is where the crushed cans fall to and keeps it off his silhouette.
  const pileX = homeX + canSize * 1.4;
  drawPile(ctx, Math.max(0, state.pile - falling), pileX, geometry, sprites);

  // Everything he does not touch goes behind him, and the one can he does goes
  // in front. That ordering is itself part of the read: the can in front of the
  // crusher is the one being crushed, and there is never more than one.
  //
  // Cans still approaching the strike line sit in the bars they belong to —
  // the container premise, drawn: a note *is* a can coming at you.
  for (const can of pending) draw(can.x, can.y - canSize / 2, "upright", 0);

  for (const can of state.cans) {
    if (can.fate === "missed") {
      // Never got up. It lies down in its bar and rolls past his boots, which
      // is what a can does when nobody picks it up.
      draw(scrollX(can), geometry.laneY(can.lane), "rolling", age(can) * 2.6);
    } else if (can.fate === "wrong") {
      // Right idea, wrong place. Nothing stops it, so it holds the height the
      // player gave it and keeps going — over his head or past his hip by
      // exactly the interval they missed by.
      const tilt = can.wobbly ? Math.sin(age(can) * 9 + can.id) * 0.4 : 0;
      draw(scrollX(can), flyingY(can), "upright", tilt);
    }
  }

  drawCrusher(
    ctx,
    bodyX,
    // He takes the blow: driven down on contact and springing back. This is the
    // channel that carries the crush when the player is not looking straight at
    // the can, which is most of the time — they are reading the next note.
    homeY + jolt * geometry.rowHeight * SHAKE_ROWS,
    geometry.rowHeight,
    { dx: homeX - bodyX, above: palmAbove },
    swingPhase,
    state.complete && state.passed
  );

  // Inbound first, then whatever is happening at his brow — in sixteenths the
  // next can is only a few pixels behind the one being crushed, and painting it
  // afterwards hides the single frame the whole mechanic is about.
  for (const can of crushed) {
    if (age(can) < STANDS_BACK_BEATS) draw(scrollX(can), flyingY(can), "upright", 0);
  }
  for (const can of crushed) {
    const sinceContact = age(can) - STANDS_BACK_BEATS;
    if (sinceContact < 0) continue;
    const brow = homeY - lift + jolt * geometry.rowHeight * SHAKE_ROWS;
    if (sinceContact < crushBeats) {
      // The palm is down. Flat, against his brow, with the impact on it — and
      // over-flattened at the instant of contact, springing back to its resting
      // shape over the rest of the window, so the flatten is an event rather
      // than a swapped sprite.
      const t = sinceContact / crushBeats;
      drawCan(ctx, homeX, brow, canSize, "crushed", 0, sprites, 1 + SQUASH_OVERSHOOT * (1 - t));
      drawRing(ctx, homeX, brow, canSize * (0.25 + t * 0.8), 1 - t);
      drawSpray(ctx, homeX, brow, canSize, sinceContact / SPRAY_BEATS);
    } else if (sinceContact < crushBeats + fallBeats) {
      // ...and down it goes, onto the pile. Accelerating, because a can that
      // drifts down reads as floating rather than as something dropped.
      // Forward as well as down, so it drops clear of him and onto the heap
      // instead of sliding down through his face and chest.
      const t = (sinceContact - crushBeats) / fallBeats;
      const from = homeY - lift;
      draw(
        homeX + (pileX - homeX) * t,
        from + (geometry.floorY - from) * (t * t),
        "crushed",
        // Tumbles as it falls. A flat object dropping without rotating reads as
        // being lowered.
        t * 1.1
      );
      if (sinceContact < SPRAY_BEATS) drawSpray(ctx, homeX, homeY - lift, canSize, sinceContact / SPRAY_BEATS);
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
  /**
   * Low enough that the working arm folds instead of doubling over.
   *
   * It was 0.8, which put the shoulder six pixels under the head's centre —
   * and his palm at contact is on his own brow, so shoulder and hand were
   * almost the same point. A two-bone solve given 33.6px of arm and 5.8px to
   * cross has only one shape available, a hairpin, and it threw the elbow
   * nearly sixteen pixels clear of the line between them. Whichever way that
   * broke, the elbow ended up the highest thing on the character: above his own
   * head, at every phase of the swing.
   *
   * Dropping the shoulder is what fixes it, not the pole below. At 0.70 the
   * hand is far enough from the shoulder for the arm to bend like an arm, and
   * the outward solution and the downward one become the same solution — at
   * this height the elbow sits below the head through the whole loop for any
   * pole direction worth having, so the choice stops being delicate.
   *
   * It also gives him a neck, which he did not have: the head used to sit into
   * the shoulders.
   */
  shoulder: 0.7,
  headCentre: 0.875,
  /**
   * The head is an ellipse, not a circle. A circular head wide enough not to be
   * swamped by the can he holds against it is also as wide as his shoulders, so
   * the working arm comes out from *behind* his head — a real head is a good
   * deal narrower than it is tall, and that is what leaves the shoulders room.
   */
  headRX: 0.115,
  headRY: 0.125,
  shoulderHalf: 0.145,
  hipHalf: 0.105,
  /** Half a leg's width, and how far its centre sits off the midline. */
  legHalf: 0.042,
  legSpread: 0.065,
  shorts: 0.15,
  upperArm: 0.2,
  foreArm: 0.22,
  palmR: 0.055,
  limb: 0.055,
} as const;

/**
 * Which way the elbow is allowed to break, as a direction in his own frame:
 * outward, and a little down.
 *
 * A two-bone solve has two answers — the elbow can sit on either side of the
 * line from shoulder to hand — and picking one by a fixed rotation of that line
 * is what produced an arm bending the wrong way. The rotation follows the hand:
 * with the hand raised it points outward, but with the hand low it points *in*,
 * and the bracing arm's elbow folded through his own ribs. A fixed hint in body
 * space cannot do that, because it does not depend on where the hand is.
 */
const ELBOW_POLE = { x: 0.944, y: 0.33 };

/** How far left of the crush point he stands, so the can covers his face and not his head. */
const FACE_OFFSET_ROWS = BODY_ROWS * FIGURE.headRX * 0.8;

type Point = { x: number; y: number };

/**
 * The elbow, for a shoulder and a hand — the standard two-bone solve, with the
 * side chosen by {@link ELBOW_POLE} so the joint always breaks outward.
 *
 * Solved in his right-hand frame; the caller mirrors for the other arm, which
 * mirrors the pole with it and gives that elbow its own outward.
 */
function solveElbow(shoulder: Point, hand: Point, upper: number, fore: number): Point {
  const dx = hand.x - shoulder.x;
  const dy = hand.y - shoulder.y;
  const raw = Math.hypot(dx, dy) || 1;
  // Clamped inside the reachable annulus, so a target the arm cannot make
  // straightens or folds it fully instead of producing a NaN.
  const d = Math.min(upper + fore, Math.max(Math.abs(upper - fore) + 1e-6, raw));
  const along = (d * d + upper * upper - fore * fore) / (2 * d);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const ux = dx / raw;
  const uy = dy / raw;
  // Perpendicular to the arm, flipped to whichever of the two solutions lies on
  // the pole's side. This is the whole fix: the side is decided in body space,
  // not by which way the hand happens to be pointing.
  const side = -uy * ELBOW_POLE.x + ux * ELBOW_POLE.y >= 0 ? 1 : -1;
  return {
    x: shoulder.x + ux * along + -uy * out * side,
    y: shoulder.y + uy * along + ux * out * side,
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
  const headRX = h * FIGURE.headRX;
  const headRY = h * FIGURE.headRY;
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

  // Neck, bridging the daylight the lowered shoulder opened between his jaw and
  // the vest. Drawn from the head's own centre so its top is always behind the
  // ellipse whatever the two heights are, and before the head so the jaw laps
  // over the join rather than butting against it.
  ctx.fillStyle = CRUSHER.skinShade;
  ctx.fillRect(-headRX * 0.45, headY, headRX * 0.9, shoulderY - headY + h * 0.02);

  // Head, headband, hair.
  ctx.fillStyle = CRUSHER.skin;
  ctx.beginPath();
  ctx.ellipse(0, headY, headRX, headRY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CRUSHER.hair;
  ctx.fillRect(-headRX, headY - headRY * 1.02, headRX * 2, headRY * 0.42);
  ctx.fillStyle = CRUSHER.band;
  ctx.fillRect(-headRX, headY - headRY * 0.6, headRX * 2, headRY * 0.32);

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
  spin: number,
  sprites: RepeatSprites = NO_REPEAT_SPRITES,
  squash = 1
): void {
  const crushed = pose === "crushed";
  const sprite = crushed ? sprites.crushed : sprites.can;
  const fallback = crushed
    ? repeatCanMetrics(size / CAN_ROWS).crushed
    : repeatCanMetrics(size / CAN_ROWS).upright;
  // Height is what the layout is expressed in — the lift, the crush point and
  // the palm are all vertical measurements — so the sprite's own aspect decides
  // the width rather than the other way round.
  const h = fallback.h;
  const w = sprite && sprite.height > 0 ? h * (sprite.width / sprite.height) : fallback.w;

  ctx.save();
  // A rolling can turns about its own middle and rests that middle half its
  // width above the bar, so it lies ON the note rather than through it.
  ctx.translate(x, pose === "rolling" ? y - w / 2 : y);
  if (pose === "rolling") ctx.rotate(Math.PI / 2 + spin);
  else if (spin !== 0) ctx.rotate(spin);
  // Volume-preserving, so an over-flattened can is wider rather than simply
  // smaller. Only the crush uses this; everything else passes 1.
  if (squash !== 1) ctx.scale(squash, 1 / squash);

  if (sprite && sprite.width > 0) {
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  // The asset has not loaded. A blocked-in can keeps the mechanic legible
  // rather than leaving a hole where the object the minigame is about should
  // be; an outline first, because a can spends most of its flight over a bright
  // note bar and a pale grey cylinder on a cyan rectangle has no edge.
  const top = -h / 2;
  const rim = Math.max(1, h * 0.14);
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
 * The shock ring out from the point of contact.
 *
 * Flat rather than circular: it is meant to read as travelling across the front
 * of him, and a circle at this size reads as a bubble drawn around his head.
 */
function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  strength: number
): void {
  if (strength <= 0) return;
  ctx.save();
  ctx.globalAlpha = strength * 0.8;
  ctx.strokeStyle = CRUSHER.spark;
  ctx.lineWidth = Math.max(1, r * 0.08 * strength);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * What was in the can, thrown up and out.
 *
 * Placed from the drop's index rather than from a random seed, so the same
 * moment of the same crush draws the same spray on every frame and after any
 * dropped one — position stays a pure function of the beat, like everything
 * else here. Biased upward: a can crushed against a forehead throws its
 * contents over the top of him, not down through his chest.
 */
function drawSpray(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  t: number
): void {
  if (t <= 0 || t >= 1) return;
  ctx.save();
  ctx.globalAlpha = (1 - t) * (1 - t);
  ctx.fillStyle = CRUSHER.spark;
  for (let i = 0; i < SPRAY_DROPS; i += 1) {
    const spread = (i / (SPRAY_DROPS - 1)) * 2 - 1;
    const angle = -Math.PI / 2 + spread * 1.25;
    const speed = size * (1.5 + Math.abs(spread) * 0.9);
    // A ballistic arc rather than a straight line: out at a constant rate, and
    // falling back under its own weight. Droplets that travel radially read as
    // a firework.
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(angle) * speed * t,
      y + Math.sin(angle) * speed * t + size * 2.6 * t * t,
      Math.max(0.8, size * 0.13 * (1 - t * 0.6)),
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
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
  geometry: ActorGeometry,
  sprites: RepeatSprites
): void {
  if (pile === 0) return;
  const unit = geometry.rowHeight * 0.44;
  const perRow = 8;

  ctx.save();
  for (let i = 0; i < pile; i += 1) {
    const row = Math.floor(i / perRow);
    const column = i % perRow;
    // Each row is inset, so a long attempt builds a heap rather than a wall.
    const x = homeX - unit * (perRow / 2) + column * unit + row * unit * 0.5;
    const y = geometry.floorY - row * unit * 0.55;
    if (sprites.crushed) {
      // The same sprite that was just dropped here, so the heap is visibly
      // made of the cans the player watched fall into it rather than of
      // anonymous grey tiles. Alternately flipped and nudged off the grid,
      // because a heap of identical cans in rows is a wall.
      const w = unit * 1.05;
      const h = w * (sprites.crushed.height / sprites.crushed.width);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(x + unit / 2, y - h / 2);
      ctx.rotate(((i % 3) - 1) * 0.16);
      if (i % 2 === 0) ctx.scale(-1, 1);
      ctx.drawImage(sprites.crushed, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = CRUSHER.pile;
      ctx.fillRect(x, y - unit * 0.34, unit * 0.9, unit * 0.34);
    }
  }
  ctx.restore();
}
