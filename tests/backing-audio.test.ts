import { describe, expect, it } from "vitest";

import { generateBassLine } from "../src/audio/bass-line.js";
import { BACKBEAT_PATTERN, type DrumVoice } from "../src/audio/drum-pattern.js";
import { forEachLoopEvent } from "../src/audio/loop-scheduling.js";
import { BEATS_PER_MEASURE } from "../src/config/tuning.js";
import type { RunKey } from "../src/music/keys.js";

/** Collects the absolute beats a walk visits, in order. */
function walk<T extends { startBeat: number }>(
  events: readonly T[],
  loopBeats: number,
  from: number,
  to: number
): number[] {
  const seen: number[] = [];
  forEachLoopEvent(events, loopBeats, from, to, (_event, beat) => seen.push(beat));
  return seen.sort((a, b) => a - b);
}

describe("forEachLoopEvent", () => {
  const events = [{ startBeat: 0 }, { startBeat: 1 }, { startBeat: 2 }, { startBeat: 3 }];

  it("visits every event in the window once", () => {
    expect(walk(events, 4, 0, 4)).toEqual([1, 2, 3, 4]);
  });

  it("is half-open at the start, so advancing slices never double-schedules", () => {
    // This is how the players advance: `from` becomes the previous `to`. An
    // inclusive start would sound beat 4 twice.
    const first = walk(events, 4, 0, 4);
    const second = walk(events, 4, 4, 8);
    expect(first.filter((beat) => second.includes(beat))).toEqual([]);
    expect([...first, ...second]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("wraps across loop boundaries", () => {
    expect(walk(events, 4, 2.5, 5.5)).toEqual([3, 4, 5]);
  });

  it("maps an arbitrary far-future position onto the pattern", () => {
    // 1000 beats in, the pattern must still land on the same phase.
    expect(walk(events, 4, 1000, 1004)).toEqual([1001, 1002, 1003, 1004]);
  });

  it("handles a window shorter than the gap between events", () => {
    expect(walk(events, 4, 1.1, 1.9)).toEqual([]);
  });

  it("visits nothing for an empty or inverted window", () => {
    expect(walk(events, 4, 4, 4)).toEqual([]);
    expect(walk(events, 4, 8, 4)).toEqual([]);
  });

  it("survives a degenerate loop length instead of spinning forever", () => {
    expect(walk(events, 0, 0, 4)).toEqual([]);
  });

  it("walks a real bass line without dropping or duplicating a note", () => {
    const key: RunKey = { tonic: 0, mode: "major" };
    const line = generateBassLine(key, () => 0.5);
    const oneLoop = walk(line.notes, line.loopBeats, 0, line.loopBeats);
    expect(oneLoop).toHaveLength(line.notes.length);
    expect(new Set(oneLoop).size).toBe(line.notes.length);
  });
});

describe("backbeat pattern", () => {
  const at = (beat: number): DrumVoice[] =>
    BACKBEAT_PATTERN.hits.filter((hit) => hit.startBeat === beat).map((hit) => hit.voice);

  it("loops every measure, dividing the bass's four-measure loop exactly", () => {
    expect(BACKBEAT_PATTERN.loopBeats).toBe(BEATS_PER_MEASURE);
    expect((BEATS_PER_MEASURE * 4) % BACKBEAT_PATTERN.loopBeats).toBe(0);
  });

  it("puts the kick on 1 and 3 and the snare on 2 and 4", () => {
    expect(at(0)).toContain("kick");
    expect(at(2)).toContain("kick");
    expect(at(1)).toContain("snare");
    expect(at(3)).toContain("snare");
  });

  it("marks every eighth with a hat", () => {
    const hats = BACKBEAT_PATTERN.hits
      .filter((hit) => hit.voice === "hat")
      .map((hit) => hit.startBeat)
      .sort((a, b) => a - b);
    expect(hats).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it("accents downbeat hats over offbeat ones, so eighths group by ear", () => {
    const hat = (beat: number) =>
      BACKBEAT_PATTERN.hits.find((hit) => hit.voice === "hat" && hit.startBeat === beat);
    expect(hat(0)!.velocity).toBeGreaterThan(hat(0.5)!.velocity);
  });

  it("keeps every hit inside the loop and at a usable level", () => {
    for (const hit of BACKBEAT_PATTERN.hits) {
      expect(hit.startBeat).toBeGreaterThanOrEqual(0);
      expect(hit.startBeat).toBeLessThan(BACKBEAT_PATTERN.loopBeats);
      expect(hit.velocity).toBeGreaterThan(0);
      expect(hit.velocity).toBeLessThanOrEqual(1);
    }
  });
});
