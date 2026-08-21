/**
 * Scale degrees, normalised.
 *
 * Two different notations use the letter `b` in this project and they mean
 * completely different things. Confusing them silently transposes the game.
 *
 *   1. **Authored octave-band tokens** — the vocabulary a scenario's `prompt[]`
 *      is written in: `1..7` for the octave the run's tonic sits in, and `b1`
 *      for the root one octave above it. Here `b` is the *band* letter, not an
 *      accidental. `b1` means "first degree, second octave".
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
 * Which octave of the timeline a degree sits in.
 *
 * `0` = the run key's own octave, `1` = the root above it. The timeline is one
 * octave root-to-root, so band 1 exists for degree 1 and nothing else: there is
 * no lane for a second `2`.
 */
export type OctaveBand = 0 | 1;

/** One target pitch, independent of key and of how it was written down. */
export type ScaleDegreeRef = {
  degree: Degree;
  octaveBand: OctaveBand;
};

/** The Key View lanes, low to high: `1 2 3 4 5 6 7 b1`. Index === lane index. */
export const LANE_COUNT = 8;

const TOKEN_BAND_PREFIX: Readonly<Record<string, OctaveBand>> = {
  "": 0,
  b: 1,
};

export class DegreeTokenError extends Error {
  constructor(token: string, reason: string) {
    super(`Bad authored degree token ${JSON.stringify(token)}: ${reason}`);
    this.name = "DegreeTokenError";
  }
}

/**
 * Parses an authored octave-band token (`"1"`, `"7"`, `"b1"`) into a
 * {@link ScaleDegreeRef}.
 *
 * Throws rather than guessing: a scenario file with a typo should fail its
 * validation test, not transpose one note into the wrong octave at runtime.
 * The tokens `b2..b7` and `c1` were the second-octave vocabulary of the old
 * two-octave timeline and are now errors, not silently-folded notes.
 */
export function parseDegreeToken(token: string): ScaleDegreeRef {
  const match = /^(b?)([1-7])$/.exec(token);
  if (!match) throw new DegreeTokenError(token, "expected /^b?[1-7]$/");

  const band = TOKEN_BAND_PREFIX[match[1] ?? ""];
  if (band === undefined) throw new DegreeTokenError(token, "unknown octave-band prefix");

  const degree = Number(match[2]) as Degree;
  if (band === 1 && degree !== 1) {
    throw new DegreeTokenError(token, "the timeline is one octave: band `b` holds only the root");
  }
  return { degree, octaveBand: band };
}

/** Inverse of {@link parseDegreeToken}. Used by tests and by the debug panel. */
export function formatDegreeToken(ref: ScaleDegreeRef): string {
  return `${ref.octaveBand === 0 ? "" : "b"}${ref.degree}`;
}

/** Lane index 0..7, low to high. The Key View's only ordering authority. */
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
