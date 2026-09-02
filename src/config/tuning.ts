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
 *
 * A few values here are not free choices at all: they MIRROR an internal
 * threshold of Tuninator's, and go stale if the library retunes. Those carry a
 * `MIRRORS Tuninator <path> = <value>` marker, so `grep -rn "MIRRORS Tuninator"`
 * lists everything to re-check when the library moves. Everything without that
 * marker is ours to pick.
 */

// The only import in this file, and type-only: keying the window table by
// `NoteDuration` makes a new duration a compile error here rather than an
// `undefined` window discovered when someone plays the note. `minigame/api.ts`
// imports nothing, so this cannot cycle.
import type { NoteDuration } from "../minigame/api.js";

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

/**
 * The narrowest a Good window is ever allowed to get, whatever the subdivision
 * and whatever the neighbour clamp says.
 *
 * Half a beat — an eighth note either side, at any tempo. This exists because
 * of what the clamp did to a player with a *systematic* offset, which is the
 * common case on a real rig and not something they can feel or fix by playing
 * better.
 *
 * Measured against the real judge on authored material: with the clamp alone,
 * eighth-note material breaks at 0.25 beats of lateness — 167ms at 90bpm — and
 * it breaks as a **cliff**, not a slope. Every note past that point arrives
 * after its own target has expired and is offered to the next one, which is a
 * different pitch, so a single uncompensated latency turns nearly every note
 * into a miss *and* a wrong note at once. Sixty targets, a hundred and twelve
 * failures. That is what "the goat appears briefly then disappears" looks like
 * from the inside.
 *
 * With this floor the same material stays clean to ±0.4 beats (±267ms), on
 * one-pitch material as well as scale material, in both directions.
 *
 * Overlapping windows are safe here, and were always safer than the clamp
 * assumed: `TargetJudge` filters candidates by **pitch** before it picks the
 * nearest in time, and a resolved target is never offered again — so a played
 * note finds the nearest target *that it could actually be*, and one note can
 * never resolve two. The clamp was protecting an invariant the resolver already
 * enforces, and charging a real player for it.
 */
export const GOOD_WINDOW_FLOOR_BEATS = 0.5;

export const TIMING_WINDOWS_BEATS: Readonly<Record<NoteDuration, SubdivisionWindows>> = {
  whole: { perfect: 0.22, good: 0.5 },
  half: { perfect: 0.2, good: 0.5 },
  quarter: { perfect: 0.18, good: 0.5 },
  eighth: { perfect: 0.11, good: 0.25 },
  // Interpolated between its neighbours in length rather than measured: a third
  // of a beat sits between an eighth and a sixteenth, and so does 0.08. The row
  // most likely to want retuning by ear, because it is also the subdivision
  // Tuninator is least accurate on (~94-124ms published onset error).
  eighthTriplet: { perfect: 0.08, good: 1 / 6 },
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
/**
 * Consistency bonus per unbroken note, in judgment-point units, used only by
 * the star meter's second-star comparison (`game/stars.ts`).
 *
 * One against ten for a Perfect, so a flawless attempt's bonus is worth exactly
 * 10% of its own all-Perfect maximum at any note count. PROVISIONAL — a number
 * to play against, not a derived one.
 */
export const CONSISTENCY_POINTS_PER_NOTE = 1;

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
 * The *default* extra input-latency compensation, in milliseconds, on top of what the
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
 * headphones). A positive value judges the player as having played *earlier*
 * than the raw timestamp says.
 *
 * It is a default, not a setting: the player measures their own rig in pregame
 * by playing along to the beat, and the result is remembered in
 * `src/persistence/latency.ts`. This constant is what a rig that has never been
 * measured starts from, and zero is right for that — the browser's own
 * `outputLatency + baseLatency` is already applied, and guessing a correction
 * on top of a number the browser got right would be worse than no correction.
 */
export const EXTRA_INPUT_LATENCY_MS = 0;

/**
 * Ignore detections below this confidence entirely.
 *
 * Deliberately just under the library's own gate, so the adapter never becomes
 * the stricter of the two by accident.
 *
 * MIRRORS Tuninator pitch confidence gate = 0.35
 */
export const MIN_ATTACK_CONFIDENCE = 0.3;

/**
 * How soon after an announced attack a *new* Tuninator `Note` is folded into
 * that attack instead of being announced as a second played note.
 *
 * Tuninator segments one played event into more than one `Note` a measurable
 * fraction of the time — 97 of 459 events in its own corpus. Downstream a
 * fragment is indistinguishable from a second pick: the first resolves the
 * target and the second lands as a wrong note, so one cleanly played note
 * scores as a hit *and* a mistake, and draws two bars on the timeline.
 *
 * Folding them is a translation decision, not a detection one. Tuninator still
 * reports exactly what it reports and no pitch detection happens here, so
 * `AGENTS.md` §4's boundary is intact: this is the adapter deciding what one
 * *played note* means to the game.
 *
 * The value is bracketed from both sides rather than chosen. The floor is what
 * the fragments actually are: Tuninator absorbs a stub into the articulation
 * that shed it only while that stub is younger than its `transient
 * .articulationMs`, 80ms — so the splits that escape absorption and reach the
 * game are the ones that just missed that bound, and a window under 80ms would
 * miss them too. The ceiling is musical: the window must stay below the
 * shortest gap between two notes the player can legitimately be asked for,
 * which is a sixteenth at the fastest tempo, 60000 / (140 * 4) = 107ms. 90ms is
 * the only round number comfortably inside 80..107.
 *
 * Measured from the announced attack rather than from the previous fragment's
 * end, deliberately: `releaseGraceMs` means a legato eighth ends only as the
 * next one begins, so a contiguity rule would swallow real playing.
 *
 * Provisional, and in milliseconds rather than beats because it describes the
 * recognizer's behaviour and the physics of a pick, neither of which knows what
 * tempo the game is at.
 */
export const FRAGMENT_COALESCE_MS = 90;

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * How much musical time the timeline shows either side of the strike line.
 *
 * These two set the scroll speed: the play area is a fixed width, so a note
 * takes `TIMELINE_FUTURE_BEATS` to travel from the right edge to the centre.
 * Doubling them halves the pixels-per-beat, and therefore halves the speed.
 *
 * GDD §12.1 specifies two beats each way. Four is a deliberate, user-requested
 * departure: at two beats a sixteenth-note run arrives too fast to read as
 * pitch — the note is legible only once it is nearly on the line, which is late
 * to be deciding which fret to be on. Four beats trades on-screen density for
 * reading time. The GDD section records the change and the reason.
 *
 * Anything that consumes these must read them rather than assume 2, including
 * the played-note retention window in `ui/timeline/timeline-model.ts`.
 */
export const TIMELINE_FUTURE_BEATS = 4;
/** Beats of history visible to the left of the strike line. Mirrors the future. */
export const TIMELINE_HISTORY_BEATS = 4;

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

export const BEATS_PER_MEASURE = 4;

/**
 * Measures in the authored phrase — the unit a scenario actually composes, and
 * what a level's `measurePlan.attemptMeasures` counts.
 */
export const PHRASE_MEASURES = 4;
export const PHRASE_BEATS = BEATS_PER_MEASURE * PHRASE_MEASURES;

/**
 * How many times an attempt plays that phrase.
 *
 * Two, because one pass at a phrase is a sight-read and nothing else. The
 * player meets the material cold, works out where their hand goes, and the
 * attempt is over — which is a bad way to learn an exercise and a worse way to
 * be scored on one. Playing it twice makes the first pass the read and the
 * second the performance, and the score is the whole thing, so getting it right
 * the second time round redeems the first.
 *
 * This is a *global* rule, not a scenario setting: it is a statement about how
 * long the player gets with any exercise, and a scenario that wanted a
 * different answer would be asking for a different game loop.
 */
export const ATTEMPT_REPEATS = 2;

export const ATTEMPT_MEASURES = PHRASE_MEASURES * ATTEMPT_REPEATS;
export const ATTEMPT_BEATS = BEATS_PER_MEASURE * ATTEMPT_MEASURES;
/** Scenario slide transition, in beats. GDD §10: exactly one beat. */
export const TRANSITION_BEATS = 1;
/** Beats of lead-in between pressing Play and the first attempt's beat 1. */
export const RUN_LEAD_IN_BEATS = 4;

/* -------------------------------------------------------------------------- */
/* Dev autoplay                                                                */
/* -------------------------------------------------------------------------- */

/*
 * Numbers for the dev-only autoplay (`src/dev/auto-performance.ts`).
 *
 * Nothing on the production path reads any of these: they are reachable only
 * from `?dev=1`. They live here anyway because this file's contract is "every
 * provisional tuning number in one place", and a second tuning file for dev
 * values would be the beginning of two conventions.
 *
 * All provisional per `AGENTS.md` §17 — the GDD has no opinion on how badly a
 * fake guitarist should play, so these are reversible defaults chosen to make
 * each tier legible on screen, not design decisions.
 */

/**
 * Seed used when `?seed=N` is absent.
 *
 * Fixed, not `Date.now()`: the point of a seeded autoplay is that
 * `?dev=1&autoplay=50` plays the same performance every time, so a screenshot
 * or a bug report reproduces.
 */
export const AUTOPLAY_DEFAULT_SEED = 1;

/**
 * Share of note opportunities each tier intends to hit.
 *
 * `perfect: 1` is load-bearing, not decorative: `scripts/browser-validate.mjs`
 * asserts three stars from a flawless attempt, and ★★★ is authored at exactly
 * `noteOpportunityCount * JUDGMENT_POINTS.perfect`.
 *
 * On the synthetic-mic path these are *intents*, not measurements — the real
 * recognizer drops the occasional onset, so the achieved rate runs a little
 * under. The deterministic test provider hits them exactly.
 */
export const AUTOPLAY_HIT_RATE = { perfect: 1, "75": 0.75, "50": 0.5, "25": 0.25 } as const;

/**
 * Of the opportunities a tier does *not* hit, the share played as an audible
 * wrong pitch. The rest are simply not played.
 *
 * Weighted towards wrong notes because a bare missed target is nearly
 * invisible — nothing is drawn on the played row at all — and the point of the
 * mode is to make failure legible.
 */
export const AUTOPLAY_WRONG_SHARE = 0.7;

/**
 * Timing jitter on a hit, as a fraction of that target's *clamped Good* window.
 *
 * Below 1 so a hit is never jittered into a miss. Well above `perfect/good`
 * (0.36 for a quarter note) so a decent share of hits land outside Perfect and
 * the Good path gets exercised too, rather than every tier producing a wall of
 * Perfects.
 */
export const AUTOPLAY_HIT_JITTER_FRACTION = 0.6;

/** Chance that an eligible gap between gestures gets one extra wrong note. */
export const AUTOPLAY_NOODLE_CHANCE = 0.35;
/** Below this, a gap has no room for a noodle clear of both neighbours. */
export const AUTOPLAY_NOODLE_MIN_GAP_BEATS = 1;

/** How many of the nearest safe pitches a fumble picks among. */
export const AUTOPLAY_WRONG_NOTE_CANDIDATES = 3;

/**
 * Safety margin added to every Good window when deciding which pitch classes a
 * wrong note may not use.
 *
 * The planner works in exact beats; the synthetic path is judged on Tuninator's
 * onset estimate, which can sit tens of milliseconds either side. Without the
 * margin a "wrong" note planned just outside a window can be detected just
 * inside it and score a Good, which would quietly delete the failure.
 */
export const AUTOPLAY_WRONG_NOTE_MARGIN_BEATS = 0.08;

/** Minimum beats between the end of one gesture and the start of the next. */
export const AUTOPLAY_GESTURE_GAP_BEATS = 0.08;

/**
 * A gesture this close to now is already past; skip it rather than schedule it.
 *
 * `osc.start()` with a past time clamps to now and compresses the envelope, and
 * the test provider's `pump` fires a past event immediately and out of order.
 * Both matter once a mode can be switched on mid-attempt.
 */
export const AUTOPLAY_SCHEDULE_LEAD_SECONDS = 0.02;

/*
 * The synthetic pluck envelope.
 *
 * These are set against Tuninator's own note-tracking thresholds rather than
 * chosen by ear, because the whole job of the envelope is to give the real
 * recognizer an unambiguous note start and note end:
 *
 *   - `tracking.releaseGraceMs: 90` — silence must persist this long before a
 *     Note ends. A gap shorter than that leaves the previous note open, which
 *     is what makes played bars grow until they are pruned.
 *   - `tracking.minStableMs: 55`   — a Note must sound this long to be
 *     announced at all.
 *   - `harmony.mergeMaxGapMs: 120` — the largest silence a merge may bridge.
 *
 * So the gap is set above 90ms and the sounding floor comfortably above 55ms.
 * The tightest real slot is an eighth note at 140bpm (214ms), which leaves
 * 114ms sounding after a 100ms gap — inside both bounds. Sixteenths at speed
 * would not fit, and no registered scenario authors them; if one ever does,
 * the fallback below trades separation for the note existing at all.
 */
export const AUTOPLAY_PLUCK_ATTACK_SECONDS = 0.008;
export const AUTOPLAY_PLUCK_PEAK_GAIN = 0.5;
/**
 * Where the body decays to before the release ramp starts.
 *
 * The old envelope ramped exponentially to 0.0001 across the whole note, which
 * is asymptotically flat — no moment in it reads as "the note stopped", so the
 * recognizer's note end had no fixed relationship to the requested duration.
 * Decaying to a definite floor and then ramping linearly to true zero makes the
 * note-off a locatable event. Measured as no worse and probably better on
 * spurious onsets; see `src/dev/synthetic-guitar.ts` for the numbers and their
 * (small) sample size.
 */
export const AUTOPLAY_PLUCK_BODY_FLOOR_GAIN = 0.05;
export const AUTOPLAY_PLUCK_RELEASE_SECONDS = 0.025;
/**
 * Silence guaranteed after the release, before the next attack.
 *
 * MIRRORS Tuninator tracking.releaseGraceMs = 90 (must exceed it)
 */
export const AUTOPLAY_PLUCK_GAP_SECONDS = 0.1;
/**
 * Sounding floor: a note shorter than this is never announced at all.
 *
 * MIRRORS Tuninator tracking.minStableMs = 55 (must exceed it)
 */
export const AUTOPLAY_PLUCK_MIN_SOUNDING_SECONDS = 0.08;
/** Cap, so a whole note at 60bpm does not drone for four seconds. */
export const AUTOPLAY_PLUCK_MAX_SOUNDING_SECONDS = 0.9;
