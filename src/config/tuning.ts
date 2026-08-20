/**
 * Every provisional tuning number in GOATerizer, in one file.
 *
 * `AGENTS.md` §17 is explicit about design gaps: where the design does not
 * specify a value, do not present a guess as canonical — make it config, label
 * it provisional, document the choice. The GDD lists judgment windows, score
 * values, star thresholds, key weighting and the bass grammar as open tuning
 * decisions (§23), so everything here is a reversible default chosen to make
 * the vertical slice playable, not a design decision.
 *
 * Star thresholds are NOT here: they are per-level authored scenario data and
 * live in `docs/scenarios/rocky-ascent/rocky_ascent.scenario.json`. What lives
 * here is the *metric* those thresholds are denominated in.
 */

/* -------------------------------------------------------------------------- */
/* Judgment windows                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Timing tolerance, in beats, by the target's own subdivision.
 *
 * Beats rather than milliseconds because the GDD's rule is musical: "make Good
 * as forgiving as possible without making the musical sequence ambiguous". A
 * window expressed in beats stays proportionate at every tempo, and the ceiling
 * on `good` is half the distance to the neighbouring target of that
 * subdivision — at exactly half, adjacent Good windows touch but never overlap,
 * so a played note is never claimable by two targets.
 *
 *   quarter  — neighbours 1 beat apart   -> good 0.5   (the GDD's own example)
 *   eighth   — neighbours 0.5 beats apart -> good 0.25
 *   sixteenth— neighbours 0.25 beats apart -> good 0.125
 *
 * Perfect is set well inside Good and tightens with the subdivision. Measured
 * against Tuninator's own published onset error (70ms median on quarter notes,
 * ~94–124ms on triplets and sixteenths), 0.18 beats is 180ms at 60bpm and 77ms
 * at 140bpm, so Perfect stays achievable at the top tempo without being free.
 */
export type SubdivisionWindows = {
  /** Absolute beat offset from the ideal attack that still counts as Perfect. */
  perfect: number;
  /** Absolute beat offset that still counts as Good. Must be >= `perfect`. */
  good: number;
};

export const TIMING_WINDOWS_BEATS: {
  whole: SubdivisionWindows;
  half: SubdivisionWindows;
  quarter: SubdivisionWindows;
  eighth: SubdivisionWindows;
  sixteenth: SubdivisionWindows;
} = {
  whole: { perfect: 0.22, good: 0.5 },
  half: { perfect: 0.2, good: 0.5 },
  quarter: { perfect: 0.18, good: 0.5 },
  eighth: { perfect: 0.11, good: 0.25 },
  sixteenth: { perfect: 0.06, good: 0.125 },
};

/**
 * How long one sustained wrong pitch is muted for before another wrong-note
 * event may fire from it.
 *
 * The Tuninator adapter already emits one attack per `Note`, so a held wrong
 * note cannot spam per analyzer frame by construction. This is the second belt:
 * it also absorbs a fast re-articulation of the same wrong pitch, which is what
 * a player flailing at one bad fret actually produces.
 */
export const WRONG_NOTE_DEBOUNCE_BEATS = 0.25;

/**
 * Whether the right pitch class in the wrong octave counts as a hit.
 *
 * Provisional, and on. Two reasons, both about honesty rather than generosity:
 * octave error is Tuninator's own documented failure mode on guitar (its README
 * lists four separate mitigations for it), and a player who fingers the right
 * note somewhere else on the neck has played the right note. It is capped at
 * Good by {@link OCTAVE_MATCH_MAX_JUDGMENT} so an exact match is always worth
 * more, and so ★★★ still requires the actual written octave.
 */
export const OCTAVE_EQUIVALENT_MATCH = true;
export const OCTAVE_MATCH_MAX_JUDGMENT = "good" as const;

/* -------------------------------------------------------------------------- */
/* Score                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Point values. The GDD fixes only the ordering — `Perfect > Good > Miss`, with
 * Good the lowest *successful* score — and leaves the magnitudes TBD.
 */
export const SCORE_VALUES = {
  perfect: 100,
  good: 40,
  miss: 0,
  wrongNote: 0,
} as const;

/**
 * Streak bonus, added to a successful note's score once the streak passes
 * {@link STREAK_BONUS_MIN_LENGTH}.
 *
 * Scale material is not streak-eligible content — the GDD points streaks at
 * triplets and sixteenth runs — so scenario level data opts in per level
 * (`scoring.streakBonusEligible`). The streak itself is always tracked and
 * always shown in the debug panel; only the bonus is gated.
 */
export const STREAK_BONUS_PER_NOTE = 5;
export const STREAK_BONUS_MIN_LENGTH = 5;
export const STREAK_BONUS_MAX_NOTES = 20;

/** Whether a wrong played note breaks a clean streak. GDD §9.2 default. */
export const WRONG_NOTE_BREAKS_STREAK = true;

/* -------------------------------------------------------------------------- */
/* Stars                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The metric authored star thresholds are denominated in.
 *
 * A star threshold is a cumulative count of *judgment points*, so a level's
 * maximum is `noteOpportunityCount * JUDGMENT_POINTS.perfect`. Authoring
 * ★★★ at exactly that maximum is what makes three stars mean "perfect
 * performance" (GDD §7) rather than "very good".
 */
export const JUDGMENT_POINTS = {
  perfect: 10,
  good: 6,
  miss: 0,
} as const;

/* -------------------------------------------------------------------------- */
/* Latency                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Extra input-latency compensation, in milliseconds, on top of what the
 * AudioContext reports.
 *
 * The measured part is `outputLatency + baseLatency`: the player hears the bass
 * that much after it is scheduled, plays in response, and the response is
 * captured that much after they play. Tuninator's `SourceTimeMs` is derived
 * from a sample count and anchored to the shared AudioContext through
 * `Timebase.originContextTime`, so there is no analysis lag to subtract on top
 * of that — a detected attack already carries the sample time of the attack.
 *
 * This knob exists for rigs the browser under-reports (USB interfaces, wireless
 * headphones). It is surfaced live in the debug panel; a positive value judges
 * the player as having played *earlier* than the raw timestamp says.
 */
export const EXTRA_INPUT_LATENCY_MS = 0;

/** Ignore detections below this confidence entirely. Tuninator gates at 0.35. */
export const MIN_ATTACK_CONFIDENCE = 0.3;

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

/** Beats of future visible to the right of the strike line. GDD §12.1. */
export const TIMELINE_FUTURE_BEATS = 2;
/** Beats of history visible to the left of the strike line. GDD §12.1. */
export const TIMELINE_HISTORY_BEATS = 2;

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

export const BEATS_PER_MEASURE = 4;
export const ATTEMPT_MEASURES = 4;
export const ATTEMPT_BEATS = BEATS_PER_MEASURE * ATTEMPT_MEASURES;
/** Scenario slide transition, in beats. GDD §10: exactly one beat. */
export const TRANSITION_BEATS = 1;
/** Beats of lead-in between pressing Play and the first attempt's beat 1. */
export const RUN_LEAD_IN_BEATS = 4;
