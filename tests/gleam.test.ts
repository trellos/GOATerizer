import { describe, expect, it } from "vitest";

import { GLEAM_PERIOD_BEATS, gleamIntensity, gleamPhase } from "../src/ui/timeline/gleam.js";

describe("the gleam on a Perfect note", () => {
  it("peaks exactly on the beat, and is dark half a beat either side", () => {
    const id = "a0-3";
    const beat = 100 + gleamPhase(id);
    expect(gleamIntensity(id, beat)).toBe(1);
    expect(gleamIntensity(id, beat - 0.25)).toBeCloseTo(0.5, 9);
    expect(gleamIntensity(id, beat + 0.25)).toBeCloseTo(0.5, 9);
    expect(gleamIntensity(id, beat - 0.5)).toBe(0);
    expect(gleamIntensity(id, beat + 0.5)).toBe(0);
  });

  it("gleams every other beat, never on the beat between", () => {
    const id = "a0-5";
    const beat = 40 + gleamPhase(id);
    expect(gleamIntensity(id, beat)).toBe(1);
    expect(gleamIntensity(id, beat + 1)).toBe(0);
    expect(gleamIntensity(id, beat + GLEAM_PERIOD_BEATS)).toBe(1);
    expect(gleamIntensity(id, beat - GLEAM_PERIOD_BEATS)).toBe(1);
  });

  it("does not gleam every note at once: the phase is the note's own", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `a1-${i}`);
    const phases = new Set(ids.map(gleamPhase));
    expect(phases).toEqual(new Set([0, 1]));
    // Two notes on opposite phases never peak on the same beat.
    const a = ids.find((id) => gleamPhase(id) === 0)!;
    const b = ids.find((id) => gleamPhase(id) === 1)!;
    for (let beat = 0; beat < 8; beat += 1) {
      expect(Math.min(gleamIntensity(a, beat), gleamIntensity(b, beat))).toBe(0);
    }
  });

  it("is stable: the same id gleams on the same beat every frame", () => {
    expect(gleamPhase("a3-7")).toBe(gleamPhase("a3-7"));
  });
});
