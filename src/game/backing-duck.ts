/**
 * How loud the bass is allowed to be, given how the player is actually doing.
 *
 * The band is the player's accompaniment, and an accompanist who keeps playing
 * at full volume while the soloist falls apart is not being supportive, it is
 * being oblivious. So when the player stops landing notes the bass steps out of
 * the way: quieter with every missed opportunity, until after four of them it is
 * barely there and the drums — which never duck — are the only thing holding the
 * floor. Getting it right pulls the bass straight back in.
 *
 * This module is a pure state machine on purpose. It takes judgment events and
 * produces a number in 0..1; it has never heard of an AudioContext, a GainNode
 * or a `<div>`. That is what makes "four misses leaves the bass audible but
 * nearly gone, and four correct events restore it exactly" a unit test rather
 * than something you have to plug a guitar in and listen for. The caller (see
 * `app/game-app.ts`) is the only thing that knows the number ends up on
 * `BassPlayer.setDuck`.
 *
 * The ladder is deliberately symmetric — one rung down per miss, one rung up per
 * correct event — because the alternatives are both worse in play. A duck that
 * recovers instantly on the first good note makes the whole effect a flicker; a
 * duck that recovers slower than it falls is a hole a struggling player cannot
 * climb out of, which is exactly the player it is most likely to be punishing.
 */

import type { JudgmentEvent } from "./judgment.js";

/**
 * Gain multiplier by number of consecutive-ish misses on the ladder, 0..4.
 *
 * PROVISIONAL (`AGENTS.md` §17): the GDD has no opinion about ducking the
 * backing track, so these are reversible defaults chosen to be legible on the
 * speakers a browser game is actually played on, not design decisions.
 *
 * The steps are even in *decibels*, not in linear gain, because the ear hears
 * ratios: a flat linear ladder (1.0, 0.75, 0.5, 0.25, 0.0) sounds like nothing
 * much happened for the first two steps and then falls off a cliff. Five
 * decibels per rung is about the smallest step that unambiguously reads as
 * "something just changed" mid-phrase on a laptop speaker, and four of them
 * stack to −20 dB:
 *
 *   rung 0 →   0 dB → 1.00   full volume, nothing is wrong
 *   rung 1 →  −5 dB → 0.56
 *   rung 2 → −10 dB → 0.32
 *   rung 3 → −15 dB → 0.18
 *   rung 4 → −20 dB → 0.10   a tenth of the amplitude, roughly a quarter of the
 *                            perceived loudness: plainly gone, still present
 *
 * The bottom rung is 0.1 and **not** zero, and that is the load-bearing part of
 * the table. The bass is also the player's only harmonic reference — it is where
 * the key is — so silencing it outright would take information away from the
 * player who most needs it, on top of the volume. Barely there is a comment on
 * the performance; absent is a punishment.
 */
export const DUCK_GAIN_LADDER: readonly number[] = [1, 0.56, 0.32, 0.18, 0.1];

/** Rungs below full volume. Four, so four misses reach the bottom. */
export const DUCK_MAX_MISSES = DUCK_GAIN_LADDER.length - 1;

/** What one judgment event means to the duck, if anything. */
export type DuckInput = "missed" | "correct";

/**
 * Which judgment events move the ladder, and in which direction.
 *
 * Exported separately from the state machine so the *rule* — as opposed to the
 * arithmetic — is one readable function with its own tests.
 *
 * **Down: `MissedNote` only.** That is the user's own phrasing, and it is also
 * the only event that means what the duck is about: the target's window closed
 * without the correct pitch ever being started. Nothing else in the judgment
 * vocabulary carries that meaning.
 *
 * **A `WrongNote` deliberately does not duck.** A wrong note does not consume
 * its target (`game/judgment.ts`, GDD §5.2) — the target stays open and the
 * player can still land it, and if they do not, it expires as a `MissedNote` in
 * its own time and *that* is what ducks. Counting the wrong note as well would
 * charge one fumble twice, and worse, it would charge the player who is groping
 * for the right fret more than the player who does not try at all. Noodling
 * between targets would also duck the band, which is nobody's idea of the rule.
 *
 * **Up: `PerfectNote`, `GoodNote` and `NoteReleasedOnTime`.** Starting a note at
 * the right time or ending one at the right time both count, so a note that is
 * played cleanly and released cleanly is worth two rungs. That is the intended
 * asymmetry, not an accident: a player recovering on sustained material climbs
 * back in about two notes, while one working through staccato material — where
 * releases mostly land outside the window — climbs back at one rung per note.
 * Both are recoveries; the one that demonstrates more control is faster.
 *
 * `TargetResolved` and `PlayedNoteRevised` are bookkeeping. `TargetResolved`
 * accompanies every one of the events above, so counting it would double every
 * step; `PlayedNoteRevised` is the recognizer changing its mind about a note
 * that was already judged, and re-judging is handled inside the judge.
 */
export function duckInputFor(event: JudgmentEvent): DuckInput | null {
  switch (event.type) {
    case "MissedNote":
      return "missed";
    case "PerfectNote":
    case "GoodNote":
    case "NoteReleasedOnTime":
      return "correct";
    case "WrongNote":
    case "TargetResolved":
    case "PlayedNoteRevised":
      return null;
    default:
      return null;
  }
}

/**
 * The ladder itself.
 *
 * One per attempt. Construct it with the attempt and throw it away with the
 * attempt: the duck is a statement about how *this* performance is going, and a
 * player who arrives at a new minigame with the bass still ducked from the last
 * one is being told something untrue about the notes in front of them.
 */
export class BackingDuck {
  #misses = 0;

  /** How far down the ladder, 0..{@link DUCK_MAX_MISSES}. */
  get misses(): number {
    return this.#misses;
  }

  /** The multiplier to apply to the bass's own level. Always in 0..1. */
  get gain(): number {
    return DUCK_GAIN_LADDER[this.#misses] ?? 1;
  }

  /** Back to full volume. Call at the start of every attempt. */
  reset(): void {
    this.#misses = 0;
  }

  /** One step down, floored at the bottom rung. Returns the new gain. */
  missed(): number {
    this.#misses = Math.min(this.#misses + 1, DUCK_MAX_MISSES);
    return this.gain;
  }

  /** One step up, capped at full volume. Returns the new gain. */
  correct(): number {
    this.#misses = Math.max(this.#misses - 1, 0);
    return this.gain;
  }

  /**
   * Feeds one judgment event through {@link duckInputFor}. Returns the gain
   * afterwards, whether or not this event moved it, so the caller can pass the
   * result straight to the bass without branching.
   */
  apply(event: JudgmentEvent): number {
    const input = duckInputFor(event);
    if (input === "missed") return this.missed();
    if (input === "correct") return this.correct();
    return this.gain;
  }
}
