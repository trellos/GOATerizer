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
 *
 * A third notation exists for scenarios written in the **pentatonic** scale:
 * `p1`..`p6`, the Blues Lick family's own vocabulary (see
 * {@link PentatonicDegreeRef}). It is the one authored form that cannot be
 * turned into a lane at load time, because which diatonic degree a pentatonic
 * step is depends on the run's mode — the major pentatonic is `1 2 3 5 6`, the
 * minor `1 b3 4 5 b7` — and the mode is rolled at run start. So a pentatonic
 * ref stays pentatonic until {@link resolveDegree} meets a key, in
 * `game/targets.ts`, the one place a degree becomes a pitch.
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

/** One of the five steps of a pentatonic scale, within one octave. */
export type PentatonicStep = 1 | 2 | 3 | 4 | 5;

/**
 * One authored pentatonic degree, not yet a pitch.
 *
 * The vocabulary is `p1..p6`: five steps from the root, then `p6`, the root an
 * octave above — the same root-to-root span the timeline shows, so a pentatonic
 * scenario is written in exactly the pitch space the player can see. There is
 * deliberately nothing below `p1`: the lanes stop at the root, and a lick that
 * dipped under it could only be drawn by moving the note somewhere it was not
 * written.
 *
 * Distinct from {@link ScaleDegreeRef} on purpose: a pentatonic step has no
 * lane until the mode is known, and giving it a `degree` field would invite
 * something to read one that is not there.
 */
export type PentatonicDegreeRef = {
  pentatonic: PentatonicStep;
  /** `0` = the run key's own octave, `1` = the root above it (`p6`). */
  octaveBand: OctaveBand;
};

/** What a scenario's `prompt[]` may carry once parsed: either vocabulary. */
export type AuthoredDegreeRef = ScaleDegreeRef | PentatonicDegreeRef;

export function isPentatonic(ref: AuthoredDegreeRef): ref is PentatonicDegreeRef {
  return "pentatonic" in ref;
}

/**
 * Which diatonic degree each pentatonic step is, per mode.
 *
 * Major pentatonic is the major scale without its 4 and 7; minor pentatonic is
 * the natural minor without its 2 and b6. Both are subsets of the run key's own
 * scale, so every resolved target is diatonic and the lane labels the player
 * already reads (`b3`, `b7` in minor) stay right.
 */
const PENTATONIC_TO_DIATONIC: Readonly<Record<"major" | "minor", readonly Degree[]>> = {
  major: [1, 2, 3, 5, 6],
  minor: [1, 3, 4, 5, 7],
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
export function parseDegreeToken(token: string): AuthoredDegreeRef {
  const pentatonic = /^p([1-6])$/.exec(token);
  if (pentatonic) {
    // `p1..p5` are the five steps from the root; `p6` is the root above them.
    const written = Number(pentatonic[1]);
    return written === 6
      ? { pentatonic: 1, octaveBand: 1 }
      : { pentatonic: written as PentatonicStep, octaveBand: 0 };
  }

  const match = /^(b?)([1-7])$/.exec(token);
  if (!match) throw new DegreeTokenError(token, "expected /^b?[1-7]$/ or /^p[1-6]$/");

  const band = TOKEN_BAND_PREFIX[match[1] ?? ""];
  if (band === undefined) throw new DegreeTokenError(token, "unknown octave-band prefix");

  const degree = Number(match[2]) as Degree;
  if (band === 1 && degree !== 1) {
    throw new DegreeTokenError(token, "the timeline is one octave: band `b` holds only the root");
  }
  return { degree, octaveBand: band };
}

/** Inverse of {@link parseDegreeToken}. Used by tests and by the debug panel. */
export function formatDegreeToken(ref: AuthoredDegreeRef): string {
  if (isPentatonic(ref)) return `p${ref.octaveBand === 1 ? 6 : ref.pentatonic}`;
  return `${ref.octaveBand === 0 ? "" : "b"}${ref.degree}`;
}

/**
 * Resolves an authored degree of either vocabulary into a diatonic
 * {@link ScaleDegreeRef} for a key of the given mode.
 *
 * A diatonic ref passes through untouched. A pentatonic ref becomes the
 * diatonic degree its step is in this mode, and the band above holds only the
 * root — the same rule the diatonic tokens follow, and the reason `p6` exists
 * rather than a `p7` the timeline could not draw.
 *
 * Nothing here moves a note to make it fit. Both vocabularies describe pitches
 * that are already inside the one-octave span, so a ref that could not be drawn
 * is a loud error rather than a silent transposition.
 */
export function resolveDegree(ref: AuthoredDegreeRef, mode: "major" | "minor"): ScaleDegreeRef {
  if (!isPentatonic(ref)) return ref;
  if (ref.octaveBand === 1) {
    if (ref.pentatonic !== 1) {
      throw new DegreeTokenError(
        formatDegreeToken(ref),
        "the timeline is one octave: the band above holds only the root"
      );
    }
    return { degree: 1, octaveBand: 1 };
  }
  const degree = PENTATONIC_TO_DIATONIC[mode][ref.pentatonic - 1];
  if (degree === undefined) {
    throw new DegreeTokenError(formatDegreeToken(ref), "pentatonic step out of range");
  }
  return { degree, octaveBand: 0 };
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
