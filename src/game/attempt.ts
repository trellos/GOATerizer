/**
 * One attempt: two passes at one scenario's four-measure phrase, at one
 * difficulty.
 *
 * This is the join between the systems, and it is where the causal chain the
 * whole game rests on actually happens:
 *
 *     guitar event -> beat -> judgment -> actor
 *
 * It owns the judge, the score, the star meter, and whatever characters this
 * scenario puts on the timeline. It is free of DOM and audio, so the entire
 * chain is testable with injected input.
 *
 * The chain used to run `judgment -> energy -> scenario`, with the caller
 * deciding when energy arrived so a streak flying from the note to the scenario
 * panel was what triggered the goat. There is no scenario panel to fly to any
 * more — the actors live on the note bars and the panel is a backdrop
 * (`docs/game-design/PROPOSED_Timeline_Actors.md`) — so a judgment now moves its
 * actor directly, on the beat it is judged.
 */

import { ATTEMPT_BEATS, ATTEMPT_REPEATS, BEATS_PER_MEASURE } from "../config/tuning.js";
import type { GuitarInputEvent } from "../input/guitar-input.js";
import { laneOfMidi, type RunKey } from "../music/keys.js";
import { RepeatMinigame } from "../scenario/minigames/repeat-minigame.js";
import { TimelineActor } from "../scenario/minigames/timeline-actor.js";
import type { ScenarioDefinition, ScenarioLevelData } from "../scenario/types.js";
import { TargetJudge, type JudgmentEvent } from "./judgment.js";
import { AttemptScore, type ScoreSnapshot } from "./scoring.js";
import { StarMeter } from "./stars.js";
import { resolveTargets, type ResolvedTarget } from "./targets.js";

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

/**
 * Periods a `RepeatMinigame` performer is allowed to swing at, longest first.
 *
 * Every one of them divides a beat, and {@link STANDS_BACK_BEATS}' worth of
 * flight is a whole beat, so a note on the grid arrives at the performer
 * exactly on one of his swings. Anything not on this list would put the palm
 * somewhere else when the can got there.
 */
const STRIKE_PERIODS = [1, 1 / 2, 1 / 3, 1 / 4] as const;

/**
 * How often a `RepeatMinigame` performer swings, in beats.
 *
 * Read from the authored grid rather than configured: his loop is the tutorial
 * for the whole mechanic, so it has to run at the rate cans actually arrive.
 * Quarter-note material gets a swing per beat; a scenario that drops into
 * sixteenths gets a performer working in sixteenths, which is also the honest
 * picture of what it is asking of the player.
 */
function repeatStrikePeriod(targets: readonly ResolvedTarget[]): number {
  const beats = targets.map((target) => target.startBeat).sort((a, b) => a - b);
  let finest: number = STRIKE_PERIODS[0];
  for (let i = 1; i < beats.length; i += 1) {
    const gap = (beats[i] ?? 0) - (beats[i - 1] ?? 0);
    if (gap > 1e-6 && gap < finest) finest = gap;
  }
  // The longest allowed period that still fits inside the tightest gap.
  return STRIKE_PERIODS.find((period) => period <= finest + 1e-6) ?? STRIKE_PERIODS.at(-1) ?? 1;
}

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
  /** The repeat performer, when this scenario is a `RepeatMinigame`. */
  readonly repeat: RepeatMinigame | null;
/**
   * PROTOTYPE: the actor that lives on the timeline itself
   * (`docs/game-design/PROPOSED_Timeline_Actors.md`). Every scenario has one;
   * a `RepeatMinigame` draws its performer instead, from `repeat` below.
   */
  readonly actor = new TimelineActor();

  readonly #toBeat: (contextTime: number) => number;
  readonly #listeners: ((event: AttemptEvent) => void)[] = [];
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
    this.repeat =
      options.scenario.assetBindings.kind === "repeat"
        ? new RepeatMinigame({
            performerLane: repeatPerformerLane(this.targets),
            strikePeriodBeats: repeatStrikePeriod(this.targets),
          })
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
      this.repeat?.update(this.toAttemptBeat(absoluteBeat));
      return;
    }

    const beat = this.toAttemptBeat(absoluteBeat);
    this.judge.tick(beat);
    this.repeat?.update(beat);
    // What the actor should be leaning at. At 60bpm there is most of a second
    // between quarter notes, and an idle actor there is dead air; aimed at the
    // next lane it doubles as a pointer at the note that is coming.
    this.actor.aimAt(this.judge.currentTarget(beat)?.lane ?? null);

    // The plan counts the authored phrase; the attempt plays it more than once.
    const measures = Math.min(
      this.level.measurePlan.attemptMeasures * ATTEMPT_REPEATS,
      Math.floor(beat / BEATS_PER_MEASURE)
    );
    while (this.#measuresCompleted < measures) {
      const index = this.#measuresCompleted;
      this.#measuresCompleted += 1;
      this.#emit({ type: "measureComplete", measureIndex: index });
    }

    if (beat >= ATTEMPT_BEATS) this.#finish(beat);
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
  }

  /**
   * Places one can in response to one judgment.
   *
   * The mirror image of `#driveActor`: a projectile resolves at the strike line
   * and leaves no state behind, so it is safe — and diagnostic — to let the
   * played pitch put it where the player actually played.
   *
   * Every judgment produces a can, a miss included. The can was already on
   * screen riding in on its bar before it was judged, so it has to go
   * somewhere; a miss is the one outcome where the answer is "nowhere", and
   * watching it stay down and roll past is the point.
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
        // Its own lane, its own beat: the can stays exactly where it already
        // was and keeps travelling with the bar it arrived in.
        repeat.miss(judgment.target.lane, judgment.target.startBeat);
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

  #finish(beat: number): void {
    if (this.#complete) return;
    // Expire anything whose window closed exactly on the boundary.
    this.judge.tick(beat);
    this.#complete = true;

    const stars = this.starMeter.update(this.score.judgmentPoints, this.score.consistencyPoints);
    const passed = stars >= 1;
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
