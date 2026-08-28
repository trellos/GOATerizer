/**
 * The fake guitarist: what autoplay plays, decided without a clock.
 *
 * Dev-only. This module turns an attempt's targets into a list of gestures —
 * "attack this pitch at this beat, for this long" — and knows nothing about
 * audio, the DOM, the transport or which sink will perform them. That is the
 * whole point: `game-app.ts` owns *when* a gesture reaches the audio clock and
 * *which* fake input path performs it, and everything about *what a performance
 * at 50% looks like* is decided here, where it can be tested against the real
 * `TargetJudge` with no microphone (`AGENTS.md` §7).
 *
 * It is also a pure function of `(targets, mode, seed, attemptIndex)` and never
 * reads "now". Two consequences fall out of that, and both are load-bearing:
 * the same link replays the same performance, and switching mode in the middle
 * of an attempt can replan from scratch and reproduce the remaining gestures
 * exactly, because the PRNG stream restarts from the top either way.
 *
 * The hard part is not the hit rate. It is making a wrong note *provably*
 * wrong — see `pickWrongMidi`.
 */

import {
  AUTOPLAY_GESTURE_GAP_BEATS,
  AUTOPLAY_HIT_JITTER_FRACTION,
  AUTOPLAY_HIT_RATE,
  AUTOPLAY_NOODLE_CHANCE,
  AUTOPLAY_NOODLE_MIN_GAP_BEATS,
  AUTOPLAY_WRONG_NOTE_CANDIDATES,
  AUTOPLAY_WRONG_NOTE_MARGIN_BEATS,
  AUTOPLAY_WRONG_SHARE,
  WRONG_NOTE_DEBOUNCE_BEATS,
} from "../config/tuning.js";
import { computeWindows, type TargetWindows } from "../game/judgment.js";
import type { ResolvedTarget } from "../game/targets.js";
import { mod } from "../music/pitch.js";

/**
 * The tiers.
 *
 * The ids are also the `?autoplay=` values and the dev-button id suffixes, so
 * there is one vocabulary rather than three that have to be kept in step.
 */
export type AutoplayMode = "perfect" | "75" | "50" | "25" | "off";

export const AUTOPLAY_MODES: readonly AutoplayMode[] = ["perfect", "75", "50", "25", "off"];

export function parseAutoplayMode(value: string | null): AutoplayMode | null {
  return AUTOPLAY_MODES.find((mode) => mode === value) ?? null;
}

/** One thing the fake guitarist does. Times are attempt-relative beats. */
export type AutoGesture = {
  /** Attack beat, jitter already applied. */
  beat: number;
  midi: number;
  /** How long it should sound. Never runs into the next gesture. */
  durationBeats: number;
  /** The target this aims at, or null for a noodle between targets. */
  opportunityIndex: number | null;
  /**
   * What the planner expects the judge to say.
   *
   * Diagnostics and tests only — nothing schedules differently because of it,
   * and on the synthetic path the recognizer is free to disagree.
   */
  intent: "hit" | "wrong";
};

export type AutoPerformance = {
  mode: AutoplayMode;
  seed: number;
  attemptIndex: number;
  /** Ascending by `beat`, non-overlapping. */
  gestures: readonly AutoGesture[];
  counts: { hits: number; wrong: number; dropped: number; noodles: number };
};

export type PlanOptions = {
  targets: readonly ResolvedTarget[];
  mode: AutoplayMode;
  /** Run-wide, from `?seed=N`. */
  seed: number;
  /** Monotonic per attempt, so attempts differ within one run. */
  attemptIndex: number;
  /** Test seam. Defaults to `computeWindows(targets)` — the judge's own. */
  windows?: readonly TargetWindows[];
};

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * mulberry32. Small, fast, and good enough to make mistakes look unplanned.
 *
 * The repo had no seeded PRNG — `pickWeightedKey` and `scenariosForDifficulty`
 * both call `Math.random` directly — and a dev-tool RNG does not belong in
 * `src/music` or `src/game`, so it lives here with its only caller.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One attempt's stream, derived so attempts differ but the run replays. */
export function attemptSeed(seed: number, attemptIndex: number): number {
  return (seed ^ Math.imul(attemptIndex + 1, 0x9e3779b1)) >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Wrong notes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A pitch that cannot be mistaken for a hit at this beat.
 *
 * This is the sharp edge of the whole module. `TargetJudge` does not compare
 * against "the current target": `#findMatch` scans **every** unresolved slot
 * whose clamped Good window contains the beat, and matches on exact MIDI *or*
 * on pitch class, because `OCTAVE_EQUIVALENT_MATCH` is on. So a naively-chosen
 * wrong note can score a Good against a *neighbouring* target an octave away,
 * and the failure the mode exists to show never appears.
 *
 * The planner cannot know which targets will still be open when the note
 * lands, so it over-approximates and treats every target as open. A margin is
 * added to each window because the synthetic path is judged on Tuninator's
 * onset estimate rather than the exact planned beat.
 *
 * Two tiers, in order of how a real fumble looks:
 *
 *   1. Another pitch from *this level's own vocabulary*. Diatonic by
 *      construction and inside the one-octave span, so it draws as a clean bar
 *      in the wrong lane — a guitarist playing the wrong degree.
 *   2. A chromatic neighbour. Draws fuzzy and off-lane
 *      (`ui/timeline/timeline-view.ts`), which is unmistakably a mistake.
 *
 * Returns `null` when nothing is safe, and the caller turns the fumble into a
 * silent drop instead. Never guess: a "wrong" note that scores is worse than
 * no note at all.
 */
export function pickWrongMidi(args: {
  beat: number;
  targets: readonly ResolvedTarget[];
  windows: readonly TargetWindows[];
  /** Pitch to stay near, so a fumble reads as a fumble and not as a bug. */
  nearMidi: number;
  /** The last wrong note played, for the debounce below. */
  recentWrong: { midi: number; beat: number } | null;
  random: () => number;
  marginBeats?: number;
  debounceBeats?: number;
}): number | null {
  const margin = args.marginBeats ?? AUTOPLAY_WRONG_NOTE_MARGIN_BEATS;
  const debounce = args.debounceBeats ?? WRONG_NOTE_DEBOUNCE_BEATS;

  const forbidden = new Set<number>();
  args.targets.forEach((target, index) => {
    const window = args.windows[index];
    if (!window) return;
    if (Math.abs(args.beat - target.startBeat) <= window.good + margin) {
      forbidden.add(mod(target.midi, 12));
    }
  });

  /**
   * The debounce is not cosmetic. `TargetJudge.#emitWrong` swallows a repeat of
   * the same wrong pitch inside `WRONG_NOTE_DEBOUNCE_BEATS`, so no `WrongNote`
   * event fires, so `markPlayedOutcome(..., wrong: true)` never runs — and the
   * bar renders in the ordinary played colour instead of the wrong colour. A
   * wrong note that looks like a hit is the one outcome this mode must not
   * produce.
   */
  const swallowed = (midi: number): boolean =>
    args.recentWrong !== null &&
    args.recentWrong.midi === midi &&
    args.beat - args.recentWrong.beat < debounce + margin;

  const usable = (midi: number): boolean => !forbidden.has(mod(midi, 12)) && !swallowed(midi);

  const vocabulary = [...new Set(args.targets.map((target) => target.midi))]
    .filter(usable)
    .sort((a, b) => Math.abs(a - args.nearMidi) - Math.abs(b - args.nearMidi));

  if (vocabulary.length > 0) {
    const pool = vocabulary.slice(0, AUTOPLAY_WRONG_NOTE_CANDIDATES);
    return pool[Math.floor(args.random() * pool.length)] ?? pool[0] ?? null;
  }

  for (const offset of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    const candidate = args.nearMidi + offset;
    if (usable(candidate)) return candidate;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

/** Everything the fake guitarist does in one attempt. */
export function planAutoPerformance(options: PlanOptions): AutoPerformance {
  const { targets, mode, seed, attemptIndex } = options;
  const windows = options.windows ?? computeWindows(targets);
  const empty: AutoPerformance = {
    mode,
    seed,
    attemptIndex,
    gestures: [],
    counts: { hits: 0, wrong: 0, dropped: 0, noodles: 0 },
  };
  if (mode === "off" || targets.length === 0) return empty;

  const random = createRandom(attemptSeed(seed, attemptIndex));
  const hitRate = AUTOPLAY_HIT_RATE[mode];
  const counts = { hits: 0, wrong: 0, dropped: 0, noodles: 0 };
  const gestures: AutoGesture[] = [];
  let recentWrong: { midi: number; beat: number } | null = null;

  /*
   * Which targets get hit, by running quota rather than a coin flip each.
   *
   * A per-note coin flip clumps: at 50% it will happily miss five in a row and
   * then hit five, which reads as two different performances rather than one
   * mediocre one. Accumulating the rate and firing when it crosses 1 spreads
   * the hits evenly and lands the count exactly; the jitter only decides which
   * side of a boundary a marginal note falls on, so the pattern is not visibly
   * mechanical either.
   */
  let quota = mode === "perfect" ? 0 : random();

  targets.forEach((target, index) => {
    const window = windows[index];
    if (!window) return;

    quota += hitRate;
    const hit = quota >= 1;
    if (hit) quota -= 1;

    const jitter =
      mode === "perfect" ? 0 : (random() * 2 - 1) * window.good * AUTOPLAY_HIT_JITTER_FRACTION;
    const beat = target.startBeat + jitter;

    if (hit) {
      counts.hits += 1;
      gestures.push({
        beat,
        midi: target.midi,
        durationBeats: target.durationBeats,
        opportunityIndex: target.opportunityIndex,
        intent: "hit",
      });
      return;
    }

    // A wrong pitch does not consume its target (`game/judgment.ts`), so the
    // target still expires to a miss. One fumble, two marks: a wrong played
    // bar and a missed target.
    if (random() < AUTOPLAY_WRONG_SHARE) {
      const midi = pickWrongMidi({
        beat,
        targets,
        windows,
        nearMidi: target.midi,
        recentWrong,
        random,
      });
      if (midi !== null) {
        counts.wrong += 1;
        recentWrong = { midi, beat };
        gestures.push({
          beat,
          midi,
          durationBeats: target.durationBeats,
          opportunityIndex: target.opportunityIndex,
          intent: "wrong",
        });
        return;
      }
    }
    counts.dropped += 1;
  });

  gestures.sort((a, b) => a.beat - b.beat);

  // Noodles: the extra notes nobody asked for, in the gaps. A second pass, so
  // they are placed against the gestures that actually exist rather than
  // against the targets, and so `perfect` can skip the whole idea.
  if (mode !== "perfect") {
    const noodles: AutoGesture[] = [];
    for (let index = 0; index < gestures.length - 1; index += 1) {
      const current = gestures[index] as AutoGesture;
      const next = gestures[index + 1] as AutoGesture;
      const from = current.beat + current.durationBeats + AUTOPLAY_GESTURE_GAP_BEATS;
      const to = next.beat - AUTOPLAY_GESTURE_GAP_BEATS;
      if (to - from < AUTOPLAY_NOODLE_MIN_GAP_BEATS) continue;
      if (random() >= AUTOPLAY_NOODLE_CHANCE) continue;

      const beat = from + random() * (to - from);
      const midi = pickWrongMidi({
        beat,
        targets,
        windows,
        nearMidi: current.midi,
        recentWrong,
        random,
      });
      if (midi === null) continue;
      counts.noodles += 1;
      recentWrong = { midi, beat };
      noodles.push({
        beat,
        midi,
        durationBeats: Math.min(1, to - beat),
        opportunityIndex: null,
        intent: "wrong",
      });
    }
    gestures.push(...noodles);
    gestures.sort((a, b) => a.beat - b.beat);
  }

  // Finally, clamp every duration so no gesture runs into its successor. The
  // sinks depend on this: two overlapping sine plucks give the recognizer no
  // silence to end the first note on, and a note that never ends is a played
  // bar that never stops growing.
  for (let index = 0; index < gestures.length; index += 1) {
    const gesture = gestures[index] as AutoGesture;
    const next = gestures[index + 1];
    const available = next
      ? next.beat - gesture.beat - AUTOPLAY_GESTURE_GAP_BEATS
      : gesture.durationBeats;
    gesture.durationBeats = Math.max(0.05, Math.min(gesture.durationBeats, available));
  }

  return { mode, seed, attemptIndex, gestures, counts };
}
