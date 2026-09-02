/**
 * Latency measurement and compensation.
 *
 * Three pieces, all of them about the same number: how far the player's notes
 * land from the beat they were aiming at, what that says the compensation
 * should be, and remembering it between sessions.
 *
 * The sign convention is the whole point and is asserted repeatedly on purpose:
 * **positive is late**, everywhere, and the trim that cancels a late bias is a
 * larger positive trim. Getting that backwards doubles the error instead of
 * removing it, and it is not a mistake a green test suite should permit.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { offBeatMs, TimingDeltaLog } from "../src/game/timing-log.js";
import {
  MAX_LATENCY_TRIM_MS,
  readLatencyTrimMs,
  writeLatencyTrimMs,
} from "../src/persistence/latency.js";

const SECONDS_PER_BEAT = 60 / 120; // 0.5s — 500ms of headroom either way.

describe("distance from the nearest beat", () => {
  it("is zero on the beat, in any bar", () => {
    expect(offBeatMs(0, SECONDS_PER_BEAT)).toBe(0);
    expect(offBeatMs(37, SECONDS_PER_BEAT)).toBe(0);
  });

  it("is positive for late and negative for early", () => {
    expect(offBeatMs(4.1, SECONDS_PER_BEAT)).toBeCloseTo(50, 6);
    expect(offBeatMs(3.9, SECONDS_PER_BEAT)).toBeCloseTo(-50, 6);
  });

  it("scales with the tempo, because a beat is a duration", () => {
    // The same fraction of a beat is twice the milliseconds at half the tempo.
    expect(offBeatMs(1.1, 60 / 60)).toBeCloseTo(100, 6);
    expect(offBeatMs(1.1, 60 / 120)).toBeCloseTo(50, 6);
  });

  /**
   * The documented ceiling. Half a beat late is indistinguishable from half a
   * beat early, so a rig worse than that has to calibrate at a slower tempo.
   */
  it("folds over past half a beat", () => {
    expect(offBeatMs(1.6, SECONDS_PER_BEAT)).toBeCloseTo(-200, 6);
  });
});

describe("the timing delta log", () => {
  it("has nothing to say before it has samples", () => {
    const log = new TimingDeltaLog();
    expect(log.count).toBe(0);
    expect(log.median).toBeNull();
    expect(log.spread).toBeNull();
    expect(log.suggestedTrimMs(0)).toBeNull();
  });

  it("finds the bias through a fumbled note", () => {
    const log = new TimingDeltaLog();
    for (const sample of [38, 41, 40, 39, 42, 40, 400, 39]) log.record(sample);
    // A mean would be dragged to 85 by the fumble; the median is not.
    expect(log.median).toBeCloseTo(40, 6);
    expect(log.spread!).toBeLessThan(5);
  });

  it("suggests a trim that cancels the bias, additively", () => {
    const log = new TimingDeltaLog();
    for (let i = 0; i < 10; i += 1) log.record(30);
    // Playing 30ms late under 40ms of compensation needs 70, not 30.
    expect(log.suggestedTrimMs(40)).toBe(70);
    // And an early player needs less compensation, not more.
    const early = new TimingDeltaLog();
    for (let i = 0; i < 10; i += 1) early.record(-25);
    expect(early.suggestedTrimMs(40)).toBe(15);
  });

  it("says the spread is as wide as the bias when the player is not steady", () => {
    const log = new TimingDeltaLog();
    for (const sample of [-60, 70, -50, 80, -70, 60]) log.record(sample);
    // This is the "keep playing" case: there is a median, but it describes
    // nothing, and the spread is what says so.
    expect(log.spread!).toBeGreaterThan(Math.abs(log.median!));
  });

  it("forgets everything on a trim change, because the rig changed", () => {
    const log = new TimingDeltaLog();
    for (let i = 0; i < 5; i += 1) log.record(30);
    log.clear();
    expect(log.count).toBe(0);
    expect(log.median).toBeNull();
  });

  it("keeps only the most recent samples", () => {
    const log = new TimingDeltaLog(4);
    for (const sample of [100, 100, 100, 100, 10, 10, 10, 10]) log.record(sample);
    expect(log.count).toBe(4);
    expect(log.median).toBe(10);
  });

  it("ignores a non-finite sample rather than poisoning the median", () => {
    const log = new TimingDeltaLog();
    log.record(20);
    log.record(Number.NaN);
    log.record(Number.POSITIVE_INFINITY);
    expect(log.count).toBe(1);
    expect(log.median).toBe(20);
  });
});

describe("remembering the calibration", () => {
  const store = new Map<string, string>();
  let original: Storage | undefined;

  beforeEach(() => {
    store.clear();
    original = globalThis.window?.localStorage;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
          removeItem: (key: string) => void store.delete(key),
        },
      },
    });
  });

  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, "window");
  });

  it("round-trips a trim", () => {
    writeLatencyTrimMs(64);
    expect(readLatencyTrimMs()).toBe(64);
  });

  it("rounds to whole milliseconds — the source is a median of noisy samples", () => {
    writeLatencyTrimMs(63.7);
    expect(readLatencyTrimMs()).toBe(64);
  });

  it("reads as uncalibrated when nothing was stored", () => {
    expect(readLatencyTrimMs()).toBeNull();
  });

  it("forgets on null, so the browser's own number stands alone", () => {
    writeLatencyTrimMs(64);
    writeLatencyTrimMs(null);
    expect(readLatencyTrimMs()).toBeNull();
  });

  it("refuses a stored value too large to be a real rig", () => {
    writeLatencyTrimMs(MAX_LATENCY_TRIM_MS + 1);
    // Written, but not honoured: a trim that big would put notes in the wrong
    // bar, and reading it back as "uncalibrated" is the safe failure.
    expect(readLatencyTrimMs()).toBeNull();
  });

  it("refuses a corrupt value", () => {
    store.set("goaterizer.latencyTrimMs.v1", "not a number");
    expect(readLatencyTrimMs()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => {
            throw new Error("denied");
          },
          setItem: () => {
            throw new Error("denied");
          },
          removeItem: () => {
            throw new Error("denied");
          },
        },
      },
    });
    expect(() => writeLatencyTrimMs(40)).not.toThrow();
    expect(readLatencyTrimMs()).toBeNull();
  });
});
