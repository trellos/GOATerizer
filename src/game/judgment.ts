/**
 * Target judgment: what the player played, against what the prompt asked for.
 *
 * Pure and synchronous. It takes beats and MIDI numbers and returns domain
 * events; it has never heard of Tuninator, an AudioContext or a sprite. That is
 * what makes "correct pitch, 40ms late, at 140bpm is a Good" a unit test rather
 * than something you have to plug a guitar in to find out.
 *
 * The rules it implements, from the GDD:
 *
 *   - a wrong note does **not** consume the target (§5.2) — the game keeps
 *     listening for the right pitch until that target's window expires;
 *   - a target resolves exactly once, to Perfect, Good or Miss;
 *   - one sustained wrong pitch does not produce a stream of wrong-note events;
 *   - windows are duration-aware data, not one hard-coded millisecond figure.
 *
 * It also watches note *endings* — see {@link TargetJudge.release} — but only
 * ever reports them; nothing about a release changes what a target resolved to
 * or what it was worth. Judgment of a target happens once, at its attack.
 */

import {
  GOOD_WINDOW_FLOOR_BEATS,
  OCTAVE_EQUIVALENT_MATCH,
  TIMING_WINDOWS_BEATS,
  WRONG_NOTE_DEBOUNCE_BEATS,
  type SubdivisionWindows,
} from "../config/tuning.js";
import { isDiatonic, lanePositionOfMidi, type RunKey } from "../music/keys.js";
import { mod } from "../music/pitch.js";
import type { ResolvedTarget } from "./targets.js";

export type JudgmentOutcome = "perfect" | "good" | "miss";

/** Why a correct pitch only earned a Good. Surfaced in the debug panel. */
export type GoodReason = "timing" | "octave";

export type JudgmentEvent =
  | {
      type: "PerfectNote";
      target: ResolvedTarget;
      attackId: string;
      playedMidi: number;
      /** Signed beats from the ideal attack. Negative is early. */
      beatDelta: number;
    }
  | {
      type: "GoodNote";
      target: ResolvedTarget;
      attackId: string;
      playedMidi: number;
      beatDelta: number;
      reason: GoodReason;
    }
  | { type: "MissedNote"; target: ResolvedTarget }
  | {
      type: "WrongNote";
      attackId: string;
      playedMidi: number;
      atBeat: number;
      /** False when the note is outside the run key entirely. */
      diatonic: boolean;
      /** Continuous lane coordinate, or null when off the one-octave span. */
      lanePosition: number | null;
    }
  | { type: "TargetResolved"; target: ResolvedTarget; outcome: JudgmentOutcome }
  /**
   * A previously-judged played note changed pitch under revision. The timeline
   * redraws that note; nothing is scored twice.
   */
  | { type: "PlayedNoteRevised"; attackId: string; playedMidi: number }
  /**
   * A note that already landed on its target was also *let go* near where the
   * target ends. See {@link TargetJudge.release} for the exact window and for
   * why this is a strictly weaker claim than "held for its written duration".
   *
   * This event scores nothing. It does not touch the score, the judgment
   * points, the star meter, the timeline actor or the can crusher, and the
   * target it names has already been resolved and will not be resolved again.
   * It exists so that something downstream — today, the backing-track duck in
   * `game/backing-duck.ts` — can tell the difference between a player who is
   * hitting attacks and letting the notes fall over, and one who is actually in
   * control of the phrase. Adding it to a scoring path would silently change
   * every authored star threshold, which are denominated in judgment points
   * against a maximum of `noteOpportunityCount * JUDGMENT_POINTS.perfect`.
   */
  | {
      type: "NoteReleasedOnTime";
      target: ResolvedTarget;
      attackId: string;
      /** Signed beats from the target's end. Negative is an early release. */
      beatDelta: number;
    };

/** Per-target timing tolerance, after neighbour clamping. */
export type TargetWindows = SubdivisionWindows;

/**
 * Timing windows for a whole level.
 *
 * Each target starts from its subdivision's authored window and has its Good
 * window clamped to half the distance to its nearest neighbouring target, so
 * that dense material does not hand one played note to a target it obviously
 * does not belong to.
 *
 * Then {@link GOOD_WINDOW_FLOOR_BEATS} puts a floor under the result, and the
 * floor wins. The clamp on its own made eighth-note material break as a cliff
 * under any systematic offset past 0.25 beats — see that constant for the
 * measurement — and its stated purpose, stopping two targets claiming one note,
 * is something `#findMatch` already guarantees structurally: candidates are
 * filtered by pitch, the nearest survivor wins, and a resolved target is never
 * offered again.
 *
 * Perfect is *not* floored. Widening what counts as a hit is forgiveness;
 * widening what counts as flawless would make three stars mean less.
 */
export function computeWindows(targets: readonly ResolvedTarget[]): TargetWindows[] {
  return targets.map((target, index) => {
    const base = TIMING_WINDOWS_BEATS[target.duration];
    const previous = targets[index - 1];
    const next = targets[index + 1];

    let good = base.good;
    if (previous) good = Math.min(good, (target.startBeat - previous.startBeat) / 2);
    if (next) good = Math.min(good, (next.startBeat - target.startBeat) / 2);
    good = Math.max(good, GOOD_WINDOW_FLOOR_BEATS);

    return { perfect: Math.min(base.perfect, good), good };
  });
}

type TargetSlot = {
  target: ResolvedTarget;
  windows: TargetWindows;
  outcome: JudgmentOutcome | null;
  /** Which attack resolved it, for revision handling. */
  resolvedBy: string | null;
};

/** What the judge remembers about one played note. */
type AttackRecord = {
  midi: number;
  beat: number;
  /**
   * Index into `#slots` of the target this note resolved, or null while it has
   * resolved nothing. A slot index rather than an `opportunityIndex`: the two
   * happen to coincide for targets built by `resolveTargets`, but the judge is
   * handed an arbitrary target list and must not assume they do.
   */
  resolvedSlot: number | null;
  wrong: boolean;
  /**
   * Whether a release has already been accounted for. One played note gets one
   * release; a recognizer that repeats itself must not be able to feed the same
   * clean ending downstream twice.
   */
  released: boolean;
};

export type JudgeOptions = {
  targets: readonly ResolvedTarget[];
  key: RunKey;
  /** Test seam. Defaults to the tuning table. */
  windows?: readonly TargetWindows[];
  octaveEquivalentMatch?: boolean;
  wrongNoteDebounceBeats?: number;
};

export class TargetJudge {
  readonly #slots: TargetSlot[];
  readonly #key: RunKey;
  readonly #octaveEquivalent: boolean;
  readonly #debounceBeats: number;
  readonly #attacks = new Map<string, AttackRecord>();
  #lastWrong: { midi: number; beat: number } | null = null;
  #listeners: ((event: JudgmentEvent) => void)[] = [];

  constructor(options: JudgeOptions) {
    const windows = options.windows ?? computeWindows(options.targets);
    this.#slots = options.targets.map((target, index) => {
      const window = windows[index];
      if (!window) throw new Error(`no timing window for target ${index}`);
      return { target, windows: window, outcome: null, resolvedBy: null };
    });
    this.#key = options.key;
    this.#octaveEquivalent = options.octaveEquivalentMatch ?? OCTAVE_EQUIVALENT_MATCH;
    this.#debounceBeats = options.wrongNoteDebounceBeats ?? WRONG_NOTE_DEBOUNCE_BEATS;
  }

  onEvent(handler: (event: JudgmentEvent) => void): () => void {
    this.#listeners.push(handler);
    return () => {
      this.#listeners = this.#listeners.filter((entry) => entry !== handler);
    };
  }

  /** Outcome per target, `null` where still open. */
  get outcomes(): readonly (JudgmentOutcome | null)[] {
    return this.#slots.map((slot) => slot.outcome);
  }

  get openTargetCount(): number {
    return this.#slots.filter((slot) => slot.outcome === null).length;
  }

  windowsFor(opportunityIndex: number): TargetWindows | undefined {
    return this.#slots[opportunityIndex]?.windows;
  }

  /** The target the player should currently be aiming at, if any is open. */
  currentTarget(beat: number): ResolvedTarget | null {
    let best: TargetSlot | null = null;
    for (const slot of this.#slots) {
      if (slot.outcome !== null) continue;
      if (beat > slot.target.startBeat + slot.windows.good) continue;
      if (!best || slot.target.startBeat < best.target.startBeat) best = slot;
    }
    return best?.target ?? null;
  }

  /* ------------------------------------------------------------------ */

  /** One played note. `beat` is the attack, already latency-compensated. */
  attack(attackId: string, midi: number, beat: number): void {
    const match = this.#findMatch(midi, beat);

    if (!match) {
      this.#attacks.set(attackId, {
        midi,
        beat,
        resolvedSlot: null,
        wrong: true,
        released: false,
      });
      this.#emitWrong(attackId, midi, beat);
      return;
    }

    this.#attacks.set(attackId, {
      midi,
      beat,
      resolvedSlot: match.index,
      wrong: false,
      released: false,
    });
    this.#resolve(match.slot, match.outcome, attackId, midi, beat, match.reason);
  }

  /**
   * The recognizer revised a note it already announced.
   *
   * A target that already resolved stays resolved — a revision is new
   * information about the *player's* note, not permission to re-score. But a
   * note that was judged wrong gets another chance while its target is still
   * open, which is exactly the case Tuninator's `pitchCorrection` exists for.
   */
  retune(attackId: string, midi: number, beat?: number): void {
    const record = this.#attacks.get(attackId);
    if (!record) return;
    if (record.midi === midi) return;

    record.midi = midi;
    this.#emit({ type: "PlayedNoteRevised", attackId, playedMidi: midi });

    if (record.resolvedSlot !== null) return;

    const at = beat ?? record.beat;
    const match = this.#findMatch(midi, at);
    if (!match) return;

    record.wrong = false;
    record.resolvedSlot = match.index;
    this.#resolve(match.slot, match.outcome, attackId, midi, at, match.reason);
  }

  /**
   * The player let a note go. `beat` is the release, latency-compensated the
   * same way an attack is.
   *
   * Emits {@link JudgmentEvent} `NoteReleasedOnTime` when, and only when, all of
   * this holds:
   *
   *   - the released note is one this judge has seen attacked;
   *   - that attack already **resolved a target**, as Perfect or Good. A wrong
   *     note has no target to be released against, and letting go of one
   *     tidily is not a musical achievement. A note that landed nothing is
   *     simply forgotten here;
   *   - the release lands within that target's own Good window of the target's
   *     **end** (`startBeat + durationBeats`);
   *   - nothing has already been reported for this attack.
   *
   * The window is the target's existing, neighbour-clamped Good window rather
   * than a new constant, and that is a deliberate reuse rather than laziness.
   * It is already duration-aware data (`config/tuning.ts`), it is already
   * clamped so no two targets can claim one played note, and for the uniform
   * material every registered scenario authors it works out to exactly half the
   * note's own length — a quarter note's Good window is 0.5 beats, an eighth's
   * is 0.25. So "released on time" means, in practice, *held for at least half
   * the written note and let go before half again as long*, at any tempo, with
   * no second table of numbers to keep in step with the first.
   *
   * Note what this event does **not** claim. It is not "held for its written
   * duration": the recognizer's note end is a silence-detection estimate, and
   * the player may have re-articulated, palm-muted or simply run out of sustain.
   * It is the honest, weaker statement — the note stopped near where the prompt
   * said it should — which is all the duck needs and all this can support.
   *
   * One deliberate hole: a note released *before* a late `retune` turns it from
   * wrong into a hit will never report a release, because the release was
   * already accounted for against a note that had resolved nothing. Reopening it
   * would mean remembering release beats indefinitely so a revision could
   * re-judge them, and the whole prize is one rung of a five-rung duck. Costing
   * a rare recognizer revision one rung is a better trade than a second replay
   * mechanism inside the judge.
   */
  release(attackId: string, beat: number): void {
    const record = this.#attacks.get(attackId);
    if (!record) return;
    if (record.released) return;
    // Recorded even when nothing is emitted below, so a repeat of this release
    // cannot produce a second event by taking a different branch.
    record.released = true;

    if (record.resolvedSlot === null) return;
    const slot = this.#slots[record.resolvedSlot];
    if (!slot) return;
    // Belt and braces: a slot an attack resolved is Perfect or Good by
    // construction, and a released miss must never reach the duck.
    if (slot.outcome !== "perfect" && slot.outcome !== "good") return;
    if (slot.resolvedBy !== attackId) return;

    const endBeat = slot.target.startBeat + slot.target.durationBeats;
    const beatDelta = beat - endBeat;
    if (Math.abs(beatDelta) > slot.windows.good) return;

    this.#emit({ type: "NoteReleasedOnTime", target: slot.target, attackId, beatDelta });
  }

  /** Expires every target whose window has closed. Idempotent. */
  tick(beat: number): void {
    for (const slot of this.#slots) {
      if (slot.outcome !== null) continue;
      if (beat <= slot.target.startBeat + slot.windows.good) continue;
      slot.outcome = "miss";
      this.#emit({ type: "MissedNote", target: slot.target });
      this.#emit({ type: "TargetResolved", target: slot.target, outcome: "miss" });
    }
  }

  /* ------------------------------------------------------------------ */

  #findMatch(
    midi: number,
    beat: number
  ): { slot: TargetSlot; index: number; outcome: JudgmentOutcome; reason: GoodReason } | null {
    let best: {
      slot: TargetSlot;
      index: number;
      outcome: JudgmentOutcome;
      reason: GoodReason;
      rank: number;
      distance: number;
    } | null = null;

    for (const [index, slot] of this.#slots.entries()) {
      if (slot.outcome !== null) continue;
      const delta = beat - slot.target.startBeat;
      const distance = Math.abs(delta);
      if (distance > slot.windows.good) continue;

      const exact = midi === slot.target.midi;
      const octave =
        !exact &&
        this.#octaveEquivalent &&
        mod(midi - slot.target.midi, 12) === 0;
      if (!exact && !octave) continue;

      // Exact pitch always beats an octave-equivalent one; within a rank, the
      // closest target in time wins.
      const rank = exact ? 0 : 1;
      const outcome: JudgmentOutcome =
        exact && distance <= slot.windows.perfect ? "perfect" : "good";
      const reason: GoodReason = exact ? "timing" : "octave";

      if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
        best = { slot, index, outcome, reason, rank, distance };
      }
    }

    return best
      ? { slot: best.slot, index: best.index, outcome: best.outcome, reason: best.reason }
      : null;
  }

  #resolve(
    slot: TargetSlot,
    outcome: JudgmentOutcome,
    attackId: string,
    playedMidi: number,
    beat: number,
    reason: GoodReason
  ): void {
    slot.outcome = outcome;
    slot.resolvedBy = attackId;
    const beatDelta = beat - slot.target.startBeat;

    if (outcome === "perfect") {
      this.#emit({ type: "PerfectNote", target: slot.target, attackId, playedMidi, beatDelta });
    } else {
      this.#emit({
        type: "GoodNote",
        target: slot.target,
        attackId,
        playedMidi,
        beatDelta,
        reason,
      });
    }
    this.#emit({ type: "TargetResolved", target: slot.target, outcome });
  }

  #emitWrong(attackId: string, midi: number, beat: number): void {
    const last = this.#lastWrong;
    if (last && last.midi === midi && beat - last.beat < this.#debounceBeats) return;
    this.#lastWrong = { midi, beat };
    this.#emit({
      type: "WrongNote",
      attackId,
      playedMidi: midi,
      atBeat: beat,
      diatonic: isDiatonic(midi, this.#key),
      lanePosition: lanePositionOfMidi(midi, this.#key),
    });
  }

  #emit(event: JudgmentEvent): void {
    for (const handler of [...this.#listeners]) handler(event);
  }
}
