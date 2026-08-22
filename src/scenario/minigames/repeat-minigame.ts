/**
 * `RepeatMinigame` — a performer who stands still and does one thing over and
 * over. Can Crushing decides that thing is crushing a beer can.
 *
 * PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 *
 * This class exists to test the other half of the timeline-actor primitive.
 * `ClimbMinigame`'s actor moves and its containers are terrain, so the
 * *authored* pitch places them. Here the actor is stationary, the container is
 * a projectile, and the **played** pitch places it:
 *
 *   - play the note you were asked for -> the can appears at the crusher's
 *     lane and is crushed;
 *   - play something else -> the can appears at the lane you actually played
 *     and sails into his head.
 *
 * That distinction is not cosmetic. Terrain has to be deterministic, because a
 * platform placed by a wrong note could strand the actor somewhere the next
 * note is unreachable from. A projectile resolves instantly at the strike line
 * and leaves no state behind, so the player is safe to place it — and doing so
 * makes wrong-note feedback *diagnostic*: a can arriving two lanes high says
 * "you overshot by a third" before the player can think about it.
 *
 * Pure. No canvas, no audio, no DOM.
 */

/**
 * How many crushed cans the pile shows before it stops growing.
 *
 * A cap rather than a scale: the pile is a heap on a floor strip a couple of
 * rows tall, and an uncapped one climbs off the top of it. Exported because the
 * renderer needs the same number — the model owns the saturation, the layer
 * only draws it.
 */
export const MAX_PILE = 24;

/**
 * How long a placed can stays on screen, in beats.
 *
 * It travels leftwards with the timeline, so this is a distance as much as a
 * duration: long enough to reach the performer and then visibly carry on past
 * him when he is not the one it was aimed at.
 */
const CAN_LIFETIME_BEATS = 2.5;

export type FlyingCan = {
  id: number;
  /** Lane the can was placed on — the PLAYED pitch, not the authored one. */
  lane: number;
  /** True when it arrived at the crusher's lane and was dealt with. */
  crushed: boolean;
  /** Off-scale or unpitched input: it spawns wobbling rather than snapping. */
  wobbly: boolean;
  bornBeat: number;
};

export type RepeatVisualState = {
  /** The lane the performer stands on. */
  performerLane: number;
  /** Cans dealt with this attempt. The score of the thing. */
  crushed: number;
  /** How many of them to actually draw — {@link MAX_PILE} at most. */
  pile: number;
  /** Cans that hit him instead. */
  beaned: number;
  cans: readonly FlyingCan[];
  /** Beat of the last successful crush, for the action pose. */
  lastCrushBeat: number;
  complete: boolean;
  passed: boolean;
};

export type RepeatOptions = {
  /**
   * Where the performer stands. A fixed lane for the whole attempt in this
   * prototype; the design allows him to step between measures, telegraphed by
   * walking during the preceding one, and that hook is not built yet.
   */
  performerLane: number;
};

export class RepeatMinigame {
  readonly performerLane: number;
  #crushed = 0;
  #beaned = 0;
  #cans: FlyingCan[] = [];
  #lastCrushBeat = -99;
  #complete = false;
  #passed = false;
  #nextId = 1;

  constructor(options: RepeatOptions) {
    this.performerLane = options.performerLane;
  }

  get state(): RepeatVisualState {
    return {
      performerLane: this.performerLane,
      crushed: this.#crushed,
      pile: Math.min(MAX_PILE, this.#crushed),
      beaned: this.#beaned,
      cans: this.#cans,
      lastCrushBeat: this.#lastCrushBeat,
      complete: this.#complete,
      passed: this.#passed,
    };
  }

  /**
   * A note was played. The can appears where the player put it.
   *
   * @param playedLane the lane the *played* pitch quantises to, or null when
   * the input was off-scale or unpitched — that can spawns wobbling rather than
   * snapping to a lane it does not belong on.
   */
  place(playedLane: number | null, beat: number): void {
    if (this.#complete) return;
    const crushed = playedLane === this.performerLane;
    this.#cans.push({
      id: this.#nextId++,
      lane: playedLane ?? this.performerLane,
      crushed,
      wobbly: playedLane === null,
      bornBeat: beat,
    });
    if (crushed) {
      this.#crushed += 1;
      this.#lastCrushBeat = beat;
    } else {
      this.#beaned += 1;
    }
  }

  /** A target expired with nothing played at it. No can, no pile, no bean. */
  miss(): void {
    // Deliberately nothing. A missed note is already its own punishment in the
    // score; making the performer get hit for a note the player never played
    // would be inventing a second failure for one mistake.
  }

  /** Drops cans that have flown off. Safe to call every frame. */
  update(beat: number): void {
    this.#cans = this.#cans.filter((can) => beat - can.bornBeat < CAN_LIFETIME_BEATS);
  }

  complete(passed: boolean, beat: number): void {
    this.#complete = true;
    this.#passed = passed;
    this.#cans = [];
    void beat;
  }
}
