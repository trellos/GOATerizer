/**
 * `RepeatMinigame` — a performer who stands still and does one thing over and
 * over. Can Crushing decides that thing is crushing a beer can on his forehead.
 *
 * PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md` §5.
 *
 * This class exists to test the other half of the timeline-actor primitive.
 * `ClimbMinigame`'s actor moves and its containers are terrain, so the
 * *authored* pitch places them. Here the actor is stationary and never stops
 * moving — his hand loops to his forehead and back forever, on the pulse,
 * whether or not anything is coming. That loop is the whole instruction: it
 * shows the player the exact place and the exact instant a can has to be in to
 * get crushed, before they have got one right even once.
 *
 * So every note carries a can, and the note's outcome decides only one thing:
 * **whether the can gets up to where the hand is.**
 *
 *   - play the note you were asked for -> the can rises into the gap under his
 *     palm, is crushed, and drops onto the pile;
 *   - play something else -> the can rises to the lane you actually played,
 *     which is over his head or under his feet, and goes by untouched;
 *   - play nothing -> the can never gets up at all. It tips over and rolls past
 *     his shins while the hand comes down on air.
 *
 * That is why the played pitch places the can rather than the authored one. A
 * projectile resolves at the strike line and leaves no state behind, so it is
 * safe to let the player put it wherever they actually played — and doing so
 * makes wrong-note feedback *diagnostic*: a can sailing two lanes over his head
 * says "you overshot by a third" before the player can think about it.
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
 * How long a can stays on screen after the strike line, in beats.
 *
 * It travels leftwards with the timeline, so this is a distance as much as a
 * duration. It has to outlast the longest thing that can happen to a can:
 * reaching the performer, being flattened, and falling to the pile — and then
 * some, because a can he never touched has to visibly carry on past him.
 */
const CAN_LIFETIME_BEATS = 3;

/**
 * What became of one can. Three fates, three silhouettes at the performer:
 * flat, sailing past upright, rolling past on its side.
 */
export type CanFate = "crushed" | "wrong" | "missed";

export type FlyingCan = {
  id: number;
  /**
   * The lane the can rides at from the strike line on.
   *
   * For a crushed or wrong can this is the *played* pitch — that is the
   * mechanic. For a missed one it is the target's own lane, because nobody
   * placed it anywhere; it just stays in the bar it arrived in.
   */
  lane: number;
  fate: CanFate;
  /** Off-scale or unpitched input: it spawns wobbling rather than snapping. */
  wobbly: boolean;
  bornBeat: number;
};

export type RepeatVisualState = {
  /** The lane the performer stands on. */
  performerLane: number;
  /**
   * The performer's loop period, in beats — one hand-to-forehead-and-back per
   * period, contacting on multiples of it.
   *
   * Carried in the state rather than assumed by the renderer because the loop
   * has to *meet* the cans: it is derived from the authored note grid, so a
   * scenario in eighths gets a hand moving in eighths and every can arrives
   * exactly when the palm does.
   */
  strikePeriodBeats: number;
  /** Cans dealt with this attempt. The score of the thing. */
  crushed: number;
  /** How many of them to actually draw — {@link MAX_PILE} at most. */
  pile: number;
  /** Cans that went by him: wrong lane or never lifted. */
  uncrushed: number;
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
  /**
   * How often he swings, in beats. See {@link RepeatVisualState.strikePeriodBeats}.
   * Defaults to a swing per beat, which is right for quarter-note material.
   */
  strikePeriodBeats?: number;
};

export class RepeatMinigame {
  readonly performerLane: number;
  readonly strikePeriodBeats: number;
  #crushed = 0;
  #uncrushed = 0;
  #cans: FlyingCan[] = [];
  #lastCrushBeat = -99;
  #complete = false;
  #passed = false;
  #nextId = 1;

  constructor(options: RepeatOptions) {
    this.performerLane = options.performerLane;
    this.strikePeriodBeats =
      options.strikePeriodBeats && options.strikePeriodBeats > 0
        ? options.strikePeriodBeats
        : 1;
  }

  get state(): RepeatVisualState {
    return {
      performerLane: this.performerLane,
      strikePeriodBeats: this.strikePeriodBeats,
      crushed: this.#crushed,
      pile: Math.min(MAX_PILE, this.#crushed),
      uncrushed: this.#uncrushed,
      cans: this.#cans,
      lastCrushBeat: this.#lastCrushBeat,
      complete: this.#complete,
      passed: this.#passed,
    };
  }

  /**
   * A note was played. The can rises to where the player put it.
   *
   * @param playedLane the lane the *played* pitch quantises to, or null when
   * the input was off-scale or unpitched — that can spawns wobbling rather than
   * snapping to a lane it does not belong on.
   */
  place(playedLane: number | null, beat: number): void {
    if (this.#complete) return;
    const crushed = playedLane === this.performerLane;
    this.#push({
      lane: playedLane ?? this.performerLane,
      fate: crushed ? "crushed" : "wrong",
      wobbly: playedLane === null,
      bornBeat: beat,
    });
    if (crushed) {
      this.#crushed += 1;
      this.#lastCrushBeat = beat;
    } else {
      this.#uncrushed += 1;
    }
  }

  /**
   * A target expired with nothing played at it.
   *
   * The can still exists — it was already on screen, riding in on its bar —
   * so it has to go somewhere. It stays exactly where it was: in the bar, never
   * lifted, rolling past his shins. Nothing hits him. Making the performer get
   * beaned for a note the player never played would be inventing a second
   * failure for one mistake, and it would put the only interesting thing on
   * screen behind the player's worst moments.
   */
  miss(targetLane: number, beat: number): void {
    if (this.#complete) return;
    this.#push({ lane: targetLane, fate: "missed", wobbly: false, bornBeat: beat });
    this.#uncrushed += 1;
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

  #push(can: Omit<FlyingCan, "id">): void {
    this.#cans.push({ id: this.#nextId++, ...can });
  }
}
