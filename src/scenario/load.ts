/**
 * Validates authored scenario JSON into the runtime scenario model.
 *
 * The JSON under `docs/scenarios/` is the authority — this module does not
 * repair it, infer missing content, or generate exercises. It throws, loudly,
 * on anything it cannot map, so a bad edit fails a test rather than transposing
 * a note in a run.
 */

import { parseDegreeToken } from "../music/degrees.js";
import type {
  ClimbAssetBindings,
  ClimbClassParameters,
  MeasurePlan,
  MinigameClassId,
  NoteDuration,
  PromptEvent,
  RouteData,
  ScenarioDefinition,
  ScenarioLevelData,
  StarThresholds,
} from "./types.js";
import { DURATION_BEATS } from "./types.js";

export class ScenarioDataError extends Error {
  constructor(where: string, reason: string) {
    super(`Invalid scenario data at ${where}: ${reason}`);
    this.name = "ScenarioDataError";
  }
}

type Json = Record<string, unknown>;

function obj(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScenarioDataError(where, "expected an object");
  }
  return value as Json;
}

function arr(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new ScenarioDataError(where, "expected an array");
  return value;
}

function str(value: unknown, where: string): string {
  if (typeof value !== "string") throw new ScenarioDataError(where, "expected a string");
  return value;
}

function num(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ScenarioDataError(where, "expected a finite number");
  }
  return value;
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new ScenarioDataError(where, "expected a boolean");
  return value;
}

function strings(value: unknown, where: string): string[] {
  return arr(value, where).map((entry, i) => str(entry, `${where}[${i}]`));
}

function duration(value: unknown, where: string): NoteDuration {
  const name = str(value, where);
  if (!(name in DURATION_BEATS)) {
    throw new ScenarioDataError(where, `unknown duration ${JSON.stringify(name)}`);
  }
  return name as NoteDuration;
}

/* -------------------------------------------------------------------------- */

function parsePrompt(raw: unknown, where: string, plan: MeasurePlan): PromptEvent[] {
  const events = arr(raw, where).map((entry, i): PromptEvent => {
    const at = `${where}[${i}]`;
    const event = obj(entry, at);
    const type = str(event["type"], `${at}.type`);
    if (type !== "note" && type !== "rest") {
      throw new ScenarioDataError(`${at}.type`, 'expected "note" or "rest"');
    }

    const dur = duration(event["duration"], `${at}.duration`);
    const durationBeats = num(event["durationBeats"], `${at}.durationBeats`);
    if (durationBeats !== DURATION_BEATS[dur]) {
      throw new ScenarioDataError(
        `${at}.durationBeats`,
        `${durationBeats} does not match ${dur} (${DURATION_BEATS[dur]})`
      );
    }

    const startBeat = num(event["startBeat"], `${at}.startBeat`);
    const rawDegree = event["scaleDegree"];
    if (type === "note" && typeof rawDegree !== "string") {
      throw new ScenarioDataError(`${at}.scaleDegree`, "a note must carry a scale degree");
    }
    if (type === "rest" && rawDegree !== undefined) {
      throw new ScenarioDataError(`${at}.scaleDegree`, "a rest must not carry a scale degree");
    }

    return {
      index: i,
      type,
      duration: dur,
      durationBeats,
      startBeat,
      measureIndex: Math.floor(startBeat / plan.beatsPerMeasure),
      beatWithinMeasure: startBeat % plan.beatsPerMeasure,
      degree: type === "note" ? parseDegreeToken(rawDegree as string) : null,
    };
  });

  // The authored file states `startBeat` explicitly; check it is actually the
  // running sum of the durations rather than trusting two fields to agree.
  let expected = 0;
  for (const event of events) {
    if (Math.abs(event.startBeat - expected) > 1e-9) {
      throw new ScenarioDataError(
        `${where}[${event.index}].startBeat`,
        `${event.startBeat} but the preceding durations total ${expected}`
      );
    }
    expected += event.durationBeats;
  }

  const attemptBeats = plan.attemptMeasures * plan.beatsPerMeasure;
  if (Math.abs(expected - attemptBeats) > 1e-9) {
    throw new ScenarioDataError(where, `durations total ${expected} beats, expected ${attemptBeats}`);
  }
  return events;
}

function parseMeasurePlan(raw: unknown, where: string): MeasurePlan {
  const plan = obj(raw, where);
  return {
    attemptMeasures: num(plan["attemptMeasures"], `${where}.attemptMeasures`),
    beatsPerMeasure: num(plan["beatsPerMeasure"], `${where}.beatsPerMeasure`),
    visualSpanMeasures: num(plan["visualSpanMeasures"], `${where}.visualSpanMeasures`),
    resetBetweenMeasures: bool(plan["resetBetweenMeasures"], `${where}.resetBetweenMeasures`),
  };
}

function parseStars(raw: unknown, where: string): StarThresholds {
  const stars = obj(raw, where);
  const pass = num(stars["passThreshold"], `${where}.passThreshold`);
  const star2 = num(stars["star2Threshold"], `${where}.star2Threshold`);
  const star3 = num(stars["star3Threshold"], `${where}.star3Threshold`);
  if (!(pass <= star2 && star2 <= star3)) {
    throw new ScenarioDataError(where, `thresholds must ascend, got ${pass}/${star2}/${star3}`);
  }
  return {
    passThreshold: pass,
    star2Threshold: star2,
    star3Threshold: star3,
    provisional: stars["provisional"] === true,
    note: typeof stars["note"] === "string" ? stars["note"] : "",
  };
}

function parseRoute(raw: unknown, where: string, expectedWaypoints: number): RouteData {
  const route = obj(raw, where);
  const point = (value: unknown, at: string) => {
    const p = obj(value, at);
    return { x: num(p["x"], `${at}.x`), y: num(p["y"], `${at}.y`) };
  };

  const waypoints = arr(route["waypoints"], `${where}.waypoints`).map((entry, i) => {
    const at = `${where}.waypoints[${i}]`;
    const wp = obj(entry, at);
    return {
      ...point(wp, at),
      scale: num(wp["scale"], `${at}.scale`),
      rotationDeg: num(wp["rotationDeg"], `${at}.rotationDeg`),
    };
  });

  if (waypoints.length !== expectedWaypoints) {
    throw new ScenarioDataError(
      `${where}.waypoints`,
      `${waypoints.length} waypoints for ${expectedWaypoints} note opportunities — ` +
        "one successful note must advance exactly one waypoint"
    );
  }

  return {
    character: str(route["character"], `${where}.character`),
    startPosition: point(route["startPosition"], `${where}.startPosition`),
    destination: point(route["destination"], `${where}.destination`),
    waypoints,
  };
}

function parseLevel(raw: unknown, where: string): ScenarioLevelData {
  const level = obj(raw, where);
  const measurePlan = parseMeasurePlan(level["measurePlan"], `${where}.measurePlan`);
  const prompt = parsePrompt(level["prompt"], `${where}.prompt`, measurePlan);
  const noteCount = prompt.filter((event) => event.type === "note").length;

  const declared = num(level["noteOpportunityCount"], `${where}.noteOpportunityCount`);
  if (declared !== noteCount) {
    throw new ScenarioDataError(
      `${where}.noteOpportunityCount`,
      `declared ${declared}, prompt contains ${noteCount}`
    );
  }

  const visual = obj(level["visual"], `${where}.visual`);
  const scoring = obj(level["scoring"], `${where}.scoring`);

  return {
    difficulty: num(level["difficulty"], `${where}.difficulty`),
    prompt,
    noteOpportunityCount: noteCount,
    authoredBeatCount: num(level["authoredBeatCount"], `${where}.authoredBeatCount`),
    measurePlan,
    stars: parseStars(level["stars"], `${where}.stars`),
    scoring: { streakBonusEligible: bool(scoring["streakBonusEligible"], `${where}.scoring.streakBonusEligible`) },
    route: parseRoute(visual["route"], `${where}.visual.route`, noteCount),
    visual,
  };
}

function parseClimbBindings(raw: unknown, where: string): ClimbAssetBindings {
  const bindings = obj(raw, where);
  const one = (slot: string): string => {
    const values = strings(bindings[slot], `${where}.${slot}`);
    const first = values[0];
    if (values.length !== 1 || first === undefined) {
      throw new ScenarioDataError(`${where}.${slot}`, "expected exactly one asset id");
    }
    return first;
  };
  const many = (slot: string, min: number): string[] => {
    const values = strings(bindings[slot], `${where}.${slot}`);
    if (values.length < min) {
      throw new ScenarioDataError(`${where}.${slot}`, `expected at least ${min} asset ids`);
    }
    return values;
  };

  return {
    background: one("background"),
    climberPoses: many("climberPoses", 1),
    finishPose: one("finishPose"),
    waypointVisuals: many("waypointVisuals", 1),
    destinationVisual: one("destinationVisual"),
    stepEffects: many("stepEffects", 2),
  };
}

function parseClimbParameters(raw: unknown, where: string, plan: MeasurePlan): ClimbClassParameters {
  const params = obj(raw, where);
  const policy = str(params["badNotePolicy"], `${where}.badNotePolicy`);
  if (policy !== "Wobble" && policy !== "Stall") {
    throw new ScenarioDataError(`${where}.badNotePolicy`, 'expected "Wobble" or "Stall"');
  }
  return {
    visualSpanMeasures: num(params["visualSpanMeasures"], `${where}.visualSpanMeasures`),
    resetBetweenMeasures: plan.resetBetweenMeasures,
    badNotePolicy: policy,
    showDestinationFromStart: bool(
      params["showDestinationFromStart"],
      `${where}.showDestinationFromStart`
    ),
  };
}

/* -------------------------------------------------------------------------- */

const KNOWN_CLASSES: ReadonlySet<string> = new Set<MinigameClassId>([
  "ClimbMinigame",
  "PerformMinigame",
  "TraverseMinigame",
  "ThreeStepMinigame",
  "RepeatMinigame",
  "BattleMinigame",
]);

/**
 * @param assetUrls asset id -> resolvable URL. Supplied by the caller so the
 * scenario file stays free of build-tool paths and never hotlinks anything.
 */
export function loadScenario(
  raw: unknown,
  assetUrls: Readonly<Record<string, string>>
): ScenarioDefinition {
  const root = obj(raw, "scenario");
  const id = str(root["id"], "scenario.id");
  const minigameClass = str(root["minigameClass"], "scenario.minigameClass");
  if (!KNOWN_CLASSES.has(minigameClass)) {
    throw new ScenarioDataError("scenario.minigameClass", `unknown class ${minigameClass}`);
  }

  const supportedLevels = arr(root["supportedLevels"], "scenario.supportedLevels").map((entry, i) =>
    num(entry, `scenario.supportedLevels[${i}]`)
  );

  const rawLevels = obj(root["levels"], "scenario.levels");
  const levels = new Map<number, ScenarioLevelData>();
  for (const level of supportedLevels) {
    const entry = rawLevels[String(level)];
    if (entry === undefined) {
      throw new ScenarioDataError("scenario.levels", `level ${level} is supported but absent`);
    }
    const parsed = parseLevel(entry, `scenario.levels.${level}`);
    if (parsed.difficulty !== level) {
      throw new ScenarioDataError(
        `scenario.levels.${level}.difficulty`,
        `is ${parsed.difficulty}`
      );
    }
    levels.set(level, parsed);
  }

  const firstLevel = levels.values().next().value;
  if (!firstLevel) throw new ScenarioDataError("scenario.levels", "no supported levels");

  const bindings = parseClimbBindings(root["assetBindings"], "scenario.assetBindings");
  for (const assetId of [
    bindings.background,
    ...bindings.climberPoses,
    bindings.finishPose,
    ...bindings.waypointVisuals,
    bindings.destinationVisual,
    ...bindings.stepEffects,
  ]) {
    if (assetUrls[assetId] === undefined) {
      throw new ScenarioDataError("scenario.assetBindings", `no URL supplied for ${assetId}`);
    }
  }

  return {
    id,
    displayName: str(root["displayName"], "scenario.displayName"),
    theme: str(root["theme"], "scenario.theme"),
    minigameClass: minigameClass as MinigameClassId,
    family: str(root["family"], "scenario.family"),
    visualVerb: str(root["visualVerb"], "scenario.visualVerb"),
    supportedLevels,
    premise: str(root["scenarioPremise"], "scenario.scenarioPremise"),
    classParameters: parseClimbParameters(
      root["classParameters"],
      "scenario.classParameters",
      firstLevel.measurePlan
    ),
    assetBindings: bindings,
    assetUrls,
    levels,
  };
}
