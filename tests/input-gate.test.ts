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
  AUTO_APPLY_MIN_HEADROOM,
  GATE_NOISE_MULTIPLE,
  InputGateMeasurement,
  MEASUREMENT_WINDOW_FRAMES,
  MIN_FLOOR_FRAMES,
  MIN_RMS_GATE,
  TUNINATOR_DEFAULT_RMS_GATE,
  gateChangesAnything,
  inputGateVerdict,
  shouldAutoApply,
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
    expect(inputGateVerdict(measurement.state)).toContain("Listening");
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

describe("the measurement window", () => {
  it("follows a rig that changes, instead of averaging it with its own past", () => {
    // The player turns their interface up. Their old level is history, and a
    // measurement that keeps averaging it in describes a rig that no longer
    // exists — which is the one thing this must not do, since turning the knob
    // is exactly what a player experimenting with this will try.
    const measurement = new InputGateMeasurement();
    for (let i = 0; i < MEASUREMENT_WINDOW_FRAMES; i += 1) {
      measurement.observe(i % 4 === 0 ? 0.00005 : 0.002);
    }
    const quiet = measurement.state.playingLevel!;

    for (let i = 0; i < MEASUREMENT_WINDOW_FRAMES; i += 1) {
      measurement.observe(i % 4 === 0 ? 0.0005 : 0.02);
    }
    const loud = measurement.state.playingLevel!;

    expect(quiet).toBeLessThan(0.005);
    expect(loud).toBeGreaterThan(0.015);
  });

  it("stays a fixed size however long it runs, while still counting frames", () => {
    const measurement = new InputGateMeasurement();
    const total = MEASUREMENT_WINDOW_FRAMES * 3 + 17;
    for (let i = 0; i < total; i += 1) measurement.observe(0.001);
    expect(measurement.frames).toBe(total);
    expect(measurement.state.floorFrames).toBe(MEASUREMENT_WINDOW_FRAMES);
  });

  it("gives the same answer read twice, and a new one after a new frame", () => {
    // The state is memoised because three readers want it per rendered frame.
    // A cache that outlived a new frame would freeze the readout.
    const measurement = rig(0.00005, 0.004);
    expect(measurement.state).toBe(measurement.state);
    const before = measurement.state;
    measurement.observe(0.004);
    expect(measurement.state).not.toBe(before);
  });
});

describe("deciding whether a gate is worth setting", () => {
  it("does not offer to set the gate it already set", () => {
    // `worthApplying` compares against Tuninator's default and stays true once
    // it is true, so on its own it would leave the button live forever.
    const state = rig(0.00005, 0.004).state;
    expect(state.worthApplying).toBe(true);
    expect(gateChangesAnything(state.recommended, null)).toBe(true);
    expect(gateChangesAnything(state.recommended, state.recommended)).toBe(false);
  });

  it("still offers a gate that is a real improvement on the one in force", () => {
    expect(gateChangesAnything(0.0004, 0.004)).toBe(true);
  });

  it("offers nothing when there is nothing to recommend", () => {
    expect(gateChangesAnything(null, null)).toBe(false);
  });
});

describe("calibrating without being asked", () => {
  it("sets itself from a clean quiet DI, which is the case it exists for", () => {
    const state = rig(0.00005, 0.004).state;
    expect(state.headroom).toBeGreaterThan(AUTO_APPLY_MIN_HEADROOM);
    expect(shouldAutoApply(state)).toBe(true);
  });

  it("leaves a rig with poor separation alone", () => {
    // This player's real fix is their interface knob. Moving the gate down for
    // them would push it into their own noise on their behalf, which is a worse
    // failure than the one it is trying to fix.
    const state = rig(0.001, 0.002).state;
    expect(state.headroom).toBeLessThan(AUTO_APPLY_MIN_HEADROOM);
    expect(shouldAutoApply(state)).toBe(false);
  });

  it("waits for more playing than the button does", () => {
    // Two notes are enough for a player who has decided; they are not enough to
    // decide for them.
    const thin = rig(0.00005, 0.004, 200, 20).state;
    expect(thin.worthApplying).toBe(true);
    expect(shouldAutoApply(thin)).toBe(false);
    expect(shouldAutoApply(rig(0.00005, 0.004, 200, 200).state)).toBe(true);
  });

  it("does nothing for a rig the default already serves", () => {
    expect(shouldAutoApply(rig(0.002, 0.2).state)).toBe(false);
  });

  it("treats a digitally silent floor as the cleanest case, not a missing one", () => {
    // Null headroom means there was no measurable noise at all, so there is
    // nothing for a lower gate to let through.
    const state = rig(0, 0.004, 200, 200).state;
    expect(state.headroom).toBeNull();
    expect(shouldAutoApply(state)).toBe(true);
  });
});
