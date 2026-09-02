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

import { ATTEMPT_BEATS, BEATS_PER_MEASURE, REACTION_DELAY_BEATS } from "../config/tuning.js";
import type { GuitarInputEvent } from "../input/guitar-input.js";
import type { RunKey } from "../music/keys.js";
import type { Judged, Minigame, MinigameModule, Opportunity } from "../minigame/api.js";
import { requireMinigame } from "../minigame/registry.js";
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
   * played note fell outside the one-octave span entirely.
   */
  lane: number | null;
  /** Attempt-relative beat the judgment happened on. */
  beat: number;
  /** Which note opportunity this resolved. Null for an unmatched wrong note. */
  opportunityIndex: number | null;
  /** What the player played. Null for a miss — nothing was played. */
  playedMidi: number | null;
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
  /** Test seam. Defaults to {@link REACTION_DELAY_BEATS}. */
  reactionDelayBeats?: number;
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
  readonly minigame: Minigame;

  readonly #module: MinigameModule;
  readonly #reactionDelayBeats: number;
  readonly #toBeat: (contextTime: number) => number;
  readonly #listeners: ((event: AttemptEvent) => void)[] = [];
  #nextEnergyId = 1;
  /** Latest attempt-relative beat seen by {@link AttemptRuntime.update}. */
  #beat = 0;
  /** Judged notes waiting out the reaction delay. */
  #pending: { judged: Judged; atBeat: number }[] = [];
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
    this.#reactionDelayBeats = options.reactionDelayBeats ?? REACTION_DELAY_BEATS;

    this.targets = resolveTargets(level, options.key);
    this.judge = new TargetJudge({ targets: this.targets, key: options.key });
    this.score = new AttemptScore({ streakBonusEligible: level.scoring.streakBonusEligible });
    this.starMeter = new StarMeter(level.stars);
    const module = requireMinigame(
      options.scenario.minigameId,
      `scenario ${options.scenario.id}`
    );
    this.#module = module;
    this.minigame = module.create({
      config: options.scenario.config,
      data: level.data,
      assets: Object.keys(options.scenario.assetUrls),
      plan: {
        measures: level.measurePlan.attemptMeasures,
        beatsPerMeasure: level.measurePlan.beatsPerMeasure,
        totalBeats: level.measurePlan.attemptMeasures * level.measurePlan.beatsPerMeasure,
      },
      opportunities: this.targets.map(
        (target): Opportunity => ({
          index: target.opportunityIndex,
          startBeat: target.startBeat,
          durationBeats: target.durationBeats,
          duration: target.duration,
          lane: target.lane,
          midi: target.midi,
        })
      ),
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

  /**
   * Developer-panel rows this scenario's minigame wants to show.
   *
   * Routed through the module rather than read off the instance, so the app
   * shell never needs to know what kind of minigame it is looking at.
   */
  get debugRows(): Readonly<Record<string, string>> {
    return this.#module.debug?.(this.minigame) ?? {};
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
      this.#beat = this.toAttemptBeat(absoluteBeat);
      this.#flushPending(this.#beat);
      this.minigame.update(this.#beat);
      return;
    }

    const beat = this.toAttemptBeat(absoluteBeat);
    this.#beat = beat;
    this.judge.tick(beat);
    this.#flushPending(beat);
    this.minigame.update(beat);

    const measures = Math.min(
      this.level.measurePlan.attemptMeasures,
      Math.floor(beat / BEATS_PER_MEASURE)
    );
    while (this.#measuresCompleted < measures) {
      const index = this.#measuresCompleted;
      this.#measuresCompleted += 1;
      this.minigame.onMeasure(index, beat);
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
    const judged: Judged = {
      id: energy.id,
      outcome: energy.cause,
      opportunityIndex: energy.opportunityIndex,
      playedMidi: energy.playedMidi,
      lane: energy.lane,
      beat: energy.beat,
    };
    // Zero is delivered on the spot rather than on the next frame, so the
    // default really is "the reaction happens when the note is judged" and not
    // "one frame later, usually".
    if (this.#reactionDelayBeats <= 0) {
      this.minigame.onJudged(judged, atBeat);
      return;
    }
    this.#pending.push({ judged, atBeat: atBeat + this.#reactionDelayBeats });
  }

  /** Hands over any judged note whose reaction delay has elapsed. */
  #flushPending(beat: number): void {
    if (this.#pending.length === 0) return;
    const due = this.#pending.filter((entry) => entry.atBeat <= beat);
    if (due.length === 0) return;
    this.#pending = this.#pending.filter((entry) => entry.atBeat > beat);
    for (const entry of due) this.minigame.onJudged(entry.judged, beat);
  }

  /* ------------------------------------------------------------------ */

  #onJudgment(judgment: JudgmentEvent): void {
    this.score.apply(judgment);
    this.#emit({ type: "judgment", judgment });

    const before = this.starMeter.stars;
    const after = this.starMeter.update(this.score.judgmentPoints);
    if (after > before) {
      this.minigame.onStarEarned(after, this.#beat);
      this.#emit({ type: "starEarned", stars: after });
    }

    const energy = this.#energyFor(judgment);
    if (energy) this.#emit({ type: "energy", energy });
  }

  #energyFor(judgment: JudgmentEvent): EnergyEvent | null {
    switch (judgment.type) {
      case "PerfectNote":
      case "GoodNote":
        return this.#energy({
          polarity: "good",
          cause: judgment.type === "PerfectNote" ? "perfect" : "good",
          lane: judgment.target.lane,
          beat: judgment.target.startBeat,
          opportunityIndex: judgment.target.opportunityIndex,
          playedMidi: judgment.playedMidi,
        });
      case "MissedNote":
        return this.#energy({
          polarity: "bad",
          cause: "miss",
          lane: judgment.target.lane,
          beat: judgment.target.startBeat,
          opportunityIndex: judgment.target.opportunityIndex,
          // A miss is a target nothing was played for.
          playedMidi: null,
        });
      case "WrongNote":
        return this.#energy({
          polarity: "bad",
          cause: "wrong",
          lane: judgment.lanePosition,
          beat: judgment.atBeat,
          // A wrong note matched no target, so it resolves no opportunity.
          opportunityIndex: null,
          playedMidi: judgment.playedMidi,
        });
      default:
        return null;
    }
  }

  #energy(fields: Omit<EnergyEvent, "id">): EnergyEvent {
    return { id: this.#nextEnergyId++, ...fields };
  }

  #finish(beat: number): void {
    if (this.#complete) return;
    // Expire anything whose window closed exactly on the boundary.
    this.judge.tick(beat);
    this.#complete = true;

    const stars = this.starMeter.update(this.score.judgmentPoints);
    const passed = stars >= 1;
    this.minigame.onComplete(passed, stars, beat);

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
