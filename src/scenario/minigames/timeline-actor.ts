/**
 * The actor that lives on the timeline.
 *
 * PROPOSED DESIGN, PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md`.
 * The premise: a note bar is a container, and an actor at the strike line has a
 * verb. For `ClimbMinigame` the container is a platform and the verb is "land
 * on" — the goat jumps the note bars, so pitch height and platform height stop
 * being the same information drawn twice.
 *
 * The single most important property of this class is that **it cannot make the
 * game harder**. Position is deterministic, size is a display of the streak, and
 * nothing here gates a star or ends a run. A miss kills the actor and the next
 * good note spawns a new one — that is the whole failure model, and it is
 * bounded by construction: there is no recovery time to run out of, no state to
 * compound, and no way for one flub to make the next note unplayable.
 *
 * Pure. No canvas, no audio, no DOM — `ui/timeline/actor-layer.ts` draws it.
 */

/** How long a streak has to run before the actor stops growing. */
export const ACTOR_SIZE_CAP_STREAK = 12;

/** Unbroken notes past the cap that each further decoration costs. */
const NOTES_PER_DECORATION = 4;

/** Decorations never accumulate past this; they are a garnish, not a meter. */
const MAX_DECORATIONS = 4;

/** Fallen actors kept on the floor. Beyond this the oldest is dropped. */
const MAX_FALLEN = 8;

export type FallenActor = {
  id: number;
  /** Where it fell from, so it can drop rather than appear. */
  lane: number;
  /** Size it had reached, 0..1. */
  size: number;
  bornBeat: number;
};

export type TimelineActorState = {
  /** Lane the actor stands on, or null while it is dead. */
  lane: number | null;
  alive: boolean;
  /** Consecutive good notes. */
  streak: number;
  /** 0..1 — see {@link TimelineActor.size}. */
  size: number;
  /** Stars sparking off the actor once it has stopped growing. */
  decorations: number;
  /** The lane the next target sits on, so the actor can lean toward it. */
  nextLane: number | null;
  /** Beat of the most recent landing, for the jump arc. */
  landedBeat: number;
  /** Lane it jumped from, for the same reason. */
  fromLane: number | null;
  fallen: readonly FallenActor[];
};

export class TimelineActor {
  #lane: number | null = null;
  #fromLane: number | null = null;
  #nextLane: number | null = null;
  #alive = false;
  #streak = 0;
  #landedBeat = 0;
  #fallen: FallenActor[] = [];
  #nextId = 1;

  get state(): TimelineActorState {
    return {
      lane: this.#lane,
      alive: this.#alive,
      streak: this.#streak,
      size: this.size,
      decorations: this.decorations,
      nextLane: this.#nextLane,
      landedBeat: this.#landedBeat,
      fromLane: this.#fromLane,
      fallen: this.#fallen,
    };
  }

  /**
   * Size, 0..1, from the streak alone.
   *
   * Square-rooted so the first few notes feel enormous and the twenty-fifth
   * still nudges. Capped at a twelve-note streak, which a clean L1 (15-16
   * notes) can reach exactly as a clean L6 can — so size means "did you hold it
   * together" identically at every difficulty, rather than meaning "which
   * scenario did you draw".
   */
  get size(): number {
    if (!this.#alive) return 0;
    return Math.min(1, Math.sqrt(this.#streak / ACTOR_SIZE_CAP_STREAK));
  }

  /**
   * Decorations earned past the size cap.
   *
   * Growth has to stop at 12 or the actor eats the read-ahead zone, but a
   * 28-note streak should still visibly register. Past the cap the streak buys
   * garnish instead of mass — and it vanishes with the actor on a break, so the
   * whole streak stays one readable object.
   */
  get decorations(): number {
    if (!this.#alive || this.#streak <= ACTOR_SIZE_CAP_STREAK) return 0;
    const past = this.#streak - ACTOR_SIZE_CAP_STREAK;
    return Math.min(MAX_DECORATIONS, Math.floor(past / NOTES_PER_DECORATION) + 1);
  }

  /** Where the next target sits, so the actor can lean at it between notes. */
  aimAt(lane: number | null): void {
    this.#nextLane = lane;
  }

  /**
   * A note landed. The actor arrives on that lane, alive, one note longer.
   *
   * Note the lane comes from the *target*, not from what the player played:
   * authored pitch places terrain (`PROPOSED_Timeline_Actors.md` §2). If a
   * wrong note could move the actor, one flub could strand it somewhere the
   * next platform is unreachable from, and a single mistake could end a run.
   */
  land(lane: number, beat: number): void {
    this.#fromLane = this.#alive ? this.#lane : lane;
    this.#lane = lane;
    this.#landedBeat = beat;
    this.#alive = true;
    this.#streak += 1;
  }

  /**
   * A miss or a wrong note. The actor falls; the streak is over.
   *
   * Deliberately cheap: it costs the streak and nothing else. The next good
   * note spawns a fresh one, so there is no recovery period during which the
   * player is being punished for something they already paid for.
   */
  fall(beat: number): void {
    if (this.#alive && this.#lane !== null) {
      this.#fallen.push({ id: this.#nextId++, lane: this.#lane, size: this.size, bornBeat: beat });
      if (this.#fallen.length > MAX_FALLEN) this.#fallen.shift();
    }
    this.#alive = false;
    this.#lane = null;
    this.#fromLane = null;
    this.#streak = 0;
  }

  /** New attempt: the floor is swept and the streak starts again. */
  reset(): void {
    this.#fallen = [];
    this.#alive = false;
    this.#lane = null;
    this.#fromLane = null;
    this.#nextLane = null;
    this.#streak = 0;
    this.#landedBeat = 0;
  }
}
