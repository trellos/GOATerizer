/**
 * REPEAT — the Straight Sixteenths family, as a registered minigame module.
 *
 * Wraps {@link RepeatMinigame}, which keeps the cans and the swing and is
 * unchanged. What moves here is everything the host used to know about this
 * family: its asset slots, its class parameters, where the performer stands,
 * how often he swings, and what a judged note does — `AttemptRuntime` no longer
 * mentions a can.
 *
 * The rule this family exists to demonstrate, and the reason its `onJudged` is
 * not the climb's: **authored pitch places terrain, played pitch places
 * projectiles.** A can lands where the player actually played, which is what
 * makes a wrong note legible as a wrong note rather than as nothing happening.
 */

import {
  MINIGAME_API_VERSION,
  type AttemptContext,
  type Judged,
  type Minigame,
  type MinigameModule,
  type Stage,
} from "../../minigame/api.js";
import { bool, num, obj, ScenarioDataError, str, strings } from "../parse.js";
import { RepeatMinigame, type RepeatVisualState } from "./repeat-minigame.js";

/**
 * The swing periods a performer may settle into, longest first.
 *
 * He swings on a musical division rather than at whatever rate the notes
 * happen to arrive, so the loop stays readable when the phrase is not uniform.
 */
const STRIKE_PERIODS = [1, 1 / 2, 1 / 3, 1 / 4] as const;

export type RepeatConfig = {
  background: string;
  performerNeutral: string;
  performerAction: string;
  performerFinish: string;
  repeatTarget: string;
  targetCompletedState: string;
  impactEffects: readonly string[];
  repeatMode: "sequence" | "accumulate";
  performerMovesBetweenMeasures: boolean;
};

export type RepeatLevel = {
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
};

/** The lane he stands in: whichever the phrase uses most. */
function performerLane(opportunities: AttemptContext["opportunities"]): number {
  const counts = new Map<number, number>();
  for (const note of opportunities) counts.set(note.lane, (counts.get(note.lane) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [lane, count] of counts) {
    if (count > bestCount) {
      best = lane;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The lane a can can land on, or null if there is none.
 *
 * {@link Judged.lane} is a *continuous* coordinate, so a bend can be drawn
 * sliding between lanes and a wrong note can be drawn where it actually was.
 * A can is not drawn there: it lands on a lane or it does not land, and a pitch
 * that sits between two lanes — a major third in a minor key — belongs to
 * neither. Rounding it would invent a lane the player never played, and the
 * wobble is precisely the feedback that says "that pitch is not in this key".
 *
 * This is `music/keys.ts`'s `laneOfMidi` answer, derived from the coordinate
 * the contract already carries rather than from the key — which a minigame is
 * deliberately not given, because a family that could read the key could start
 * grading pitch, and grading is the host's.
 */
function placeableLane(lane: number | null): number | null {
  return lane !== null && Number.isInteger(lane) ? lane : null;
}

/** The longest allowed period that still fits inside the phrase's tightest gap. */
function strikePeriod(opportunities: AttemptContext["opportunities"]): number {
  const beats = opportunities.map((note) => note.startBeat).sort((a, b) => a - b);
  let finest: number = STRIKE_PERIODS[0];
  for (let i = 1; i < beats.length; i += 1) {
    const gap = (beats[i] ?? 0) - (beats[i - 1] ?? 0);
    if (gap > 1e-6 && gap < finest) finest = gap;
  }
  return STRIKE_PERIODS.find((period) => period <= finest + 1e-6) ?? STRIKE_PERIODS.at(-1) ?? 1;
}

class RepeatModuleMinigame implements Minigame {
  readonly #config: RepeatConfig;
  readonly #repeat: RepeatMinigame;
  readonly #opportunities: AttemptContext["opportunities"];

  constructor(config: RepeatConfig, context: AttemptContext) {
    this.#config = config;
    this.#opportunities = context.opportunities;
    this.#repeat = new RepeatMinigame({
      performerLane: performerLane(context.opportunities),
      strikePeriodBeats: strikePeriod(context.opportunities),
    });
  }

  /** The performer's state, for the layer that still draws him. */
  get state(): RepeatVisualState {
    return this.#repeat.state;
  }

  /**
   * Places one can per judged note.
   *
   * Every judgment produces a can, a miss included: the can was already on
   * screen riding in on its bar before it was judged, so it has to go
   * somewhere. A miss is the one outcome where the answer is "nowhere", and
   * watching it stay down and roll past is the point.
   *
   * A note released on time never reaches here — the host only reports attacks
   * — which is what stops a sustained note putting a second can on the belt.
   * This was `AttemptRuntime.#driveRepeat`.
   */
  onJudged(judged: Judged): void {
    const target =
      judged.opportunityIndex === null ? null : this.#opportunities[judged.opportunityIndex];
    switch (judged.outcome) {
      case "perfect":
      case "good":
      case "wrong":
        // The PLAYED lane places the can — the whole mechanic. Judgment already
        // happened and is not revisited here.
        this.#repeat.place(placeableLane(judged.lane), judged.beat);
        break;
      case "miss":
        // Its own lane, its own beat: the can stays where it already was and
        // keeps travelling with the bar it arrived in.
        if (target) this.#repeat.miss(target.lane, target.startBeat);
        break;
    }
  }

  /** TRANSITIONAL — see {@link Minigame.prototypeLayer}. Can, then crushed can. */
  prototypeLayer(): { kind: "repeat"; state: unknown; sprites: readonly string[] } {
    return {
      kind: "repeat",
      state: this.#repeat.state,
      sprites: [this.#config.repeatTarget, this.#config.targetCompletedState],
    };
  }

  update(beat: number): void {
    this.#repeat.update(beat);
  }

  onMeasure(): void {}
  onStarEarned(): void {}

  onComplete(passed: boolean, _stars: number, beat: number): void {
    this.#repeat.complete(passed, beat);
  }

  render(): Stage {
    // Note art is deliberately absent: the can IS the note here, and it is a
    // sprite the performer knocks off the bar rather than paint on the bar.
    return { background: this.#config.background };
  }
}

/* -------------------------------------------------------------------------- */

export const REPEAT_MINIGAME: MinigameModule = {
  id: "RepeatMinigame",
  displayName: "Repeat",
  rhythmCall: "Boom Boom Boom Boom",
  apiVersion: MINIGAME_API_VERSION,

  authoring: {
    /**
     * One target per note opportunity, and the measure plan's own two fields.
     *
     * `expectedCans` is what the level says it is asking for; nothing parses it,
     * but a level claiming twelve cans while its prompt authors twenty-eight is
     * a level whose two halves were edited apart.
     */
    reconcileLevel(level, shape) {
      const measurePlan = { ...((level["measurePlan"] as Record<string, unknown>) ?? {}) };
      const visual = { ...((level["visual"] as Record<string, unknown>) ?? {}) };
      return {
        ...level,
        measurePlan: {
          ...measurePlan,
          visualSpanMeasures:
            typeof measurePlan["visualSpanMeasures"] === "number"
              ? measurePlan["visualSpanMeasures"]
              : 1,
          resetBetweenMeasures: measurePlan["resetBetweenMeasures"] !== false,
        },
        visual: { ...visual, expectedCans: shape.noteOpportunityCount },
      };
    },
  },

  parseConfig(raw: unknown): RepeatConfig {
    const { classParameters, assetBindings } = obj(raw, "scenario") as {
      classParameters: unknown;
      assetBindings: unknown;
    };
    const bindings = obj(assetBindings, "scenario.assetBindings");
    const params = obj(classParameters, "scenario.classParameters");
    const one = (slot: string): string => {
      const values = strings(bindings[slot], `scenario.assetBindings.${slot}`);
      const first = values[0];
      if (values.length !== 1 || first === undefined) {
        throw new ScenarioDataError(
          `scenario.assetBindings.${slot}`,
          "expected exactly one asset id"
        );
      }
      return first;
    };

    const many = (slot: string, min: number): readonly string[] => {
      const values = strings(bindings[slot], `scenario.assetBindings.${slot}`);
      if (values.length < min) {
        throw new ScenarioDataError(
          `scenario.assetBindings.${slot}`,
          `expected at least ${min} asset ids`
        );
      }
      return values;
    };

    const mode = str(params["repeatMode"], "scenario.classParameters.repeatMode");
    if (mode !== "sequence" && mode !== "accumulate") {
      throw new ScenarioDataError(
        "scenario.classParameters.repeatMode",
        'expected "sequence" or "accumulate"'
      );
    }

    // Read in slot order, so a scenario missing several slots is told about the
    // first one it is missing rather than whichever the parser happened to
    // reach first. An author fixing bindings top to bottom needs the failures
    // to arrive in that order too.
    return {
      background: one("background"),
      performerNeutral: one("performerNeutral"),
      performerAction: one("performerAction"),
      performerFinish: one("performerFinish"),
      repeatTarget: one("repeatTarget"),
      targetCompletedState: one("targetCompletedState"),
      impactEffects: many("impactEffects", 1),
      repeatMode: mode,
      performerMovesBetweenMeasures: bool(
        params["performerMovesBetweenMeasures"],
        "scenario.classParameters.performerMovesBetweenMeasures"
      ),
    };
  },

  /**
   * No route. A performer who stands still has no path, so authoring one would
   * be authoring data that means nothing — and the climb's one-waypoint-per-note
   * check has nothing to check here.
   */
  parseLevel(raw: unknown): RepeatLevel {
    const level = obj(raw, "level");
    const plan = obj(level["measurePlan"], "level.measurePlan");
    return {
      visualSpanMeasures: num(plan["visualSpanMeasures"], "level.measurePlan.visualSpanMeasures"),
      resetBetweenMeasures: plan["resetBetweenMeasures"] === true,
    };
  },

  backgroundId(config: unknown): string {
    return (config as RepeatConfig).background;
  },

  assetIds(config: unknown): readonly string[] {
    const repeat = config as RepeatConfig;
    return [
      repeat.background,
      repeat.performerNeutral,
      repeat.performerAction,
      repeat.performerFinish,
      repeat.repeatTarget,
      repeat.targetCompletedState,
      ...repeat.impactEffects,
    ];
  },

  create(context: AttemptContext): Minigame {
    return new RepeatModuleMinigame(context.config as RepeatConfig, context);
  },

  /** See `climb-minigame.ts` — one row, and it is about cans. */
  debug(instance: Minigame): Readonly<Record<string, string>> {
    const state = repeatState(instance);
    return { "cans crushed/missed": `${state.crushed}/${state.uncrushed}` };
  },
};

export { RepeatModuleMinigame };

/** Narrowing helpers, for tests and tools. See `climb-minigame.ts`. */
export function repeatConfig(config: unknown): RepeatConfig {
  return config as RepeatConfig;
}

export function repeatLevel(data: unknown): RepeatLevel {
  return data as RepeatLevel;
}

/** The performer state of a running repeat. Throws if handed another family. */
export function repeatState(minigame: Minigame): RepeatVisualState {
  if (!(minigame instanceof RepeatModuleMinigame)) throw new Error("not a RepeatMinigame");
  return minigame.state;
}
