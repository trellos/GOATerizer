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

import type { ScaleDegreeRef } from "../music/degrees.js";

export type MinigameClassId =
  | "ClimbMinigame"
  | "PerformMinigame"
  | "TraverseMinigame"
  | "ThreeStepMinigame"
  | "RepeatMinigame"
  | "BattleMinigame";

export type NoteDuration = "whole" | "half" | "quarter" | "eighth" | "sixteenth";

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

/** How a scenario uses the four measures it authors. */
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
  /**
   * The climber's authored path, in the scenario art panel.
   *
   * **Authored, validated, and no longer drawn.** The actors moved onto the
   * note bars and the art panel became a backdrop
   * (`docs/game-design/PROPOSED_Timeline_Actors.md`), so nothing reads these
   * coordinates at runtime any more. They stay because they are the authored
   * record of each route's shape and the loader still checks the invariant they
   * encode — one waypoint per note opportunity — which is a real authoring
   * check on the *musical* content whatever draws it.
   *
   * Null for a class that never had one: a `RepeatMinigame` performer stands
   * still, and the loader does not invent a path for him.
   */
  route: RouteData | null;
  /** Free-form per-level visual character, passed to the class as parameters. */
  visual: Readonly<Record<string, unknown>>;
};

/**
 * Asset slots are named by the *class*, never by the scenario. `ClimbMinigame`
 * asks for `climberPoses`; Rocky Ascent decides those are goats.
 *
 * Only `background` is drawn today — the scenario panel is a backdrop and the
 * goat is drawn from primitives on the timeline. The rest stay bound: they are
 * the canonical slots from `GOATerizer_Scenario_Asset_Slot_Bindings.md`, the
 * files exist, and they are what the actor layer should draw once it stops
 * being a prototype.
 */
export type ClimbAssetBindings = {
  background: string;
  climberPoses: readonly string[];
  finishPose: string;
  waypointVisuals: readonly string[];
  destinationVisual: string;
  stepEffects: readonly string[];
};

/**
 * Authored, and — like the route — no longer read at runtime: `badNotePolicy`
 * described a wobble in the art panel, and `showDestinationFromStart` a summit
 * cairn nothing draws now. Kept as authored scenario data.
 */
export type ClimbClassParameters = {
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
  badNotePolicy: "Wobble" | "Stall";
  showDestinationFromStart: boolean;
};

/**
 * `RepeatMinigame`'s parameters. Shares nothing with the climb's but the two
 * measure-cycle fields: there is no route to show from the start and no wobble
 * policy, because a wrong note here places a can rather than shaking a climber.
 */
export type RepeatClassParameters = {
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
  /** `sequence`: targets arrive one at a time. `accumulate`: they pile up. */
  repeatMode: "sequence" | "accumulate";
  /**
   * Whether the performer may change lanes at a measure boundary, telegraphed
   * by walking through the preceding one. Designed, not built — every scenario
   * authors `false` today.
   */
  performerMovesBetweenMeasures: boolean;
};

/**
 * `RepeatMinigame`'s slots, from the canonical schema in
 * `GOATerizer_Scenario_Asset_Slot_Bindings.md` §2.
 *
 * A performer who stands still and does one thing over and over to a reusable
 * target. Can Crushing decides the target is a beer can.
 */
export type RepeatAssetBindings = {
  background: string;
  performerNeutral: string;
  performerAction: string;
  performerFinish: string;
  /** The reusable untouched unit — the can. */
  repeatTarget: string;
  /** What it becomes once dealt with. */
  targetCompletedState: string;
  impactEffects: readonly string[];
};

/**
 * Bindings are named by the *class*, and which class a scenario belongs to is
 * what decides the shape. Discriminated so nothing can read `waypointVisuals`
 * off a scenario that has no waypoints.
 */
export type ScenarioAssetBindings =
  | ({ kind: "climb" } & ClimbAssetBindings)
  | ({ kind: "repeat" } & RepeatAssetBindings);

/**
 * Class parameters, discriminated the same way and by the same class decision,
 * so a scenario can only ever carry the parameters its own class reads.
 */
export type ScenarioClassParameters =
  | ({ kind: "climb" } & ClimbClassParameters)
  | ({ kind: "repeat" } & RepeatClassParameters);

export type ScenarioDefinition = {
  id: string;
  displayName: string;
  theme: string;
  minigameClass: MinigameClassId;
  family: string;
  visualVerb: string;
  supportedLevels: readonly number[];
  premise: string;
  classParameters: ScenarioClassParameters;
  assetBindings: ScenarioAssetBindings;
  /** Asset id -> URL, resolved against the app's base path at load time. */
  assetUrls: Readonly<Record<string, string>>;
  levels: ReadonlyMap<number, ScenarioLevelData>;
};
