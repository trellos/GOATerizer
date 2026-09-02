/**
 * Placeholder art for the GOATS `PerformMinigame` scenario, Goat Frontman.
 *
 * A separate module from `rocky-art.mjs` because it is a different theme with a
 * different palette — a stadium stage under coloured light rather than an
 * alpine dusk — but it deliberately *borrows* the Rocky goat body, in a black
 * coat with gold horns, so the frontman is recognisably the same animal that
 * climbs the mountains. One species, two careers.
 *
 * Slots (`GOATerizer_Scenario_Asset_Slot_Bindings.md` §2, `PerformMinigame`):
 * `background`, `performerPoses[]` (four), `flourishPoses[]` (two),
 * `finishPose`, `signatureProps[]` (a mic stand), `audienceStates[]` (a crowd
 * goat, unimpressed and impressed), `flourishEffects[]`, `accentEffects[]`,
 * `payoffEffects[]`, plus the two timeline note-art pieces the class binds: a
 * stage-light bar for the note body and a star to mark a flourish note.
 *
 * Every file is a static billboard. The crowd goat is drawn once and
 * instantiated up to a few dozen times, varied only by transform — which is
 * the whole art budget of this scenario (GDD §1.3).
 */

import { lcg, Pixels } from "./png.mjs";
import { DEFAULT_PALETTE, goatFinish, goatPose, GOAT_LEGS, tick } from "./rocky-art.mjs";

export const FRONTMAN_PALETTE = {
  // Stage.
  hallTop: [14, 10, 26],
  hallMid: [34, 20, 58],
  hallLow: [64, 32, 84],
  floor: [38, 30, 44],
  floorEdge: [92, 76, 96],
  truss: [70, 70, 84],
  bulb: [255, 236, 170],
  beamPink: [255, 96, 196],
  beamCyan: [96, 224, 255],
  speaker: [28, 28, 34],
  speakerCone: [60, 60, 72],
  // The frontman: a black goat in a black coat with gold horns and a red eye.
  fur: [44, 38, 52],
  furShade: [30, 26, 36],
  furDark: [12, 10, 16],
  /**
   * A rim light along the top edge, and the reason the flourishes read at all.
   *
   * The frontman's coat is nearly black, so his internal drawing is invisible
   * and only his outline carries the pose — and an outline in `furDark` against
   * a dark stage is barely an outline. A lit top edge is what a spotlit figure
   * actually has, and it separates the arch of his back from the hall behind
   * him without lightening the coat and losing the rock-star silhouette.
   */
  furRim: [126, 116, 148],
  horn: [236, 196, 84],
  eye: [250, 70, 70],
  // The crowd is the ordinary white Rocky goat, unchanged.
  crowdFur: DEFAULT_PALETTE.fur,
  crowdShade: DEFAULT_PALETTE.furShade,
  crowdDark: DEFAULT_PALETTE.furDark,
  crowdHorn: DEFAULT_PALETTE.horn,
  crowdEye: DEFAULT_PALETTE.eye,
  mic: [200, 204, 214],
  micDark: [96, 100, 112],
  micHead: [40, 40, 48],
  swoosh: [255, 246, 214],
  burst: [255, 220, 120],
  burstHot: [255, 255, 255],
  star: [255, 214, 72],
  starDark: [200, 140, 32],
  lightBar: [214, 88, 224],
  lightBarBright: [255, 170, 255],
  lightBarDark: [110, 40, 130],
};

function frontmanGoatPalette(C) {
  return { fur: C.fur, furShade: C.furShade, furDark: C.furDark, horn: C.horn, eye: C.eye };
}

/** The four normal-note poses: the Rocky pose cycle, recoloured. */
export function frontmanPose(index, C = FRONTMAN_PALETTE) {
  return goatPose(GOAT_LEGS[index % GOAT_LEGS.length], frontmanGoatPalette(C));
}

/** Completion pose: reared up, chin insufferably high. Same as the summit. */
export function frontmanFinish(C = FRONTMAN_PALETTE) {
  return goatFinish(frontmanGoatPalette(C));
}

/**
 * The two flourish poses, 24x18, facing right, in the same idiom and on the
 * same grid as `rocky-art.mjs`'s goat: `.` transparent, `f` fur, `s` fur
 * shade, `d` dark (outline, hooves, muzzle), `h` horn, `e` eye.
 *
 * These are the only two drawings in the scenario that have to carry a *pose*
 * rather than a creature — the performer's normal cycle is the Rocky goat
 * recoloured, and a pose cycle reads from the legs alone. A flourish has to
 * read at a glance, against a lit backdrop, while the player is looking at the
 * notes: so each one is built around a silhouette that is unmistakable with the
 * detail thrown away — a vertical goat, and a goat bent double.
 *
 * The first attempt at both was drawn as a horizontal mass, like the standing
 * body, and both read as a dark blob: a goat lying down, and a lump. The fix is
 * not more pixels but a different outline.
 */

/**
 * The bend: reared up on the hind legs, head thrown back, front hooves pawing
 * the air — the stadium-rock singer's backbend.
 *
 * The silhouette is **vertical**, which is the whole point: it is the only
 * thing on the timeline taller than it is wide, so it reads as a change of
 * posture even at the edge of vision. The horns sweep back over the neck rather
 * than forward, because a head thrown back is what says "singing" instead of
 * "charging".
 */
const FLOURISH_BEND = [
  "...........hh...........",
  "..........hh.hh.........",
  "..........h...hhd.......",
  ".............dllffd.....",
  "............dlfffffd....",
  "............dfffeffdd...",
  "............dffffffd....",
  ".........ff..dffffd.....",
  "........ff...dffffd.....",
  ".......ff...dlfffffd....",
  "......dd....dlffffffd...",
  "..........ddlffffffd....",
  ".........dslfffffffd....",
  ".........dssffffffdd....",
  ".........dsssffffd......",
  ".........dssssssd.......",
  "..........d.f.f.d.......",
  "..........dd.d.dd.......",
];

/**
 * The slur: the headbang. Back arched high, head driven down and forward,
 * horns pointing at the floor.
 *
 * The opposite silhouette to the bend — a low, humped mass with the head *below*
 * the body — so the two flourishes never read as the same event, which matters
 * because they alternate.
 */
const FLOURISH_HEADBANG = [
  "........................",
  "....llll................",
  "..llffffll..............",
  ".dffffffffdd............",
  ".dsffffffffffd..........",
  ".dssfffffffffffd........",
  "..dsssffffffffffd.......",
  "...ddsssssfffffffd......",
  "...d.f...dsssffffd......",
  "...d.f......ddffdd......",
  "...d.f........dfd.......",
  "...dd.d.......dfd.......",
  "..............dllfd.....",
  ".............dlffffd....",
  ".............dfffefd....",
  ".............ddfffdh....",
  "..............dddhh.....",
  "................hh......",
];

export function frontmanFlourish(kind, C = FRONTMAN_PALETTE) {
  const image = new Pixels(24, 18);
  const rows = kind === "bend" ? FLOURISH_BEND : FLOURISH_HEADBANG;
  image.stamp(0, 0, rows, {
    f: C.fur,
    s: C.furShade,
    d: C.furDark,
    l: C.furRim,
    h: C.horn,
    e: C.eye,
  });
  return image;
}

/**
 * One crowd goat, 16x12, facing LEFT — toward the stage, which sits at the
 * strike line to the crowd's left for every goat on the right wing. The left
 * wing gets the same sprite; a crowd is allowed to look both ways.
 *
 * Two states, one drawing: `neutral` stands and chews, `impressed` is up on
 * its hind legs with its mouth open. The runtime swaps between them at star
 * thresholds; it never animates them.
 */
const CROWD_NEUTRAL = [
  "................",
  "....hh..........",
  "...hh...........",
  "..ddff..........",
  ".deffffddddd....",
  ".dfffffffffffd..",
  "..dffffffffffd..",
  "..ddsffffffssd..",
  "...dssssssssd...",
  "...d.f....f.d...",
  "...d.f....f.d...",
  "...dd.d..dd.d...",
];

const CROWD_IMPRESSED = [
  "hh..............",
  ".hhh............",
  "..ddff..........",
  ".dfffff.........",
  ".deffffd........",
  ".ddffffddd......",
  "..dfffffffdd....",
  "...dfffffffd....",
  "..f.dsffffffd...",
  ".ff.dssffffsd...",
  "dd..dssssssd....",
  "....d.f..f.d....",
];

export function crowdGoat(state, C = FRONTMAN_PALETTE) {
  const image = new Pixels(16, 12);
  const rows = state === "impressed" ? CROWD_IMPRESSED : CROWD_NEUTRAL;
  image.stamp(0, 0, rows, {
    f: C.crowdFur,
    s: C.crowdShade,
    d: C.crowdDark,
    h: C.crowdHorn,
    e: C.crowdEye,
  });
  return image;
}

/** The signature prop: a mic stand, 10x24. Static; the runtime only places it. */
export function micStand(C = FRONTMAN_PALETTE) {
  const image = new Pixels(10, 24);
  image.fillRect(4, 3, 2, 19, C.mic);
  image.fillRect(5, 3, 1, 19, C.micDark);
  // Tripod base.
  image.fillRect(1, 22, 8, 1, C.micDark);
  image.fillRect(0, 23, 10, 1, C.micDark);
  // Boom and head, angled toward the goat.
  image.fillRect(2, 3, 4, 1, C.mic);
  image.fillEllipse(1.5, 2, 1.8, 2.2, C.micHead);
  image.set(1, 1, C.mic);
  return image;
}

/** The flourish accent: a swoosh of stage light, 26x14, one frame. */
export function swoosh(C = FRONTMAN_PALETTE) {
  const image = new Pixels(26, 14);
  for (let x = 0; x < 26; x += 1) {
    const t = x / 25;
    // An arc rising to the right, thicker in the middle, fading at both ends.
    const y = 11 - Math.sin(t * Math.PI) * 9;
    const alpha = Math.round(255 * Math.sin(t * Math.PI) ** 0.6);
    image.set(x, Math.round(y), [...C.swoosh, alpha]);
    if (t > 0.2 && t < 0.8) image.set(x, Math.round(y) + 1, [...C.swoosh, Math.round(alpha * 0.6)]);
  }
  image.fillEllipse(13, 2.5, 1.6, 1.4, C.burstHot);
  return image;
}

/** The small successful-note highlight: the same glint the climb uses. */
export function sparkle(C = FRONTMAN_PALETTE) {
  return tick({ ...DEFAULT_PALETTE, tick: C.burst, tickHot: C.burstHot });
}

/** The ★★★ payoff: a starburst, 36x36, drawn once and scaled up at runtime. */
export function burst(C = FRONTMAN_PALETTE) {
  const image = new Pixels(36, 36);
  const c = 17.5;
  const random = lcg(0xb0b);
  for (let ray = 0; ray < 16; ray += 1) {
    const angle = (ray / 16) * Math.PI * 2;
    const length = 12 + random() * 6;
    for (let r = 3; r < length; r += 0.5) {
      const alpha = Math.round(255 * (1 - r / length));
      image.set(Math.round(c + Math.cos(angle) * r), Math.round(c + Math.sin(angle) * r), [...C.burst, alpha]);
    }
  }
  image.fillEllipse(c, c, 4.2, 4.2, C.burst);
  image.fillEllipse(c, c, 2.4, 2.4, C.burstHot);
  return image;
}

/**
 * The timeline note body: a bar of stage light, 8x12.
 *
 * Banded horizontally and eight pixels wide for the same reason the Rocky ledge
 * is: this one is **stretched to the note's rect**, and horizontal bands
 * stretch cleanly where anything with vertical detail would smear.
 */
export function lightBar(C = FRONTMAN_PALETTE) {
  const image = new Pixels(8, 12);
  image.fillRect(0, 0, 8, 1, C.lightBarBright);
  image.fillRect(0, 1, 8, 2, C.lightBar);
  image.fillRect(0, 3, 8, 2, C.lightBarBright);
  image.fillRect(0, 5, 8, 4, C.lightBar);
  image.fillRect(0, 9, 8, 2, C.lightBarDark);
  image.fillRect(0, 11, 8, 1, C.lightBarDark);
  return image;
}

/**
 * The flourish marker: a gold star, 14x14, drawn as an `overlay` on a
 * flourish note so the player can see the pose coming. It is the one piece of
 * art here that carries gameplay information, so it is deliberately loud.
 */
const STAR = [
  "......d.......",
  "......dd......",
  ".....dssd.....",
  ".....dssd.....",
  "....dsssdd....",
  "dddddsssssddd.",
  ".dsssswsssssd.",
  "..dssssssssd..",
  "...dssssssd...",
  "...dssssssd...",
  "..dssssddssd..",
  "..dsssd..dsd..",
  ".dssd......dd.",
  ".dd...........",
];

export function flourishStar(C = FRONTMAN_PALETTE) {
  const image = new Pixels(14, 14);
  image.stamp(0, 0, STAR, { s: C.star, d: C.starDark, w: C.burstHot });
  return image;
}

/**
 * The backdrop: a stadium stage, 384x216.
 *
 * Dark hall, a lighting truss along the top, two coloured beams crossing the
 * middle band where the notes run, speaker stacks at both wings and a floor
 * strip along the bottom — which is where the frontman stands and where the
 * crowd gathers, below the lanes.
 */
export function background(C = FRONTMAN_PALETTE, seed = 0x5a7e) {
  const W = 384;
  const H = 216;
  const image = new Pixels(W, H);
  const random = lcg(seed);

  const mix = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];

  for (let y = 0; y < H; y += 1) {
    const t = y / H;
    const colour = t < 0.5 ? mix(C.hallTop, C.hallMid, t / 0.5) : mix(C.hallMid, C.hallLow, (t - 0.5) / 0.5);
    image.fillRect(0, y, W, 1, colour);
  }

  // Beams: two translucent cones from the truss, one pink, one cyan.
  const beam = (fromX, toX, halfWidth, colour) => {
    for (let y = 12; y < H - 30; y += 1) {
      const t = (y - 12) / (H - 42);
      const cx = fromX + (toX - fromX) * t;
      const w = 4 + halfWidth * t;
      for (let x = Math.round(cx - w); x <= Math.round(cx + w); x += 1) {
        const edge = 1 - Math.abs(x - cx) / w;
        image.set(x, y, [...colour, Math.round(38 * edge * (1 - t * 0.5))]);
      }
    }
  };
  beam(96, 250, 70, C.beamPink);
  beam(290, 130, 70, C.beamCyan);

  // Truss and bulbs.
  image.fillRect(0, 8, W, 3, C.truss);
  for (let x = 12; x < W; x += 24) {
    image.fillRect(x - 1, 11, 3, 3, C.truss);
    image.fillEllipse(x, 15, 2.2, 2.2, C.bulb);
  }

  // Speaker stacks in both wings.
  const stack = (x) => {
    for (let i = 0; i < 3; i += 1) {
      const y = H - 34 - i * 34;
      image.fillRect(x, y, 30, 32, C.speaker);
      image.fillEllipse(x + 15, y + 12, 9, 9, C.speakerCone);
      image.fillEllipse(x + 15, y + 12, 3.5, 3.5, C.speaker);
      image.fillEllipse(x + 15, y + 26, 4, 4, C.speakerCone);
    }
  };
  stack(6);
  stack(W - 36);

  // Haze: a few drifting motes in the beams.
  for (let i = 0; i < 70; i += 1) {
    image.set(Math.floor(random() * W), 20 + Math.floor(random() * (H - 60)), [255, 255, 255, 40 + Math.floor(random() * 60)]);
  }

  // The stage floor.
  image.fillRect(0, H - 30, W, 30, C.floor);
  image.fillRect(0, H - 30, W, 2, C.floorEdge);
  for (let x = 0; x < W; x += 16) image.fillRect(x, H - 28, 1, 28, [...C.floorEdge, 60]);

  return image;
}
