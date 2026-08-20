import { describe, expect, it } from "vitest";

import { generateBassLine } from "../src/audio/bass-line.js";
import { KEY_WEIGHTS } from "../src/config/key-weighting.js";
import { TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS } from "../src/config/tuning.js";
import { resolveTargets } from "../src/game/targets.js";
import {
  fingeringsForKey,
  formatFretPosition,
  OPEN_STRING_MIDI,
  STRING_NAMES,
} from "../src/music/fingering.js";
import { laneMidiNotes, type RunKey } from "../src/music/keys.js";
import { ROCKY_ASCENT } from "../src/scenario/registry.js";
import { TimelineModel } from "../src/ui/timeline/timeline-model.js";

const KEY: RunKey = { tonic: 7, mode: "minor" };

describe("fingerings", () => {
  it("offers at least one playable two-octave shape in every key", () => {
    for (const { key } of KEY_WEIGHTS) {
      const fingerings = fingeringsForKey(key);
      expect(fingerings.length).toBeGreaterThan(0);
      for (const fingering of fingerings) {
        expect(fingering.positions).toHaveLength(15);
      }
    }
  });

  it("maps every lane to a string and fret that produces that exact pitch", () => {
    for (const { key } of KEY_WEIGHTS) {
      const notes = laneMidiNotes(key);
      for (const fingering of fingeringsForKey(key)) {
        fingering.positions.forEach((position, lane) => {
          const open = OPEN_STRING_MIDI[position.stringIndex];
          expect(open).toBeDefined();
          expect((open as number) + position.fret).toBe(notes[lane]);
        });
      }
    }
  });

  it("keeps every shape inside a reachable stretch of neck", () => {
    for (const { key } of KEY_WEIGHTS) {
      for (const fingering of fingeringsForKey(key)) {
        expect(fingering.lowestFret).toBeGreaterThanOrEqual(0);
        expect(fingering.highestFret).toBeLessThanOrEqual(17);
        expect(fingering.highestFret - fingering.lowestFret).toBeLessThanOrEqual(7);
      }
    }
  });

  it("ascends across the strings rather than jumping about", () => {
    for (const fingering of fingeringsForKey(KEY)) {
      let previous = -1;
      for (const position of fingering.positions) {
        expect(position.stringIndex).toBeGreaterThanOrEqual(previous);
        previous = position.stringIndex;
      }
    }
  });

  it("writes positions in the design's <string><fret> notation", () => {
    expect(formatFretPosition({ stringIndex: 0, fret: 3 })).toBe("E3");
    expect(formatFretPosition({ stringIndex: 5, fret: 12 })).toBe("e12");
    expect(STRING_NAMES).toEqual(["E", "A", "D", "G", "B", "e"]);
  });
});

describe("timeline model", () => {
  const level = ROCKY_ASCENT.levels.get(1)!;
  const targets = resolveTargets(level, KEY);

  function model(): TimelineModel {
    const timeline = new TimelineModel(KEY);
    timeline.addTargets("a0", targets, 100);
    timeline.setBassLine(generateBassLine(KEY, () => 0.3));
    return timeline;
  }

  it("places targets at the attempt's absolute beat", () => {
    const snapshot = model().snapshot(100, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);
    expect(snapshot.targets[0]?.startBeat).toBe(100);
    expect(snapshot.targets[0]?.lane).toBe(0);
  });

  it("only reports what is inside the visible window", () => {
    const timeline = model();
    const early = timeline.snapshot(100, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);
    // Two beats of future, two of history. The attempt starts at 100, so
    // nothing precedes it and the window reaches targets 0-2.
    expect(early.targets.map((t) => t.startBeat)).toEqual([100, 101, 102]);

    const later = timeline.snapshot(108, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);
    // A quarter note starting on 105 still has its tail inside the window at
    // 106, so it is drawn -- a note leaves the screen when it ENDS, not when it
    // starts.
    expect(later.targets.map((t) => t.startBeat)).toEqual([105, 106, 107, 108, 109, 110]);
  });

  it("keeps two attempts' targets apart across a transition", () => {
    const timeline = model();
    timeline.addTargets("a1", targets, 117);
    const snapshot = timeline.snapshot(116, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);
    const keys = new Set(snapshot.targets.map((target) => target.attemptKey));
    expect(keys).toEqual(new Set(["a0", "a1"]));

    // A judgment on one attempt must not colour the other's note.
    timeline.markTargetOutcome("a1", 0, "perfect");
    const after = timeline.snapshot(117, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);
    const marked = after.targets.filter((target) => target.outcome === "perfect");
    expect(marked).toHaveLength(1);
    expect(marked[0]?.attemptKey).toBe("a1");

    timeline.removeTargets("a0");
    expect(
      timeline
        .snapshot(117, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS)
        .targets.every((target) => target.attemptKey === "a1")
    ).toBe(true);
  });

  it("unrolls the looping bass across the window without storing repeats", () => {
    const timeline = model();
    // Beat 100 is 4 loops of 16 plus 4 -- well past the authored 0..15.
    const snapshot = timeline.snapshot(100, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS);
    expect(snapshot.bass.length).toBeGreaterThan(0);
    for (const note of snapshot.bass) {
      expect(note.startBeat + note.durationBeats).toBeGreaterThanOrEqual(98);
      expect(note.startBeat).toBeLessThanOrEqual(102);
      // Placed by scale degree, so the ear learns the relationship.
      expect(note.lane).toBeGreaterThanOrEqual(0);
      expect(note.lane).toBeLessThanOrEqual(6);
    }
  });

  it("keeps a wrong played note visible, and off the clean lanes", () => {
    const timeline = model();
    timeline.addPlayed("p1", 44, 100.4); // G#2 is not in G minor
    timeline.markPlayedOutcome("p1", null, true);

    const played = timeline.snapshot(100, TIMELINE_FUTURE_BEATS, TIMELINE_HISTORY_BEATS).played;
    expect(played).toHaveLength(1);
    expect(played[0]?.wrong).toBe(true);
    expect(played[0]?.diatonic).toBe(false);
    // Between lane 0 and lane 1, not on either.
    expect(played[0]?.lanePosition).toBeGreaterThan(0);
    expect(played[0]?.lanePosition).toBeLessThan(1);
  });

  it("re-places a played note when the recognizer revises its pitch", () => {
    const timeline = model();
    timeline.addPlayed("p1", 44, 100);
    timeline.revisePlayed("p1", 43); // G2, the tonic
    const played = timeline.snapshot(100, 2, 2).played[0];
    expect(played?.midi).toBe(43);
    expect(played?.diatonic).toBe(true);
    expect(played?.lanePosition).toBe(0);
  });

  it("re-places played notes when the key is rerolled under them", () => {
    const timeline = model();
    timeline.addPlayed("p1", 43, 100);
    expect(timeline.snapshot(100, 2, 2).played[0]?.diatonic).toBe(true);
    // G is not in Db major (Db Eb F Gb Ab Bb C).
    timeline.setKey({ tonic: 1, mode: "major" });
    expect(timeline.snapshot(100, 2, 2).played[0]?.diatonic).toBe(false);
  });

  it("drops played notes once they are well past the left edge", () => {
    const timeline = model();
    timeline.addPlayed("p1", 43, 100);
    timeline.prune(103);
    expect(timeline.snapshot(103, 2, 2).played).toHaveLength(0);
  });

  it("grows a sounding note until it is released", () => {
    const timeline = model();
    timeline.addPlayed("p1", 43, 100);
    expect(timeline.snapshot(100.5, 2, 2).played[0]?.endBeat).toBeNull();
    timeline.endPlayed("p1", 101);
    expect(timeline.snapshot(101, 2, 2).played[0]?.endBeat).toBe(101);
    // A second release does not move the first one.
    timeline.endPlayed("p1", 102);
    expect(timeline.snapshot(101, 2, 2).played[0]?.endBeat).toBe(101);
  });
});
