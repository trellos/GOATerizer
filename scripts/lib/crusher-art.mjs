/**
 * Placeholder art for the 80s `RepeatMinigame` scenario, Can Crushing.
 *
 * PROTOTYPE. A separate module from `rocky-art.mjs` because it is a different
 * theme with a different palette — the Rocky family is alpine dusk, this is a
 * beach party at golden hour — and because the two share no shapes. The
 * drawing style and the deterministic-seed discipline are the same.
 *
 * Slots: `background`, `performerNeutral`, `performerAction`, `performerFinish`,
 * `repeatTarget` (an intact can), `targetCompletedState` (a crushed one), and
 * one impact effect.
 */

import { lcg, Pixels } from "./png.mjs";

export const CRUSHER_PALETTE = {
  skyTop: [58, 42, 84],
  skyMid: [148, 84, 104],
  skyLow: [232, 138, 92],
  skySun: [255, 206, 128],
  sea: [46, 72, 110],
  seaLight: [78, 116, 150],
  sand: [206, 170, 118],
  sandDark: [162, 128, 88],
  skin: [226, 168, 122],
  skinShade: [186, 132, 92],
  vest: [232, 96, 96],
  band: [252, 220, 96],
  hair: [64, 44, 40],
  can: [206, 210, 218],
  canLight: [238, 242, 248],
  canDark: [128, 134, 146],
  canLabel: [220, 72, 72],
  spark: [255, 246, 196],
};

/**
 * The bro, 20x22. `.` transparent, `k` skin, `s` skin shade, `v` vest,
 * `b` headband, `h` hair, `d` outline.
 *
 * Two poses from one body, exactly as the goat does it: the arm block is the
 * only thing that changes between "ready" and "crushing".
 */
const BRO_BODY = [
  "....................",
  ".......hhhhhh.......",
  "......hhhhhhhh......",
  "......bbbbbbbb......",
  "......hkkkkkkh......",
  ".......kkkkkk.......",
  ".......kdkkdk.......",
  ".......kkkkkk.......",
  "........kkkk........",
  "......vvvvvvvv......",
  ".....vvvvvvvvvv.....",
  ".....vvvvvvvvvv.....",
  ".....vvvvvvvvvv.....",
  "......kkkkkkkk......",
  "......kkkkkkkk......",
];

/** Arm blocks, 20 wide x 7 tall. */
const BRO_ARMS_READY = [
  "...kk........kk.....",
  "...kk........kk.....",
  "...kk........kk.....",
  "....k........k......",
  "....kk......kk......",
  ".....ss....ss.......",
  "....................",
];

const BRO_ARMS_CRUSH = [
  ".kkk..........kkk...",
  ".kkk..........kkk...",
  "..kk..........kk....",
  "..kkk........kkk....",
  "...kkkk....kkkk.....",
  "....ssssssssss......",
  "....................",
];

const BRO_ARMS_FINISH = [
  "kk................kk",
  "kk................kk",
  ".kk..............kk.",
  "..kk............kk..",
  "...kk..........kk...",
  "....ss........ss....",
  "....................",
];

function broPalette(C) {
  return { k: C.skin, s: C.skinShade, v: C.vest, b: C.band, h: C.hair, d: C.hair };
}

function bro(arms, C = CRUSHER_PALETTE) {
  const image = new Pixels(20, 22);
  const palette = broPalette(C);
  image.stamp(0, 0, BRO_BODY, palette);
  image.stamp(0, BRO_BODY.length, arms, palette);
  return image;
}

export function broNeutral(C = CRUSHER_PALETTE) {
  return bro(BRO_ARMS_READY, C);
}

export function broAction(C = CRUSHER_PALETTE) {
  return bro(BRO_ARMS_CRUSH, C);
}

export function broFinish(C = CRUSHER_PALETTE) {
  return bro(BRO_ARMS_FINISH, C);
}

/** An intact can, 10x14. The reusable unit — one per note. */
export function can(C = CRUSHER_PALETTE) {
  const image = new Pixels(10, 14);
  image.fillRect(1, 1, 8, 12, C.can);
  image.fillRect(2, 1, 2, 12, C.canLight);
  image.fillRect(7, 1, 2, 12, C.canDark);
  image.fillRect(1, 0, 8, 2, C.canDark);
  image.fillRect(1, 12, 8, 2, C.canDark);
  // A label band, so a crushed one is obviously the same object flattened.
  image.fillRect(1, 5, 8, 4, C.canLabel);
  return image;
}

/** The same can, dealt with. Same width, a third of the height. */
export function canCrushed(C = CRUSHER_PALETTE) {
  const image = new Pixels(12, 6);
  image.fillRect(0, 2, 12, 3, C.can);
  image.fillRect(1, 2, 10, 1, C.canLight);
  image.fillRect(0, 4, 12, 1, C.canDark);
  image.fillRect(3, 2, 5, 2, C.canLabel);
  // Splayed ends, because a crushed can is wider than it was.
  image.fillRect(0, 1, 2, 4, C.canDark);
  image.fillRect(10, 1, 2, 4, C.canDark);
  return image;
}

/** The crush impact — a short burst, one frame, no animation. */
export function crushImpact(C = CRUSHER_PALETTE, seed = 0xca11) {
  const image = new Pixels(18, 14);
  const random = lcg(seed);
  for (let i = 0; i < 14; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 3 + random() * 5;
    const x = Math.round(9 + Math.cos(angle) * radius);
    const y = Math.round(7 + Math.sin(angle) * radius * 0.7);
    image.fillRect(x, y, 1 + Math.round(random()), 1, C.spark);
  }
  image.fillEllipse(9, 7, 3.2, 2.2, C.spark);
  return image;
}

/**
 * Beach at golden hour. Opaque; the timeline is drawn over it.
 *
 * 384x216, matching the Rocky family, because a background is now stretched
 * across the whole frame rather than into a third of it — at half that it is
 * visibly chunkier than the scenario next door.
 */
export function beachBackground(C = CRUSHER_PALETTE, seed = 0xbea0) {
  const width = 384;
  const height = 216;
  const image = new Pixels(width, height);
  const random = lcg(seed);

  for (let y = 0; y < height; y += 1) {
    const t = y / height;
    const colour =
      t < 0.35
        ? mix(C.skyTop, C.skyMid, t / 0.35)
        : t < 0.55
          ? mix(C.skyMid, C.skyLow, (t - 0.35) / 0.2)
          : C.sea;
    image.fillRect(0, y, width, 1, colour);
  }

  // Sun, low and fat.
  image.fillEllipse(width * 0.68, height * 0.42, width * 0.068, width * 0.068, C.skySun);

  // Sea glitter, then the beach.
  for (let i = 0; i < 360; i += 1) {
    const x = Math.round(random() * width);
    const y = Math.round(height * 0.56 + random() * height * 0.2);
    image.fillRect(x, y, 1 + Math.round(random() * 2), 1, C.seaLight);
  }
  image.fillRect(0, Math.round(height * 0.76), width, height, C.sand);
  for (let i = 0; i < 480; i += 1) {
    const x = Math.round(random() * width);
    const y = Math.round(height * 0.78 + random() * height * 0.2);
    image.fillRect(x, y, 1, 1, C.sandDark);
  }
  return image;
}

function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}
