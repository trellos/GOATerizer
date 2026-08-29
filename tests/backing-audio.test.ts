import { describe, expect, it } from "vitest";

import { generateBassLine } from "../src/audio/bass-line.js";
import { forEachLoopEvent } from "../src/audio/loop-scheduling.js";
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
