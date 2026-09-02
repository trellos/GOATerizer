/**
 * `PerformMinigame` — the PERFORM verb, for the Blues Lick family.
 *
 * The contract: **expression, played to a crowd.** The performer does not go
 * anywhere; it stands at the current-time bar and the phrase comes to it. Every
 * successful note is a pose. Certain authored notes are **flourishes** — the
 * designer marks them, and on those the performer strikes a flourish pose and
 * the act visibly pays off: an audience arrives. Bad notes are embarrassment,
 * not injury: a flinch, a crowd that loses interest for a beat, and nothing
 * lost.
 *
 * On the timeline (GDD §11.2) that reads as: the note bars are the light show,
 * the performer stands on the stage floor below the lanes just left of the
 * strike line, and the crowd gathers on the same floor to either side of it,
 * walking in from the wings one flourish at a time. Goat Frontman decides the
 * performer and the crowd are goats; the class only knows about poses, slots
 * and a crowd of some sprite that has two states.
 *
 * This class contains no scenario-specific asset names and no scenario ids. It
 * is handed a set of class asset *slots* and class parameters, and level data
 * that says which beats of the phrase are flourishes and how big a crowd each
 * one draws. A second PERFORM scenario needs data and art, not code.
 */

import {
  decay,
  MINIGAME_API_VERSION,
  slide,
  type AttemptContext,
  type Judged,
  type Minigame,
  type MinigameModule,
  type NoteArt,
  type Sprite,
  type Stage,
  type StageView,
} from "../../minigame/api.js";
import { arr, bool, num, obj, ScenarioDataError, str, strings } from "../parse.js";

/* -------------------------------------------------------------------------- */
/* Content shape — owned by this class, opaque to the host                     */
/* -------------------------------------------------------------------------- */

/**
 * The canonical `PerformMinigame` slots
 * (`GOATerizer_Scenario_Asset_Slot_Bindings.md` §2), plus the two pieces of
 * timeline note art the surface needs: what a note is made of, and what marks
 * a flourish note so the player can see the pose coming.
 */
export type PerformAssetBindings = {
  background: string;
  /** Normal-note pose cycle, one step per successful note. */
  performerPoses: readonly string[];
  /** Struck on a flourish note. Flourishes cycle through these in turn. */
  flourishPoses: readonly string[];
  finishPose: string;
  /** Staging objects placed beside the performer. May be empty. */
  signatureProps: readonly string[];
  /**
   * The crowd sprite: [0] unimpressed, [1] impressed. Optional in the canon —
   * some PERFORM scenarios escalate through the performer alone — and when it
   * is empty the crowd is still counted but nothing is drawn for it.
   */
  audienceStates: readonly string[];
  flourishEffects: readonly string[];
  accentEffects: readonly string[];
  payoffEffects: readonly string[];
  noteArt: { body: string; flourish: string };
};

export type PerformConfig = {
  bindings: PerformAssetBindings;
  /** `Embarrass`: a flinch and a bored crowd. `Ignore`: bad notes do nothing. */
  badNotePolicy: "Embarrass" | "Ignore";
  /** The most crowd members that fit in the wings. */
  crowdCapacity: number;
};

export type PerformLevelData = {
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
  /** Phrase-relative start beats of the flourish notes. */
  flourishBeats: readonly number[];
  /** Crowd members one flourish summons. The level ladder lives in this number. */
  goatsPerFlourish: number;
};

type PerformEffectKind = "accent" | "flourish" | "payoff";

type PerformEffect = {
  id: number;
  kind: PerformEffectKind;
  assetId: string;
  /** For an accent: which note it happened on. Null for effects at the performer. */
  noteIndex: number | null;
  strength: number;
  bornAtBeat: number;
  lifeBeats: number;
};

/** One crowd member. Where it stands is a slot; when it arrived says where it is now. */
export type CrowdMember = {
  id: number;
  /** Which slot it fills, in arrival order. */
  slot: number;
  arrivedAtBeat: number;
};

export type PerformOptions = {
  bindings: PerformAssetBindings;
  badNotePolicy: PerformConfig["badNotePolicy"];
  crowdCapacity: number;
  resetBetweenMeasures: boolean;
  /** Opportunity indices that are flourishes, already matched to the prompt. */
  flourishOpportunities: ReadonlySet<number>;
  goatsPerFlourish: number;
  /** Beat length of each opportunity, so a flourish pose is held for its note. */
  durationsByOpportunity: readonly number[];
};

/* -------------------------------------------------------------------------- */
/* Tuning — provisional, in normalised timeline space                          */
/* -------------------------------------------------------------------------- */

/** How long an accent glint stays up, in beats. */
const ACCENT_LIFE_BEATS = 0.55;
/** How long the flourish swoosh stays up. */
const FLOURISH_FX_BEATS = 0.8;
/** How long the ★★★ burst stays up. */
const PAYOFF_BEATS = 1.6;
/** The shortest a flourish pose is held, whatever the note's length. */
const FLOURISH_MIN_BEATS = 0.75;
/** How long the flinch takes to settle. */
const EMBARRASS_BEATS = 0.7;
/** How long the crowd stays bored after a bad note. */
const SULK_BEATS = 1;
/** How long a crowd member takes to walk in from the wing. */
const WALK_BEATS = 1.5;
/** How long the whole crowd jumps after ★★★. */
const PAYOFF_JUMP_BEATS = 2;

/*
 * Sprite sizing. `y` is normalised to the lane band, so `1` is the bottom of
 * the lowest lane and the floor below it is `y > 1` — the play area the
 * background fills (`minigame/api.ts`, `Sprite`).
 */
/*
 * Sized and placed so the performer's whole body sits *below* the lane band:
 * at 1.45 it is 0.276 of the band tall, and with its hooves at 1.27 its horns
 * reach 0.994. A first pass at 1.6 / 1.24 put its head across the bottom lane
 * at the strike line, under the very note the player was reading. The floor
 * below the band is at least 0.31 of the band tall (`BAND_MAX_FRACTION` in
 * the timeline view), so 1.27 stays on screen at every pane aspect.
 */
const PERFORMER_SCALE = 1.45;
/** Where the performer's hooves are: on the stage floor, under the lanes. */
const PERFORMER_FEET_Y = 1.27;
/** How far left of the strike line the performer stands, in beats. */
const PERFORMER_BACK_BEATS = 0.45;
/** Lift on a flourish, as a fraction of the band. */
const FLOURISH_LIFT = 0.05;
/** Degrees of lean at full flinch, and the dip that goes with it. */
const EMBARRASS_TILT = -14;
const EMBARRASS_DIP = 0.03;
const PROP_SCALE = 1.2;
/** How far right of the performer the first signature prop stands, in beats. */
const PROP_AHEAD_BEATS = 0.35;
const CROWD_SCALE = 0.85;
const CROWD_FEET_Y = 1.29;
/** Crowd slot layout: the first offset from the performer, and the pitch. */
const CROWD_FIRST_OFFSET = 0.075;
const CROWD_PITCH = 0.06;
/** Slots per side per row before the crowd starts a row further back. */
const CROWD_PER_SIDE_PER_ROW = 6;
const CROWD_ROW_SETBACK_Y = 0.05;
const CROWD_ROW_SHRINK = 0.12;
/** Where a walking-in crowd member starts: just off each wing. */
const WING_X = { left: -0.06, right: 1.06 };
const CROWD_WALK_HOP = 0.012;
const CROWD_CHEER_BOB = 0.02;
const CROWD_JUMP = 0.06;
const CROWD_SLUMP = 0.02;
const ACCENT_SCALE = 1.0;
const ACCENT_LIFT_Y = -0.03;
const FLOURISH_FX_SCALE = 1.4;
const PAYOFF_SCALE = 1.5;

/* -------------------------------------------------------------------------- */

/**
 * Where crowd member `index` stands, relative to the performer.
 *
 * Alternating sides, filling outward, then a row further back once a side is
 * full: the crowd grows around the act rather than in a queue. Pure, so the
 * same index is the same place on every frame and in every test.
 */
export function crowdSlot(index: number): { dx: number; row: number } {
  const side = index % 2 === 0 ? 1 : -1;
  const k = Math.floor(index / 2);
  return {
    dx: side * (CROWD_FIRST_OFFSET + (k % CROWD_PER_SIDE_PER_ROW) * CROWD_PITCH),
    row: Math.floor(k / CROWD_PER_SIDE_PER_ROW),
  };
}

export class PerformMinigame implements Minigame {
  readonly #bindings: PerformAssetBindings;
  readonly #badNotePolicy: PerformConfig["badNotePolicy"];
  readonly #crowdCapacity: number;
  readonly #resetBetweenMeasures: boolean;
  readonly #flourishOpportunities: ReadonlySet<number>;
  readonly #goatsPerFlourish: number;
  readonly #durations: readonly number[];

  #successfulNotes = 0;
  #flourishesHit = 0;
  #poseIndex = 0;
  #flourishPose: string | null = null;
  #flourishStartedAtBeat: number | null = null;
  #flourishHoldBeats = 0;
  #embarrassedAtBeat: number | null = null;
  #sulkUntilBeat: number | null = null;
  #impressed = false;
  #payoffAtBeat: number | null = null;
  #crowd: CrowdMember[] = [];
  #effects: PerformEffect[] = [];
  #nextId = 1;
  #finished = false;
  #frozen = false;
  #beat = 0;

  constructor(options: PerformOptions) {
    this.#bindings = options.bindings;
    this.#badNotePolicy = options.badNotePolicy;
    this.#crowdCapacity = Math.max(0, Math.floor(options.crowdCapacity));
    this.#resetBetweenMeasures = options.resetBetweenMeasures;
    this.#flourishOpportunities = options.flourishOpportunities;
    this.#goatsPerFlourish = Math.max(0, Math.floor(options.goatsPerFlourish));
    this.#durations = options.durationsByOpportunity;
  }

  /** Progress and terminal state, for tests and the developer panel. Not the render path. */
  get progress(): {
    successfulNotes: number;
    flourishesHit: number;
    crowd: number;
    impressed: boolean;
    finished: boolean;
    frozen: boolean;
  } {
    return {
      successfulNotes: this.#successfulNotes,
      flourishesHit: this.#flourishesHit,
      crowd: this.#crowd.length,
      impressed: this.#impressed,
      finished: this.#finished,
      frozen: this.#frozen,
    };
  }

  /** The crowd, in arrival order. Read-only. */
  get crowd(): readonly CrowdMember[] {
    return this.#crowd;
  }

  /* ------------------------------------------------------------------ */
  /* Minigame                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * One judged note.
   *
   * Perfect and Good both count as a successful note and both advance the
   * pose; the difference is in the accent's strength and, on a flourish, in
   * how much of the crowd turns up — Perfect draws the full count, Good half.
   * A miss or a wrong note is embarrassment and nothing else: no crowd member
   * ever leaves, because the crowd is the attempt-global record of what was
   * earned, and taking it away would be charging twice for one mistake.
   */
  onJudged(judged: Judged, beat: number): void {
    this.#beat = beat;
    if (this.#finished || this.#frozen) return;

    if (judged.outcome === "miss" || judged.outcome === "wrong") {
      if (this.#badNotePolicy === "Embarrass") {
        this.#embarrassedAtBeat = beat;
        this.#sulkUntilBeat = beat + SULK_BEATS;
      }
      return;
    }

    const index = judged.opportunityIndex;
    if (index === null) return;

    this.#successfulNotes += 1;
    this.#poseIndex = (this.#poseIndex + 1) % Math.max(1, this.#bindings.performerPoses.length);

    const perfect = judged.outcome === "perfect";
    const [accent] = this.#bindings.accentEffects;
    if (accent) this.#spawnEffect("accent", accent, index, perfect ? 1 : 0.55, beat, ACCENT_LIFE_BEATS);

    if (!this.#flourishOpportunities.has(index)) return;

    // A flourish. The pose is held for the note it was played on — a half
    // note's flourish is a long one — but never for less than a readable beat.
    const poses = this.#bindings.flourishPoses;
    this.#flourishPose = poses[this.#flourishesHit % Math.max(1, poses.length)] ?? null;
    this.#flourishStartedAtBeat = beat;
    this.#flourishHoldBeats = Math.max(FLOURISH_MIN_BEATS, this.#durations[index] ?? 0);
    this.#flourishesHit += 1;

    const [swoosh] = this.#bindings.flourishEffects;
    if (swoosh) this.#spawnEffect("flourish", swoosh, null, perfect ? 1 : 0.7, beat, FLOURISH_FX_BEATS);

    this.#summon(perfect ? this.#goatsPerFlourish : Math.ceil(this.#goatsPerFlourish / 2), beat);
  }

  /** Decays transient state. Purely visual; nothing here changes progress. */
  update(beat: number): void {
    this.#beat = beat;
    this.#effects = this.#effects.filter((effect) => beat - effect.bornAtBeat < effect.lifeBeats);
    if (this.#flourishStartedAtBeat !== null && beat - this.#flourishStartedAtBeat >= this.#flourishHoldBeats) {
      this.#flourishStartedAtBeat = null;
      this.#flourishPose = null;
    }
    if (this.#embarrassedAtBeat !== null && beat - this.#embarrassedAtBeat >= EMBARRASS_BEATS) {
      this.#embarrassedAtBeat = null;
    }
    if (this.#sulkUntilBeat !== null && beat >= this.#sulkUntilBeat) this.#sulkUntilBeat = null;
  }

  /**
   * Measure boundary. A PERFORM scenario is one continuous act across all
   * four measures by default, so nothing resets; a scenario that asks for a
   * per-measure cycle drops only the transient effects. The crowd is
   * attempt-global spectacle and survives every boundary.
   */
  onMeasure(_measureIndex: number, beat: number): void {
    this.#beat = beat;
    if (!this.#resetBetweenMeasures) return;
    this.#effects = [];
  }

  /**
   * Stars are where the crowd changes its mind: at ★★ it is impressed and
   * stays impressed (stars lock, so this never goes back), and ★★★ is the
   * payoff — the burst, and the whole crowd off its feet.
   */
  onStarEarned(stars: number, beat: number): void {
    this.#beat = beat;
    if (stars >= 2) this.#impressed = true;
    if (stars >= 3) {
      this.#payoffAtBeat = beat;
      const [burst] = this.#bindings.payoffEffects;
      if (burst) this.#spawnEffect("payoff", burst, null, 1, beat, PAYOFF_BEATS);
    }
  }

  /**
   * The attempt is over. Passed: the finish pose, held. Failed: freeze on the
   * current pose in front of whatever crowd was earned — not getting the
   * crowd is the punishment, and there is no bespoke failure art.
   */
  onComplete(passed: boolean, _stars: number, beat: number): void {
    this.#beat = beat;
    this.#flourishStartedAtBeat = null;
    this.#flourishPose = null;
    this.#embarrassedAtBeat = null;
    if (passed) this.#finished = true;
    else this.#frozen = true;
  }

  /**
   * The act, on the timeline.
   *
   * Every note bar is a stage light; the flourish notes carry a star so the
   * player can see them coming. The performer stands on the floor just left
   * of the strike line with its props, and the crowd fills the floor to either
   * side of it, each member walking in from the nearest wing when it was
   * summoned. Everything below the lanes is positioned from `view.strikeX`
   * and the measure geometry, never from a pixel.
   */
  render(view: StageView): Stage {
    const sprites: Sprite[] = [];
    const notes = new Map<string, NoteArt>();
    const art = this.#bindings.noteArt;
    const beat = view.beat;

    for (const note of view.notes) {
      const flourish = this.#flourishOpportunities.has(note.opportunityIndex);
      notes.set(
        note.id,
        flourish
          ? { body: { assetId: art.body }, overlay: { assetId: art.flourish, scale: 1.1 } }
          : { body: { assetId: art.body } }
      );
    }

    const performerX = view.strikeX - PERFORMER_BACK_BEATS * view.measure.beatWidth;

    // The crowd, behind the performer.
    const audience = this.#bindings.audienceStates;
    if (audience.length > 0) {
      const sulking = this.#sulkUntilBeat !== null && beat < this.#sulkUntilBeat;
      const cheering = this.#impressed && !sulking;
      const stateId = (cheering ? audience[1] : audience[0]) ?? audience[0] ?? "";
      const jumping = this.#payoffAtBeat !== null && beat - this.#payoffAtBeat < PAYOFF_JUMP_BEATS;

      for (const member of this.#crowd) {
        const slot = crowdSlot(member.slot);
        const homeX = performerX + slot.dx;
        const fromX = slot.dx < 0 ? WING_X.left : WING_X.right;
        const walking = beat - member.arrivedAtBeat < WALK_BEATS;
        const x = slide(fromX, homeX, member.arrivedAtBeat, WALK_BEATS, beat);

        let y = CROWD_FEET_Y - slot.row * CROWD_ROW_SETBACK_Y;
        if (walking) {
          y -= CROWD_WALK_HOP * Math.abs(Math.sin((beat - member.arrivedAtBeat) * Math.PI * 4));
        } else if (jumping) {
          y -= CROWD_JUMP * Math.abs(Math.sin((beat + member.id * 0.37) * Math.PI * 2));
        } else if (cheering) {
          y -= CROWD_CHEER_BOB * Math.abs(Math.sin((beat + member.id * 0.29) * Math.PI));
        } else if (sulking) {
          y += CROWD_SLUMP;
        }

        sprites.push({
          key: `crowd-${member.id}`,
          assetId: stateId,
          x,
          y,
          scale: CROWD_SCALE * (1 - slot.row * CROWD_ROW_SHRINK),
          anchor: "bottom",
          layer: "over",
          z: 2 - slot.row,
        });
      }
    }

    // Props beside the performer, then the performer.
    this.#bindings.signatureProps.forEach((assetId, i) => {
      sprites.push({
        key: `prop-${i}`,
        assetId,
        x: performerX + (PROP_AHEAD_BEATS + i * 0.3) * view.measure.beatWidth,
        y: PERFORMER_FEET_Y,
        scale: PROP_SCALE,
        anchor: "bottom",
        layer: "over",
        z: 4,
      });
    });

    const flinch =
      this.#embarrassedAtBeat === null ? 0 : decay(this.#embarrassedAtBeat, EMBARRASS_BEATS, beat);
    const flourishing =
      this.#flourishStartedAtBeat !== null && beat - this.#flourishStartedAtBeat < this.#flourishHoldBeats;
    const lift = flourishing
      ? FLOURISH_LIFT *
        Math.sin(Math.min(1, (beat - (this.#flourishStartedAtBeat ?? beat)) / this.#flourishHoldBeats) * Math.PI)
      : 0;

    sprites.push({
      key: "performer",
      assetId: this.#performerAssetId(flourishing),
      x: performerX,
      y: PERFORMER_FEET_Y + flinch * EMBARRASS_DIP - lift,
      scale: PERFORMER_SCALE,
      // `|| 0` so a settled flinch is 0, not -0, which a strict equality
      // elsewhere would treat as a lean.
      rotationDeg: flinch * EMBARRASS_TILT || 0,
      anchor: "bottom",
      layer: "over",
      z: 5,
    });

    for (const effect of this.#effects) {
      const life = decay(effect.bornAtBeat, effect.lifeBeats, beat);
      const age = 1 - life;
      if (effect.kind === "accent") {
        const on = effect.noteIndex === null ? undefined : view.notes[effect.noteIndex];
        if (!on) continue;
        sprites.push({
          key: `fx-${effect.id}`,
          assetId: effect.assetId,
          x: on.rect.x + on.rect.w / 2,
          y: on.rect.y + ACCENT_LIFT_Y,
          scale: effect.strength * (0.6 + Math.sin(age * Math.PI) * 0.9) * ACCENT_SCALE,
          opacity: life,
          layer: "over",
          z: 6,
        });
      } else if (effect.kind === "flourish") {
        sprites.push({
          key: `fx-${effect.id}`,
          assetId: effect.assetId,
          x: performerX + 0.02 + age * 0.03,
          y: PERFORMER_FEET_Y - 0.3 - age * 0.08,
          scale: effect.strength * FLOURISH_FX_SCALE * (0.8 + age * 0.5),
          opacity: life,
          layer: "over",
          z: 6,
        });
      } else {
        sprites.push({
          key: `fx-${effect.id}`,
          assetId: effect.assetId,
          x: performerX,
          y: PERFORMER_FEET_Y - 0.16,
          scale: PAYOFF_SCALE * (1 + age * 1.4),
          opacity: life,
          layer: "over",
          z: 7,
        });
      }
    }

    return { background: this.#bindings.background, sprites, notes };
  }

  /* ------------------------------------------------------------------ */

  #performerAssetId(flourishing: boolean): string {
    if (this.#finished) return this.#bindings.finishPose;
    if (flourishing && this.#flourishPose) return this.#flourishPose;
    const poses = this.#bindings.performerPoses;
    return poses[this.#poseIndex] ?? poses[0] ?? "";
  }

  /** Crowd members walk in from the wings. Stops silently at capacity. */
  #summon(count: number, beat: number): void {
    for (let i = 0; i < count; i += 1) {
      if (this.#crowd.length >= this.#crowdCapacity) return;
      this.#crowd = [
        ...this.#crowd,
        { id: this.#nextId++, slot: this.#crowd.length, arrivedAtBeat: beat },
      ];
    }
  }

  #spawnEffect(
    kind: PerformEffectKind,
    assetId: string,
    noteIndex: number | null,
    strength: number,
    beat: number,
    lifeBeats: number
  ): void {
    this.#effects = [
      ...this.#effects,
      { id: this.#nextId++, kind, assetId, noteIndex, strength, bornAtBeat: beat, lifeBeats },
    ];
  }
}

/* -------------------------------------------------------------------------- */
/* The package                                                                 */
/* -------------------------------------------------------------------------- */

function parseBindings(raw: unknown, where: string): PerformAssetBindings {
  const bindings = obj(raw, where);
  const one = (slot: string): string => {
    const values = strings(bindings[slot], `${where}.${slot}`);
    const first = values[0];
    if (values.length !== 1 || first === undefined) {
      throw new ScenarioDataError(`${where}.${slot}`, "expected exactly one asset id");
    }
    return first;
  };
  const many = (slot: string, min: number): string[] => {
    // Optional slots may be absent altogether; the canon marks `audienceStates`
    // as unbound for some scenarios rather than bound to nothing.
    const values = bindings[slot] === undefined && min === 0 ? [] : strings(bindings[slot], `${where}.${slot}`);
    if (values.length < min) {
      throw new ScenarioDataError(`${where}.${slot}`, `expected at least ${min} asset ids`);
    }
    return values;
  };
  const noteArt = obj(bindings["noteArt"], `${where}.noteArt`);
  const noteArtSlot = (slot: string): string => {
    const values = strings(noteArt[slot], `${where}.noteArt.${slot}`);
    const first = values[0];
    if (values.length !== 1 || first === undefined) {
      throw new ScenarioDataError(`${where}.noteArt.${slot}`, "expected exactly one asset id");
    }
    return first;
  };

  const audienceStates = many("audienceStates", 0);
  if (audienceStates.length === 1) {
    throw new ScenarioDataError(
      `${where}.audienceStates`,
      "expected none, or an unimpressed and an impressed state"
    );
  }

  return {
    background: one("background"),
    performerPoses: many("performerPoses", 1),
    flourishPoses: many("flourishPoses", 1),
    finishPose: one("finishPose"),
    signatureProps: many("signatureProps", 0),
    audienceStates,
    flourishEffects: many("flourishEffects", 1),
    accentEffects: many("accentEffects", 1),
    payoffEffects: many("payoffEffects", 1),
    noteArt: { body: noteArtSlot("body"), flourish: noteArtSlot("flourish") },
  };
}

/** Narrows a scenario's opaque config. Throws if it did not come from here. */
export function performConfig(config: unknown): PerformConfig {
  const value = config as Partial<PerformConfig> | null;
  if (!value || typeof value !== "object" || !value.bindings) {
    throw new Error("not a PerformMinigame config");
  }
  return value as PerformConfig;
}

/** Narrows a level's opaque data. Throws if it did not come from here. */
export function performLevelData(data: unknown): PerformLevelData {
  const value = data as Partial<PerformLevelData> | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.flourishBeats)) {
    throw new Error("not PerformMinigame level data");
  }
  return value as PerformLevelData;
}

/**
 * `PerformMinigame` as the host sees it.
 *
 * The parsers own the content shape: only this class knows what a flourish
 * is, so only it can say whether a level's flourish beats are valid. The one
 * check that needs the prompt — that every flourish beat lands on a note
 * opportunity, not on a rest or between notes — happens in `create`, where the
 * opportunities are finally in hand, and it throws rather than dropping the
 * flourish.
 */
export const PERFORM_MINIGAME: MinigameModule = {
  id: "PerformMinigame",
  displayName: "Perform",
  apiVersion: MINIGAME_API_VERSION,

  parseConfig(raw: unknown): PerformConfig {
    const root = obj(raw, "perform config");
    const params = obj(root["classParameters"], "scenario.classParameters");
    const policy = str(params["badNotePolicy"], "scenario.classParameters.badNotePolicy");
    if (policy !== "Embarrass" && policy !== "Ignore") {
      throw new ScenarioDataError(
        "scenario.classParameters.badNotePolicy",
        'expected "Embarrass" or "Ignore"'
      );
    }
    const capacity = num(params["crowdCapacity"], "scenario.classParameters.crowdCapacity");
    if (capacity < 0 || !Number.isInteger(capacity)) {
      throw new ScenarioDataError("scenario.classParameters.crowdCapacity", "expected a whole number");
    }
    return {
      bindings: parseBindings(root["assetBindings"], "scenario.assetBindings"),
      badNotePolicy: policy,
      crowdCapacity: capacity,
    };
  },

  parseLevel(raw: unknown, shape): PerformLevelData {
    const visual = obj(raw, "level.visual");
    const flourishBeats = arr(visual["flourishBeats"], "level.visual.flourishBeats").map((entry, i) => {
      const beat = num(entry, `level.visual.flourishBeats[${i}]`);
      if (beat < 0) throw new ScenarioDataError(`level.visual.flourishBeats[${i}]`, "before the phrase");
      return beat;
    });
    if (flourishBeats.length > shape.noteOpportunityCount) {
      throw new ScenarioDataError(
        "level.visual.flourishBeats",
        `${flourishBeats.length} flourishes for ${shape.noteOpportunityCount} note opportunities`
      );
    }
    const perFlourish = num(visual["goatsPerFlourish"], "level.visual.goatsPerFlourish");
    if (perFlourish < 0 || !Number.isInteger(perFlourish)) {
      throw new ScenarioDataError("level.visual.goatsPerFlourish", "expected a whole number");
    }
    return {
      visualSpanMeasures: num(visual["visualSpanMeasures"], "level.visual.visualSpanMeasures"),
      resetBetweenMeasures: bool(visual["resetBetweenMeasures"], "level.visual.resetBetweenMeasures"),
      flourishBeats,
      goatsPerFlourish: perFlourish,
    };
  },

  assetIds(config: unknown): readonly string[] {
    const { bindings } = performConfig(config);
    return [
      bindings.background,
      ...bindings.performerPoses,
      ...bindings.flourishPoses,
      bindings.finishPose,
      ...bindings.signatureProps,
      ...bindings.audienceStates,
      ...bindings.flourishEffects,
      ...bindings.accentEffects,
      ...bindings.payoffEffects,
      bindings.noteArt.body,
      bindings.noteArt.flourish,
    ];
  },

  create(context: AttemptContext): Minigame {
    const config = performConfig(context.config);
    const level = performLevelData(context.data);
    return new PerformMinigame({
      bindings: config.bindings,
      badNotePolicy: config.badNotePolicy,
      crowdCapacity: config.crowdCapacity,
      resetBetweenMeasures: level.resetBetweenMeasures,
      flourishOpportunities: flourishOpportunities(level.flourishBeats, context),
      goatsPerFlourish: level.goatsPerFlourish,
      durationsByOpportunity: context.opportunities.map((o) => o.durationBeats),
    });
  },

  debug(instance: Minigame): Readonly<Record<string, string>> {
    if (!(instance instanceof PerformMinigame)) return {};
    const { crowd, flourishesHit, successfulNotes, impressed } = instance.progress;
    return {
      crowd: String(crowd),
      flourishes: String(flourishesHit),
      "successful notes": String(successfulNotes),
      audience: impressed ? "impressed" : "unimpressed",
    };
  },
};

/**
 * Which opportunities are flourishes: those whose start beat, taken modulo the
 * phrase length, is an authored flourish beat. The modulo is what lets a
 * phrase authored once mark its flourishes on every pass an attempt plays.
 *
 * Throws if an authored flourish beat lands on nothing — a flourish on a rest
 * is a content error, and dropping it quietly would make a level look easier
 * than it was written.
 */
export function flourishOpportunities(
  flourishBeats: readonly number[],
  context: Pick<AttemptContext, "opportunities" | "plan">
): ReadonlySet<number> {
  const span = context.plan.totalBeats;
  const result = new Set<number>();
  for (const flourishBeat of flourishBeats) {
    let matched = false;
    for (const opportunity of context.opportunities) {
      const within = span > 0 ? opportunity.startBeat % span : opportunity.startBeat;
      if (Math.abs(within - flourishBeat) < 1e-9) {
        result.add(opportunity.index);
        matched = true;
      }
    }
    if (!matched) {
      throw new ScenarioDataError(
        "level.visual.flourishBeats",
        `beat ${flourishBeat} is not the start of any note opportunity`
      );
    }
  }
  return result;
}
