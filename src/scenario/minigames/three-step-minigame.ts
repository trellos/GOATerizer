/**
 * THREE-STEP — the Triplets family, as a registered minigame module.
 *
 * Two little preparatory actions and a larger third one, per triplet group.
 * The player fantasy is groove; the visual verb is a rhythm you can see before
 * you can count it.
 *
 * ## The one rule this family exists to demonstrate
 *
 * **The A/B/C role comes from where a note sits inside its beat, never from
 * `index % 3`.** Authored rhythm is not uniform: a level may rest through a
 * triplet's first partial, mix a quarter note in between groups, or place two
 * groups back to back. Counting note opportunities gets all three of those
 * wrong, and gets them wrong *silently* — the actor keeps leaping, just on the
 * wrong partials. Position within the beat cannot drift, because the loader
 * already snapped every start to an exact twelve-tick grid
 * (`scenario/load.ts`).
 *
 * ## What is on screen during a rest
 *
 * The checklist in `GOATerizer_Minigame_Authoring.md` §7 asks, and for this
 * family the answer is the target. The wolf stands at the strike line for the
 * whole attempt and the ram stands beside it; between groups they are simply
 * both there, and the ram leans at the lane the next note is on. Nothing has to
 * be invented to fill a gap.
 *
 * Pure: it parses data, keeps state, and answers with a {@link Stage} of asset
 * ids. It never touches a canvas, a clock or an asset store.
 */

import {
  arc,
  decay,
  MINIGAME_API_VERSION,
  type AttemptContext,
  type Judged,
  type Minigame,
  type MinigameModule,
  type Opportunity,
  type Sprite,
  type Stage,
  type StageView,
} from "../../minigame/api.js";
import { num, obj, ScenarioDataError, strings } from "../parse.js";

/** Which partial of a triplet group a note is. */
export type Step = "a" | "b" | "c";

/**
 * Ticks per beat, matching `scenario/load.ts`.
 *
 * Twelve is the smallest number divisible by both the binary subdivisions and
 * the triplet one, which is why the loader counts in it. This module rounds
 * into the same grid rather than comparing floats: an eighth triplet is exactly
 * 4 ticks, so the three partials of a beat are 0, 4 and 8 and nothing lands
 * between them.
 */
const TICKS_PER_BEAT = 12;
/** An eighth triplet: a third of a beat. */
const TRIPLET_TICKS = 4;

/** How long an impact effect stays up, in beats. */
const EFFECT_BEATS = 0.5;
/** The leap's flight time — the whole third partial. */
const LEAP_BEATS = 1 / 3;
/** How high the leap arcs, in lane-band units. Negative y is up. */
const LEAP_HEIGHT = 0.55;

export type ThreeStepConfig = {
  background: string;
  stepA: string;
  stepB: string;
  stepC: string;
  alternateStepC: readonly string[];
  finishPose: string;
  /** [0] is the target as it stands, [1] the state it is left in once bonked. */
  targetVisuals: readonly string[];
  minorStepEffects: readonly string[];
  majorStepEffects: readonly string[];
  groupEffects: readonly string[];
};

export type ThreeStepLevel = {
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
  /** Every third partial after this many landed groups uses the alternate pose. */
  alternateAfterGroups: number;
};

/**
 * Which partial of its beat a note is, from its start position alone.
 *
 * Not `index % 3`. A note exactly on the beat is A, a third in is B, two thirds
 * in is C, and anything else — a quarter note, an eighth, a sixteenth between
 * groups — is not part of a triplet group at all and returns null, so it draws
 * as a plain step rather than being forced into a role it does not have.
 */
export function stepOf(opportunity: Opportunity): Step | null {
  if (opportunity.duration !== "eighthTriplet") return null;
  const ticks = Math.round(opportunity.startBeat * TICKS_PER_BEAT);
  const withinBeat = ((ticks % TICKS_PER_BEAT) + TICKS_PER_BEAT) % TICKS_PER_BEAT;
  if (withinBeat === 0) return "a";
  if (withinBeat === TRIPLET_TICKS) return "b";
  if (withinBeat === TRIPLET_TICKS * 2) return "c";
  return null;
}

/** A pose or effect showing right now, with the beat it started on. */
type Flash = { assetId: string; startBeat: number; lane: number };

class ThreeStepMinigame implements Minigame {
  readonly #config: ThreeStepConfig;
  readonly #level: ThreeStepLevel;
  readonly #opportunities: readonly Opportunity[];

  /** The pose the ram is holding, and when it started. */
  #pose: Flash | null = null;
  /** The leap in flight, if any: from lane, to lane, and when it left. */
  #leap: { from: number; to: number; startBeat: number } | null = null;
  /** Impact effects currently decaying. Bounded — see {@link #remember}. */
  #effects: Flash[] = [];
  /** Completed triplet groups, attempt-global. Drives the alternate ending. */
  #groups = 0;
  /** Landed notes in the group being played. Visual-cycle-local. */
  #inGroup = 0;
  /** Whether the target has been bonked in this visual cycle. */
  #targetDown = false;
  /** The lane the next note is on, for the lean. */
  #aim: number | null = null;

  constructor(config: ThreeStepConfig, level: ThreeStepLevel, context: AttemptContext) {
    this.#config = config;
    this.#level = level;
    this.#opportunities = context.opportunities;
  }

  /** Attempt-global group count, for the dev panel and tests. */
  get groups(): number {
    return this.#groups;
  }

  /** Whether the target is currently down. Visual-cycle-local. */
  get targetDown(): boolean {
    return this.#targetDown;
  }

  /**
   * A judged note becomes a step.
   *
   * Acts on the **authored** target's lane, not the played pitch: this family's
   * actor is terrain-bound like CLIMB's, not a projectile like REPEAT's, so a
   * wrong note must not teleport the ram to wherever the player fluffed to.
   * `GOATerizer_Minigame_Authoring.md` §5 is explicit that getting this
   * backwards makes a wrong note look like nothing happening — here the wrong
   * note reads instead as the group breaking down, which is what it is.
   */
  onJudged(judged: Judged, beat: number): void {
    const target =
      judged.opportunityIndex === null ? null : this.#opportunities[judged.opportunityIndex];

    if (judged.outcome === "miss" || judged.outcome === "wrong") {
      // A broken group is not a group. The count that drives the alternate
      // ending only ever advances on a group played through.
      this.#inGroup = 0;
      return;
    }
    if (!target) return;

    const step = stepOf(target);
    const lane = target.lane;

    if (step === "c") {
      const from = this.#pose?.lane ?? lane;
      this.#leap = { from, to: lane, startBeat: target.startBeat };
      this.#pose = { assetId: this.#stepCPose(), startBeat: target.startBeat, lane };
      this.#remember({ assetId: this.#pick(this.#config.majorStepEffects), startBeat: beat, lane });
      this.#targetDown = true;
      // Only a full A-B-C counts. `#inGroup` reaching 2 means both taps landed.
      if (this.#inGroup >= 2) {
        this.#groups += 1;
        this.#remember({ assetId: this.#pick(this.#config.groupEffects), startBeat: beat, lane });
      }
      this.#inGroup = 0;
      return;
    }

    this.#pose = {
      assetId: step === "b" ? this.#config.stepB : this.#config.stepA,
      startBeat: target.startBeat,
      lane,
    };
    this.#remember({ assetId: this.#pick(this.#config.minorStepEffects), startBeat: beat, lane });
    // A note that is not a triplet partial at all still shows a step, but never
    // counts toward a group — there is no group for it to be part of.
    if (step !== null) this.#inGroup += 1;
  }

  aimAt(lane: number | null): void {
    this.#aim = lane;
  }

  update(beat: number): void {
    this.#effects = this.#effects.filter((flash) => decay(flash.startBeat, EFFECT_BEATS, beat) > 0);
    if (this.#leap && beat >= this.#leap.startBeat + LEAP_BEATS) this.#leap = null;
  }

  /**
   * The visual cycle resets; the attempt-global count does not.
   *
   * `AGENTS.md` §9 keeps these separate deliberately, and this family is where
   * the distinction is visible: the target stands back up for the next cycle,
   * but the group count that decides whether the ending is the alternate one
   * survives, so escalation earned earlier is not undone by a measure line.
   */
  onMeasure(): void {
    this.#targetDown = false;
    this.#inGroup = 0;
  }

  onStarEarned(): void {}

  /** The finish pose simply becomes the held pose; nothing else changes. */
  onComplete(passed: boolean, _stars: number, beat: number): void {
    if (passed) {
      this.#pose = { assetId: this.#config.finishPose, startBeat: beat, lane: this.#pose?.lane ?? 0 };
    }
  }

  render(view: StageView): Stage {
    const sprites: Sprite[] = [];
    const laneY = (lane: number): number =>
      view.laneCount <= 1 ? 0.5 : 1 - (lane + 0.5) / view.laneCount;

    // The target waits at the strike line for the whole attempt: this family's
    // notes come to the actor rather than the actor chasing them.
    const targetArt = this.#targetDown
      ? (this.#config.targetVisuals[1] ?? this.#config.targetVisuals[0])
      : this.#config.targetVisuals[0];
    if (targetArt !== undefined) {
      sprites.push({
        key: "target",
        assetId: targetArt,
        x: view.strikeX + view.measure.beatWidth * 0.35,
        y: laneY(this.#aim ?? 0) + 0.12,
        anchor: "bottom",
        layer: "over",
      });
    }

    const pose = this.#pose;
    if (pose) {
      // Mid-leap the ram flies an arc between the two lanes; otherwise it
      // stands on the one its pose was set on, leaning at what is coming.
      const restY = laneY(pose.lane);
      const position = this.#leap
        ? arc(
            { x: view.strikeX - view.measure.beatWidth * 0.55, y: laneY(this.#leap.from) },
            { x: view.strikeX - view.measure.beatWidth * 0.1, y: laneY(this.#leap.to) },
            LEAP_HEIGHT,
            this.#leap.startBeat,
            LEAP_BEATS,
            view.beat
          )
        : { x: view.strikeX - view.measure.beatWidth * 0.55, y: restY };
      sprites.push({
        key: "ram",
        assetId: pose.assetId,
        x: position.x,
        y: position.y,
        anchor: "bottom",
        layer: "over",
      });
    }

    for (const [i, flash] of this.#effects.entries()) {
      sprites.push({
        key: `fx-${i}-${flash.startBeat}`,
        assetId: flash.assetId,
        x: view.strikeX,
        y: laneY(flash.lane),
        layer: "over",
        opacity: decay(flash.startBeat, EFFECT_BEATS, view.beat),
      });
    }

    return { background: this.#config.background, sprites };
  }

  /**
   * The third-partial pose, swapping to the alternate once escalated.
   *
   * `alternateAfterGroups` is the level's own answer to when the headbutt
   * changes — the catalogue's "altered endings produce different victims or
   * objects" — so a low level can run the whole attempt on one ending and a
   * high one can switch part-way. Read from the level rather than hard-coded,
   * because which groups earn it is authored content, not a rule of the family.
   */
  #stepCPose(): string {
    const alternates = this.#config.alternateStepC;
    if (alternates.length === 0 || this.#groups < this.#level.alternateAfterGroups) {
      return this.#config.stepC;
    }
    const index = (this.#groups - this.#level.alternateAfterGroups) % alternates.length;
    return alternates[index] ?? this.#config.stepC;
  }

  /** First entry of a slot, or the step pose if the slot is empty. */
  #pick(slot: readonly string[]): string {
    return slot[0] ?? this.#config.stepA;
  }

  /**
   * Keeps the effect list bounded.
   *
   * `update` already drops expired flashes, but it only runs between judged
   * notes — a dense sixteenth-triplet passage can push several on within one
   * frame. Six is more than any triplet group can produce and costs nothing;
   * the pile of crushed cans in `RepeatMinigame` is the cautionary tale
   * (`docs/IDEAS.md`, the frame-loop entry).
   */
  #remember(flash: Flash): void {
    this.#effects.push(flash);
    if (this.#effects.length > 6) this.#effects.splice(0, this.#effects.length - 6);
  }
}

/* -------------------------------------------------------------------------- */

export const THREE_STEP_MINIGAME: MinigameModule = {
  id: "ThreeStepMinigame",
  displayName: "Three-Step",
  apiVersion: MINIGAME_API_VERSION,

  parseConfig(raw: unknown): ThreeStepConfig {
    const { assetBindings } = obj(raw, "scenario") as { assetBindings: unknown };
    const bindings = obj(assetBindings, "scenario.assetBindings");

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
      if (bindings[slot] === undefined && min === 0) return [];
      const values = strings(bindings[slot], `scenario.assetBindings.${slot}`);
      if (values.length < min) {
        throw new ScenarioDataError(
          `scenario.assetBindings.${slot}`,
          `expected at least ${min} asset ids`
        );
      }
      return values;
    };

    // Read in slot order, so an author fixing bindings top to bottom is told
    // about the first one they are missing rather than whichever came first.
    return {
      background: one("background"),
      stepA: one("stepAPoseOrEffect"),
      stepB: one("stepBPoseOrEffect"),
      stepC: one("stepCPoseOrEffect"),
      alternateStepC: many("alternateStepC", 0),
      finishPose: one("finishPose"),
      // Slot ordering is part of this family's contract: [0] is the target as
      // it stands, [1] the state it is left in. One entry is legal — a target
      // that does not visibly change is a scenario's choice, not an error.
      targetVisuals: many("targetVisuals", 1),
      minorStepEffects: many("minorStepEffects", 1),
      majorStepEffects: many("majorStepEffects", 1),
      groupEffects: many("groupEffects", 1),
    };
  },

  /**
   * Level data, and the one content check this family owes the author.
   *
   * A THREE-STEP level whose prompt contains no triplet at all is not a
   * THREE-STEP level: every note would return null from {@link stepOf} and the
   * scenario would play as a silent, poseless nothing. That is exactly the
   * "fail a test, not transpose a note mid-run" case the parsers exist for.
   */
  parseLevel(raw: unknown, shape): ThreeStepLevel {
    const level = obj(raw, "level");
    const plan = obj(level["measurePlan"], "level.measurePlan");
    const visual = obj(level["visual"], "level.visual");

    const prompt = level["prompt"];
    const triplets = Array.isArray(prompt)
      ? prompt.filter(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            (event as Record<string, unknown>)["duration"] === "eighthTriplet"
        ).length
      : 0;
    if (triplets === 0) {
      throw new ScenarioDataError(
        "level.prompt",
        "a ThreeStepMinigame level must author at least one eighthTriplet"
      );
    }
    if (triplets % 3 !== 0) {
      throw new ScenarioDataError(
        "level.prompt",
        `${triplets} eighthTriplet events do not divide into whole groups of three`
      );
    }
    if (shape.noteOpportunityCount === 0) {
      throw new ScenarioDataError("level.prompt", "no note opportunities");
    }

    return {
      visualSpanMeasures: num(plan["visualSpanMeasures"], "level.measurePlan.visualSpanMeasures"),
      resetBetweenMeasures: plan["resetBetweenMeasures"] === true,
      alternateAfterGroups: num(
        visual["alternateAfterGroups"],
        "level.visual.alternateAfterGroups"
      ),
    };
  },

  backgroundId(config: unknown): string {
    return (config as ThreeStepConfig).background;
  },

  assetIds(config: unknown): readonly string[] {
    const three = config as ThreeStepConfig;
    return [
      three.background,
      three.stepA,
      three.stepB,
      three.stepC,
      ...three.alternateStepC,
      three.finishPose,
      ...three.targetVisuals,
      ...three.minorStepEffects,
      ...three.majorStepEffects,
      ...three.groupEffects,
    ];
  },

  create(context: AttemptContext): Minigame {
    return new ThreeStepMinigame(
      context.config as ThreeStepConfig,
      context.data as ThreeStepLevel,
      context
    );
  },

  debug(instance: Minigame): Readonly<Record<string, string>> {
    const three = instance as ThreeStepMinigame;
    return {
      "triplet groups": String(three.groups),
      "target": three.targetDown ? "down" : "standing",
    };
  },
};

export { ThreeStepMinigame };

/**
 * Narrowing helpers, for tests and tools.
 *
 * `config` and `data` are `unknown` on the scenario model, so a test asserting
 * on a step pose or a group count is a three-step test and has to say so.
 */
export function threeStepConfig(config: unknown): ThreeStepConfig {
  return config as ThreeStepConfig;
}

export function threeStepLevel(data: unknown): ThreeStepLevel {
  return data as ThreeStepLevel;
}

/** The group count of a running three-step. Throws if handed another family. */
export function threeStepGroups(minigame: Minigame): number {
  if (!(minigame instanceof ThreeStepMinigame)) throw new Error("not a ThreeStepMinigame");
  return minigame.groups;
}
