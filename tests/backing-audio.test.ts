import { describe, expect, it } from "vitest";

import { generateBassLine } from "../src/audio/bass-line.js";
import { BACKBEAT_PATTERN, drumPatternFor, type DrumVoice } from "../src/audio/drum-pattern.js";
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

  it("sounds nothing between the beats when no subdivision is signalled", () => {
    // The pulse has to be unambiguous. Anything between the beats is a
    // *signal*, so an unsignalled bar must not contain one.
    const beats = [...new Set(BACKBEAT_PATTERN.hits.map((hit) => hit.startBeat))];
    expect(beats.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("puts a hat on every beat, so the pulse survives a small speaker", () => {
    // A kick is mostly sub-bass and a laptop throws that away. Measured on the
    // real output, dropping the on-beat hat took the peak above 800 Hz — where
    // small speakers start reproducing — from 0.49 down to 0.14: loud by the
    // numbers, inaudible in the room.
    const hats = BACKBEAT_PATTERN.hits
      .filter((hit) => hit.voice === "hat")
      .map((hit) => hit.startBeat)
      .sort((a, b) => a - b);
    expect(hats).toEqual([0, 1, 2, 3]);
  });

  it("accents the on-beat hat over the offbeat, so eighths group by ear", () => {
    const pattern = drumPatternFor(new Set(["eighth"]));
    const hat = (beat: number) =>
      pattern.hits.find((hit) => hit.voice === "hat" && hit.startBeat === beat);
    expect(hat(0)!.velocity).toBeGreaterThan(hat(0.5)!.velocity);
  });

  it("keeps every hit inside the loop and at a usable level", () => {
    for (const pattern of [
      BACKBEAT_PATTERN,
      drumPatternFor(new Set(["eighth", "sixteenth", "triplet"])),
    ]) {
      for (const hit of pattern.hits) {
        expect(hit.startBeat).toBeGreaterThanOrEqual(0);
        expect(hit.startBeat).toBeLessThan(pattern.loopBeats);
        expect(hit.velocity).toBeGreaterThan(0);
        expect(hit.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the quarter-note pulse whatever grid is signalled over it", () => {
    for (const grid of [["eighth"], ["sixteenth"], ["triplet"], ["sixteenth", "triplet"]] as const) {
      const pattern = drumPatternFor(new Set(grid));
      const pulse = pattern.hits
        .filter((hit) => hit.voice === "kick" || hit.voice === "snare")
        .map((hit) => hit.startBeat)
        .sort((a, b) => a - b);
      expect(pulse).toEqual([0, 1, 2, 3]);
    }
  });

  it("adds the ands to the hat line when eighths are signalled", () => {
    const hats = drumPatternFor(new Set(["eighth"]))
      .hits.filter((hit) => hit.voice === "hat")
      .map((hit) => hit.startBeat)
      .sort((a, b) => a - b);
    expect(hats).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it("marks the e and the a — not the and — when sixteenths are signalled", () => {
    // The `and` belongs to the eighth layer, which a sixteenth grid always
    // brings with it. Doubling it up would just make it louder, not clearer.
    const pattern = drumPatternFor(new Set(["eighth", "sixteenth"]));
    const ticks = pattern.hits
      .filter((hit) => hit.voice === "tick")
      .map((hit) => hit.startBeat)
      .sort((a, b) => a - b);
    expect(ticks).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]);
  });

  it("puts triplets on their own grid and their own voice", () => {
    const pattern = drumPatternFor(new Set(["triplet"]));
    const trips = pattern.hits
      .filter((hit) => hit.voice === "trip")
      .map((hit) => hit.startBeat)
      .sort((a, b) => a - b);
    expect(trips).toHaveLength(8);
    expect(trips[0]).toBeCloseTo(1 / 3, 9);
    expect(trips[1]).toBeCloseTo(2 / 3, 9);
  });

  it("sounds sixteenths and triplets together, without either losing its voice", () => {
    // They do not share a grid, so the only way to tell them apart is timbre.
    const pattern = drumPatternFor(new Set(["eighth", "sixteenth", "triplet"]));
    const voices = new Set(pattern.hits.map((hit) => hit.voice));
    expect(voices).toEqual(new Set(["kick", "snare", "hat", "tick", "trip"]));
  });
});
