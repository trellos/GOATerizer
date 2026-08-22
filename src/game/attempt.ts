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
import { laneOfMidi, type RunKey } from "../music/keys.js";
import { ClimbMinigame, type ClimbEnergy } from "../scenario/minigames/climb-minigame.js";
import { RepeatMinigame } from "../scenario/minigames/repeat-minigame.js";
import { TimelineActor } from "../scenario/minigames/timeline-actor.js";
import type { ScenarioDefinition, ScenarioLevelData } from "../scenario/types.js";
import { TargetJudge, type JudgmentEvent } from "./judgment.js";
import { AttemptScore, type ScoreSnapshot } from "./scoring.js";
import { StarMeter } from "./stars.js";
import { resolveTargets, type ResolvedTarget } from "./targets.js";

export type EnergyCause = "perfect" | "good" | "miss" | "wrong";

/**
 * Where a `RepeatMinigame` performer stands: the lane the exercise sits on most
 * often.
 *
 * Read from the authored material rather than configured, so a scenario cannot
 * declare a home pitch its own phrases never visit. REPEAT material is
 * dominated by one pitch by construction — the class is "do this one thing over
 * and over" — so the modal lane is the home, and any note off it is the
 * composer deliberately making the player move.
 */
function repeatPerformerLane(targets: readonly ResolvedTarget[]): number {
  const counts = new Map<number, number>();
  for (const target of targets) counts.set(target.lane, (counts.get(target.lane) ?? 0) + 1);
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
  /** The climb, when this scenario is a `ClimbMinigame`. Null otherwise. */
  readonly climb: ClimbMinigame | null;
  /** The repeat performer, when this scenario is a `RepeatMinigame`. */
  readonly repeat: RepeatMinigame | null;
  /**
   * PROTOTYPE: the actor that lives on the timeline itself
   * (`docs/game-design/PROPOSED_Timeline_Actors.md`). Runs alongside the climb
   * rather than replacing it, so the two presentations can be compared in the
   * same build.
   */
  readonly actor = new TimelineActor();

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
    // One class per scenario, chosen by the scenario's own declaration. The
    // runtime never guesses: a class whose data is absent is simply not built.
    const bindings = options.scenario.assetBindings;
    const parameters = options.scenario.classParameters;
    this.climb =
      bindings.kind === "climb" && parameters.kind === "climb" && level.route
        ? new ClimbMinigame({ route: level.route, bindings, parameters })
        : null;
    this.repeat =
      bindings.kind === "repeat"
        ? new RepeatMinigame({ performerLane: repeatPerformerLane(this.targets) })
        : null;

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
      this.climb?.update(this.toAttemptBeat(absoluteBeat));
      this.repeat?.update(this.toAttemptBeat(absoluteBeat));
      return;
    }

    const beat = this.toAttemptBeat(absoluteBeat);
    this.judge.tick(beat);
    this.climb?.update(beat);
    this.repeat?.update(beat);
    // What the actor should be leaning at. At 60bpm there is most of a second
    // between quarter notes, and an idle actor there is dead air; aimed at the
    // next lane it doubles as a pointer at the note that is coming.
    this.actor.aimAt(this.judge.currentTarget(beat)?.lane ?? null);

    const measures = Math.min(
      this.level.measurePlan.attemptMeasures,
      Math.floor(beat / BEATS_PER_MEASURE)
    );
    while (this.#measuresCompleted < measures) {
      const index = this.#measuresCompleted;
      this.#measuresCompleted += 1;
      this.climb?.onMeasureComplete(index, beat);
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
    this.climb?.applyEnergy(payload, atBeat);
  }

  /* ------------------------------------------------------------------ */

  #onJudgment(judgment: JudgmentEvent): void {
    this.score.apply(judgment);
    this.#driveActor(judgment);
    this.#driveRepeat(judgment);
    this.#emit({ type: "judgment", judgment });

    const before = this.starMeter.stars;
    const after = this.starMeter.update(this.score.judgmentPoints, this.score.consistencyPoints);
    if (after > before) this.#emit({ type: "starEarned", stars: after });

    const energy = this.#energyFor(judgment);
    if (energy) this.#emit({ type: "energy", energy });
  }

  /**
   * Places one can in response to one judgment.
   *
   * The mirror image of `#driveActor`: a projectile resolves at the strike line
   * and leaves no state behind, so it is safe — and diagnostic — to let the
   * played pitch put it where the player actually played.
   */
  #driveRepeat(judgment: JudgmentEvent): void {
    const repeat = this.repeat;
    if (!repeat) return;
    switch (judgment.type) {
      case "PerfectNote":
      case "GoodNote":
      case "WrongNote": {
        // The PLAYED pitch places the can — that is the whole mechanic. It is
        // quantised to a lane for placement only; judgment already happened and
        // is not revisited here.
        const beat =
          judgment.type === "WrongNote" ? judgment.atBeat : judgment.target.startBeat;
        repeat.place(laneOfMidi(judgment.playedMidi, this.key), beat);
        break;
      }
      case "MissedNote":
        repeat.miss();
        break;
      default:
        break;
    }
  }

  /**
   * Moves the timeline actor in response to one judgment.
   *
   * Lands on the *target's* lane, never the played pitch — see
   * `timeline-actor.ts` for why that distinction is what keeps a single mistake
   * from ending a run. A wrong note kills the actor without moving it anywhere.
   */
  #driveActor(judgment: JudgmentEvent): void {
    switch (judgment.type) {
      case "PerfectNote":
      case "GoodNote":
        this.actor.land(judgment.target.lane, judgment.target.startBeat);
        break;
      case "MissedNote":
        this.actor.fall(judgment.target.startBeat);
        break;
      case "WrongNote":
        this.actor.fall(judgment.atBeat);
        break;
      default:
        break;
    }
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

    const stars = this.starMeter.update(this.score.judgmentPoints, this.score.consistencyPoints);
    const passed = stars >= 1;
    this.climb?.complete(passed, beat);
    this.repeat?.complete(passed, beat);

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
