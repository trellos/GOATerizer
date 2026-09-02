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
  // The can gets a fuller ramp than anything else in this palette because it is
  // the object the whole minigame is about, and at the size it renders the only
  // thing separating "aluminium cylinder" from "grey rectangle" is a highlight
  // on one side and a shade on the other. Five steps of metal, a label that is
  // its own two colours, and a hard outline so it survives being drawn over a
  // bright note bar.
  canLid: [240, 244, 250],
  canLight: [214, 221, 234],
  can: [176, 185, 202],
  canDark: [124, 133, 152],
  canShadow: [80, 87, 104],
  canLabel: [214, 66, 66],
  canLabelDark: [162, 40, 46],
  canLabelLight: [250, 206, 96],
  outline: [24, 21, 30],
  spark: [255, 246, 196],
  sparkHot: [255, 255, 255],
  foam: [246, 240, 214],
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

/**
 * An intact can, 14x28. The reusable unit — one per note.
 *
 * The first version was a 10x14 grey rectangle with a red stripe across it, and
 * on the timeline it read as neither a can nor anything else — a coloured
 * sliver riding a note bar. Four things fix that, and they are all silhouette
 * or contrast rather than detail, because detail does not survive to the
 * screen at this size:
 *
 *   1. **The taper.** A can is narrower at the lid and the base than through
 *      the middle. That double pinch is the single strongest cue that a shape
 *      is a drinks can and not a box, and it costs two pixels a side.
 *   2. **A lid you can see.** Drawn as a lighter band above a dark rim, with a
 *      pull tab on it — the can is seen fractionally from above, which is how
 *      anyone looking at a can on a table sees one.
 *   3. **A metal ramp across the width.** Highlight, body, shade, in that order
 *      left to right. Flat fill reads as cardboard; a cylinder needs the light
 *      to wrap.
 *   4. **A hard outline.** It spends most of its flight over a bright cyan or
 *      gold note bar, and a pale grey object on a saturated one has no edge at
 *      all without it.
 *
 * Proportioned off a real 12oz can — 66mm across, 122mm tall — rather than
 * chosen by eye. The body here is 10 of 28, which reads slightly stouter than
 * life once the lid is added, and stout is the right error: a can drawn to
 * exact proportion at this size looks like a battery.
 */
export function can(C = CRUSHER_PALETTE) {
  const image = new Pixels(14, 28);

  /**
   * The silhouette, one interior span per row: `[x, width]`.
   *
   * Written as a profile rather than as overlapping rectangles because the
   * taper is the whole point and rectangles kept swallowing it — a lid block
   * and a barrel block that overlap by a row leave no step for the eye to
   * find, which is how the first attempt came out as a straight cylinder with
   * a tab stuck on the end. A profile cannot do that: the step is in the data.
   *
   * Proportioned off a real 12oz can, where the lid end is about four fifths
   * of the body diameter — 8 pixels against 10 here.
   */
  const PROFILE = [
    [4, 6], // 0  lid surface
    [4, 6], // 1  lid surface, tab sits here
    [4, 6], // 2
    [4, 6], // 3  rim, in shadow
    [3, 8], // 4  neck
    [2, 10], // 5  shoulder, out to full width
    ...Array.from({ length: 18 }, () => [2, 10]), // 6..23 barrel
    [3, 8], // 24 base taper
    [3, 8], // 25
    [4, 6], // 26 base
    [4, 6], // 27
  ];

  /**
   * Where the light falls across the barrel, by absolute x.
   *
   * A function of x rather than a set of column fills, so the tapered rows get
   * the same wrap clipped to their own width for free — the specular stays on
   * the same side of the can all the way up instead of sliding as the width
   * changes.
   */
  const metal = (x) => {
    if (x <= 2) return C.canDark; // left edge, already turning away
    if (x === 3) return C.canLight;
    if (x === 4) return C.canLid; // specular, left of centre: light from up-left
    if (x === 5) return C.canLight;
    if (x <= 7) return C.can;
    if (x <= 9) return C.canDark;
    return C.canShadow;
  };
  const label = (x) => {
    if (x <= 2) return C.canLabelDark;
    if (x === 4) return [255, 152, 152];
    if (x <= 7) return C.canLabel;
    if (x <= 9) return C.canLabelDark;
    return [122, 28, 34];
  };

  const LABEL_TOP = 11;
  const LABEL_BOTTOM = 19;

  PROFILE.forEach(([x, w], y) => {
    for (let dx = 0; dx < w; dx += 1) {
      const px = x + dx;
      const inLabel = y >= LABEL_TOP && y <= LABEL_BOTTOM;
      image.set(px, y, inLabel ? label(px) : metal(px));
    }
    // Outline, one pixel either side of the span on every row — including the
    // tapered ones, which is what makes the step legible.
    image.set(x - 1, y, C.outline);
    image.set(x + w, y, C.outline);
  });

  // Caps, and the internal edges the profile cannot express.
  image.fillRect(4, 0, 6, 1, C.outline); // top of the lid
  image.fillRect(4, 27, 6, 1, C.outline); // bottom of the base
  image.fillRect(4, 3, 6, 1, C.canShadow); // rim, under the lid
  image.fillRect(4, 1, 6, 1, C.canLid); // lid catches the most light
  image.fillRect(6, 2, 3, 1, C.canDark); // the pull tab
  image.fillRect(4, 26, 6, 1, C.canShadow); // underside, in its own shadow

  // Label edges, so it reads as printed on the can rather than as the can
  // changing colour halfway down.
  image.fillRect(2, LABEL_TOP, 10, 1, [122, 28, 34]);
  image.fillRect(2, LABEL_BOTTOM, 10, 1, [122, 28, 34]);
  image.fillRect(2, 14, 10, 2, C.canLabelLight);
  image.set(4, 14, C.canLid);
  image.set(4, 15, C.canLid);
  return image;
}

/**
 * The same can, dealt with. 22x11.
 *
 * A crushed can is not a short can, and the old one — the same rectangle at a
 * third of the height — is exactly the mistake that reads as "the can got
 * smaller". What says *crushed* is asymmetry and folds: it is wider than it was
 * because the metal had to go somewhere, the lid survives as a recognisable
 * disc at one end while the other end is mangled, and the concertina creases
 * run across it. None of that is symmetrical, so none of it is drawn
 * symmetrically.
 */
export function canCrushed(C = CRUSHER_PALETTE) {
  const image = new Pixels(24, 12);

  /**
   * The top edge, per column. The bottom is flat at {@link FLOOR}, because the
   * thing is lying on something.
   *
   * Only the top varies, and only ever by a pixel at a time. An earlier version
   * varied both edges by up to three and came out as a row of teeth — at this
   * size a silhouette that moves faster than one pixel per column stops reading
   * as a dented object and starts reading as a comb. The buckling lives in the
   * shading instead, where it can be as violent as it likes.
   *
   * Still lopsided, which is the part worth keeping: the lid end kept its rigid
   * disc so it stands tallest, the middle took the blow, and the far end splayed
   * because the metal had to go somewhere.
   */
  const FLOOR = 9;
  const TOP = [2, 2, 3, 3, 4, 3, 4, 4, 4, 5, 5, 4, 4, 3, 3, 4, 4, 4, 5, 5, 6, 6];

  /**
   * The concertina, as creases rather than as facets.
   *
   * The version before this gave each buckled column its own full-height tone,
   * alternating bright and dark, and it read as a row of separate pillars —
   * the object came apart into stripes. A fold in sheet metal is a *line* with
   * a highlight beside it, not a differently coloured panel, so each entry here
   * is one dark column with one light one next to it and the body tone
   * everywhere else. Unevenly spaced, because regular spacing reads as
   * corrugated sheet rather than as something that failed under a hand.
   */
  const CREASES = [3, 6, 10, 14, 18];

  /** What is left of the label: a band, buckled with the metal, not a stripe. */
  const LABEL_FROM = 6;
  const LABEL_TO = 16;

  TOP.forEach((top, index) => {
    const x = index + 1;
    const crease = CREASES.includes(index)
      ? C.canDark
      : CREASES.includes(index - 1)
        ? C.canLight
        : null;
    for (let y = top; y <= FLOOR; y += 1) {
      // Top row bright, bottom row dark, so it reads as one crumpled tube lit
      // from above. The label only covers the middle rows: it was printed
      // around the barrel, so the lit crown and the shaded underside still show
      // bare metal.
      const labelled =
        index >= LABEL_FROM && index <= LABEL_TO && y > top + 1 && y < FLOOR - 1;
      image.set(
        x,
        y,
        y === top
          ? C.canLight
          : y === FLOOR
            ? C.canShadow
            : labelled
              ? (crease === C.canDark ? C.canLabelDark : C.canLabel)
              : (crease ?? C.can)
      );
    }
    image.set(x, top - 1, C.outline);
    image.set(x, FLOOR + 1, C.outline);
  });

  // Ends, capped. The lid end keeps its rim — the one part of a crushed can
  // that still shows what it used to be — and the far end is torn open.
  image.fillRect(0, 1, 1, 10, C.outline);
  image.fillRect(1, 1, 1, 1, C.outline);
  image.fillRect(23, 5, 1, 6, C.outline);
  image.fillRect(22, 6, 1, 4, C.canShadow);
  image.fillRect(1, 2, 1, 8, C.canLid);
  image.fillRect(2, 2, 1, 1, C.canLight);
  return image;
}

/**
 * The crush impact — a short burst, one frame, no animation.
 *
 * Bigger and hotter than the first version, which was a pale blob at the size
 * it actually drew. A white core with a warm corona around it, and the spray
 * biased upward and outward: a can crushed against a forehead throws its
 * contents up and sideways, not down through the man holding it.
 */
export function crushImpact(C = CRUSHER_PALETTE, seed = 0xca11) {
  const image = new Pixels(28, 22);
  const random = lcg(seed);

  // Spray. Upper hemisphere only, and length varying with angle so the burst
  // has spikes rather than a uniform fuzz ring.
  for (let i = 0; i < 26; i += 1) {
    const angle = Math.PI + random() * Math.PI;
    const radius = 4 + random() * 9;
    const x = Math.round(14 + Math.cos(angle) * radius);
    const y = Math.round(12 + Math.sin(angle) * radius * 0.8);
    image.fillRect(x, y, 1 + Math.round(random() * 2), 1, random() > 0.55 ? C.foam : C.spark);
  }
  // Four hard spikes on top of the spray, so it reads as an impact rather than
  // as a cloud.
  for (const angle of [-2.6, -2.0, -1.1, -0.5]) {
    for (let r = 4; r < 12; r += 1) {
      image.set(Math.round(14 + Math.cos(angle) * r), Math.round(12 + Math.sin(angle) * r * 0.8), C.spark);
    }
  }
  image.fillEllipse(14, 12, 5.2, 3.4, C.spark);
  image.fillEllipse(14, 12, 3.0, 2.0, C.sparkHot);
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
