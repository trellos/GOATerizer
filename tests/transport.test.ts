import { beforeEach, describe, expect, it } from "vitest";

import { generateBassLine } from "../src/audio/bass-line.js";
import { Transport } from "../src/audio/transport.js";
import { TIMELINE_FUTURE_BEATS } from "../src/config/tuning.js";
import { KEY_WEIGHTS } from "../src/config/key-weighting.js";
import { laneMidiNotes } from "../src/music/keys.js";
import { resolveTargets } from "../src/game/targets.js";
import { ROCKY_ASCENT } from "../src/scenario/registry.js";
import type { RunKey } from "../src/music/keys.js";

/** A hand-cranked stand-in for `AudioContext.currentTime`. */
class FakeClock {
  time = 0;
  readonly now = (): number => this.time;
  advance(seconds: number): void {
    this.time += seconds;
  }
}

describe("Transport", () => {
  let clock: FakeClock;
  let transport: Transport;

  beforeEach(() => {
    clock = new FakeClock();
    clock.time = 12.345; // a non-zero audio-clock origin, as a real one has
    transport = new Transport(clock.now);
    transport.start(120);
  });

  it("derives the beat from the clock rather than accumulating it", () => {
    expect(transport.beat).toBe(0);
    clock.advance(0.5);
    expect(transport.beat).toBeCloseTo(1, 12);
    clock.advance(7.5);
    expect(transport.beat).toBeCloseTo(16, 12);
  });

  it("does not drift over a long run", () => {
    // 10 minutes at 120bpm is 1200 beats, to the last floating-point bit.
    clock.advance(600);
    expect(transport.beat).toBeCloseTo(1200, 9);
  });

  it("round-trips beat <-> context time", () => {
    for (const beat of [0, 0.25, 3.5, 16, 63.75]) {
      expect(transport.beatAt(transport.contextTimeAt(beat))).toBeCloseTo(beat, 12);
    }
  });

  it("reports measures and position within a measure", () => {
    clock.advance(0.5 * 6); // 6 beats at 120bpm
    expect(transport.beat).toBeCloseTo(6, 12);
    expect(transport.measure).toBe(1);
    expect(transport.beatInMeasure).toBeCloseTo(2, 12);
  });

  it("finds the next measure boundary, and stays put when already on one", () => {
    expect(transport.nextMeasureBoundary(0)).toBe(0);
    expect(transport.nextMeasureBoundary(0.1)).toBe(4);
    expect(transport.nextMeasureBoundary(4)).toBe(4);
    expect(transport.nextMeasureBoundary(4.0001)).toBe(8);
  });

  describe("tempo change", () => {
    it("preserves the beat position exactly", () => {
      clock.advance(1.75); // 3.5 beats at 120
      const before = transport.beat;
      transport.setBpm(60);
      expect(transport.beat).toBeCloseTo(before, 12);
      expect(transport.beat).toBeCloseTo(3.5, 12);
    });

    it("preserves phase inside the four-measure loop", () => {
      clock.advance(0.5 * 18); // beat 18 -> phase 2 of a 16-beat loop
      transport.setBpm(140);
      expect(transport.beat % 16).toBeCloseTo(2, 9);
    });

    it("changes the rate from the moment of the change onwards", () => {
      transport.setBpm(60);
      clock.advance(1);
      expect(transport.beat).toBeCloseTo(1, 12); // 60bpm: one beat per second
      transport.setBpm(120);
      clock.advance(1);
      expect(transport.beat).toBeCloseTo(3, 12); // 120bpm: two more
    });

    it("survives every tempo in the game's list without a jump", () => {
      let expected = 0;
      for (const bpm of [60, 90, 106, 120, 140]) {
        transport.setBpm(bpm);
        expect(transport.beat).toBeCloseTo(expected, 9);
        clock.advance(2);
        expected += (2 * bpm) / 60;
      }
      expect(transport.beat).toBeCloseTo(expected, 9);
    });
  });

  it("refuses to restart a running transport", () => {
    expect(() => transport.start(90)).toThrow(/already running/);
  });
});

describe("target position on the timeline", () => {
  const clock = new FakeClock();
  const transport = new Transport(clock.now);
  transport.start(120, 0);

  it("puts a target on the strike line exactly at its authored beat", () => {
    const key: RunKey = { tonic: 7, mode: "minor" };
    const level = ROCKY_ASCENT.levels.get(1)!;
    const targets = resolveTargets(level, key);
    const attemptStartBeat = 8; // the attempt begins on some later measure

    for (const target of targets) {
      const absoluteBeat = attemptStartBeat + target.startBeat;
      const strikeTime = transport.contextTimeAt(absoluteBeat);
      // Position is (targetBeat - nowBeat): 0 at the strike line, +2 when it
      // enters on the right, -2 as it leaves on the left.
      const offsetAtStrike = absoluteBeat - transport.beatAt(strikeTime);
      expect(offsetAtStrike).toBeCloseTo(0, 12);

      const spawnTime = transport.contextTimeAt(absoluteBeat - TIMELINE_FUTURE_BEATS);
      expect(absoluteBeat - transport.beatAt(spawnTime)).toBeCloseTo(TIMELINE_FUTURE_BEATS, 12);
    }
  });

  it("keeps measure indices stable across the whole attempt", () => {
    const level = ROCKY_ASCENT.levels.get(4)!;
    const measures = level.prompt.map((event) => event.measureIndex);
    expect(new Set(measures)).toEqual(new Set([0, 1, 2, 3]));
    expect(measures).toEqual([...measures].sort((a, b) => a - b));
  });
});

describe("bass line", () => {
  it("plays one note per beat across four measures", () => {
    const line = generateBassLine({ tonic: 7, mode: "minor" }, () => 0.5);
    expect(line.loopBeats).toBe(16);
    expect(line.notes).toHaveLength(16);
    expect(line.notes.map((note) => note.startBeat)).toEqual([...Array(16).keys()]);
    expect(line.progression).toHaveLength(4);
  });

  it("starts each measure on its chord root", () => {
    const line = generateBassLine({ tonic: 0, mode: "major" }, () => 0);
    for (let measure = 0; measure < 4; measure += 1) {
      expect(line.notes[measure * 4]?.degree).toBe(line.progression[measure]);
    }
  });

  it("stays below the timeline's lowest lane in every key", () => {
    for (const { key } of KEY_WEIGHTS) {
      const lowestLane = laneMidiNotes(key)[0]!;
      for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
        for (const note of generateBassLine(key, () => roll).notes) {
          expect(note.midi).toBeLessThan(lowestLane);
          // A playable bass register: D1 up to D3, across all 24 keys.
          expect(note.midi).toBeGreaterThanOrEqual(26);
          expect(note.midi).toBeLessThanOrEqual(50);
        }
      }
    }
  });

  it("is deterministic for a given random source", () => {
    const a = generateBassLine({ tonic: 2, mode: "minor" }, () => 0.7);
    const b = generateBassLine({ tonic: 2, mode: "minor" }, () => 0.7);
    expect(a.notes).toEqual(b.notes);
  });
});
