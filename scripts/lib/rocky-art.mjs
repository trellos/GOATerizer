/**
 * Shared placeholder-art shapes for the "Rocky" scenario family.
 *
 * Rocky Ascent, Rocky Ascent High, Rocky Descent and Rocky Descent High all
 * bind the same class of asset (a goat pose cycle, a foothold, a destination
 * cairn, a dust puff, a tick glint, a mountain backdrop) because they are the
 * same `ClimbMinigame` shapes wearing different route/register data — the
 * scenario files for the three companions say as much explicitly ("Placeholder
 * source families may be reused from the normal version; final art can
 * distinguish the high version later"). This module is that reuse: one set of
 * drawing functions, parameterized by palette and RNG seed so each family gets
 * its own (still deterministic) files rather than four byte-identical copies.
 *
 * Extracted from `generate-placeholder-art.mjs`, which was the first caller and
 * still owns the canonical Rocky Ascent palette and seeds.
 */

import { lcg, Pixels } from "./png.mjs";

export const DEFAULT_PALETTE = {
  skyTop: [26, 34, 58],
  skyMid: [63, 71, 104],
  skyLow: [156, 118, 110],
  skyGlow: [222, 164, 116],
  farRidge: [50, 58, 84],
  midRidge: [66, 72, 96],
  nearRidge: [46, 48, 63],
  snow: [222, 228, 240],
  rock: [122, 122, 132],
  rockLight: [162, 162, 172],
  rockDark: [78, 78, 88],
  rockMoss: [104, 124, 92],
  fur: [238, 230, 214],
  furShade: [206, 196, 178],
  furDark: [120, 108, 92],
  horn: [186, 158, 116],
  eye: [30, 26, 22],
  dust: [214, 202, 178],
  tick: [255, 246, 196],
  tickHot: [255, 255, 255],
};

/**
 * A side-profile goat, facing right, 24x18.
 *
 * `.` transparent, `f` fur, `s` fur shade, `d` dark (outline, hooves, muzzle),
 * `h` horn, `e` eye.
 *
 * The body is shared; only the leg block below it changes per pose, which is
 * what makes four "poses" out of one drawing without four drawings.
 */
const GOAT_BODY = [
  "........................",
  "..................hh....",
  ".................hhh....",
  "...............hhh......",
  "..............ffdd......",
  ".............fffffd.....",
  "....ddddd....ffffed.....",
  "..ddffffdddddffffdd.....",
  ".dffffffffffffffdd......",
  ".dffffffffffffffd.......",
  ".dsffffffffffffsd.......",
  "..dssffffffffssd........",
  "...dsssssssssdd.........",
];

/** Leg blocks, 24 wide x 5 tall. One per advance pose. */
export const GOAT_LEGS = [
  // 01 — square stance
  [
    "...d.f.......f.d........",
    "...d.f.......f.d........",
    "...d.f.......f.d........",
    "...d.f.......f.d........",
    "...dd.d.....dd.d........",
  ],
  // 02 — front reaching up
  [
    "...d.f.......ff.d.......",
    "...d.f......ff..d.......",
    "...d.f.....ff...d.......",
    "...d.f....ff............",
    "...dd.d..dd.............",
  ],
  // 03 — pushing off, rear extended
  [
    "..dd.f.......f.d........",
    ".dd..f.......f.d........",
    "dd...f.......f.d........",
    "d....f.......f.d........",
    "d...dd.......dd.........",
  ],
  // 04 — gathered, both legs tucked
  [
    "....df.......fd.........",
    "....df.......fd.........",
    ".....df.....fd..........",
    ".....df.....fd..........",
    ".....dd.....dd..........",
  ],
];

/** The summit pose: reared up, front legs off the rock, chin insufferably high. */
const GOAT_FINISH = [
  "........................",
  "....................hh..",
  "...................hhh..",
  ".................hhh....",
  "................ffdd....",
  "...............fffffd...",
  "......ddd......ffffed...",
  "....ddfffdd....ffffdd...",
  "...dfffffffddddffffd....",
  "...dffffffffffffffd.....",
  "...dsffffffffffffd......",
  "....dssffffffffsd.......",
  ".....dsssssssssd........",
  "....d.f......ff.........",
  "....d.f.....ff..........",
  "....d.f....ff...........",
  "....dd.d..d.............",
  "......d.................",
];

function goatPalette(C) {
  return { f: C.fur, s: C.furShade, d: C.furDark, h: C.horn, e: C.eye };
}

export function goatPose(legs, C = DEFAULT_PALETTE) {
  const image = new Pixels(24, 18);
  const palette = goatPalette(C);
  image.stamp(0, 0, GOAT_BODY, palette);
  image.stamp(0, GOAT_BODY.length, legs, palette);
  return image;
}

export function goatFinish(C = DEFAULT_PALETTE) {
  const image = new Pixels(24, 18);
  image.stamp(0, 0, GOAT_FINISH, goatPalette(C));
  return image;
}

/** One reusable foothold. Instantiated once per waypoint, transform-varied. */
export function step(C = DEFAULT_PALETTE) {
  const image = new Pixels(18, 11);
  image.fillEllipse(9, 8, 8.5, 3.6, C.rock);
  image.fillEllipse(7, 6.5, 5.5, 2.8, C.rockLight);
  image.fillEllipse(12.5, 7, 3.4, 2, C.rockLight);
  // A couple of dark seams so the shape reads as stone rather than a pill.
  image.fillRect(4, 9, 3, 1, C.rockDark);
  image.fillRect(11, 9, 5, 1, C.rockDark);
  image.fillEllipse(14, 5.6, 1.6, 1, C.rockMoss);
  return image;
}

/** The destination cairn, visible from the start of the attempt. */
export function goal(C = DEFAULT_PALETTE) {
  const image = new Pixels(22, 26);
  const stones = [
    [11, 23, 9.5, 3.2, C.rock],
    [10, 19, 7.5, 3.0, C.rockLight],
    [12, 15.5, 6.0, 2.6, C.rock],
    [10, 12, 4.8, 2.4, C.rockLight],
    [11, 9, 3.6, 2.0, C.rock],
    [11, 6.2, 2.4, 1.8, C.rockLight],
  ];
  for (const [cx, cy, rx, ry, colour] of stones) image.fillEllipse(cx, cy, rx, ry, colour);
  for (const [cx, cy, rx] of stones) {
    image.fillRect(Math.round(cx - rx) + 1, Math.round(cy) + 1, Math.max(2, Math.round(rx)), 1, C.rockDark);
  }
  image.fillEllipse(11, 3.4, 1.6, 1.4, C.rockMoss);
  return image;
}

/** One dust frame. Deliberately a single billboard, not an animation. */
export function dust(C = DEFAULT_PALETTE, seed = 0x5eed) {
  const image = new Pixels(20, 12);
  const random = lcg(seed);
  const puffs = [
    [5, 8, 4.2, 2.6, 210],
    [11, 7.5, 3.6, 2.4, 180],
    [15.5, 9, 2.8, 1.9, 150],
    [8, 5.5, 2.4, 1.8, 120],
  ];
  for (const [cx, cy, rx, ry, alpha] of puffs) {
    image.fillEllipse(cx, cy, rx, ry, [...C.dust, alpha]);
  }
  // Grit, so the edge is not a clean vector blob.
  for (let i = 0; i < 22; i += 1) {
    image.set(
      Math.floor(random() * 20),
      6 + Math.floor(random() * 6),
      [...C.dust, 90 + Math.floor(random() * 90)]
    );
  }
  return image;
}

/** The clean-progress accent: a four-point glint, scaled in and out at runtime. */
export function tick(C = DEFAULT_PALETTE) {
  const image = new Pixels(16, 16);
  const c = 7.5;
  for (let i = 0; i < 16; i += 1) {
    const t = Math.abs(i - c) / c;
    const thickness = Math.max(0, 1 - t) * 1.6;
    for (let w = -thickness; w <= thickness; w += 1) {
      image.set(i, Math.round(c + w), C.tick);
      image.set(Math.round(c + w), i, C.tick);
    }
  }
  // Diagonals, shorter, so it reads as a sparkle rather than a plus sign.
  for (let i = -4; i <= 4; i += 1) {
    const alpha = Math.round(255 * (1 - Math.abs(i) / 5));
    image.set(Math.round(c + i), Math.round(c + i), [...C.tick, alpha]);
    image.set(Math.round(c + i), Math.round(c - i), [...C.tick, alpha]);
  }
  image.fillEllipse(c, c, 2.2, 2.2, C.tickHot);
  return image;
}

/**
 * The scenario backdrop: 384x216 (16:9 at a pixel-art scale).
 *
 * Opaque, with the centre-right corridor left uncluttered so a route of up to
 * thirty footholds stays readable on top of it.
 */
export function background(C = DEFAULT_PALETTE, seed = 0x60a7) {
  const W = 384;
  const H = 216;
  const image = new Pixels(W, H);
  const random = lcg(seed);

  const mix = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];

  // Sky: night at the top grading into a low alpine sunset.
  for (let y = 0; y < H; y += 1) {
    const t = y / H;
    const colour =
      t < 0.55
        ? mix(C.skyTop, C.skyMid, t / 0.55)
        : t < 0.78
          ? mix(C.skyMid, C.skyLow, (t - 0.55) / 0.23)
          : mix(C.skyLow, C.skyGlow, (t - 0.78) / 0.22);
    image.fillRect(0, y, W, 1, colour);
  }

  // Stars, thinning out towards the glow.
  for (let i = 0; i < 90; i += 1) {
    const y = Math.floor(random() * H * 0.5);
    image.set(Math.floor(random() * W), y, [235, 238, 250, 200 - y]);
  }

  /** One ridge line: a sum of sines, so it is deterministic and unfussy. */
  const ridge = (baseY, amplitude, frequency, phase, colour, snowLine) => {
    for (let x = 0; x < W; x += 1) {
      const h =
        Math.sin((x / W) * Math.PI * frequency + phase) * amplitude +
        Math.sin((x / W) * Math.PI * frequency * 2.7 + phase * 1.7) * amplitude * 0.35;
      const top = Math.round(baseY - h);
      image.fillRect(x, top, 1, H - top, colour);
      if (snowLine !== undefined && top < snowLine) {
        image.fillRect(x, top, 1, Math.min(6, snowLine - top), C.snow);
      }
    }
  };

  ridge(120, 42, 3.1, 0.4, C.farRidge, 96);
  ridge(150, 34, 2.3, 2.1, C.midRidge, 128);
  ridge(196, 26, 1.6, 4.2, C.nearRidge);

  // Foreground scree, so the bottom of the frame is not a flat silhouette.
  for (let i = 0; i < 180; i += 1) {
    const x = Math.floor(random() * W);
    const y = 188 + Math.floor(random() * 28);
    image.set(x, y, random() < 0.5 ? C.rockDark : C.nearRidge);
  }

  return image;
}
