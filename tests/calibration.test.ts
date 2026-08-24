/**
 * The timing check.
 *
 * The assertions that matter most here are about what the session *refuses* to
 * say: it must not report an offset from a warm-up bar, from too few notes, or
 * from a player who is not playing steadily enough for a middle to mean
 * anything. A calibration that confidently reports noise is worse than none,
 * because the player will apply it.
 */

import { describe, expect, it } from "vitest";

import {
  CALIBRATION_BPM,
  CalibrationSession,
  COUNT_IN_BARS,
  MAX_USABLE_SPREAD_MS,
  MIN_SAMPLES,
  TOTAL_BARS,
  WARMUP_BARS,
} from "../src/game/calibration.js";
import { BEATS_PER_MEASURE } from "../src/config/tuning.js";

const SECONDS_PER_BEAT = 60 / CALIBRATION_BPM;
const MS_PER_BEAT = SECONDS_PER_BEAT * 1000;
const FIRST_MEASURED_BEAT = (COUNT_IN_BARS + WARMUP_BARS) * BEATS_PER_MEASURE;

/** A session already advanced to the first measured beat. */
function measuring(startBeat = 40): CalibrationSession {
  const session = new CalibrationSession(startBeat, SECONDS_PER_BEAT);
  session.update(startBeat + FIRST_MEASURED_BEAT);
  return session;
}

/** Plays `count` notes, each `offsetMs` from its beat, starting where measuring does. */
function play(
  session: CalibrationSession,
  count: number,
  offsetMs: number | ((index: number) => number),
  startBeat = 40
): void {
  for (let i = 0; i < count; i += 1) {
    const off = typeof offsetMs === "number" ? offsetMs : offsetMs(i);
    const beat = startBeat + FIRST_MEASURED_BEAT + i + off / MS_PER_BEAT;
    session.update(startBeat + FIRST_MEASURED_BEAT + i);
    session.note(beat);
  }
}

describe("the check's phases", () => {
  it("counts in before it records anything", () => {
    const session = new CalibrationSession(40, SECONDS_PER_BEAT);
    expect(session.phase).toBe("countIn");
    session.note(40.5);
    expect(session.state.samples).toBe(0);
  });

  it("throws away the warm-up bar", () => {
    const session = new CalibrationSession(40, SECONDS_PER_BEAT);
    session.update(40 + COUNT_IN_BARS * BEATS_PER_MEASURE);
    expect(session.phase).toBe("warmUp");
    for (let i = 0; i < BEATS_PER_MEASURE; i += 1) {
      session.note(40 + COUNT_IN_BARS * BEATS_PER_MEASURE + i + 0.3);
    }
    expect(session.state.samples).toBe(0);
  });

  it("records through the measured bars and then stops", () => {
    const session = measuring();
    play(session, 4, 20);
    expect(session.state.samples).toBe(4);

    session.update(40 + TOTAL_BARS * BEATS_PER_MEASURE);
    expect(session.phase).toBe("done");
    session.note(40 + TOTAL_BARS * BEATS_PER_MEASURE + 0.1);
    expect(session.state.samples).toBe(4);
  });

  it("reports a bar number the player can follow", () => {
    const session = new CalibrationSession(40, SECONDS_PER_BEAT);
    expect(session.state).toMatchObject({ bar: 1, totalBars: TOTAL_BARS });
    session.update(40 + 2 * BEATS_PER_MEASURE);
    expect(session.state.bar).toBe(3);
    session.update(40 + 99);
    expect(session.state.bar).toBe(TOTAL_BARS);
  });

  it("does not run backwards on a stale frame", () => {
    const session = measuring();
    session.update(40 + FIRST_MEASURED_BEAT + 2);
    session.update(40); // an out-of-order frame
    expect(session.phase).toBe("measuring");
  });
});

describe("what the check measures", () => {
  it("finds a steady late offset", () => {
    const session = measuring();
    play(session, 16, (i) => 60 + (i % 3) - 1); // 59..61ms late
    const state = session.state;
    expect(state.offsetMs!).toBeCloseTo(60, 0);
    expect(state.spreadMs!).toBeLessThan(3);
    expect(state.usable).toBe(true);
    expect(state.worthApplying).toBe(true);
  });

  it("finds a steady early offset, with the sign the trim expects", () => {
    const session = measuring();
    play(session, 16, -35);
    // Negative is early, everywhere. A player who anticipates needs *less*
    // compensation, and the sign is what carries that.
    expect(session.state.offsetMs!).toBeCloseTo(-35, 6);
  });

  it("separates the rig from the player: same offset, different steadiness", () => {
    const steady = measuring();
    play(steady, 16, (i) => 50 + (i % 2 === 0 ? 5 : -5));
    const sloppy = measuring();
    play(sloppy, 16, (i) => 50 + (i % 2 === 0 ? 90 : -90));

    // The middle is the rig and it agrees; the spread is the playing and it
    // does not. That distinction is the whole point of the screen.
    expect(steady.state.offsetMs!).toBeCloseTo(50, 0);
    expect(sloppy.state.offsetMs!).toBeCloseTo(50, 0);
    expect(steady.state.usable).toBe(true);
    expect(sloppy.state.usable).toBe(false);
  });

  it("refuses to speak from too few notes", () => {
    const session = measuring();
    play(session, MIN_SAMPLES - 1, 60);
    expect(session.state.offsetMs).not.toBeNull();
    expect(session.state.usable).toBe(false);
  });

  it("refuses a spread too wide to describe a rig", () => {
    const session = measuring();
    play(session, 16, (i) => (i % 2 === 0 ? MAX_USABLE_SPREAD_MS + 20 : -MAX_USABLE_SPREAD_MS - 20));
    expect(session.state.usable).toBe(false);
  });

  it("says an already-accurate rig needs nothing", () => {
    const session = measuring();
    play(session, 16, (i) => (i % 2 === 0 ? 3 : -3));
    const state = session.state;
    expect(state.usable).toBe(true);
    // The offset is real and tiny. Applying it would be chasing noise, and the
    // ratio rule this replaced would have called a perfect rig "keep playing".
    expect(state.worthApplying).toBe(false);
  });

  it("has nothing to report before a note is played", () => {
    const state = measuring().state;
    expect(state.offsetMs).toBeNull();
    expect(state.spreadMs).toBeNull();
    expect(state.usable).toBe(false);
  });
});

describe("the fold-over, and unwrapping past it", () => {
  /**
   * The failure this exists to prevent: on a badly lagged rig every note sits
   * near the half-beat boundary, and a single noisy one lands the other side of
   * it. Rounding to the nearest beat would record that note as most of a beat
   * *early* — a 600ms error, in the wrong direction, dragged into the median.
   */
  it("keeps a stray note with its neighbours once an estimate exists", () => {
    const session = measuring();
    // 280ms late at 90bpm is 0.42 of a beat; the stray is 0.52, over the line.
    play(session, 16, (i) => (i === 12 ? 347 : 280));
    expect(session.state.offsetMs!).toBeCloseTo(280, 0);
    // Without unwrapping the stray would read as -320ms and blow the spread up.
    expect(session.state.spreadMs!).toBeLessThan(5);
  });

  it("still measures a rig lagged most of a beat", () => {
    const session = measuring();
    play(session, 16, 300);
    expect(session.state.offsetMs!).toBeCloseTo(300, 0);
    expect(session.state.usable).toBe(true);
  });

  it("cannot see past half a beat on the very first note, and does not pretend to", () => {
    const session = measuring();
    // One note, 0.6 beats late, with no estimate to unwrap against yet.
    play(session, 1, MS_PER_BEAT * 0.6);
    // It reads as early. That is the documented limit, and it is why the check
    // needs a run of notes rather than one — the next fifteen outvote it.
    expect(session.state.offsetMs!).toBeLessThan(0);
    expect(session.state.usable).toBe(false);
  });
});
