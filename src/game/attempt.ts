/**
 * One attempt: two passes at one scenario's four-measure phrase, at one
 * difficulty.
 *
 * This is the join between the systems, and it is where the causal chain the
 * whole game rests on actually happens:
 *
 *     guitar event -> beat -> judgment -> minigame
 *
 * It owns the judge, the score, the star meter, and whatever characters this
 * scenario puts on the timeline. It is free of DOM and audio, so the entire
 * chain is testable with injected input.
 *
 * The chain used to run `judgment -> energy -> scenario`, with the caller
 * deciding when energy arrived so a streak flying from the note to the scenario
 * panel was what triggered the goat. There is no scenario panel to fly to any
 * more — the actors live on the note bars — so a judgment now reaches its
 * minigame directly, on the beat it is judged.
 *
 * What this file does NOT know is which minigame that is. It resolves the
 * scenario's declared id through `minigame/registry.ts`, hands the result
 * judged notes, measure boundaries, stars and completion, and never asks what
 * any of it draws. Adding a family changes nothing here.
 */

import { ATTEMPT_BEATS, ATTEMPT_REPEATS, BEATS_PER_MEASURE } from "../config/tuning.js";
import type { GuitarInputEvent } from "../input/guitar-input.js";
import type { Judged, Minigame } from "../minigame/api.js";
import { requireMinigame } from "../minigame/registry.js";
import { lanePositionOfMidi, type RunKey } from "../music/keys.js";
import type { ScenarioDefinition, ScenarioLevelData } from "../scenario/types.js";
import { TargetJudge, type JudgmentEvent } from "./judgment.js";
import { AttemptScore, type ScoreSnapshot } from "./scoring.js";
import { StarMeter } from "./stars.js";
import { resolveTargets, type ResolvedTarget } from "./targets.js";

export type AttemptResult = {
  scenarioId: string;
  difficulty: number;
  stars: number;
  passed: boolean;
} & ScoreSnapshot;

export type AttemptEvent =
  | { type: "judgment"; judgment: JudgmentEvent }
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
  /**
   * Whatever family this scenario declares, built through the registry.
   *
   * The runtime holds one of these and knows nothing else about it. It does not
   * know whether it draws a goat or a can crusher, and adding a third family
   * changes nothing in this file.
   */
  readonly minigame: Minigame;

  readonly #toBeat: (contextTime: number) => number;
  readonly #listeners: ((event: AttemptEvent) => void)[] = [];
  #measuresCompleted = 0;
  #judgedCount = 0;
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
    // One family per scenario, chosen by the scenario's own declaration and
    // built by the registry. The runtime never guesses and never branches: it
    // does not know what a climber or a can is.
    this.minigame = requireMinigame(options.scenario.minigameId, `scenario ${options.scenario.id}`)
      .create({
        config: options.scenario.config,
        data: level.data,
        assets: Object.keys(options.scenario.assetUrls),
        plan: {
          measures: level.measurePlan.attemptMeasures * ATTEMPT_REPEATS,
          beatsPerMeasure: level.measurePlan.beatsPerMeasure,
          totalBeats: ATTEMPT_BEATS,
          phraseBeats: level.measurePlan.attemptMeasures * level.measurePlan.beatsPerMeasure,
        },
        opportunities: this.targets.map((target) => ({
          index: target.opportunityIndex,
          startBeat: target.startBeat,
          durationBeats: target.durationBeats,
          duration: target.duration,
          lane: target.lane,
          midi: target.midi,
        })),
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

  /**
   * Whatever this family wants shown in the dev panel.
   *
   * Asked of the module rather than read off the instance: the host has no idea
   * whether a can or a streak is the interesting number, and a third family
   * must be able to say so without editing the panel.
   */
  get debugRows(): Readonly<Record<string, string>> {
    return requireMinigame(this.scenario.minigameId, "debug").debug?.(this.minigame) ?? {};
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
   * Attacks, revisions and releases reach judgment. Sustain updates carry bend
   * data that no Rocky Ascent target asks about and are forwarded to nothing.
   *
   * Releases used to be dropped here on the grounds that nothing graded note
   * duration. Something does now — not duration grading, but the backing-track
   * duck (`game/backing-duck.ts`), which treats letting a note go at the right
   * moment as evidence that the player is on top of the phrase. A release still
   * cannot resolve, re-resolve or re-score a target; see `judgment.ts`.
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
      case "release":
        this.judge.release(event.id, this.toAttemptBeat(this.#toBeat(event.contextTime)));
        break;
      default:
        break;
    }
  }

  /** Drives expiry, effect decay and completion. Safe to call every frame. */
  update(absoluteBeat: number): void {
    if (this.#complete) {
      // A finished attempt still animates while its measures scroll off.
      this.minigame.update(this.toAttemptBeat(absoluteBeat));
      return;
    }

    const beat = this.toAttemptBeat(absoluteBeat);
    this.judge.tick(beat);
    this.minigame.update(beat);
    // What the family should be leaning at, for the ones that lean. At 60bpm
    // there is most of a second between quarter notes, and an idle actor there
    // is dead air; aimed at the next lane it doubles as a pointer at the note
    // that is coming.
    this.minigame.aimAt?.(this.judge.currentTarget(beat)?.lane ?? null);

    // The plan counts the authored phrase; the attempt plays it more than once.
    const measures = Math.min(
      this.level.measurePlan.attemptMeasures * ATTEMPT_REPEATS,
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

  /* ------------------------------------------------------------------ */

  #onJudgment(judgment: JudgmentEvent): void {
    this.score.apply(judgment);
    const judged = this.#toJudged(judgment);
    if (judged) this.minigame.onJudged(judged, judged.beat);
    this.#emit({ type: "judgment", judgment });

    const before = this.starMeter.stars;
    const after = this.starMeter.update(this.score.judgmentPoints, this.score.consistencyPoints);
    if (after > before) {
      this.minigame.onStarEarned(after, judged?.beat ?? 0);
      this.#emit({ type: "starEarned", stars: after });
    }
  }

  /**
   * One judgment, in the vocabulary the contract speaks.
   *
   * This is the whole of what `AttemptRuntime` knows about a family now. It
   * used to be two methods — `#driveActor` and `#driveRepeat` — each holding
   * one family's rules, and adding a third family meant a third method here.
   *
   * `Judged` deliberately carries both pitches: `lane` is what the player
   * actually played, and the target's is reachable through `opportunityIndex`.
   * That is what lets a climb land on authored pitch and a repeat place a can
   * on played pitch without the host choosing between them.
   *
   * A note released on time produces nothing. The family already reacted when
   * the attack was judged, and it gets exactly one reaction per opportunity —
   * a release must not advance a goat or put a second can on the belt.
   */
  #toJudged(judgment: JudgmentEvent): Judged | null {
    const id = this.#judgedCount;
    switch (judgment.type) {
      case "PerfectNote":
      case "GoodNote":
        this.#judgedCount += 1;
        return {
          id,
          outcome: judgment.type === "PerfectNote" ? "perfect" : "good",
          opportunityIndex: judgment.target.opportunityIndex,
          playedMidi: judgment.playedMidi,
          lane: lanePositionOfMidi(judgment.playedMidi, this.key),
          beat: judgment.target.startBeat,
        };
      case "MissedNote":
        this.#judgedCount += 1;
        return {
          id,
          outcome: "miss",
          opportunityIndex: judgment.target.opportunityIndex,
          playedMidi: null,
          lane: null,
          beat: judgment.target.startBeat,
        };
      case "WrongNote":
        this.#judgedCount += 1;
        return {
          id,
          outcome: "wrong",
          opportunityIndex: null,
          playedMidi: judgment.playedMidi,
          lane: judgment.lanePosition,
          beat: judgment.atBeat,
        };
      default:
        return null;
    }
  }

  #finish(beat: number): void {
    if (this.#complete) return;
    // Expire anything whose window closed exactly on the boundary.
    this.judge.tick(beat);
    this.#complete = true;

    const stars = this.starMeter.update(this.score.judgmentPoints, this.score.consistencyPoints);
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
