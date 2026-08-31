/**
 * Choosing the amplitude gate for a player's rig.
 *
 * The bug this closes, stated as a test: a guitarist feeding an amp sim keeps
 * their interface conservative, so their notes never cross Tuninator's default
 * 0.008 gate and the detector reports nothing — while the amp sim, which has no
 * gate, is perfectly happy with the same signal. Turning the interface up is the
 * only fix otherwise available and it clips the sim.
 */

import { describe, expect, it } from "vitest";

import {
  GATE_NOISE_MULTIPLE,
  InputGateMeasurement,
  MIN_FLOOR_FRAMES,
  MIN_RMS_GATE,
  TUNINATOR_DEFAULT_RMS_GATE,
  inputGateVerdict,
} from "../src/game/input-gate.js";

/** Frames from a rig: `count` of silence at `floor`, then `notes` of playing. */
function rig(floor: number, level: number, quiet = 200, notes = 80): InputGateMeasurement {
  const measurement = new InputGateMeasurement();
  for (let i = 0; i < quiet; i += 1) measurement.observe(floor * (0.9 + (i % 5) * 0.05));
  for (let i = 0; i < notes; i += 1) measurement.observe(level * (0.8 + (i % 7) * 0.06));
  return measurement;
}

describe("measuring a rig", () => {
  it("says nothing until it has heard enough", () => {
    const measurement = new InputGateMeasurement();
    for (let i = 0; i < MIN_FLOOR_FRAMES - 1; i += 1) measurement.observe(0.0001);
    expect(measurement.state.recommended).toBeNull();
    expect(inputGateVerdict(measurement.state)).toBe("Listening…");
  });

  it("asks for notes when it has only heard silence", () => {
    const measurement = new InputGateMeasurement();
    for (let i = 0; i < 200; i += 1) measurement.observe(0.0001);
    const state = measurement.state;
    expect(state.noiseFloor).toBeGreaterThan(0);
    expect(state.playingLevel).toBeNull();
    expect(inputGateVerdict(state)).toContain("Play a few notes");
  });

  it("finds the floor and the playing level of a quiet clean DI", () => {
    // The reported case: a signal an amp sim reads fine, well clear of its own
    // noise, and entirely below Tuninator's default gate.
    const state = rig(0.00005, 0.004).state;
    expect(state.noiseFloor).toBeCloseTo(0.000045, 5);
    expect(state.playingLevel).toBeGreaterThan(0.003);
    expect(state.playingLevel).toBeLessThan(TUNINATOR_DEFAULT_RMS_GATE);
    expect(state.headroom).toBeGreaterThan(50);
  });

  it("recommends a gate under the player's notes and over their noise", () => {
    const floor = 0.00005;
    const level = 0.004;
    const state = rig(floor, level).state;
    expect(state.recommended).not.toBeNull();
    expect(state.recommended!).toBeGreaterThan(state.noiseFloor!);
    expect(state.recommended!).toBeLessThan(state.playingLevel!);
    expect(state.worthApplying).toBe(true);
  });

  it("never recommends a gate above Tuninator's own default", () => {
    // A loud rig is already served by the default; this must not make a working
    // detector deafer than it was.
    for (const [floor, level] of [
      [0.002, 0.2],
      [0.01, 0.4],
      [0.05, 0.9],
    ]) {
      const state = rig(floor!, level!).state;
      expect(state.recommended ?? 0).toBeLessThanOrEqual(TUNINATOR_DEFAULT_RMS_GATE);
      expect(state.worthApplying).toBe(false);
    }
  });

  it("never recommends switching gating off altogether", () => {
    // Every gate it will actually write stays above the floor.
    for (const [floor, level] of [
      [0.00005, 0.004],
      [1e-6, 0.0008],
      [0, 0.1],
    ]) {
      const state = rig(floor!, level!).state;
      if (state.recommended !== null) {
        expect(state.recommended).toBeGreaterThanOrEqual(MIN_RMS_GATE);
      }
    }
  });

  it("refuses to recommend anything for a signal too quiet to gate", () => {
    // Where "under the notes" and "above the minimum gate" contradict, there is
    // no right answer and it says so rather than inventing one.
    const state = rig(1e-12, 1e-9).state;
    expect(state.recommended).toBeNull();
    expect(state.worthApplying).toBe(false);
    expect(inputGateVerdict(state)).toContain("too quiet to work with");
  });

  it("scales the gate to the signal when the input is digitally silent", () => {
    // A synthetic source has an exactly-zero floor. Without a signal-relative
    // term the gate collapses to the absolute minimum, which is safe but
    // unrelated to what the player plays.
    const state = rig(0, 0.1).state;
    expect(state.headroom).toBeNull();
    expect(state.recommended!).toBeGreaterThan(MIN_RMS_GATE);
    expect(state.recommended!).toBeLessThan(state.playingLevel!);
  });

  it("keeps the gate below the notes even when the noise is close to them", () => {
    // Noise x 8 would land above the playing level here, so the playing level
    // has to be what binds — a gate over the notes rejects the notes.
    const floor = 0.0004;
    const level = 0.0012;
    expect(floor * GATE_NOISE_MULTIPLE).toBeGreaterThan(level);
    const state = rig(floor, level).state;
    expect(state.recommended!).toBeLessThan(state.playingLevel!);
  });

  it("tells a player with a genuinely bad signal to turn the interface up", () => {
    // The one case software cannot fix: not enough separation to gate on.
    const state = rig(0.001, 0.002).state;
    expect(state.headroom).toBeLessThan(4);
    expect(inputGateVerdict(state)).toContain("Turn the interface up");
  });

  it("tells a player whose level is already fine that it is fine", () => {
    expect(inputGateVerdict(rig(0.002, 0.2).state)).toContain("level is fine");
  });

  it("forgets everything on reset, so a re-measure is a fresh one", () => {
    const measurement = rig(0.00005, 0.004);
    expect(measurement.frames).toBeGreaterThan(0);
    measurement.reset();
    expect(measurement.frames).toBe(0);
    expect(measurement.state.recommended).toBeNull();
  });

  it("ignores frames that are not real levels", () => {
    const measurement = new InputGateMeasurement();
    measurement.observe(Number.NaN);
    measurement.observe(-1);
    measurement.observe(Number.POSITIVE_INFINITY);
    expect(measurement.frames).toBe(0);
  });
});
