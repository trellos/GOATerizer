/**
 * The scenario content model.
 *
 * A **minigame class** is a reusable behaviour family (`ClimbMinigame`). A
 * **scenario** is an authored content instance belonging to exactly one class
 * (Rocky Ascent). **Scenario level data** is the hand-authored content for one
 * supported difficulty. Nothing here is inferred from a difficulty number.
 *
 * These types describe the *runtime* shape. The authored shape lives in
 * `docs/scenarios/<id>/<id>.scenario.json` and is validated into these by
 * `load.ts`.
 */

import type { NoteDuration } from "../minigame/api.js";
import type { ScaleDegreeRef } from "../music/degrees.js";

export type MinigameClassId =
  | "ClimbMinigame"
  | "PerformMinigame"
  | "TraverseMinigame"
  | "ThreeStepMinigame"
  | "RepeatMinigame"
  | "BattleMinigame";

/**
 * Re-exported: a note's written duration is part of the minigame contract, not
 * of this schema, because a minigame skinning the timeline has to be able to
 * draw a sixteenth differently from a whole note. One definition, in
 * `minigame/api.ts`.
 */
export type { NoteDuration };

export const DURATION_BEATS: Readonly<Record<NoteDuration, number>> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
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
   * Null for a rest. Already normalised out of the authored octave-band token,
   * so nothing downstream parses strings.
   */
  degree: ScaleDegreeRef | null;
};

/** How a scenario uses the four measures of an attempt. */
export type MeasurePlan = {
  attemptMeasures: number;
  beatsPerMeasure: number;
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
};

/** Cumulative judgment-point thresholds. Stars lock once earned. */
export type StarThresholds = {
  passThreshold: number;
  star2Threshold: number;
  star3Threshold: number;
  provisional: boolean;
  note: string;
};

export type RoutePoint = { x: number; y: number };

export type RouteWaypoint = RoutePoint & {
  /** Transform-only variety on one reused sprite. */
  scale: number;
  rotationDeg: number;
};

/**
 * `ClimbMinigame` route data, in normalised scenario space: x rightwards 0..1,
 * y downwards 0..1 with 0 at the top of the frame.
 */
export type RouteData = {
  character: string;
  startPosition: RoutePoint;
  destination: RoutePoint;
  waypoints: readonly RouteWaypoint[];
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
  route: RouteData;
  /** Free-form per-level visual character, passed to the class as parameters. */
  visual: Readonly<Record<string, unknown>>;
};

/**
 * Asset slots are named by the *class*, never by the scenario. `ClimbMinigame`
 * asks for `climberPoses`; Rocky Ascent decides those are goats.
 */
export type ClimbAssetBindings = {
  background: string;
  climberPoses: readonly string[];
  finishPose: string;
  waypointVisuals: readonly string[];
  destinationVisual: string;
  stepEffects: readonly string[];
};

export type ClimbClassParameters = {
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
  badNotePolicy: "Wobble" | "Stall";
  showDestinationFromStart: boolean;
};

export type ScenarioDefinition = {
  id: string;
  displayName: string;
  theme: string;
  minigameClass: MinigameClassId;
  family: string;
  visualVerb: string;
  supportedLevels: readonly number[];
  premise: string;
  classParameters: ClimbClassParameters;
  assetBindings: ClimbAssetBindings;
  /** Asset id -> URL, resolved against the app's base path at load time. */
  assetUrls: Readonly<Record<string, string>>;
  levels: ReadonlyMap<number, ScenarioLevelData>;
};
