/**
 * `ClimbMinigame` — the CLIMB verb, for the Scale family.
 *
 * The contract: **orderly, mechanical progress. One successful note is one
 * clean spatial increment.** Not a chase, not combat, not survival. Even at L4
 * it should read as ridiculous competence rather than panic.
 *
 * On the timeline (GDD §11.2) that increment is literal: the note bars *are* the
 * footholds, and the climber hops from one to the next as each is played. There
 * is no authored route any more — a climb used to carry a start position, a
 * destination and one waypoint per note opportunity as coordinates in a scenario
 * panel, and every one of those is now supplied by the note itself. "One
 * waypoint per successful note" stopped being a content rule that could be
 * authored wrongly and became a structural fact of the surface.
 *
 * This class contains no scenario-specific asset names and no scenario ids. It
 * is handed a set of class asset *slots* and class parameters; Rocky Ascent
 * decides those slots hold goats and boulders. A second climb scenario needs
 * data and art, not code.
 */

import {
  arc,
  decay,
  MINIGAME_API_VERSION,
  type AttemptContext,
  type Judged,
  type Minigame,
  type MinigameModule,
  type NoteArt,
  type PlacedNote,
  type Sprite,
  type Stage,
  type StageView,
} from "../../minigame/api.js";
import { bool, num, obj, ScenarioDataError, str, strings } from "../parse.js";

/* -------------------------------------------------------------------------- */
/* Content shape — owned by this class, opaque to the host                     */
/* -------------------------------------------------------------------------- */

/**
 * Asset slots are named by the *class*, never by the scenario. `ClimbMinigame`
 * asks for `climberPoses`; Rocky Ascent decides those are goats.
 */
export type ClimbAssetBindings = {
  /** Fills the play area behind this scenario's own measures. */
  background: string;
  climberPoses: readonly string[];
  finishPose: string;
  /** Sits past the final note: the thing being climbed towards. */
  destinationVisual: string;
  /** [0] the contact effect where the climber lands, [1] the clean accent. */
  stepEffects: readonly string[];
  /** What a foothold is made of. `body` is the note bar; `crag` sits behind it. */
  footholdArt: { body: string; crag: string };
};

export type ClimbConfig = {
  bindings: ClimbAssetBindings;
  badNotePolicy: "Wobble" | "Stall";
};

export type ClimbLevelData = {
  /** How many measures one visual arc spans. Rocky spans all four. */
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
};

export type ClimbEffectKind = "contact" | "accent";

type ClimbEffect = {
  id: number;
  kind: ClimbEffectKind;
  assetId: string;
  /** Which note it happened on: its position follows that note as it scrolls. */
  noteIndex: number;
  /** Multiplier on the effect's natural size. Perfect reads stronger. */
  strength: number;
  bornAtBeat: number;
  lifeBeats: number;
};

export type ClimbOptions = {
  bindings: ClimbAssetBindings;
  parameters: { badNotePolicy: "Wobble" | "Stall" };
  resetBetweenMeasures: boolean;
};

/** How long a contact/accent effect stays up, in beats. */
const EFFECT_LIFE_BEATS = 0.55;
/** How long a Wobble takes to settle, in beats. */
const WOBBLE_DECAY_BEATS = 0.7;
/** How long the climber is in the air between footholds. Short: this is a step. */
const HOP_BEATS = 0.22;

/*
 * Sprite sizing, in normalised timeline space.
 *
 * `y` is normalised to the lane band, so these are fractions of its height. The
 * climber and the effects deliberately reach above `y = 0` and below `y = 1`
 * into the play area the background fills — a goat standing on a bar has to
 * stand *on top of* it.
 */
const CLIMBER_SCALE = 1.35;
/** Peak of the hop arc, as a fraction of the lane band. */
const HOP_HEIGHT = 0.09;
/** How far the climber's feet sink into the bar it lands on. */
const CLIMBER_SINK = 0.012;
const CRAG_SCALE = 1.55;
const CRAG_FADED = 0.55;
const CRAG_SOLID = 0.95;
const EFFECT_SCALE = 1.0;
const CONTACT_DROP = 0.02;
const ACCENT_LIFT = -0.03;
const DESTINATION_SCALE = 1.5;
/** Sideways lean during a Wobble, as a fraction of the playfield. */
const WOBBLE_SHIFT = 0.004;
/** Degrees of lean at full Wobble. */
const WOBBLE_TILT = 9;

export class ClimbMinigame implements Minigame {
  readonly #bindings: ClimbAssetBindings;
  readonly #parameters: ClimbOptions["parameters"];
  readonly #resetBetweenMeasures: boolean;

  #successfulNotes = 0;
  /** Index into the attempt's notes. -1 before the first successful note. */
  #noteIndex = -1;
  /** Where the climber hopped from, so the arc has a start. */
  #fromNoteIndex = -1;
  #hopStartedAtBeat: number | null = null;
  #poseIndex = 0;
  #wobbleStartedAtBeat: number | null = null;
  #finished = false;
  #frozen = false;
  #effects: ClimbEffect[] = [];
  #nextEffectId = 1;
  #beat = 0;

  constructor(options: ClimbOptions) {
    this.#bindings = options.bindings;
    this.#parameters = options.parameters;
    this.#resetBetweenMeasures = options.resetBetweenMeasures;
  }

  /**
   * Climb progress and terminal state, for the developer panel.
   *
   * Deliberately not the render path: the screen is fed by
   * {@link ClimbMinigame.render} alone, and nothing about this is drawn.
   */
  get progress(): {
    successfulNotes: number;
    noteIndex: number;
    finished: boolean;
    frozen: boolean;
  } {
    return {
      successfulNotes: this.#successfulNotes,
      noteIndex: this.#noteIndex,
      finished: this.#finished,
      frozen: this.#frozen,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Minigame                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * One judged note.
   *
   * Perfect and Good advance **identically** — both are successful notes, and
   * the difference between them is score, not distance. Nothing here advances
   * two footholds, ever. Only the outcome and which note it was are read; a
   * climb does not care which pitch was played.
   */
  onJudged(judged: Judged, beat: number): void {
    this.#beat = beat;
    if (this.#finished || this.#frozen) return;

    if (judged.outcome === "miss" || judged.outcome === "wrong") {
      // Wobble: a brief lean, then back to exactly the same foothold. Earned
      // progress is never taken away.
      if (this.#parameters.badNotePolicy === "Wobble") this.#wobbleStartedAtBeat = beat;
      return;
    }

    const landing = judged.opportunityIndex;
    if (landing === null) return;

    this.#successfulNotes += 1;
    this.#fromNoteIndex = this.#noteIndex;
    this.#noteIndex = landing;
    this.#hopStartedAtBeat = beat;
    this.#poseIndex = (this.#poseIndex + 1) % Math.max(1, this.#bindings.climberPoses.length);

    const [contact, accent] = this.#bindings.stepEffects;
    if (contact) this.#spawnEffect("contact", contact, landing, 1, beat);
    // Stronger and cleaner for Perfect, smaller and weaker for Good.
    if (accent) {
      this.#spawnEffect("accent", accent, landing, judged.outcome === "perfect" ? 1 : 0.55, beat);
    }
  }

  /** Decays transient state. Purely visual; nothing here changes progress. */
  update(beat: number): void {
    this.#beat = beat;
    this.#effects = this.#effects.filter((effect) => beat - effect.bornAtBeat < effect.lifeBeats);
    if (this.#wobbleStartedAtBeat !== null && beat - this.#wobbleStartedAtBeat > WOBBLE_DECAY_BEATS) {
      this.#wobbleStartedAtBeat = null;
    }
  }

  /**
   * Measure boundary. Rocky Ascent spans all four measures continuously, so
   * this is a no-op for it — but the hook is where a `resetBetweenMeasures`
   * climb scenario would restart its visual cycle without touching
   * attempt-global progress.
   */
  onMeasure(_measureIndex: number, beat: number): void {
    if (!this.#resetBetweenMeasures) return;
    this.#noteIndex = -1;
    this.#fromNoteIndex = -1;
    this.#effects = [];
    this.#wobbleStartedAtBeat = null;
    this.#beat = beat;
  }

  /** A climb is indifferent to the star tier; the ascent is the whole story. */
  onStarEarned(_stars: number, beat: number): void {
    this.#beat = beat;
  }

  /**
   * The attempt is over.
   *
   * Passed: take the finish pose and hold it. Failed: freeze on the furthest
   * foothold actually earned — no bespoke failure art, because not getting
   * there is the punishment.
   */
  onComplete(passed: boolean, _stars: number, beat: number): void {
    this.#beat = beat;
    if (passed) {
      this.#finished = true;
      this.#wobbleStartedAtBeat = null;
    } else {
      this.#frozen = true;
    }
  }

  /**
   * The climb, on the timeline.
   *
   * Every note bar is a foothold — dressed as rock, and lit once it has been
   * climbed. The climber stands on the last one it reached and arcs to the next
   * as each note is played, which is why `arc` exists: a hop is not a slide.
   * Everything is positioned from the notes the host placed, so the whole thing
   * scrolls correctly for free and keeps working after a foothold has left the
   * screen.
   */
  render(view: StageView): Stage {
    const sprites: Sprite[] = [];
    const notes = new Map<string, NoteArt>();
    const art = this.#bindings.footholdArt;

    for (const note of view.notes) {
      notes.set(note.id, {
        underlay: {
          assetId: art.crag,
          scale: CRAG_SCALE,
          // The ridge fills in behind the phrase as it is climbed.
          opacity: note.opportunityIndex <= this.#noteIndex ? CRAG_SOLID : CRAG_FADED,
        },
        body: { assetId: art.body },
      });
    }

    // The summit, one measure past the final foothold: something to be climbing
    // towards, which only enters the screen as the attempt ends.
    const last = view.notes[view.notes.length - 1];
    if (last) {
      sprites.push({
        key: "destination",
        assetId: this.#bindings.destinationVisual,
        x: last.rect.x + last.rect.w + view.measure.beatWidth,
        y: last.rect.y,
        scale: DESTINATION_SCALE,
        anchor: "bottom",
        layer: "under",
      });
    }

    for (const effect of this.#effects) {
      const on = view.notes[effect.noteIndex];
      if (!on) continue;
      const life = decay(effect.bornAtBeat, effect.lifeBeats, view.beat);
      const age = 1 - life;
      // The contact effect settles outward; the accent scales in and back out.
      const pulse = effect.kind === "accent" ? 0.6 + Math.sin(age * Math.PI) * 0.9 : 1 + age * 0.35;
      sprites.push({
        key: `fx-${effect.id}`,
        assetId: effect.assetId,
        x: on.rect.x + on.rect.w / 2,
        y: on.rect.y + (effect.kind === "contact" ? CONTACT_DROP : ACCENT_LIFT),
        scale: effect.strength * pulse * EFFECT_SCALE,
        opacity: life * (effect.kind === "accent" ? 1 : 0.85),
        layer: "over",
        z: 0,
      });
    }

    const at = this.#climberAt(view);
    if (at) {
      const wobble = this.#wobbleAmount(view.beat);
      const swing = wobble > 0 ? Math.sin(wobble * Math.PI * 4) * wobble : 0;
      sprites.push({
        key: "climber",
        assetId: this.#poseAssetId(),
        x: at.x + swing * WOBBLE_SHIFT,
        y: at.y + CLIMBER_SINK,
        scale: CLIMBER_SCALE,
        rotationDeg: swing * WOBBLE_TILT,
        anchor: "bottom",
        layer: "over",
        z: 1,
      });
    }

    return { background: this.#bindings.background, sprites, notes };
  }

  /* ------------------------------------------------------------------ */

  /**
   * Where the climber is standing, mid-hop or not.
   *
   * Before the first successful note it waits a beat to the left of the opening
   * foothold, so it is visibly about to start rather than already standing on a
   * note it has not earned.
   */
  #climberAt(view: StageView): { x: number; y: number } | null {
    const target = this.#footholdAt(view, this.#noteIndex) ?? this.#startPosition(view);
    if (!target) return null;
    if (this.#hopStartedAtBeat === null) return target;

    const from = this.#footholdAt(view, this.#fromNoteIndex) ?? this.#startPosition(view);
    if (!from) return target;
    // A hop, not a slide: THREE-STEP will want the same helper for its leap.
    return arc(from, target, HOP_HEIGHT, this.#hopStartedAtBeat, HOP_BEATS, view.beat);
  }

  #footholdAt(view: StageView, index: number): { x: number; y: number } | null {
    if (index < 0) return null;
    const note = view.notes[index];
    return note ? { x: note.rect.x + note.rect.w / 2, y: note.rect.y } : null;
  }

  #startPosition(view: StageView): { x: number; y: number } | null {
    const first = view.notes[0];
    if (!first) return null;
    return { x: first.rect.x - view.measure.beatWidth, y: first.rect.y };
  }

  #poseAssetId(): string {
    if (this.#finished) return this.#bindings.finishPose;
    return this.#bindings.climberPoses[this.#poseIndex] ?? this.#bindings.climberPoses[0] ?? "";
  }

  #spawnEffect(
    kind: ClimbEffectKind,
    assetId: string,
    noteIndex: number,
    strength: number,
    beat: number
  ): void {
    this.#effects = [
      ...this.#effects,
      {
        id: this.#nextEffectId++,
        kind,
        assetId,
        noteIndex,
        strength,
        bornAtBeat: beat,
        lifeBeats: EFFECT_LIFE_BEATS,
      },
    ];
  }

  #wobbleAmount(beat = this.#beat): number {
    if (this.#wobbleStartedAtBeat === null) return 0;
    return decay(this.#wobbleStartedAtBeat, WOBBLE_DECAY_BEATS, beat);
  }
}

/* -------------------------------------------------------------------------- */
/* The package                                                                 */
/* -------------------------------------------------------------------------- */

function parseBindings(raw: unknown, where: string): ClimbAssetBindings {
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
    const values = strings(bindings[slot], `${where}.${slot}`);
    if (values.length < min) {
      throw new ScenarioDataError(`${where}.${slot}`, `expected at least ${min} asset ids`);
    }
    return values;
  };
  const foothold = obj(bindings["footholdArt"], `${where}.footholdArt`);

  return {
    background: one("background"),
    climberPoses: many("climberPoses", 1),
    finishPose: one("finishPose"),
    destinationVisual: one("destinationVisual"),
    // Slot ordering is part of the class contract: [0] is the contact effect
    // where the climber lands, [1] the clean-progress accent.
    stepEffects: many("stepEffects", 2),
    footholdArt: {
      body: str(
        strings(foothold["body"], `${where}.footholdArt.body`)[0],
        `${where}.footholdArt.body`
      ),
      crag: str(
        strings(foothold["crag"], `${where}.footholdArt.crag`)[0],
        `${where}.footholdArt.crag`
      ),
    },
  };
}

/** Narrows a scenario's opaque config. Throws if it did not come from here. */
export function climbConfig(config: unknown): ClimbConfig {
  const value = config as Partial<ClimbConfig> | null;
  if (!value || typeof value !== "object" || !value.bindings) {
    throw new Error("not a ClimbMinigame config");
  }
  return value as ClimbConfig;
}

/** Narrows a level's opaque data. Throws if it did not come from here. */
export function climbLevelData(data: unknown): ClimbLevelData {
  const value = data as Partial<ClimbLevelData> | null;
  if (!value || typeof value !== "object" || typeof value.visualSpanMeasures !== "number") {
    throw new Error("not ClimbMinigame level data");
  }
  return value as ClimbLevelData;
}

/**
 * `ClimbMinigame` as the host sees it.
 *
 * The two parsers are why this class can define whatever content shape it
 * likes: only it knows what a foothold is, so only it can say whether a
 * scenario file is valid. The host stores what they return without ever looking
 * inside.
 */
export const CLIMB_MINIGAME: MinigameModule = {
  id: "ClimbMinigame",
  displayName: "Climb",
  apiVersion: MINIGAME_API_VERSION,

  parseConfig(raw: unknown): ClimbConfig {
    const root = obj(raw, "climb config");
    const params = obj(root["classParameters"], "scenario.classParameters");
    const policy = str(params["badNotePolicy"], "scenario.classParameters.badNotePolicy");
    if (policy !== "Wobble" && policy !== "Stall") {
      throw new ScenarioDataError(
        "scenario.classParameters.badNotePolicy",
        'expected "Wobble" or "Stall"'
      );
    }
    return {
      bindings: parseBindings(root["assetBindings"], "scenario.assetBindings"),
      badNotePolicy: policy,
    };
  },

  /**
   * A climb authors no geometry at all now — the notes are the footholds, so
   * there is nothing left that could disagree with them. What remains is how
   * the scenario uses its four measures, which is the class's business and not
   * the host's (a BATTLE scenario varies it by difficulty level).
   */
  parseLevel(raw: unknown): ClimbLevelData {
    const visual = obj(raw, "level.visual");
    return {
      visualSpanMeasures: num(visual["visualSpanMeasures"], "level.visual.visualSpanMeasures"),
      resetBetweenMeasures: bool(
        visual["resetBetweenMeasures"],
        "level.visual.resetBetweenMeasures"
      ),
    };
  },

  assetIds(config: unknown): readonly string[] {
    const { bindings } = climbConfig(config);
    return [
      bindings.background,
      ...bindings.climberPoses,
      bindings.finishPose,
      bindings.destinationVisual,
      ...bindings.stepEffects,
      bindings.footholdArt.body,
      bindings.footholdArt.crag,
    ];
  },

  create(context: AttemptContext): Minigame {
    const config = climbConfig(context.config);
    const level = climbLevelData(context.data);
    return new ClimbMinigame({
      bindings: config.bindings,
      parameters: { badNotePolicy: config.badNotePolicy },
      resetBetweenMeasures: level.resetBetweenMeasures,
    });
  },

  debug(instance: Minigame): Readonly<Record<string, string>> {
    if (!(instance instanceof ClimbMinigame)) return {};
    const { noteIndex, successfulNotes } = instance.progress;
    return { foothold: `${noteIndex + 1}`, "successful notes": String(successfulNotes) };
  },
};

/** Re-exported for tests: the placed note a climber would be standing on. */
export type { PlacedNote };
