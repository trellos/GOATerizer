/**
 * Validates authored scenario JSON into the runtime scenario model.
 *
 * The JSON under `docs/scenarios/` is the authority — this module does not
 * repair it, infer missing content, or generate exercises. It throws, loudly,
 * on anything it cannot map, so a bad edit fails a test rather than transposing
 * a note in a run.
 */

import { requireMinigame } from "../minigame/registry.js";
import { parseDegreeToken } from "../music/degrees.js";
import type { NoteDuration } from "../minigame/api.js";
import type {
  MeasurePlan,
  PromptEvent,
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

/**
 * The rhythmic grid every authored position is snapped to, in ticks per beat.
 *
 * Twelve, because it is the smallest number divisible by both the binary
 * subdivisions (a sixteenth is 3 ticks) and the triplet one (an eighth triplet
 * is 4). Positions accumulate as integers on this grid and are converted to
 * beats once, at the end, which is the only way `1/3 + 1/3 + 1/3` reaches beat 1
 * rather than 0.9999999999999999 — and the only way the measure a note belongs
 * to stays an integer division instead of a float comparison against a boundary
 * it might sit a machine epsilon below.
 *
 * A duration that does not land on this grid is a content-model error, not an
 * authoring one, so it throws with the duration's name rather than a file
 * location.
 */
const TICKS_PER_BEAT = 12;

function ticksOf(name: NoteDuration): number {
  const beats = DURATION_BEATS[name];
  const ticks = Math.round(beats * TICKS_PER_BEAT);
  if (Math.abs(ticks / TICKS_PER_BEAT - beats) > 1e-12) {
    throw new Error(
      `duration ${name} (${beats} beats) is not on the ${TICKS_PER_BEAT}-tick grid`
    );
  }
  return ticks;
}

/**
 * How far an authored number may sit from the value it asserts.
 *
 * Authored `durationBeats` and `startBeat` are redundant with the duration
 * names: the loader derives both and uses its own answers, and these fields
 * exist so a file that disagrees with itself fails loudly. Verifying them
 * exactly was fine while every duration was a binary fraction, but a third of a
 * beat has no decimal an author can type — `0.333` is not 1/3 and twelve of
 * them are not four beats.
 *
 * 0.01 beats is 4ms at 140bpm and 10ms at 60bpm: far below the tightest Perfect
 * window (0.06 beats), so a slip this small cannot change how a note is judged,
 * and far below the distance between any two written durations, so it cannot
 * let one pass for another. It is a tolerance on *transcription*, not on
 * rhythm.
 */
const AUTHORING_TOLERANCE_BEATS = 0.01;

/* -------------------------------------------------------------------------- */

/**
 * The prompt: what the player is asked to play, in order.
 *
 * The **duration names are the authority**. A note's length and its position
 * are both derived here — length from the duration table, position from the
 * running sum of the lengths before it — and the numbers the file states for
 * them are checked against those and then discarded. That is what keeps the
 * runtime model exact: the sum runs on an integer tick grid, so a phrase of
 * triplets lands on beat 1 and on the measure boundary rather than a hair
 * below either.
 *
 * The authored numbers are not redundant clutter. `startBeat` in the file is
 * what catches a dropped rest — the very error a derived position would
 * silently absorb — and it stays required for exactly that reason.
 */
function parsePrompt(raw: unknown, where: string, plan: MeasurePlan): PromptEvent[] {
  const ticksPerMeasure = Math.round(plan.beatsPerMeasure * TICKS_PER_BEAT);
  const events: PromptEvent[] = [];
  let ticks = 0;

  arr(raw, where).forEach((entry, i) => {
    const at = `${where}[${i}]`;
    const event = obj(entry, at);
    const type = str(event["type"], `${at}.type`);
    if (type !== "note" && type !== "rest") {
      throw new ScenarioDataError(`${at}.type`, 'expected "note" or "rest"');
    }

    const dur = duration(event["duration"], `${at}.duration`);
    const durationBeats = DURATION_BEATS[dur];
    const statedDuration = num(event["durationBeats"], `${at}.durationBeats`);
    if (Math.abs(statedDuration - durationBeats) > AUTHORING_TOLERANCE_BEATS) {
      throw new ScenarioDataError(
        `${at}.durationBeats`,
        `${statedDuration} does not match ${dur} (${durationBeats})`
      );
    }

    const startBeat = ticks / TICKS_PER_BEAT;
    const statedStart = num(event["startBeat"], `${at}.startBeat`);
    if (Math.abs(statedStart - startBeat) > AUTHORING_TOLERANCE_BEATS) {
      throw new ScenarioDataError(
        `${at}.startBeat`,
        `${statedStart} but the preceding durations total ${startBeat}`
      );
    }

    const rawDegree = event["scaleDegree"];
    if (type === "note" && typeof rawDegree !== "string") {
      throw new ScenarioDataError(`${at}.scaleDegree`, "a note must carry a scale degree");
    }
    if (type === "rest" && rawDegree !== undefined) {
      throw new ScenarioDataError(`${at}.scaleDegree`, "a rest must not carry a scale degree");
    }

    events.push({
      index: i,
      type,
      duration: dur,
      durationBeats,
      startBeat,
      measureIndex: Math.floor(ticks / ticksPerMeasure),
      beatWithinMeasure: (ticks % ticksPerMeasure) / TICKS_PER_BEAT,
      degree: type === "note" ? parseDegreeToken(rawDegree as string) : null,
    });

    ticks += ticksOf(dur);
  });

  const attemptTicks = plan.attemptMeasures * ticksPerMeasure;
  if (ticks !== attemptTicks) {
    throw new ScenarioDataError(
      where,
      `durations total ${ticks / TICKS_PER_BEAT} beats, expected ${attemptTicks / TICKS_PER_BEAT}`
    );
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
  parseMinigameData: (levelData: unknown, shape: { noteOpportunityCount: number; measures: number }) => unknown
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
    data: parseMinigameData(level, {
      noteOpportunityCount: noteCount,
      measures: measurePlan.attemptMeasures,
    }),
  };
}

/**
 * Validates one authored scenario.
 *
 * `assetUrl` answers where one asset id lives rather than being a map of every
 * id the caller believes the scenario needs. The minigame is the authority on
 * *which* ids exist (`assetIds`), and it is asked here — so the caller supplies
 * a naming rule and cannot get the list wrong, which is what a per-scenario
 * hand-written list of ids could always do.
 */
export function loadScenario(
  raw: unknown,
  assetUrl: (assetId: string) => string
): ScenarioDefinition {
  const root = obj(raw, "scenario");
  const id = str(root["id"], "scenario.id");
  const minigameId = str(root["minigameClass"], "scenario.minigameClass");
  // The registry decides which ids exist, not a union in this file. An
  // unregistered id fails here naming the ids that ARE registered, which is the
  // error a package author needs.
  const minigame = requireMinigame(minigameId, `scenario ${id}`);

  // The minigame validates its own half. A scenario is free to carry whatever
  // shape its family asks for; this loader never looks inside either blob.
  const config = minigame.parseConfig({
    classParameters: root["classParameters"],
    assetBindings: root["assetBindings"],
    scenarioId: id,
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
    const parsed = parseLevel(entry, `scenario.levels.${level}`, (levelData, shape) =>
      minigame.parseLevel(levelData, shape)
    );
    if (parsed.difficulty !== level) {
      throw new ScenarioDataError(
        `scenario.levels.${level}.difficulty`,
        `is ${parsed.difficulty}`
      );
    }
    levels.set(level, parsed);
  }

  if (levels.size === 0) throw new ScenarioDataError("scenario.levels", "no supported levels");

  // Which ids exist is the minigame's answer, not a naming convention guessed
  // at here.
  const assetIds = minigame.assetIds(config, [...levels.values()].map((level) => level.data));
  const assetUrls = Object.fromEntries(assetIds.map((assetId) => [assetId, assetUrl(assetId)]));

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
