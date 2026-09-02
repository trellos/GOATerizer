/**
 * Validates authored scenario JSON into the runtime scenario model.
 *
 * The JSON under `docs/scenarios/` is the authority — this module does not
 * repair it, infer missing content, or generate exercises. It throws, loudly,
 * on anything it cannot map, so a bad edit fails a test rather than transposing
 * a note in a run.
 *
 * It validates only what the *host* owns: identity, the prompt, the measure
 * length, star thresholds and scoring flags. Everything that varies by minigame
 * — asset slots, class parameters, routes, rows, arenas — is handed to that
 * minigame's own parsers, because only it knows the shape. That dispatch is
 * what lets a scenario define whatever data its minigame wants while keeping
 * this file free of any minigame's vocabulary.
 */

import { requireMinigame } from "../minigame/registry.js";
import { parseDegreeToken } from "../music/degrees.js";
import { arr, bool, num, obj, ScenarioDataError, str } from "./parse.js";
import type {
  MeasurePlan,
  PromptEvent,
  ScenarioDefinition,
  ScenarioLevelData,
  StarThresholds,
} from "./types.js";
import { DURATION_BEATS, type NoteDuration } from "./types.js";

export { ScenarioDataError } from "./parse.js";

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

function parseLevel(
  raw: unknown,
  where: string,
  parseMinigameData: (visual: unknown, shape: { noteOpportunityCount: number; measures: number }) => unknown
): ScenarioLevelData {
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

  const scoring = obj(level["scoring"], `${where}.scoring`);

  return {
    difficulty: num(level["difficulty"], `${where}.difficulty`),
    prompt,
    noteOpportunityCount: noteCount,
    authoredBeatCount: num(level["authoredBeatCount"], `${where}.authoredBeatCount`),
    measurePlan,
    stars: parseStars(level["stars"], `${where}.stars`),
    scoring: { streakBonusEligible: bool(scoring["streakBonusEligible"], `${where}.scoring.streakBonusEligible`) },
    data: parseMinigameData(level["visual"], {
      noteOpportunityCount: noteCount,
      measures: measurePlan.attemptMeasures,
    }),
  };
}

/* -------------------------------------------------------------------------- */

/**
 * @param urlFor asset id -> resolvable URL. Supplied by the caller so the
 * scenario file stays free of build-tool paths and never hotlinks anything, and
 * so the *minigame* decides which ids exist rather than the host guessing them
 * from a naming convention.
 */
export function loadScenario(
  raw: unknown,
  urlFor: (assetId: string) => string
): ScenarioDefinition {
  const root = obj(raw, "scenario");
  const id = str(root["id"], "scenario.id");
  const minigameId = str(root["minigameClass"], "scenario.minigameClass");
  const minigame = requireMinigame(minigameId, `scenario ${id}`);

  // The minigame validates its own half. A scenario is free to carry whatever
  // shape its minigame asks for; this loader never looks inside either blob.
  const config = minigame.parseConfig({
    classParameters: root["classParameters"],
    assetBindings: root["assetBindings"],
  });

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
    const parsed = parseLevel(entry, `scenario.levels.${level}`, (visual, shape) =>
      minigame.parseLevel(visual, shape)
    );
    if (parsed.difficulty !== level) {
      throw new ScenarioDataError(`scenario.levels.${level}.difficulty`, `is ${parsed.difficulty}`);
    }
    levels.set(level, parsed);
  }

  if (levels.size === 0) throw new ScenarioDataError("scenario.levels", "no supported levels");

  const assetUrls: Record<string, string> = {};
  for (const assetId of minigame.assetIds(config, [...levels.values()].map((l) => l.data))) {
    assetUrls[assetId] = urlFor(assetId);
  }

  return {
    id,
    displayName: str(root["displayName"], "scenario.displayName"),
    theme: str(root["theme"], "scenario.theme"),
    minigameId,
    family: str(root["family"], "scenario.family"),
    visualVerb: str(root["visualVerb"], "scenario.visualVerb"),
    supportedLevels,
    premise: str(root["scenarioPremise"], "scenario.scenarioPremise"),
    config,
    assetUrls,
    levels,
  };
}
