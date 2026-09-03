/**
 * The scenario content model.
 *
 * A **minigame class** is a reusable behaviour family (`ClimbMinigame`). A
 * **scenario** is an authored content instance belonging to exactly one class
 * (Rocky Ascent). **Scenario level data** is the hand-authored content for one
 * supported difficulty. Nothing here is inferred from a difficulty number.
 *
 * These types describe the *runtime* shape. The authored shape lives in
 * `docs/scenarios/<id>.scenario.json` and is validated into these by
 * `load.ts`.
 */

import type { MinigameId, NoteDuration } from "../minigame/api.js";
import type { AuthoredDegreeRef } from "../music/degrees.js";

/**
 * Re-exported: a note's written duration is part of the minigame contract, not
 * of this schema, because a minigame skinning the timeline has to be able to
 * draw a sixteenth differently from a whole note. One definition, in
 * `minigame/api.ts`.
 */
export type { NoteDuration };

/**
 * A minigame's stable identity, as written in scenario data.
 *
 * An open string resolved through `minigame/registry.ts`, not a closed union:
 * the six canonical families are design vocabulary, and a seventh must not
 * require editing this file.
 */
export type { MinigameId };

/**
 * The written length of each duration, in beats.
 *
 * Every value but one is a binary fraction and therefore exact in floating
 * point. `eighthTriplet` is 1/3, which is not, and that single fact is why
 * `load.ts` treats an authored `durationBeats` as a checksum to verify rather
 * than a number to trust: no decimal an author can type is exactly a third, and
 * twelve of `0.333` do not add up to a measure.
 */
export const DURATION_BEATS: Readonly<Record<NoteDuration, number>> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  eighthTriplet: 1 / 3,
  sixteenth: 0.25,
};

/** One authored event in a level's prompt — a note opportunity or a rest. */
export type PromptEvent = {
  index: number;
  type: "note" | "rest";
  duration: NoteDuration;
  durationBeats: number;
  /** Beats from the start of the attempt. */
  startBeat: number;
  /** 0-based. */
  measureIndex: number;
  /** 0-based beat position inside its measure. */
  beatWithinMeasure: number;
  /**
   * Null for a rest. Already normalised out of the authored token, so nothing
   * downstream parses strings. Either vocabulary: a diatonic octave-band ref,
   * or a pentatonic one that `game/targets.ts` resolves once the run's mode is
   * known (`music/degrees.ts`).
   */
  degree: AuthoredDegreeRef | null;
};

/**
 * The musical length of an attempt.
 *
 * Only the two facts the host needs. *How* a scenario uses those measures —
 * whether a visual cycle spans one, two or all of them, and what a boundary
 * resets — belongs to the minigame and lives in its own level data: a BATTLE
 * scenario varies it by difficulty, which no host-owned flag could express.
 */
export type MeasurePlan = {
  /**
   * Measures in the authored **phrase**, which is what the loader validates the
   * prompt's durations against — not the length of an attempt. An attempt plays
   * the phrase `ATTEMPT_REPEATS` times, and that expansion happens once, in
   * `game/targets.ts`. The name predates the repeat and is kept because it is
   * the key in every authored scenario file.
   */
  attemptMeasures: number;
  beatsPerMeasure: number;
};

/** Cumulative judgment-point thresholds. Stars lock once earned. */
export type StarThresholds = {
  passThreshold: number;
  star2Threshold: number;
  star3Threshold: number;
  provisional: boolean;
  note: string;
};

export type ScenarioLevelData = {
  difficulty: number;
  prompt: readonly PromptEvent[];
  /** Notes only; rests never create an opportunity. */
  noteOpportunityCount: number;
  authoredBeatCount: number;
  measurePlan: MeasurePlan;
  stars: StarThresholds;
  scoring: { streakBonusEligible: boolean };
  /**
   * Whatever this scenario's minigame returned from `parseLevel`. Opaque: the
   * host stores and forwards it and never looks inside, which is what lets a
   * family define its own level shape without editing this file.
   */
  data: unknown;
};

export type ScenarioDefinition = {
  id: string;
  displayName: string;
  theme: string;
  /** Which minigame plays this scenario. Resolved through `minigame/registry`. */
  minigameId: MinigameId;
  family: string;
  visualVerb: string;
  supportedLevels: readonly number[];
  premise: string;
  /**
   * Whatever this scenario's minigame returned from `parseConfig`. Opaque, for
   * the same reason as {@link ScenarioLevelData.data}.
   */
  config: unknown;
  /** Asset id -> URL, resolved against the app's base path at load time. */
  assetUrls: Readonly<Record<string, string>>;
  levels: ReadonlyMap<number, ScenarioLevelData>;
};
