/**
 * Scale degrees, normalised.
 *
 * Two different notations use the letter `b` in this project and they mean
 * completely different things. Confusing them silently transposes the game.
 *
 *   1. **Authored octave-band tokens** — the vocabulary Rocky Ascent's
 *      `prompt[]` is written in: `1..7` for the first octave, `b1..b7` for the
 *      second octave, `c1` for the root two octaves up. Here `b` is the *band*
 *      letter, not an accidental. `b3` means "third degree, second octave".
 *
 *   2. **Harmonic degree labels** — what the timeline shows the player:
 *      `1 2 b3 4 5 b6 b7` in a minor key. Here `b` *is* a flat.
 *
 * Nothing downstream of {@link parseDegreeToken} sees either string form. The
 * engine works in {@link ScaleDegreeRef}, which has no notation at all.
 */

/** Diatonic degree within the run key's scale. */
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Which octave of the two-octave timeline a degree sits in.
 *
 * `0` = first octave, `1` = second octave, `2` = the top root only. There is no
 * band 2 for anything but degree 1: the timeline stops at the two-octave root.
 */
export type OctaveBand = 0 | 1 | 2;

/** One target pitch, independent of key and of how it was written down. */
export type ScaleDegreeRef = {
  degree: Degree;
  octaveBand: OctaveBand;
};

/** The 15 Key View lanes, low to high. Index === lane index. */
export const LANE_COUNT = 15;

const TOKEN_BAND_PREFIX: Readonly<Record<string, OctaveBand>> = {
  "": 0,
  b: 1,
  c: 2,
};

export class DegreeTokenError extends Error {
  constructor(token: string, reason: string) {
    super(`Bad authored degree token ${JSON.stringify(token)}: ${reason}`);
    this.name = "DegreeTokenError";
  }
}

/**
 * Parses an authored octave-band token (`"1"`, `"b3"`, `"c1"`) into a
 * {@link ScaleDegreeRef}.
 *
 * Throws rather than guessing: a scenario file with a typo should fail its
 * validation test, not transpose one note into the wrong octave at runtime.
 */
export function parseDegreeToken(token: string): ScaleDegreeRef {
  const match = /^([bc]?)([1-7])$/.exec(token);
  if (!match) throw new DegreeTokenError(token, "expected /^[bc]?[1-7]$/");

  const band = TOKEN_BAND_PREFIX[match[1] ?? ""];
  if (band === undefined) throw new DegreeTokenError(token, "unknown octave-band prefix");

  const degree = Number(match[2]) as Degree;
  if (band === 2 && degree !== 1) {
    throw new DegreeTokenError(token, "the third octave band holds only the root (`c1`)");
  }
  return { degree, octaveBand: band };
}

/** Inverse of {@link parseDegreeToken}. Used by tests and by the debug panel. */
export function formatDegreeToken(ref: ScaleDegreeRef): string {
  const prefix = ref.octaveBand === 0 ? "" : ref.octaveBand === 1 ? "b" : "c";
  return `${prefix}${ref.degree}`;
}

/** Lane index 0..14, low to high. The Key View's only ordering authority. */
export function laneIndexOf(ref: ScaleDegreeRef): number {
  return ref.octaveBand * 7 + (ref.degree - 1);
}

/** Inverse of {@link laneIndexOf}. */
export function laneToDegreeRef(lane: number): ScaleDegreeRef {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_COUNT) {
    throw new RangeError(`lane ${lane} outside 0..${LANE_COUNT - 1}`);
  }
  const octaveBand = Math.floor(lane / 7) as OctaveBand;
  const degree = ((lane % 7) + 1) as Degree;
  return { degree, octaveBand };
}

/** Every lane, low to high. */
export const ALL_LANES: readonly ScaleDegreeRef[] = Array.from({ length: LANE_COUNT }, (_, i) =>
  laneToDegreeRef(i)
);
