/**
 * Which lanes a scenario's timeline has, and what a note on one is called.
 *
 * The editor does not have one opinion about pitch: a scenario says how its
 * prompt is written (`runTransposition.promptRepresentation`) and which tokens
 * it uses (`degreeVocabulary`), and both are load-bearing. A diatonic scenario
 * is authored in `1..7 b1` — eight lanes, root to root. A Blues Lick scenario is
 * authored in `p1..p6`, which *cannot* be turned into a lane at authoring time
 * at all: which diatonic degree `p3` is depends on the run's mode, and the mode
 * is rolled at run start (`music/degrees.ts`). So the editor edits the tokens the
 * scenario is written in and never transposes anybody's content into a
 * vocabulary they did not choose.
 *
 * `degreeVocabulary` is narrower still, and also honoured: Can Crushing declares
 * `["1"]` because its performer stands at one lane for the whole attempt, so a
 * note anywhere else is content the scenario cannot play. Those lanes are locked
 * rather than hidden — the row is drawn, and clicking it says why.
 */

const DIATONIC_LANES: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "b1"];
const PENTATONIC_LANES: readonly string[] = ["p1", "p2", "p3", "p4", "p5", "p6"];

export type LaneVocabulary = {
  /** As the scenario's `promptRepresentation` says. */
  readonly representation: "diatonic" | "pentatonic";
  /** Token per lane, lane 0 lowest. The editor's whole pitch model. */
  readonly tokens: readonly string[];
  /** Lanes the scenario's own `degreeVocabulary` permits. */
  readonly allowed: ReadonlySet<number>;
};

export class VocabularyError extends Error {}

/** Reads the lane vocabulary out of a raw scenario file. */
export function laneVocabularyOf(raw: unknown): LaneVocabulary {
  const root = (raw ?? {}) as Record<string, unknown>;
  const transposition = (root["runTransposition"] ?? {}) as Record<string, unknown>;
  const written = transposition["promptRepresentation"];
  const representation =
    written === "pentatonic_scale_degree"
      ? "pentatonic"
      : written === "diatonic_scale_degree"
        ? "diatonic"
        : null;
  if (representation === null) {
    throw new VocabularyError(
      `runTransposition.promptRepresentation is ${JSON.stringify(written)}; ` +
        "expected diatonic_scale_degree or pentatonic_scale_degree"
    );
  }

  const tokens = representation === "pentatonic" ? PENTATONIC_LANES : DIATONIC_LANES;
  const declared = transposition["degreeVocabulary"];
  const allowed = new Set<number>();
  if (Array.isArray(declared) && declared.length > 0) {
    for (const token of declared) {
      const lane = tokens.indexOf(String(token));
      if (lane !== -1) allowed.add(lane);
    }
  }
  // A file that declares nothing usable gets the whole span rather than a
  // timeline with no playable row on it.
  if (allowed.size === 0) tokens.forEach((_, lane) => allowed.add(lane));

  return { representation, tokens, allowed };
}

/** The authored token for a lane. Throws on a lane this vocabulary has no name for. */
export function tokenForLane(vocabulary: LaneVocabulary, lane: number): string {
  const token = vocabulary.tokens[lane];
  if (token === undefined) {
    throw new VocabularyError(`lane ${lane} is outside this scenario's ${vocabulary.tokens.length} lanes`);
  }
  return token;
}

/** Inverse of {@link tokenForLane}. Returns null for a token off this timeline. */
export function laneForToken(vocabulary: LaneVocabulary, token: string): number | null {
  const lane = vocabulary.tokens.indexOf(token);
  return lane === -1 ? null : lane;
}

/**
 * What the lane label reads on the left of the timeline.
 *
 * The authored token, not a harmonic degree label: `b1` here is the octave root
 * above `1`, and calling it a flat — which the *player's* timeline legitimately
 * does in a minor key — would be a different notation with the same spelling
 * (`music/degrees.ts`). An editor shows what is written in the file.
 */
export function laneLabel(vocabulary: LaneVocabulary, lane: number): string {
  return vocabulary.tokens[lane] ?? "?";
}
