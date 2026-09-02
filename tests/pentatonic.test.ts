/**
 * The pentatonic authored vocabulary: `p1..p11`, resolved to a diatonic lane
 * only once the run's mode is known.
 *
 * Two facts are pinned here. A pentatonic step is a *different* diatonic
 * degree in major and in minor (the whole reason the token exists), and the
 * written low octave is currently folded up into the timeline's one octave —
 * provisionally, and in exactly one place.
 */

import { describe, expect, it } from "vitest";

import {
  DegreeTokenError,
  formatDegreeToken,
  isPentatonic,
  laneIndexOf,
  parseDegreeToken,
  PENTATONIC_LOW_OCTAVE_FOLDS_UP,
  resolveDegree,
} from "../src/music/degrees.js";
import { degreeToMidi, tonicMidi, type RunKey } from "../src/music/keys.js";

const C_MAJOR: RunKey = { tonic: 0, mode: "major" };
const C_MINOR: RunKey = { tonic: 0, mode: "minor" };

describe("pentatonic tokens", () => {
  it("reads the designer's eleven degrees as a step and a written octave", () => {
    expect(parseDegreeToken("p1")).toEqual({ pentatonic: 1, octaveBand: -1 });
    expect(parseDegreeToken("p5")).toEqual({ pentatonic: 5, octaveBand: -1 });
    expect(parseDegreeToken("p6")).toEqual({ pentatonic: 1, octaveBand: 0 });
    expect(parseDegreeToken("p10")).toEqual({ pentatonic: 5, octaveBand: 0 });
    expect(parseDegreeToken("p11")).toEqual({ pentatonic: 1, octaveBand: 1 });
  });

  it("round-trips every written degree, low octave included", () => {
    for (let n = 1; n <= 11; n += 1) {
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
    for (const bad of ["p0", "p12", "p", "pb1", "P6", "p6b"]) {
      expect(() => parseDegreeToken(bad)).toThrow(DegreeTokenError);
    }
  });
});

describe("pentatonic resolution", () => {
  it("is the major pentatonic in a major key: 1 2 3 5 6", () => {
    const degrees = [6, 7, 8, 9, 10].map((n) => resolveDegree(parseDegreeToken(`p${n}`), "major").degree);
    expect(degrees).toEqual([1, 2, 3, 5, 6]);
  });

  it("is the minor pentatonic in a minor key: 1 b3 4 5 b7", () => {
    const degrees = [6, 7, 8, 9, 10].map((n) => resolveDegree(parseDegreeToken(`p${n}`), "minor").degree);
    expect(degrees).toEqual([1, 3, 4, 5, 7]);
  });

  it("puts the same written lick on different lanes in major and minor", () => {
    // `5 6 7 6` — the Goat Frontman L1 lick. The 7 is the second in major and
    // the flat third in minor; a lane that did not move with the mode would be
    // asking for a note outside the key.
    const lick = ["p5", "p6", "p7", "p6"].map(parseDegreeToken);
    const major = lick.map((ref) => laneIndexOf(resolveDegree(ref, "major")));
    const minor = lick.map((ref) => laneIndexOf(resolveDegree(ref, "minor")));
    expect(major).not.toEqual(minor);
    expect(major[1]).toBe(0);
    expect(minor[1]).toBe(0);
    expect(major[2]).toBe(1); // 2
    expect(minor[2]).toBe(2); // b3
  });

  it("resolves every step to a pitch inside the key", () => {
    for (const key of [C_MAJOR, C_MINOR]) {
      for (let n = 1; n <= 11; n += 1) {
        const midi = degreeToMidi(resolveDegree(parseDegreeToken(`p${n}`), key.mode), key);
        expect(midi).toBeGreaterThanOrEqual(tonicMidi(key));
        expect(midi).toBeLessThanOrEqual(tonicMidi(key) + 12);
      }
    }
  });

  it("makes p6 the tonic and p11 the root an octave up", () => {
    for (const key of [C_MAJOR, C_MINOR]) {
      expect(degreeToMidi(resolveDegree(parseDegreeToken("p6"), key.mode), key)).toBe(tonicMidi(key));
      expect(degreeToMidi(resolveDegree(parseDegreeToken("p11"), key.mode), key)).toBe(tonicMidi(key) + 12);
    }
  });

  it("folds the written low octave up into the timeline's octave, for now", () => {
    expect(PENTATONIC_LOW_OCTAVE_FOLDS_UP).toBe(true);
    // p5 is written a pentatonic step below the root; folded, it is the same
    // pitch class an octave up — the 6 in major (A over C), the b7 in minor (Bb).
    expect(degreeToMidi(resolveDegree(parseDegreeToken("p5"), "major"), C_MAJOR)).toBe(tonicMidi(C_MAJOR) + 9);
    expect(degreeToMidi(resolveDegree(parseDegreeToken("p5"), "minor"), C_MINOR)).toBe(tonicMidi(C_MINOR) + 10);
    // ...and it is the fold, not a different note: p5 and p10 land together.
    expect(resolveDegree(parseDegreeToken("p5"), "major")).toEqual(resolveDegree(parseDegreeToken("p10"), "major"));
  });

  it("passes a diatonic ref through untouched", () => {
    const ref = parseDegreeToken("b1");
    expect(resolveDegree(ref, "major")).toBe(ref);
    expect(resolveDegree(ref, "minor")).toBe(ref);
  });
});
