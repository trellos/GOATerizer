/**
 * The pentatonic authored vocabulary: `p1..p6`, resolved to a diatonic lane
 * only once the run's mode is known.
 *
 * Two facts are pinned here. A pentatonic step is a *different* diatonic
 * degree in major and in minor — the whole reason the token exists — and the
 * vocabulary spans exactly the timeline's own octave, root to root, so nothing
 * authored in it ever needs moving to be drawn.
 */

import { describe, expect, it } from "vitest";

import {
  DegreeTokenError,
  formatDegreeToken,
  isPentatonic,
  laneIndexOf,
  LANE_COUNT,
  parseDegreeToken,
  resolveDegree,
} from "../src/music/degrees.js";
import { degreeToMidi, tonicMidi, type RunKey } from "../src/music/keys.js";

const C_MAJOR: RunKey = { tonic: 0, mode: "major" };
const C_MINOR: RunKey = { tonic: 0, mode: "minor" };

describe("pentatonic tokens", () => {
  it("reads the designer's six degrees as a step and an octave band", () => {
    expect(parseDegreeToken("p1")).toEqual({ pentatonic: 1, octaveBand: 0 });
    expect(parseDegreeToken("p5")).toEqual({ pentatonic: 5, octaveBand: 0 });
    // The sixth written degree is the root again, an octave up — the top lane.
    expect(parseDegreeToken("p6")).toEqual({ pentatonic: 1, octaveBand: 1 });
  });

  it("round-trips every written degree", () => {
    for (let n = 1; n <= 6; n += 1) {
      const ref = parseDegreeToken(`p${n}`);
      expect(isPentatonic(ref)).toBe(true);
      expect(formatDegreeToken(ref)).toBe(`p${n}`);
    }
  });

  it("does not mistake a pentatonic token for a diatonic one, or vice versa", () => {
    expect(isPentatonic(parseDegreeToken("3"))).toBe(false);
    expect(isPentatonic(parseDegreeToken("b1"))).toBe(false);
    expect(formatDegreeToken(parseDegreeToken("b1"))).toBe("b1");
  });

  it("rejects what it cannot map instead of guessing", () => {
    // `p7` is the interesting one: the old two-octave vocabulary went to p11,
    // and a scenario still written in it must fail loudly rather than resolve
    // to some other note.
    for (const bad of ["p0", "p7", "p11", "p", "pb1", "P6", "p6b"]) {
      expect(() => parseDegreeToken(bad)).toThrow(DegreeTokenError);
    }
  });
});

describe("pentatonic resolution", () => {
  it("is the major pentatonic in a major key: 1 2 3 5 6", () => {
    const degrees = [1, 2, 3, 4, 5].map((n) => resolveDegree(parseDegreeToken(`p${n}`), "major").degree);
    expect(degrees).toEqual([1, 2, 3, 5, 6]);
  });

  it("is the minor pentatonic in a minor key: 1 b3 4 5 b7", () => {
    const degrees = [1, 2, 3, 4, 5].map((n) => resolveDegree(parseDegreeToken(`p${n}`), "minor").degree);
    expect(degrees).toEqual([1, 3, 4, 5, 7]);
  });

  it("puts the same written lick on different lanes in major and minor", () => {
    // `5 1 2 1` — the Goat Frontman L1 lick. The 2 is the second degree in
    // major and the flat third in minor; a lane that did not move with the mode
    // would be asking for a note outside the key.
    const lick = ["p5", "p1", "p2", "p1"].map(parseDegreeToken);
    const major = lick.map((ref) => laneIndexOf(resolveDegree(ref, "major")));
    const minor = lick.map((ref) => laneIndexOf(resolveDegree(ref, "minor")));
    expect(major).not.toEqual(minor);
    expect(major[1]).toBe(0);
    expect(minor[1]).toBe(0);
    expect(major[2]).toBe(1); // 2
    expect(minor[2]).toBe(2); // b3
  });

  it("resolves every step to a pitch inside the key, and a lane inside the timeline", () => {
    for (const key of [C_MAJOR, C_MINOR]) {
      for (let n = 1; n <= 6; n += 1) {
        const degree = resolveDegree(parseDegreeToken(`p${n}`), key.mode);
        const midi = degreeToMidi(degree, key);
        expect(midi).toBeGreaterThanOrEqual(tonicMidi(key));
        expect(midi).toBeLessThanOrEqual(tonicMidi(key) + 12);
        expect(laneIndexOf(degree)).toBeGreaterThanOrEqual(0);
        expect(laneIndexOf(degree)).toBeLessThan(LANE_COUNT);
      }
    }
  });

  it("makes p1 the tonic and p6 the root an octave up — the two ends of the span", () => {
    for (const key of [C_MAJOR, C_MINOR]) {
      expect(degreeToMidi(resolveDegree(parseDegreeToken("p1"), key.mode), key)).toBe(tonicMidi(key));
      expect(degreeToMidi(resolveDegree(parseDegreeToken("p6"), key.mode), key)).toBe(tonicMidi(key) + 12);
      expect(laneIndexOf(resolveDegree(parseDegreeToken("p1"), key.mode))).toBe(0);
      expect(laneIndexOf(resolveDegree(parseDegreeToken("p6"), key.mode))).toBe(LANE_COUNT - 1);
    }
  });

  it("never moves a note to make it fit: the band above holds only the root", () => {
    // Constructed rather than parsed, because `p7` no longer parses — this is
    // the guard for anything that builds a ref by hand.
    expect(() => resolveDegree({ pentatonic: 3, octaveBand: 1 }, "major")).toThrow(DegreeTokenError);
  });

  it("passes a diatonic ref through untouched", () => {
    const ref = parseDegreeToken("b1");
    expect(resolveDegree(ref, "major")).toBe(ref);
    expect(resolveDegree(ref, "minor")).toBe(ref);
  });
});
