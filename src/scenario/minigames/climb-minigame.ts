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
 */

import type {
  ClimbAssetBindings,
  ClimbClassParameters,
  RouteData,
  RoutePoint,
} from "../types.js";

export type ClimbEffectKind = "contact" | "accent";

export type ClimbEffect = {
  id: number;
  kind: ClimbEffectKind;
  assetId: string;
  position: RoutePoint;
  /** Multiplier on the effect's natural size. Perfect reads stronger. */
  strength: number;
  bornAtBeat: number;
  lifeBeats: number;
};

export type ClimbVisualState = {
  /** Successful notes so far. Attempt-global; never reset by a measure. */
  successfulNotes: number;
  /** -1 before the first successful note, then 0..waypoints.length-1. */
  waypointIndex: number;
  position: RoutePoint;
  scale: number;
  rotationDeg: number;
  /** Which `climberPoses[]` entry is showing. */
  poseAssetId: string;
  /** 0..1, decaying. Drives the Wobble bad-note reaction. */
  wobble: number;
  finished: boolean;
  /** True once the attempt ended without passing. */
  frozen: boolean;
  effects: readonly ClimbEffect[];
};

/** What the class needs to know about one judged note. */
export type ClimbEnergy =
  | { polarity: "good"; strength: "perfect" | "good" }
  | { polarity: "bad"; cause: "wrong" | "miss" };

export type ClimbOptions = {
  route: RouteData;
  bindings: ClimbAssetBindings;
  parameters: ClimbClassParameters;
};

/** How long a contact/accent effect stays up, in beats. */
const EFFECT_LIFE_BEATS = 0.55;
/** How long a Wobble takes to settle, in beats. */
const WOBBLE_DECAY_BEATS = 0.7;

export class ClimbMinigame {
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

  get parameters(): ClimbClassParameters {
    return this.#parameters;
  }

  get waypointCount(): number {
    return this.#route.waypoints.length;
  }

  get destination(): RoutePoint {
    return this.#route.destination;
  }

  get showDestination(): boolean {
    return this.#parameters.showDestinationFromStart || this.#finished;
  }

  get state(): ClimbVisualState {
    const waypoint = this.#route.waypoints[this.#waypointIndex];
    const atStart = this.#waypointIndex < 0;
    const position = this.#finished
      ? this.#route.destination
      : atStart
        ? this.#route.startPosition
        : { x: waypoint?.x ?? 0, y: waypoint?.y ?? 0 };

    return {
      successfulNotes: this.#successfulNotes,
      waypointIndex: this.#waypointIndex,
      position,
      scale: waypoint?.scale ?? 1,
      rotationDeg: waypoint?.rotationDeg ?? 0,
      poseAssetId: this.#finished
        ? this.#bindings.finishPose
        : (this.#bindings.climberPoses[this.#poseIndex] ?? this.#bindings.climberPoses[0] ?? ""),
      wobble: this.#wobbleAmount(),
      finished: this.#finished,
      frozen: this.#frozen,
      effects: this.#effects,
    };
  }

  /**
   * One judged note's energy.
   *
   * Perfect and Good advance **identically** — both are successful notes, and
   * the difference between them is score, not distance. Nothing here advances
   * two waypoints, ever.
   */
  applyEnergy(energy: ClimbEnergy, beat: number): void {
    this.#beat = beat;
    if (this.#finished || this.#frozen) return;

    if (energy.polarity === "bad") {
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
      this.#spawnEffect("accent", accent, landing, energy.strength === "perfect" ? 1 : 0.55, beat);
    }
  }

  /** Decays transient state. Purely visual; nothing here changes progress. */
  update(beat: number): void {
    this.#beat = beat;
    this.#effects = this.#effects.filter(
      (effect) => beat - effect.bornAtBeat < effect.lifeBeats
    );
    if (this.#wobbleStartedAtBeat !== null && beat - this.#wobbleStartedAtBeat > WOBBLE_DECAY_BEATS) {
      this.#wobbleStartedAtBeat = null;
    }
  }

  /**
   * The attempt is over.
   *
   * Passed: move to the finish pose at the destination and hold it. Failed:
   * freeze at the furthest waypoint actually earned — no bespoke failure art,
   * because not getting there is the punishment.
   */
  complete(passed: boolean, beat: number): void {
    this.#beat = beat;
    if (passed) {
      this.#finished = true;
      this.#wobbleStartedAtBeat = null;
    } else {
      this.#frozen = true;
    }
  }

  /**
   * Measure boundary. Rocky Ascent spans all four measures continuously, so
   * this is a no-op for it — but the hook is where a `resetBetweenMeasures`
   * climb scenario would restart its visual cycle without touching
   * attempt-global progress.
   */
  onMeasureComplete(_measureIndex: number, beat: number): void {
    if (!this.#parameters.resetBetweenMeasures) return;
    this.#waypointIndex = -1;
    this.#effects = [];
    this.#wobbleStartedAtBeat = null;
    this.#beat = beat;
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

  #wobbleAmount(): number {
    if (this.#wobbleStartedAtBeat === null) return 0;
    const elapsed = this.#beat - this.#wobbleStartedAtBeat;
    return Math.max(0, 1 - elapsed / WOBBLE_DECAY_BEATS);
  }
}
