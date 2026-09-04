import { describe, expect, it } from "vitest";

import {
  FORESHADOW_FADE_BEATS,
  foreshadowArrowNudge,
  foreshadowOpacity,
  foreshadowX,
} from "../src/ui/timeline/foreshadow.js";

describe("the next-minigame notice", () => {
  it("stays pinned through the final measure", () => {
    for (let beat = 28; beat < 32; beat += 0.5) {
      expect(foreshadowX(900, 120, beat, 32)).toBe(900);
    }
  });

  it("scrolls away with the outgoing minigame at exactly the timeline's speed", () => {
    expect(foreshadowX(900, 120, 32, 32)).toBe(900);
    expect(foreshadowX(900, 120, 33, 32)).toBe(900 - 120);
    expect(foreshadowX(900, 120, 34.5, 32)).toBe(900 - 2.5 * 120);
  });

  it("fades in over half a beat and is invisible before its reveal", () => {
    expect(foreshadowOpacity(27.9, 28)).toBe(0);
    expect(foreshadowOpacity(28 + FORESHADOW_FADE_BEATS / 2, 28)).toBeCloseTo(0.5, 9);
    expect(foreshadowOpacity(30, 28)).toBe(1);
  });

  it("nudges the arrow once per beat, resting on the beat itself", () => {
    expect(foreshadowArrowNudge(10)).toBeCloseTo(0, 9);
    expect(foreshadowArrowNudge(10.5)).toBeCloseTo(1, 9);
    expect(foreshadowArrowNudge(11)).toBeCloseTo(0, 9);
  });
});
