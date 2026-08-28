/**
 * The fake guitarist, judged by the real judge.
 *
 * The assertions that matter here are not "roughly half the notes were hit" —
 * they are the ones that pin the two things a demo mode can silently get wrong:
 * a `perfect` performance that is not actually flawless (the browser suite
 * asserts three stars from it), and a "wrong" note that quietly scores because
 * `TargetJudge` matches whole pitch classes across every open target. Both are
 * checked against `TargetJudge` itself rather than against a restatement of its
 * rules, because a restatement is exactly what would drift.
 */

import { describe, expect, it } from "vitest";

import { AUTOPLAY_HIT_RATE, WRONG_NOTE_DEBOUNCE_BEATS } from "../src/config/tuning.js";
import {
  AUTOPLAY_MODES,
  planAutoPerformance,
  parseAutoplayMode,
  type AutoplayMode,
} from "../src/dev/auto-performance.js";
import { computeWindows, TargetJudge, type JudgmentEvent } from "../src/game/judgment.js";
import { resolveTargets, type ResolvedTarget } from "../src/game/targets.js";
import { mod } from "../src/music/pitch.js";
import { ROCKY_ASCENT } from "../src/scenario/registry.js";
import type { RunKey } from "../src/music/keys.js";

const KEY: RunKey = { tonic: 7, mode: "minor" };
const LEVELS = [1, 2, 3, 4];
const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234];
/** The tiers that actually play something. */
const PLAYING: AutoplayMode[] = ["perfect", "50", "25"];

function levelTargets(difficulty: number): ResolvedTarget[] {
  const level = ROCKY_ASCENT.levels.get(difficulty);
  if (!level) throw new Error(`no level ${difficulty}`);
  return resolveTargets(level, KEY);
}

function plan(mode: AutoplayMode, difficulty = 2, seed = 7, attemptIndex = 0) {
  return planAutoPerformance({ targets: levelTargets(difficulty), mode, seed, attemptIndex });
}

/** Runs a whole performance through the real judge, in beat order. */
function judgePerformance(targets: readonly ResolvedTarget[], gestures: readonly { beat: number; midi: number }[]) {
  const events: JudgmentEvent[] = [];
  const judge = new TargetJudge({ targets, key: KEY });
  judge.onEvent((event) => events.push(event));
  gestures.forEach((gesture, index) => {
    judge.tick(gesture.beat);
    judge.attack(`auto-${index}`, gesture.midi, gesture.beat);
  });
  judge.tick(Number.MAX_SAFE_INTEGER);
  return events;
}

describe("autoplay modes", () => {
  it("round-trips the ids used by the URL and the dev buttons", () => {
    for (const mode of AUTOPLAY_MODES) expect(parseAutoplayMode(mode)).toBe(mode);
    for (const rejected of ["good", "scruffy", "", "half", "100", "PERFECT", null]) {
      expect(parseAutoplayMode(rejected)).toBeNull();
    }
  });

  it("plans nothing at all when off", () => {
    const performance = plan("off");
    expect(performance.gestures).toEqual([]);
    expect(performance.counts).toEqual({ hits: 0, wrong: 0, dropped: 0, noodles: 0 });
  });
});

describe("determinism", () => {
  it("replays exactly for the same seed and attempt", () => {
    expect(plan("25", 3, 42, 5)).toEqual(plan("25", 3, 42, 5));
  });

  it("differs between seeds, and between attempts within one run", () => {
    expect(plan("50", 2, 1, 0).gestures).not.toEqual(plan("50", 2, 2, 0).gestures);
    expect(plan("50", 2, 1, 0).gestures).not.toEqual(plan("50", 2, 1, 1).gestures);
  });
});

describe("perfect is literally flawless", () => {
  it("plays every target, dead on, with nothing else", () => {
    for (const difficulty of LEVELS) {
      const targets = levelTargets(difficulty);
      const performance = plan("perfect", difficulty);

      expect(performance.gestures).toHaveLength(targets.length);
      expect(performance.counts).toMatchObject({ wrong: 0, dropped: 0, noodles: 0 });
      performance.gestures.forEach((gesture, index) => {
        const target = targets[index] as ResolvedTarget;
        expect(gesture.midi).toBe(target.midi);
        expect(gesture.beat).toBe(target.startBeat);
        expect(gesture.intent).toBe("hit");
      });
    }
  });

  it("is judged as every target Perfect and nothing wrong", () => {
    // This is the unit-level guard on browser-validate's "three stars for a
    // flawless attempt": ★★★ is authored at noteOpportunityCount * perfect.
    for (const difficulty of LEVELS) {
      const targets = levelTargets(difficulty);
      const events = judgePerformance(targets, plan("perfect", difficulty).gestures);
      const perfect = events.filter((event) => event.type === "PerfectNote");
      expect(perfect).toHaveLength(targets.length);
      expect(events.some((event) => event.type === "WrongNote")).toBe(false);
      expect(events.some((event) => event.type === "MissedNote")).toBe(false);
    }
  });
});

describe("hit rates", () => {
  it("lands close to the tier's intended share", () => {
    for (const mode of ["50", "25"] as const) {
      for (const difficulty of LEVELS) {
        const targets = levelTargets(difficulty);
        const shares = SEEDS.map(
          (seed) => planAutoPerformance({ targets, mode, seed, attemptIndex: 0 }).counts.hits / targets.length
        );
        const mean = shares.reduce((sum, share) => sum + share, 0) / shares.length;
        expect(mean).toBeGreaterThan(AUTOPLAY_HIT_RATE[mode] - 0.1);
        expect(mean).toBeLessThan(AUTOPLAY_HIT_RATE[mode] + 0.1);
      }
    }
  });

  it("accounts for every target as a hit, a wrong note or a drop", () => {
    for (const mode of PLAYING) {
      for (const seed of SEEDS) {
        const targets = levelTargets(3);
        const { counts } = planAutoPerformance({ targets, mode, seed, attemptIndex: 0 });
        expect(counts.hits + counts.wrong + counts.dropped).toBe(targets.length);
      }
    }
  });
});

describe("timing", () => {
  it("never jitters a hit out of its own Good window", () => {
    for (const mode of PLAYING) {
      for (const difficulty of LEVELS) {
        for (const seed of SEEDS) {
          const targets = levelTargets(difficulty);
          const windows = computeWindows(targets);
          const { gestures } = planAutoPerformance({ targets, mode, seed, attemptIndex: 0 });
          for (const gesture of gestures) {
            if (gesture.intent !== "hit" || gesture.opportunityIndex === null) continue;
            const target = targets[gesture.opportunityIndex] as ResolvedTarget;
            const window = windows[gesture.opportunityIndex] as { good: number };
            expect(Math.abs(gesture.beat - target.startBeat)).toBeLessThan(window.good);
          }
        }
      }
    }
  });

  it("never lets one gesture run into the next", () => {
    for (const mode of PLAYING) {
      for (const difficulty of LEVELS) {
        for (const seed of SEEDS) {
          const { gestures } = planAutoPerformance({
            targets: levelTargets(difficulty),
            mode,
            seed,
            attemptIndex: 0,
          });
          for (let index = 0; index < gestures.length - 1; index += 1) {
            const current = gestures[index] as { beat: number; durationBeats: number };
            const next = gestures[index + 1] as { beat: number };
            expect(current.beat).toBeLessThanOrEqual(next.beat);
            expect(current.beat + current.durationBeats).toBeLessThanOrEqual(next.beat);
            expect(current.durationBeats).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("wrong notes are provably wrong", () => {
  it("never scores, under the real judge, across every level and seed", () => {
    // The one that matters. TargetJudge matches on pitch class across every
    // open slot within its clamped Good window, so a carelessly-picked "wrong"
    // note can score a Good against a neighbour an octave away and the failure
    // silently disappears.
    for (const mode of ["50", "25"] as const) {
      for (const difficulty of LEVELS) {
        for (const seed of SEEDS) {
          const targets = levelTargets(difficulty);
          const { gestures } = planAutoPerformance({ targets, mode, seed, attemptIndex: 0 });
          const wrong = gestures.filter((gesture) => gesture.intent === "wrong");
          if (wrong.length === 0) continue;

          const events = judgePerformance(targets, wrong);
          const scored = events.filter(
            (event) => event.type === "PerfectNote" || event.type === "GoodNote"
          );
          expect(scored).toHaveLength(0);
          expect(events.filter((event) => event.type === "WrongNote").length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("avoids the pitch class of every target whose window covers it", () => {
    for (const seed of SEEDS) {
      const targets = levelTargets(4);
      const windows = computeWindows(targets);
      const { gestures } = planAutoPerformance({ targets, mode: "25", seed, attemptIndex: 0 });
      for (const gesture of gestures) {
        if (gesture.intent !== "wrong") continue;
        targets.forEach((target, index) => {
          const window = windows[index] as { good: number };
          if (Math.abs(gesture.beat - target.startBeat) > window.good) return;
          expect(mod(gesture.midi, 12)).not.toBe(mod(target.midi, 12));
        });
      }
    }
  });

  it("never repeats a pitch inside the wrong-note debounce", () => {
    // A repeat inside the debounce is swallowed by the judge, so no WrongNote
    // fires, so the bar renders as an ordinary played note. A wrong note that
    // looks like a hit is the one thing this mode must not draw.
    for (const mode of ["50", "25"] as const) {
      for (const difficulty of LEVELS) {
        for (const seed of SEEDS) {
          const wrong = planAutoPerformance({
            targets: levelTargets(difficulty),
            mode,
            seed,
            attemptIndex: 0,
          }).gestures.filter((gesture) => gesture.intent === "wrong");

          for (let index = 0; index < wrong.length - 1; index += 1) {
            const current = wrong[index] as { beat: number; midi: number };
            for (let other = index + 1; other < wrong.length; other += 1) {
              const later = wrong[other] as { beat: number; midi: number };
              if (later.beat - current.beat >= WRONG_NOTE_DEBOUNCE_BEATS) break;
              expect(later.midi).not.toBe(current.midi);
            }
          }
        }
      }
    }
  });
});

describe("what each tier actually looks like when judged", () => {
  it("produces a real mix of hits, wrong notes and misses", () => {
    for (const mode of ["50", "25"] as const) {
      const targets = levelTargets(3);
      const events = judgePerformance(targets, plan(mode, 3).gestures);
      const count = (type: JudgmentEvent["type"]) =>
        events.filter((event) => event.type === type).length;

      expect(count("WrongNote")).toBeGreaterThan(0);
      expect(count("MissedNote")).toBeGreaterThan(0);
      expect(count("PerfectNote") + count("GoodNote")).toBeGreaterThan(0);
    }
  });

  it("hits strictly less often at 25% than at 50%, on the same seed", () => {
    for (const seed of SEEDS) {
      const targets = levelTargets(3);
      const half = planAutoPerformance({ targets, mode: "50", seed, attemptIndex: 0 });
      const quarter = planAutoPerformance({ targets, mode: "25", seed, attemptIndex: 0 });
      expect(quarter.counts.hits).toBeLessThan(half.counts.hits);
    }
  });
});
