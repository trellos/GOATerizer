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
 */

import {
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
      /** Continuous lane coordinate, or null when off the two-octave span. */
      lanePosition: number | null;
    }
  | { type: "TargetResolved"; target: ResolvedTarget; outcome: JudgmentOutcome }
  /**
   * A previously-judged played note changed pitch under revision. The timeline
   * redraws that note; nothing is scored twice.
   */
  | { type: "PlayedNoteRevised"; attackId: string; playedMidi: number };

/** Per-target timing tolerance, after neighbour clamping. */
export type TargetWindows = SubdivisionWindows;

/**
 * Timing windows for a whole level.
 *
 * Each target starts from its subdivision's authored window, then has its Good
 * window clamped to half the distance to its nearest neighbouring target. The
 * subdivision table already encodes that for uniform material; the clamp makes
 * it hold for *any* authored rhythm — a quarter note followed by an eighth
 * cannot claim a played note that belongs to the eighth.
 */
export function computeWindows(targets: readonly ResolvedTarget[]): TargetWindows[] {
  return targets.map((target, index) => {
    const base = TIMING_WINDOWS_BEATS[target.duration];
    const previous = targets[index - 1];
    const next = targets[index + 1];

    let good = base.good;
    if (previous) good = Math.min(good, (target.startBeat - previous.startBeat) / 2);
    if (next) good = Math.min(good, (next.startBeat - target.startBeat) / 2);

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
  resolvedTarget: number | null;
  wrong: boolean;
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
      this.#attacks.set(attackId, { midi, beat, resolvedTarget: null, wrong: true });
      this.#emitWrong(attackId, midi, beat);
      return;
    }

    this.#attacks.set(attackId, {
      midi,
      beat,
      resolvedTarget: match.slot.target.opportunityIndex,
      wrong: false,
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

    if (record.resolvedTarget !== null) return;

    const at = beat ?? record.beat;
    const match = this.#findMatch(midi, at);
    if (!match) return;

    record.wrong = false;
    record.resolvedTarget = match.slot.target.opportunityIndex;
    this.#resolve(match.slot, match.outcome, attackId, midi, at, match.reason);
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
  ): { slot: TargetSlot; outcome: JudgmentOutcome; reason: GoodReason } | null {
    let best: { slot: TargetSlot; outcome: JudgmentOutcome; reason: GoodReason; rank: number; distance: number } | null =
      null;

    for (const slot of this.#slots) {
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
        best = { slot, outcome, reason, rank, distance };
      }
    }

    return best ? { slot: best.slot, outcome: best.outcome, reason: best.reason } : null;
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
