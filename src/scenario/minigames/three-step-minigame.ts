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
  spanAnchorX,
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
/**
 * The trot back, once the headbutt has landed.
 *
 * A third of a beat out and a third back puts the ram home on the beat after
 * the one it leapt on — the next group's first tap — so the round trip is the
 * length of the gesture that caused it. The return arcs lower than the leap
 * because it is not the gesture: the ram is walking off a hit, not landing one.
 */
const RECOVER_BEATS = 1 / 3;
const RECOVER_HEIGHT = 0.18;

/*
 * How big the two animals are, and how far apart they stand.
 *
 * A sprite at `scale: 1` is the size it was drawn at, against the nominal scene
 * in `ui/timeline/stage-layer.ts`. This family's art came out of a third-party
 * pack drawn much larger than the generated art the other families use — the ram
 * is 47 art pixels tall where a Rocky goat is 18 — so at 1 it stands three and a
 * half lanes tall and swallows the wolf it is supposed to be butting. Both are
 * scaled together, keeping the proportion they were drawn in, into the roughly
 * two-lane range every other actor in the game occupies.
 *
 * The distance between them is spent to the **left**, where the notes have
 * already been played: a sprite this wide sitting ahead of the strike line
 * would cover the bars the player is still reading.
 */
const ACTOR_SCALE = 0.62;
/** Where the ram waits, in beats left of the strike line. */
const RAM_REST_BEATS = 1.2;
/** Where the leap puts it: close enough that the headbutt lands on the wolf. */
const RAM_LEAP_BEATS = 0.7;
/** Where the wolf stands, in beats right of the strike line. */
const TARGET_AHEAD_BEATS = 0.35;

/*
 * The battle, made visible.
 *
 * Every landed note grows the ram a little; every missed or wrong one grows
 * the wolf. Growth pulses so the eye is drawn to the thing that just grew, and
 * the wolf flashes red when it is the wolf. At the end, a passed attempt (one
 * star or more) is a won fight: the wolf tumbles, upside down, off the bottom
 * of the screen as the minigame scrolls away, and lies there.
 *
 * Provisional numbers: how many notes fill the growth meter is a fraction of
 * the attempt's own note count, so a dense level does not max out in the first
 * measure and a sparse one still gets somewhere.
 */
/** Fraction of the attempt's notes that takes either animal to full size. */
const GROWTH_NOTES_FRACTION = 0.5;
/** How much bigger either animal gets at full growth. */
const GROWTH_SCALE = 0.6;
/** How far the ram rises off its lane at full growth, in lane-band units. */
const RAM_LIFT = 0.08;
/** The swell past the new size on a growth step, and how long it lasts. */
const GROWTH_PULSE = 0.2;
const GROWTH_PULSE_BEATS = 0.3;
/** The wolf's red flash on a growth step. */
const WOLF_FLASH_BEATS = 0.4;
const WOLF_FLASH = "#ff3b3b";
/** The tumble: how long the fall takes and where it ends, below the band. */
export const TUMBLE_BEATS = 0.8;
const TUMBLE_FLOOR_Y = 1.35;

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

/**
 * The vertical centre of a lane, in the normalised lane-band space sprites are
 * placed in: lane 0 at the bottom, `laneCount - 1` at the top.
 */
function laneY(view: StageView, lane: number): number {
  return view.laneCount <= 1 ? 0.5 : 1 - (lane + 0.5) / view.laneCount;
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
  /** The battle: 0..1 growth per animal, and when each last grew. Attempt-global. */
  #ramGrowth = 0;
  #wolfGrowth = 0;
  #ramGrewAtBeat: number | null = null;
  #wolfGrewAtBeat: number | null = null;
  /** Notes that take either animal to full size. */
  readonly #growthNotes: number;
  /** A star was earned: the fight is won, whatever happens after. */
  #won = false;
  /** The wolf's tumble, once the attempt is over and won. */
  #tumbleStartBeat: number | null = null;

  constructor(config: ThreeStepConfig, level: ThreeStepLevel, context: AttemptContext) {
    this.#config = config;
    this.#level = level;
    this.#opportunities = context.opportunities;
    this.#growthNotes = Math.max(1, Math.ceil(context.opportunities.length * GROWTH_NOTES_FRACTION));
  }

  /** Attempt-global group count, for the dev panel and tests. */
  get groups(): number {
    return this.#groups;
  }

  /** Whether the target is currently down. Visual-cycle-local. */
  get targetDown(): boolean {
    return this.#targetDown;
  }

  /** The battle, for tests and the dev panel: growth 0..1 each, and the outcome. */
  get battle(): { ram: number; wolf: number; won: boolean; tumbling: boolean } {
    return {
      ram: this.#ramGrowth,
      wolf: this.#wolfGrowth,
      won: this.#won,
      tumbling: this.#tumbleStartBeat !== null,
    };
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
      // The wolf feeds on mistakes.
      this.#wolfGrowth = Math.min(1, this.#wolfGrowth + 1 / this.#growthNotes);
      this.#wolfGrewAtBeat = beat;
      return;
    }
    if (!target) return;

    // The ram feeds on notes landed.
    this.#ramGrowth = Math.min(1, this.#ramGrowth + 1 / this.#growthNotes);
    this.#ramGrewAtBeat = beat;

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
    // Held through the return as well as the leap: dropping it at the top of
    // the arc is what used to teleport the ram home. See `#ramPosition`.
    if (this.#leap && beat >= this.#leap.startBeat + LEAP_BEATS + RECOVER_BEATS) {
      this.#leap = null;
    }
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

  /** One star is a pass, and a pass is a won fight. Stars lock, so this never unwins. */
  onStarEarned(stars: number): void {
    if (stars >= 1) this.#won = true;
  }

  /**
   * The finish pose becomes the held pose on a pass, and the wolf — beaten —
   * goes over. A failed attempt leaves it standing, and as big as it got.
   */
  onComplete(passed: boolean, _stars: number, beat: number): void {
    this.#effects = [];
    if (passed) {
      this.#pose = { assetId: this.#config.finishPose, startBeat: beat, lane: this.#pose?.lane ?? 0 };
    }
    if (passed || this.#won) this.#tumbleStartBeat = beat;
  }

  render(view: StageView): Stage {
    const sprites: Sprite[] = [];
    const beat = view.beat;

    // The target waits at the strike line for the whole attempt: this family's
    // notes come to the actor rather than the actor chasing them. Anchored to
    // the attempt's own span, so it rides in with the first measure and out
    // with the last rather than standing at the line during the previous act.
    const anchorX = spanAnchorX(view);
    const targetArt = this.#targetDown
      ? (this.#config.targetVisuals[1] ?? this.#config.targetVisuals[0])
      : this.#config.targetVisuals[0];
    if (targetArt !== undefined) {
      const restY = laneY(view, this.#aim ?? 0) + 0.12;
      const tumble = this.#tumbleAt(beat);
      const flash =
        this.#wolfGrewAtBeat === null ? 0 : decay(this.#wolfGrewAtBeat, WOLF_FLASH_BEATS, beat);
      sprites.push({
        key: "target",
        assetId: targetArt,
        x: anchorX + view.measure.beatWidth * TARGET_AHEAD_BEATS,
        // The tumble: from where it stood to the floor below the band, turning
        // over as it goes, and it stays there upside down.
        y: restY + (TUMBLE_FLOOR_Y - restY) * tumble,
        rotationDeg: 180 * tumble,
        scale: ACTOR_SCALE * this.#growthScale(this.#wolfGrowth, this.#wolfGrewAtBeat, beat),
        anchor: "bottom",
        layer: "over",
        ...(flash > 0 ? { tint: { colour: WOLF_FLASH, amount: flash * 0.8 } } : {}),
      });
    }

    const pose = this.#pose;
    if (pose) {
      // Mid-leap the ram flies an arc between the two lanes; otherwise it
      // stands on the one its pose was set on, leaning at what is coming.
      // Growth lifts it a little off its lane as well as making it bigger.
      const restY = laneY(view, pose.lane) - RAM_LIFT * this.#ramGrowth;
      const restX = anchorX - view.measure.beatWidth * RAM_REST_BEATS;
      const position = this.#ramPosition(view, { x: restX, y: restY });
      sprites.push({
        key: "ram",
        assetId: pose.assetId,
        x: position.x,
        y: position.y,
        scale: ACTOR_SCALE * this.#growthScale(this.#ramGrowth, this.#ramGrewAtBeat, beat),
        anchor: "bottom",
        layer: "over",
      });
    }

    for (const [i, flash] of this.#effects.entries()) {
      sprites.push({
        key: `fx-${i}-${flash.startBeat}`,
        assetId: flash.assetId,
        x: anchorX,
        y: laneY(view, flash.lane),
        // The same scale as the animals: the effects were drawn in the same
        // frame, and a flash that keeps its full size next to a scaled-down ram
        // reads as a different scene happening on top of this one.
        scale: ACTOR_SCALE,
        layer: "over",
        opacity: decay(flash.startBeat, EFFECT_BEATS, beat),
      });
    }

    return { background: this.#config.background, sprites };
  }

  /** Size from growth, with the swell of a step that just happened. */
  #growthScale(growth: number, grewAtBeat: number | null, beat: number): number {
    const pulse =
      grewAtBeat === null
        ? 0
        : Math.sin(Math.min(1, Math.max(0, (beat - grewAtBeat) / GROWTH_PULSE_BEATS)) * Math.PI);
    return (1 + GROWTH_SCALE * growth) * (1 + GROWTH_PULSE * pulse);
  }

  /** 0 before the tumble, 1 once the wolf is down. Eased at the start: it topples. */
  #tumbleAt(beat: number): number {
    if (this.#tumbleStartBeat === null) return 0;
    const t = Math.min(1, Math.max(0, (beat - this.#tumbleStartBeat) / TUMBLE_BEATS));
    return t * t;
  }

  /**
   * Where the ram is: at rest, going out, or coming back.
   *
   * The headbutt is a round trip. An earlier pass drew only the outbound arc and
   * dropped the leap the moment it finished, so the ram lunged at the wolf and
   * was home again on the very next frame — a teleport, and the one gesture this
   * whole family is named for. The return is the second half of it: a lower,
   * flatter arc back to whichever lane the ram is standing on *now*, so a leap
   * that landed on the last note of a group walks back to where the next group
   * starts rather than to where the last one did.
   *
   * Both halves are `arc()` against `view.beat`, like everything else here —
   * nothing accumulates, so a dropped frame loses no ground and the position at
   * any beat is the same on every machine.
   */
  #ramPosition(view: StageView, rest: { x: number; y: number }): { x: number; y: number } {
    const leap = this.#leap;
    if (!leap) return rest;

    const landing = {
      x: spanAnchorX(view) - view.measure.beatWidth * RAM_LEAP_BEATS,
      y: laneY(view, leap.to),
    };

    if (view.beat < leap.startBeat + LEAP_BEATS) {
      return arc(
        { x: rest.x, y: laneY(view, leap.from) },
        landing,
        LEAP_HEIGHT,
        leap.startBeat,
        LEAP_BEATS,
        view.beat
      );
    }
    return arc(landing, rest, RECOVER_HEIGHT, leap.startBeat + LEAP_BEATS, RECOVER_BEATS, view.beat);
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
  rhythmCall: "Ba Da Bing",
  apiVersion: MINIGAME_API_VERSION,

  authoring: {
    /**
     * Nothing here counts notes: this family's level data is how it *reads* the
     * triplet groups, not how many there are. The one rule that does depend on
     * the prompt — whole groups of three — is a refusal rather than a repair
     * (`parseLevel`), because two thirds of a headbutt is not something an
     * editor can quietly finish on the author's behalf.
     *
     * So this only fills in the fields a difficulty being authored for the first
     * time has not got yet.
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
        visual: {
          ...visual,
          alternateAfterGroups:
            typeof visual["alternateAfterGroups"] === "number"
              ? visual["alternateAfterGroups"]
              : shape.measures,
        },
      };
    },

    /**
     * `parseLevel` already refuses a level whose triplets do not come in whole
     * groups, so a loadable level always has headbutts in it. What it cannot see
     * is the side the ram butts from: `alternateAfterGroups` counts *groups*, and
     * a level with fewer groups than that never alternates at all — every leap
     * comes from the same side, for the whole attempt.
     */
    reviewLevel(level, shape) {
      const visual = (level["visual"] as Record<string, unknown>) ?? {};
      const after = visual["alternateAfterGroups"];
      const groups = Math.floor(shape.noteOpportunityCount / 3);
      if (typeof after !== "number" || after <= 0) return [];
      return groups > 0 && after >= groups
        ? [
            `alternateAfterGroups is ${after} but the phrase holds ${groups} groups, ` +
              "so the ram leaps from the same side every time",
          ]
        : [];
    },
  },

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
    // Notes, not events. A triplet *rest* is a written length, not a step —
    // counting one as a headbutt would let a level whose groups are two thirds
    // of a phrase pass as whole ones, which is exactly what happens when a note
    // is deleted in the editor and its silence is spelled back as a rest of the
    // same length.
    const triplets = Array.isArray(prompt)
      ? prompt.filter((event) => {
          if (typeof event !== "object" || event === null) return false;
          const authored = event as Record<string, unknown>;
          return authored["type"] === "note" && authored["duration"] === "eighthTriplet";
        }).length
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
    const battle = three.battle;
    return {
      "triplet groups": String(three.groups),
      "target": three.targetDown ? "down" : "standing",
      "battle ram/wolf": `${battle.ram.toFixed(2)}/${battle.wolf.toFixed(2)}${battle.won ? " won" : ""}${
        battle.tumbling ? " tumbling" : ""
      }`,
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
