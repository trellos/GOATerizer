/**
 * One attempt: four measures of one scenario at one difficulty.
 *
 * This is the join between the systems, and it is where the causal chain the
 * whole game rests on actually happens:
 *
 *     guitar event -> beat -> judgment -> energy -> scenario
 *
 * It owns the judge, the score, the star meter and the minigame class instance,
 * and it is free of DOM and audio so the entire chain is testable with injected
 * input. The one thing it does *not* do is decide when energy reaches the
 * scenario: the caller delivers that, so the visual streak flying up from the
 * timeline is what triggers the goat rather than a coincidence beside it.
 */

import { ATTEMPT_BEATS, BEATS_PER_MEASURE } from "../config/tuning.js";
import type { GuitarInputEvent } from "../input/guitar-input.js";
import type { RunKey } from "../music/keys.js";
import { ClimbMinigame, type ClimbEnergy } from "../scenario/minigames/climb-minigame.js";
import type { ScenarioDefinition, ScenarioLevelData } from "../scenario/types.js";
import { TargetJudge, type JudgmentEvent } from "./judgment.js";
import { AttemptScore, type ScoreSnapshot } from "./scoring.js";
import { StarMeter } from "./stars.js";
import { resolveTargets, type ResolvedTarget } from "./targets.js";

export type EnergyCause = "perfect" | "good" | "miss" | "wrong";

/** A judged note's energy, on its way from the timeline into the scenario. */
export type EnergyEvent = {
  id: number;
  polarity: "good" | "bad";
  cause: EnergyCause;
  /**
   * Continuous lane coordinate the streak launches from, or null when the
   * played note fell outside the two-octave span entirely.
   */
  lane: number | null;
  /** Attempt-relative beat the judgment happened on. */
  beat: number;
};

export type AttemptResult = {
  scenarioId: string;
  difficulty: number;
  stars: number;
  passed: boolean;
} & ScoreSnapshot;

export type AttemptEvent =
  | { type: "judgment"; judgment: JudgmentEvent }
  | { type: "energy"; energy: EnergyEvent }
  | { type: "starEarned"; stars: number }
  | { type: "measureComplete"; measureIndex: number }
  | { type: "complete"; result: AttemptResult };

export type AttemptOptions = {
  scenario: ScenarioDefinition;
  difficulty: number;
  key: RunKey;
  /** Absolute transport beat this attempt's beat 0 lands on. */
  startBeat: number;
  /**
   * Audio-clock seconds -> absolute transport beats, latency-compensated by the
   * caller. Injected so the whole runtime is testable without a transport.
   */
  toBeat: (contextTime: number) => number;
};

export class AttemptRuntime {
  readonly scenario: ScenarioDefinition;
  readonly difficulty: number;
  readonly level: ScenarioLevelData;
  readonly key: RunKey;
  readonly startBeat: number;
  readonly targets: readonly ResolvedTarget[];
  readonly judge: TargetJudge;
  readonly score: AttemptScore;
  readonly starMeter: StarMeter;
  readonly climb: ClimbMinigame;

  readonly #toBeat: (contextTime: number) => number;
  readonly #listeners: ((event: AttemptEvent) => void)[] = [];
  #nextEnergyId = 1;
  #measuresCompleted = 0;
  #complete = false;
  #result: AttemptResult | null = null;

  constructor(options: AttemptOptions) {
    const level = options.scenario.levels.get(options.difficulty);
    if (!level) {
      throw new Error(
        `${options.scenario.id} has no authored level ${options.difficulty}; ` +
          "a scenario is only eligible for difficulties it authors"
      );
    }

    this.scenario = options.scenario;
    this.difficulty = options.difficulty;
    this.level = level;
    this.key = options.key;
    this.startBeat = options.startBeat;
    this.#toBeat = options.toBeat;

    this.targets = resolveTargets(level, options.key);
    this.judge = new TargetJudge({ targets: this.targets, key: options.key });
    this.score = new AttemptScore({ streakBonusEligible: level.scoring.streakBonusEligible });
    this.starMeter = new StarMeter(level.stars);
    this.climb = new ClimbMinigame({
      route: level.route,
      bindings: options.scenario.assetBindings,
      parameters: options.scenario.classParameters,
    });

    this.judge.onEvent((judgment) => this.#onJudgment(judgment));
  }

  onEvent(handler: (event: AttemptEvent) => void): () => void {
    this.#listeners.push(handler);
    return () => {
      const index = this.#listeners.indexOf(handler);
      if (index >= 0) this.#listeners.splice(index, 1);
    };
  }

  get complete(): boolean {
    return this.#complete;
  }

  get result(): AttemptResult | null {
    return this.#result;
  }

  get endBeat(): number {
    return this.startBeat + ATTEMPT_BEATS;
  }

  /** Attempt-relative beat, from an absolute transport beat. */
  toAttemptBeat(absoluteBeat: number): number {
    return absoluteBeat - this.startBeat;
  }

  /* ------------------------------------------------------------------ */

  /**
   * Normalised guitar input.
   *
   * Only attacks and revisions reach judgment. Sustain updates carry bend data
   * that no Rocky Ascent target asks about, and releases matter to duration
   * grading, which this scenario does not use — both are forwarded to nothing
   * rather than being turned into extra played notes.
   */
  handleGuitarEvent(event: GuitarInputEvent): void {
    if (this.#complete) return;
    switch (event.type) {
      case "attack":
        this.judge.attack(event.id, event.midi, this.toAttemptBeat(this.#toBeat(event.contextTime)));
        break;
      case "retune":
        this.judge.retune(event.id, event.midi);
        break;
      default:
        break;
    }
  }

  /** Drives expiry, effect decay and completion. Safe to call every frame. */
  update(absoluteBeat: number): void {
    if (this.#complete) {
      this.climb.update(this.toAttemptBeat(absoluteBeat));
      return;
    }

    const beat = this.toAttemptBeat(absoluteBeat);
    this.judge.tick(beat);
    this.climb.update(beat);

    const measures = Math.min(
      this.level.measurePlan.attemptMeasures,
      Math.floor(beat / BEATS_PER_MEASURE)
    );
    while (this.#measuresCompleted < measures) {
      const index = this.#measuresCompleted;
      this.#measuresCompleted += 1;
      this.climb.onMeasureComplete(index, beat);
      this.#emit({ type: "measureComplete", measureIndex: index });
    }

    if (beat >= ATTEMPT_BEATS) this.#finish(beat);
  }

  /**
   * Hands one energy event to the scenario.
   *
   * Called by the presentation layer when the visual streak arrives, so the
   * player sees their note cause the step rather than merely accompany it. A
   * headless caller delivers immediately.
   */
  deliverEnergy(energy: EnergyEvent, atBeat: number): void {
    const payload: ClimbEnergy =
      energy.polarity === "good"
        ? { polarity: "good", strength: energy.cause === "perfect" ? "perfect" : "good" }
        : { polarity: "bad", cause: energy.cause === "miss" ? "miss" : "wrong" };
    this.climb.applyEnergy(payload, atBeat);
  }

  /* ------------------------------------------------------------------ */

  #onJudgment(judgment: JudgmentEvent): void {
    this.score.apply(judgment);
    this.#emit({ type: "judgment", judgment });

    const before = this.starMeter.stars;
    const after = this.starMeter.update(this.score.judgmentPoints);
    if (after > before) this.#emit({ type: "starEarned", stars: after });

    const energy = this.#energyFor(judgment);
    if (energy) this.#emit({ type: "energy", energy });
  }

  #energyFor(judgment: JudgmentEvent): EnergyEvent | null {
    switch (judgment.type) {
      case "PerfectNote":
        return this.#energy("good", "perfect", judgment.target.lane, judgment.target.startBeat);
      case "GoodNote":
        return this.#energy("good", "good", judgment.target.lane, judgment.target.startBeat);
      case "MissedNote":
        return this.#energy("bad", "miss", judgment.target.lane, judgment.target.startBeat);
      case "WrongNote":
        return this.#energy("bad", "wrong", judgment.lanePosition, judgment.atBeat);
      default:
        return null;
    }
  }

  #energy(
    polarity: "good" | "bad",
    cause: EnergyCause,
    lane: number | null,
    beat: number
  ): EnergyEvent {
    return { id: this.#nextEnergyId++, polarity, cause, lane, beat };
  }

  #finish(beat: number): void {
    if (this.#complete) return;
    // Expire anything whose window closed exactly on the boundary.
    this.judge.tick(beat);
    this.#complete = true;

    const stars = this.starMeter.update(this.score.judgmentPoints);
    const passed = stars >= 1;
    this.climb.complete(passed, beat);

    this.#result = {
      scenarioId: this.scenario.id,
      difficulty: this.difficulty,
      stars,
      passed,
      ...this.score.snapshot,
    };
    this.#emit({ type: "complete", result: this.#result });
  }

  #emit(event: AttemptEvent): void {
    for (const handler of [...this.#listeners]) handler(event);
  }
}
