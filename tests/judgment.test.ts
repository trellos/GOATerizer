import { beforeEach, describe, expect, it } from "vitest";

import { JUDGMENT_POINTS, SCORE_VALUES, TIMING_WINDOWS_BEATS } from "../src/config/tuning.js";
import { computeWindows, TargetJudge, type JudgmentEvent } from "../src/game/judgment.js";
import { AttemptScore } from "../src/game/scoring.js";
import { StarMeter } from "../src/game/stars.js";
import { resolveTargets, type ResolvedTarget } from "../src/game/targets.js";
import { ROCKY_ASCENT } from "../src/scenario/registry.js";
import type { RunKey } from "../src/music/keys.js";

const KEY: RunKey = { tonic: 7, mode: "minor" }; // G minor

function levelTargets(difficulty: number): ResolvedTarget[] {
  const level = ROCKY_ASCENT.levels.get(difficulty);
  if (!level) throw new Error(`no level ${difficulty}`);
  return resolveTargets(level, KEY);
}

/** A judge plus a recording of everything it emitted. */
function makeJudge(targets: readonly ResolvedTarget[]) {
  const events: JudgmentEvent[] = [];
  const judge = new TargetJudge({ targets, key: KEY });
  judge.onEvent((event) => events.push(event));
  let nextId = 0;
  return {
    judge,
    events,
    types: () => events.map((event) => event.type),
    play: (midi: number, beat: number) => {
      const id = `a${nextId++}`;
      judge.attack(id, midi, beat);
      return id;
    },
  };
}

describe("timing windows", () => {
  it("widens with the note value", () => {
    const targets = levelTargets(1);
    const windows = computeWindows(targets);
    // Quarter notes a beat apart: the full authored window survives clamping.
    expect(windows[5]).toEqual(TIMING_WINDOWS_BEATS.quarter);
  });

  it("tightens for eighths so adjacent targets stay distinguishable", () => {
    const windows = computeWindows(levelTargets(4));
    expect(windows[3]?.good).toBe(TIMING_WINDOWS_BEATS.eighth.good);
    expect(windows[3]?.good).toBeLessThan(TIMING_WINDOWS_BEATS.quarter.good);
    expect(windows[3]?.perfect).toBeLessThan(TIMING_WINDOWS_BEATS.quarter.perfect);
  });

  it("never lets two targets claim the same played note", () => {
    for (const difficulty of [1, 2, 3, 4]) {
      const targets = levelTargets(difficulty);
      const windows = computeWindows(targets);
      for (let i = 1; i < targets.length; i += 1) {
        const gap = targets[i]!.startBeat - targets[i - 1]!.startBeat;
        expect(windows[i - 1]!.good + windows[i]!.good).toBeLessThanOrEqual(gap + 1e-9);
      }
    }
  });

  it("clamps a long note's window when a short one follows closely", () => {
    // A quarter on beat 0 followed by an eighth on beat 0.5: the quarter's
    // authored +-0.5 would swallow the eighth, so it is halved.
    const targets: ResolvedTarget[] = [
      { opportunityIndex: 0, promptIndex: 0, pass: 0, startBeat: 0, durationBeats: 1, duration: "quarter", degree: { degree: 1, octaveBand: 0 }, lane: 0, midi: 43 },
      { opportunityIndex: 1, promptIndex: 1, pass: 0, startBeat: 0.5, durationBeats: 0.5, duration: "eighth", degree: { degree: 2, octaveBand: 0 }, lane: 1, midi: 45 },
    ];
    const windows = computeWindows(targets);
    expect(windows[0]?.good).toBe(0.25);
    expect(windows[0]?.perfect).toBeLessThanOrEqual(0.25);
  });
});

describe("judging one target", () => {
  let harness: ReturnType<typeof makeJudge>;

  beforeEach(() => {
    harness = makeJudge(levelTargets(1));
  });

  it("calls a dead-on correct pitch Perfect", () => {
    const target = levelTargets(1)[0]!;
    harness.play(target.midi, target.startBeat);
    expect(harness.types()).toEqual(["PerfectNote", "TargetResolved"]);
    const perfect = harness.events[0];
    expect(perfect?.type === "PerfectNote" && perfect.beatDelta).toBe(0);
  });

  it("calls a correct pitch inside the Perfect window Perfect", () => {
    const target = levelTargets(1)[2]!;
    harness.play(target.midi, target.startBeat + TIMING_WINDOWS_BEATS.quarter.perfect - 0.01);
    expect(harness.types()).toContain("PerfectNote");
  });

  it("calls a correct pitch that is late but inside the Good window Good", () => {
    const target = levelTargets(1)[2]!;
    harness.play(target.midi, target.startBeat + 0.4);
    expect(harness.types()).toEqual(["GoodNote", "TargetResolved"]);
    const good = harness.events[0];
    expect(good?.type === "GoodNote" && good.reason).toBe("timing");
    expect(good?.type === "GoodNote" && good.beatDelta).toBeCloseTo(0.4, 9);
  });

  it("calls a correct pitch that is early but inside the Good window Good", () => {
    const target = levelTargets(1)[3]!;
    harness.play(target.midi, target.startBeat - 0.4);
    expect(harness.types()).toEqual(["GoodNote", "TargetResolved"]);
  });

  it("caps a right-pitch-class-wrong-octave hit at Good", () => {
    const target = levelTargets(1)[0]!;
    harness.play(target.midi + 12, target.startBeat);
    const good = harness.events[0];
    expect(good?.type).toBe("GoodNote");
    expect(good?.type === "GoodNote" && good.reason).toBe("octave");
  });

  it("misses a target whose window expires unresolved", () => {
    const target = levelTargets(1)[0]!;
    harness.judge.tick(target.startBeat + 0.4);
    expect(harness.types()).toEqual([]);
    harness.judge.tick(target.startBeat + 0.51);
    expect(harness.types()).toEqual(["MissedNote", "TargetResolved"]);
  });

  it("resolves a target exactly once", () => {
    const target = levelTargets(1)[0]!;
    harness.play(target.midi, target.startBeat);
    harness.play(target.midi, target.startBeat + 0.1);
    harness.judge.tick(target.startBeat + 5);

    const resolutions = harness.events.filter(
      (event) => event.type === "TargetResolved" && event.target.opportunityIndex === 0
    );
    expect(resolutions).toHaveLength(1);
    // The second attempt at an already-resolved target is an extra played note.
    expect(harness.types()).toContain("WrongNote");
  });

  it("ticking repeatedly does not emit a second miss", () => {
    harness.judge.tick(1.6);
    const first = harness.events.length;
    harness.judge.tick(1.7);
    harness.judge.tick(1.8);
    const missesAtZero = harness.events.filter(
      (event) => event.type === "MissedNote" && event.target.opportunityIndex === 0
    );
    expect(missesAtZero).toHaveLength(1);
    expect(harness.events.length).toBeGreaterThanOrEqual(first);
  });
});

describe("wrong notes", () => {
  it("does not consume the target: the right note still lands afterwards", () => {
    const harness = makeJudge(levelTargets(1));
    const target = levelTargets(1)[1]!;

    harness.play(target.midi + 1, target.startBeat - 0.3); // a semitone off
    expect(harness.types()).toEqual(["WrongNote"]);

    harness.play(target.midi, target.startBeat + 0.05);
    expect(harness.types()).toEqual(["WrongNote", "PerfectNote", "TargetResolved"]);
  });

  it("still misses when only wrong notes arrive before the deadline", () => {
    const harness = makeJudge(levelTargets(1));
    const target = levelTargets(1)[1]!;
    harness.play(target.midi + 1, target.startBeat - 0.2);
    harness.play(target.midi + 3, target.startBeat + 0.2);
    expect(harness.types()).toEqual(["WrongNote", "WrongNote"]);

    harness.judge.tick(target.startBeat + 0.6);
    // Target 0's window closed too; only this target's outcome is under test.
    const forTarget = harness.events.filter(
      (event) =>
        (event.type === "MissedNote" || event.type === "TargetResolved") &&
        event.target.opportunityIndex === target.opportunityIndex
    );
    expect(forTarget.map((event) => event.type)).toEqual(["MissedNote", "TargetResolved"]);
  });

  it("flags a non-diatonic pitch as wrong and off the clean lanes", () => {
    const harness = makeJudge(levelTargets(1));
    // G#3 is not in G minor, and sits between the first two lanes.
    harness.play(56, 0.6);
    const wrong = harness.events[0];
    expect(wrong?.type).toBe("WrongNote");
    expect(wrong?.type === "WrongNote" && wrong.diatonic).toBe(false);
    expect(wrong?.type === "WrongNote" && wrong.lanePosition).toBeGreaterThan(0);
    expect(wrong?.type === "WrongNote" && wrong.lanePosition).toBeLessThan(1);
  });

  it("marks a diatonic-but-wrong pitch as diatonic", () => {
    const harness = makeJudge(levelTargets(1));
    harness.play(levelTargets(1)[6]!.midi, 0.55); // right key, wrong moment
    const wrong = harness.events[0];
    expect(wrong?.type === "WrongNote" && wrong.diatonic).toBe(true);
  });

  it("does not spam while one wrong pitch is sustained and re-attacked", () => {
    const harness = makeJudge(levelTargets(1));
    // Ten analyzer-driven attacks on one held wrong fret inside a quarter beat.
    for (let i = 0; i < 10; i += 1) harness.play(44, 0.5 + i * 0.02);
    expect(harness.events.filter((event) => event.type === "WrongNote")).toHaveLength(1);
  });

  it("does report the same wrong pitch again once it is musically a new attack", () => {
    const harness = makeJudge(levelTargets(1));
    harness.play(44, 0.5);
    harness.play(44, 0.5 + 0.3); // beyond the debounce
    expect(harness.events.filter((event) => event.type === "WrongNote")).toHaveLength(2);
  });

  it("lets a recognizer revision turn a wrong note into a hit", () => {
    const harness = makeJudge(levelTargets(1));
    const target = levelTargets(1)[1]!;
    const id = harness.play(target.midi + 5, target.startBeat + 0.05);
    expect(harness.types()).toEqual(["WrongNote"]);

    harness.judge.retune(id, target.midi);
    expect(harness.types()).toEqual([
      "WrongNote",
      "PlayedNoteRevised",
      "PerfectNote",
      "TargetResolved",
    ]);
  });

  it("never re-scores a target because a resolved note was revised", () => {
    const harness = makeJudge(levelTargets(1));
    const target = levelTargets(1)[0]!;
    const id = harness.play(target.midi, target.startBeat);
    harness.judge.retune(id, target.midi + 4);
    const resolutions = harness.events.filter((event) => event.type === "TargetResolved");
    expect(resolutions).toHaveLength(1);
  });
});

/**
 * Note endings.
 *
 * The judge reports a release that lands near where the target ends, and does
 * nothing else with it. These tests are as much about what a release must *not*
 * do — resolve, re-resolve or re-score anything — as about when it fires, since
 * that is the property the score and the star thresholds depend on.
 */
describe("releases", () => {
  // L1 is quarter notes: duration 1 beat, Good window +-0.5 either side of the
  // target's start, and therefore also of its end.
  const end = (target: ResolvedTarget) => target.startBeat + target.durationBeats;

  it("reports a note let go where the target ends", () => {
    const target = levelTargets(1)[2]!;
    const harness = makeJudge(levelTargets(1));
    const id = harness.play(target.midi, target.startBeat);
    harness.judge.release(id, end(target));

    expect(harness.types()).toEqual(["PerfectNote", "TargetResolved", "NoteReleasedOnTime"]);
    const released = harness.events[2];
    expect(released?.type === "NoteReleasedOnTime" && released.beatDelta).toBe(0);
    expect(released?.type === "NoteReleasedOnTime" && released.target.opportunityIndex).toBe(2);
  });

  it("signs the delta so an early release is negative", () => {
    const target = levelTargets(1)[2]!;
    const harness = makeJudge(levelTargets(1));
    const id = harness.play(target.midi, target.startBeat);
    harness.judge.release(id, end(target) - 0.3);
    const released = harness.events.find((event) => event.type === "NoteReleasedOnTime");
    expect(released?.type === "NoteReleasedOnTime" && released.beatDelta).toBeCloseTo(-0.3, 9);
  });

  it("accepts anything inside the target's own Good window of the end", () => {
    const targets = levelTargets(1);
    for (const offset of [-0.45, -0.2, 0, 0.2, 0.45]) {
      const target = targets[2]!;
      const harness = makeJudge(levelTargets(1));
      const id = harness.play(target.midi, target.startBeat);
      harness.judge.release(id, end(target) + offset);
      expect(harness.types()).toContain("NoteReleasedOnTime");
    }
  });

  it("says nothing about a note dropped or held far past the end", () => {
    const targets = levelTargets(1);
    for (const offset of [-0.75, 0.75]) {
      const target = targets[2]!;
      const harness = makeJudge(levelTargets(1));
      const id = harness.play(target.midi, target.startBeat);
      harness.judge.release(id, end(target) + offset);
      expect(harness.types()).not.toContain("NoteReleasedOnTime");
    }
  });

  it("says nothing about letting go of a wrong note", () => {
    const target = levelTargets(1)[2]!;
    const harness = makeJudge(levelTargets(1));
    // A semitone off: judged wrong, resolves nothing, so there is no target
    // whose end it could be released on time against.
    const id = harness.play(target.midi + 1, target.startBeat);
    harness.judge.release(id, end(target));
    expect(harness.types()).toEqual(["WrongNote"]);
  });

  it("says nothing about a release for a note it never saw attacked", () => {
    const harness = makeJudge(levelTargets(1));
    harness.judge.release("never-attacked", 1);
    expect(harness.types()).toEqual([]);
  });

  it("reports at most one release per played note", () => {
    const target = levelTargets(1)[2]!;
    const harness = makeJudge(levelTargets(1));
    const id = harness.play(target.midi, target.startBeat);
    harness.judge.release(id, end(target));
    harness.judge.release(id, end(target));
    harness.judge.release(id, end(target) + 5); // and not by taking another branch
    expect(harness.events.filter((event) => event.type === "NoteReleasedOnTime")).toHaveLength(1);
  });

  it("never resolves, re-resolves or reopens a target", () => {
    const targets = levelTargets(1);
    const harness = makeJudge(targets);
    const target = targets[2]!;
    const id = harness.play(target.midi, target.startBeat);
    const openBefore = harness.judge.openTargetCount;

    harness.judge.release(id, end(target));

    expect(harness.judge.openTargetCount).toBe(openBefore);
    expect(harness.judge.outcomes[2]).toBe("perfect");
    expect(harness.events.filter((event) => event.type === "TargetResolved")).toHaveLength(1);
  });

  it("cannot be earned by letting go of a note whose target was missed", () => {
    const targets = levelTargets(1);
    const harness = makeJudge(targets);
    const target = targets[2]!;
    // Right pitch, far too late: judged a wrong note, and its target expires.
    harness.judge.tick(target.startBeat + 0.6);
    const id = harness.play(target.midi, target.startBeat + 0.7);
    harness.judge.release(id, end(target));
    expect(harness.types()).not.toContain("NoteReleasedOnTime");
  });

  it("scores nothing", () => {
    const target = levelTargets(1)[2]!;
    const score = new AttemptScore({ streakBonusEligible: true });
    score.apply({ type: "PerfectNote", target, attackId: "a", playedMidi: target.midi, beatDelta: 0 });
    const before = score.snapshot;

    score.apply({ type: "NoteReleasedOnTime", target, attackId: "a", beatDelta: 0 });
    expect(score.snapshot).toEqual(before);
    expect(score.judgmentPoints).toBe(before.judgmentPoints);
  });
});

describe("dense subdivisions stay unambiguous", () => {
  it("assigns each eighth-note attack to its own target at L4", () => {
    const targets = levelTargets(4);
    const harness = makeJudge(targets);
    for (const target of targets) harness.play(target.midi, target.startBeat);

    expect(harness.events.filter((e) => e.type === "PerfectNote")).toHaveLength(targets.length);
    expect(harness.events.filter((e) => e.type === "WrongNote")).toHaveLength(0);
    expect(harness.judge.openTargetCount).toBe(0);
  });

  it("assigns a slightly-late eighth to the target it was aimed at, not the next", () => {
    const targets = levelTargets(4);
    const harness = makeJudge(targets);
    const target = targets[6]!;
    harness.play(target.midi, target.startBeat + 0.12);

    const good = harness.events.find((e) => e.type === "GoodNote");
    expect(good?.type === "GoodNote" && good.target.opportunityIndex).toBe(6);
  });

  it("does not let an eighth-note attack reach a target 0.5 beats away", () => {
    const targets = levelTargets(4);
    const harness = makeJudge(targets);
    // Play target 7's pitch at target 6's time. Too far for target 7's window.
    harness.play(targets[7]!.midi, targets[6]!.startBeat);
    expect(harness.types()).toEqual(["WrongNote"]);
  });

  it("reports the target the player should be aiming at", () => {
    const targets = levelTargets(1);
    const harness = makeJudge(targets);
    expect(harness.judge.currentTarget(0)?.opportunityIndex).toBe(0);
    harness.play(targets[0]!.midi, 0);
    expect(harness.judge.currentTarget(0.1)?.opportunityIndex).toBe(1);
  });
});

describe("score", () => {
  it("ranks Perfect above Good above Miss", () => {
    expect(SCORE_VALUES.perfect).toBeGreaterThan(SCORE_VALUES.good);
    expect(SCORE_VALUES.good).toBeGreaterThan(SCORE_VALUES.miss);
  });

  it("accumulates score and judgment points separately", () => {
    const score = new AttemptScore({ streakBonusEligible: false });
    const target = levelTargets(1)[0]!;
    score.apply({ type: "PerfectNote", target, attackId: "a", playedMidi: target.midi, beatDelta: 0 });
    score.apply({ type: "GoodNote", target, attackId: "b", playedMidi: target.midi, beatDelta: 0.3, reason: "timing" });
    score.apply({ type: "MissedNote", target });

    const snapshot = score.snapshot;
    expect(snapshot.score).toBe(SCORE_VALUES.perfect + SCORE_VALUES.good);
    expect(snapshot.judgmentPoints).toBe(JUDGMENT_POINTS.perfect + JUDGMENT_POINTS.good);
    expect(snapshot).toMatchObject({ perfect: 1, good: 1, missed: 1 });
  });

  it("breaks the streak on a miss and on a wrong note", () => {
    const score = new AttemptScore({ streakBonusEligible: false });
    const target = levelTargets(1)[0]!;
    const perfect = { type: "PerfectNote", target, attackId: "a", playedMidi: target.midi, beatDelta: 0 } as const;

    score.apply(perfect);
    score.apply(perfect);
    expect(score.snapshot.streak).toBe(2);

    score.apply({ type: "MissedNote", target });
    expect(score.snapshot.streak).toBe(0);

    score.apply(perfect);
    score.apply({ type: "WrongNote", attackId: "w", playedMidi: 44, atBeat: 1, diatonic: false, lanePosition: 0.5 });
    expect(score.snapshot.streak).toBe(0);
    expect(score.snapshot.bestStreak).toBe(2);
  });

  it("withholds the streak bonus on material that is not streak-eligible", () => {
    const target = levelTargets(1)[0]!;
    const perfect = { type: "PerfectNote", target, attackId: "a", playedMidi: target.midi, beatDelta: 0 } as const;

    const plain = new AttemptScore({ streakBonusEligible: false });
    const bonus = new AttemptScore({ streakBonusEligible: true });
    for (let i = 0; i < 10; i += 1) {
      plain.apply(perfect);
      bonus.apply(perfect);
    }
    expect(plain.score).toBe(10 * SCORE_VALUES.perfect);
    expect(bonus.score).toBeGreaterThan(plain.score);
    // ...and still tracks the streak either way.
    expect(plain.snapshot.streak).toBe(10);
  });
});

describe("stars", () => {
  const thresholds = ROCKY_ASCENT.levels.get(1)!.stars;

  it("earns stars as cumulative thresholds are crossed", () => {
    const meter = new StarMeter(thresholds);
    expect(meter.update(0)).toBe(0);
    expect(meter.update(thresholds.passThreshold - 1)).toBe(0);
    expect(meter.update(thresholds.passThreshold)).toBe(1);
    expect(meter.update(thresholds.star2Threshold)).toBe(2);
    expect(meter.update(thresholds.star3Threshold)).toBe(3);
  });

  it("never gives a star back", () => {
    const meter = new StarMeter(thresholds);
    meter.update(thresholds.star2Threshold);
    expect(meter.update(0)).toBe(2);
    expect(meter.stars).toBe(2);
  });

  it("fails the attempt at zero stars and passes from one", () => {
    const meter = new StarMeter(thresholds);
    expect(meter.passed).toBe(false);
    meter.update(thresholds.passThreshold);
    expect(meter.passed).toBe(true);
  });

  it("reaches three stars only on a flawless attempt", () => {
    const level = ROCKY_ASCENT.levels.get(1)!;
    const targets = levelTargets(1);

    const flawless = new AttemptScore({ streakBonusEligible: false });
    const oneScruffy = new AttemptScore({ streakBonusEligible: false });
    targets.forEach((target, i) => {
      flawless.apply({ type: "PerfectNote", target, attackId: `p${i}`, playedMidi: target.midi, beatDelta: 0 });
      if (i === 3) {
        oneScruffy.apply({ type: "GoodNote", target, attackId: `g${i}`, playedMidi: target.midi, beatDelta: 0.4, reason: "timing" });
      } else {
        oneScruffy.apply({ type: "PerfectNote", target, attackId: `p${i}`, playedMidi: target.midi, beatDelta: 0 });
      }
    });

    expect(new StarMeter(level.stars).update(flawless.judgmentPoints)).toBe(3);
    expect(new StarMeter(level.stars).update(oneScruffy.judgmentPoints)).toBe(2);
  });

  it("reports progress towards the next star for the meter fill", () => {
    const meter = new StarMeter(thresholds);
    expect(meter.progressToNextStar).toBe(0);
    meter.update(thresholds.passThreshold / 2);
    expect(meter.progressToNextStar).toBeCloseTo(0.5, 2);
    meter.update(thresholds.star3Threshold);
    expect(meter.progressToNextStar).toBe(1);
  });
});
