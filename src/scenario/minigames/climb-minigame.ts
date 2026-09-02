/**
 * `ClimbMinigame` — the CLIMB verb, for the Scale family.
 *
 * The contract: **orderly, mechanical progress. One successful note is one
 * clean spatial increment.** Not a chase, not combat, not survival. Even at L4
 * it should read as ridiculous competence rather than panic.
 *
 * This class contains no scenario-specific asset names and no scenario ids. It
 * is handed a route, a set of class asset *slots*, and class parameters; Rocky
 * Ascent decides those slots hold goats and boulders. A second climb scenario
 * needs data and art, not code.
 *
 * Slot ordering is part of the class contract, not a scenario detail:
 * `stepEffects[0]` is the contact effect shown where the climber lands, and
 * `stepEffects[1]` is the clean-progress accent shown for a successful note.
 *
 * It implements {@link Minigame} and reaches the screen only through
 * {@link ClimbMinigame.renderScene}: the host knows nothing about waypoints,
 * poses or wobble, and this class knows nothing about canvases or pixels.
 */

import { decay, type Judged, type Minigame, type Scene, type Sprite } from "../../minigame/api.js";
import type {
  ClimbAssetBindings,
  ClimbClassParameters,
  RouteData,
  RoutePoint,
} from "../types.js";

export type ClimbEffectKind = "contact" | "accent";

type ClimbEffect = {
  id: number;
  kind: ClimbEffectKind;
  assetId: string;
  position: RoutePoint;
  /** Multiplier on the effect's natural size. Perfect reads stronger. */
  strength: number;
  bornAtBeat: number;
  lifeBeats: number;
};

export type ClimbOptions = {
  route: RouteData;
  bindings: ClimbAssetBindings;
  parameters: ClimbClassParameters;
};

/** How long a contact/accent effect stays up, in beats. */
const EFFECT_LIFE_BEATS = 0.55;
/** How long a Wobble takes to settle, in beats. */
const WOBBLE_DECAY_BEATS = 0.7;

/*
 * Sprite sizing and registration.
 *
 * `Sprite.scale` multiplies the asset's natural size, and the host scales that
 * with the panel. These constants carry over the per-sprite-type sizing the
 * strip renderer used to hold, so the picture is unchanged; the y nudges are
 * the small registration offsets that sink the climber's feet into the rock and
 * lift the accent clear of the contact puff, expressed in normalised panel
 * units rather than as fixed pixels so they hold at any panel size.
 */
const CLIMBER_SCALE = 1.5;
const CLIMBER_SINK = 0.009;
const FOOTHOLD_SCALE = 1.231;
const FOOTHOLD_DIM = 0.72;
const GOAL_SCALE = 1.133;
const EFFECT_SCALE = 1.167;
const CONTACT_DROP = 0.013;
const ACCENT_LIFT = -0.022;
/** Sideways lean during a Wobble, in normalised panel units. */
const WOBBLE_SHIFT = 0.0035;
/** Degrees of lean at full Wobble. */
const WOBBLE_TILT = 9;

export class ClimbMinigame implements Minigame {
  readonly #route: RouteData;
  readonly #bindings: ClimbAssetBindings;
  readonly #parameters: ClimbClassParameters;

  #successfulNotes = 0;
  #waypointIndex = -1;
  #poseIndex = 0;
  #wobbleStartedAtBeat: number | null = null;
  #finished = false;
  #frozen = false;
  #effects: ClimbEffect[] = [];
  #nextEffectId = 1;
  #beat = 0;

  constructor(options: ClimbOptions) {
    this.#route = options.route;
    this.#bindings = options.bindings;
    this.#parameters = options.parameters;
  }

  /**
   * Route progress and terminal state, for the developer panel.
   *
   * Deliberately not the render path: the screen is fed by
   * {@link ClimbMinigame.renderScene} alone, and nothing about this is drawn.
   */
  get progress(): {
    successfulNotes: number;
    waypointIndex: number;
    waypointCount: number;
    finished: boolean;
    frozen: boolean;
  } {
    return {
      successfulNotes: this.#successfulNotes,
      waypointIndex: this.#waypointIndex,
      waypointCount: this.#route.waypoints.length,
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
   * two waypoints, ever. Only the outcome is read; a climb does not care which
   * pitch was played or where it sat in the octave.
   */
  onJudged(judged: Judged, beat: number): void {
    this.#beat = beat;
    if (this.#finished || this.#frozen) return;

    if (judged.outcome === "miss" || judged.outcome === "wrong") {
      // Wobble: a brief lean, then back to exactly the same waypoint. Earned
      // progress is never taken away.
      if (this.#parameters.badNotePolicy === "Wobble") this.#wobbleStartedAtBeat = beat;
      return;
    }

    this.#successfulNotes += 1;
    this.#waypointIndex = Math.min(this.#waypointIndex + 1, this.#route.waypoints.length - 1);
    this.#poseIndex = (this.#poseIndex + 1) % Math.max(1, this.#bindings.climberPoses.length);

    const landing = this.#route.waypoints[this.#waypointIndex];
    if (!landing) return;

    const contact = this.#bindings.stepEffects[0];
    const accent = this.#bindings.stepEffects[1];
    if (contact) {
      this.#spawnEffect("contact", contact, landing, 1, beat);
    }
    if (accent) {
      // Stronger and cleaner for Perfect, smaller and weaker for Good.
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
    if (!this.#parameters.resetBetweenMeasures) return;
    this.#waypointIndex = -1;
    this.#effects = [];
    this.#wobbleStartedAtBeat = null;
    this.#beat = beat;
  }

  /** A climb is indifferent to the star tier; the route is the whole story. */
  onStarEarned(_stars: number, beat: number): void {
    this.#beat = beat;
  }

  /**
   * The attempt is over.
   *
   * Passed: move to the finish pose at the destination and hold it. Failed:
   * freeze at the furthest waypoint actually earned — no bespoke failure art,
   * because not getting there is the punishment.
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
   * The panel: the route's footholds, the destination, any live effects, and
   * the climber on top of its own dust.
   *
   * Every foothold keeps a stable key across frames, so the host can tell a
   * reached one from an unreached one without the scene carrying that meaning
   * itself, and the climber's key never changes as it advances — which is what
   * would let the host interpolate between footholds later, if the design ever
   * wants the goat to slide rather than step.
   */
  renderScene(beat: number): Scene {
    const sprites: Sprite[] = [];

    const stepAsset = this.#bindings.waypointVisuals[0];
    if (stepAsset) {
      this.#route.waypoints.forEach((waypoint, index) => {
        sprites.push({
          key: `step-${index}`,
          assetId: stepAsset,
          x: waypoint.x,
          y: waypoint.y,
          scale: waypoint.scale * FOOTHOLD_SCALE,
          rotationDeg: waypoint.rotationDeg,
          opacity: index <= this.#waypointIndex ? 1 : FOOTHOLD_DIM,
          layer: "stage",
          z: index,
        });
      });
    }

    if (this.showDestination) {
      sprites.push({
        key: "goal",
        assetId: this.#bindings.destinationVisual,
        x: this.#route.destination.x,
        y: this.#route.destination.y,
        scale: GOAL_SCALE,
        anchor: "bottom",
        layer: "stage",
        z: this.#route.waypoints.length + 1,
      });
    }

    // Effects first, so the climber lands on top of its own dust.
    for (const effect of this.#effects) {
      const life = decay(effect.bornAtBeat, effect.lifeBeats, beat);
      const age = 1 - life;
      // The contact effect settles outward; the accent scales in and back out.
      const pulse =
        effect.kind === "accent" ? 0.6 + Math.sin(age * Math.PI) * 0.9 : 1 + age * 0.35;
      sprites.push({
        key: `fx-${effect.id}`,
        assetId: effect.assetId,
        x: effect.position.x,
        y: effect.position.y,
        scale: effect.strength * pulse * EFFECT_SCALE,
        opacity: life * (effect.kind === "accent" ? 1 : 0.85),
        offsetY: effect.kind === "contact" ? CONTACT_DROP : ACCENT_LIFT,
        layer: "actor",
        z: 0,
      });
    }

    const wobble = this.#wobbleAmount(beat);
    // A brief lean and a nudge, returning to exactly the same waypoint.
    const swing = wobble > 0 ? Math.sin(wobble * Math.PI * 4) * wobble : 0;
    const at = this.#position();
    sprites.push({
      key: "climber",
      assetId: this.#poseAssetId(),
      x: at.x + swing * WOBBLE_SHIFT,
      y: at.y,
      scale: CLIMBER_SCALE,
      rotationDeg: swing * WOBBLE_TILT,
      anchor: "bottom",
      offsetY: CLIMBER_SINK,
      layer: "actor",
      z: 1,
    });

    return { background: this.#bindings.background, sprites };
  }

  /* ------------------------------------------------------------------ */

  get showDestination(): boolean {
    return this.#parameters.showDestinationFromStart || this.#finished;
  }

  #position(): RoutePoint {
    if (this.#finished) return this.#route.destination;
    if (this.#waypointIndex < 0) return this.#route.startPosition;
    const waypoint = this.#route.waypoints[this.#waypointIndex];
    return { x: waypoint?.x ?? 0, y: waypoint?.y ?? 0 };
  }

  #poseAssetId(): string {
    if (this.#finished) return this.#bindings.finishPose;
    return this.#bindings.climberPoses[this.#poseIndex] ?? this.#bindings.climberPoses[0] ?? "";
  }

  #spawnEffect(
    kind: ClimbEffectKind,
    assetId: string,
    position: RoutePoint,
    strength: number,
    beat: number
  ): void {
    this.#effects = [
      ...this.#effects,
      {
        id: this.#nextEffectId++,
        kind,
        assetId,
        position: { x: position.x, y: position.y },
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
