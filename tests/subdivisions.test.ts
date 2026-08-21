/**
 * Reading a phrase's rhythmic grid, which is what the drums signal.
 *
 * The assertions that matter here are about *timing*, not taste: the kit has to
 * start marking a grid before the phrase that needs it arrives, and has to be
 * still marking it while that phrase is played.
 */

import { describe, expect, it } from "vitest";

import {
  NO_SUBDIVISIONS,
  subdivisionKey,
  subdivisionsOf,
  unionSubdivisions,
} from "../src/game/subdivisions.js";
import { ROCKY_ASCENT, ROCKY_ASCENT_HIGH, SCENARIOS } from "../src/scenario/registry.js";
import type { NoteDuration, PromptEvent } from "../src/scenario/types.js";

/** A minimal prompt: `[startBeat, duration]` pairs, all of them notes. */
function prompt(...events: readonly (readonly [number, NoteDuration, number])[]): PromptEvent[] {
  return events.map(([startBeat, duration, durationBeats], index) => ({
    index,
    type: "note",
    duration,
    durationBeats,
    startBeat,
    measureIndex: Math.floor(startBeat / 4),
    beatWithinMeasure: startBeat % 4,
    degree: { degree: 1, octaveBand: 0 },
  }));
}

describe("subdivision detection", () => {
  it("finds nothing in a phrase that only lands on beats", () => {
    const found = subdivisionsOf(prompt([0, "quarter", 1], [1, "quarter", 1], [2, "half", 2]));
    expect(found.size).toBe(0);
  });

  it("finds eighths on the ands", () => {
    expect([...subdivisionsOf(prompt([0, "eighth", 0.5], [0.5, "eighth", 0.5]))]).toEqual([
      "eighth",
    ]);
  });

  it("finds sixteenths, and marks their eighths too", () => {
    // A sixteenth run passes through every `and` on its way; marking those is
    // the same grid stated more coarsely, not a second one.
    const found = subdivisionsOf(prompt([0.25, "sixteenth", 0.25]));
    expect(found.has("sixteenth")).toBe(true);
    expect(found.has("eighth")).toBe(true);
    expect(found.has("triplet")).toBe(false);
  });

  it("finds sixteenths from the note length even when the run starts on a beat", () => {
    const found = subdivisionsOf(prompt([0, "sixteenth", 0.25]));
    expect(found.has("sixteenth")).toBe(true);
  });

  it("finds triplets, and does not mistake them for a binary grid", () => {
    const found = subdivisionsOf(
      prompt([0, "quarter", 1 / 3], [1 / 3, "quarter", 1 / 3], [2 / 3, "quarter", 1 / 3])
    );
    expect(found.has("triplet")).toBe(true);
    expect(found.has("sixteenth")).toBe(false);
    expect(found.has("eighth")).toBe(false);
  });

  it("ignores rests — a rest is not a note opportunity", () => {
    const events = prompt([0, "quarter", 1]);
    events.push({ ...events[0]!, index: 1, type: "rest", startBeat: 1.5, degree: null });
    expect(subdivisionsOf(events).size).toBe(0);
  });

  it("unions several phrases, which is what the kit actually marks", () => {
    const union = unionSubdivisions(new Set(["eighth"]), new Set(["triplet"]), NO_SUBDIVISIONS);
    expect(union).toEqual(new Set(["eighth", "triplet"]));
  });

  it("keys a set stably, so 'changed' is cheap to test", () => {
    expect(subdivisionKey(new Set(["sixteenth", "eighth"]))).toBe("eighth+sixteenth");
    expect(subdivisionKey(new Set(["eighth", "sixteenth"]))).toBe("eighth+sixteenth");
    expect(subdivisionKey(NO_SUBDIVISIONS)).toBe("");
  });
});

describe("the shipped scenarios' grids", () => {
  it("reads Rocky Ascent's ladder: quarters, then eighths", () => {
    expect(subdivisionsOf(ROCKY_ASCENT.levels.get(1)!.prompt).size).toBe(0);
    expect(subdivisionsOf(ROCKY_ASCENT.levels.get(2)!.prompt).size).toBe(0);
    expect([...subdivisionsOf(ROCKY_ASCENT.levels.get(3)!.prompt)]).toEqual(["eighth"]);
    expect([...subdivisionsOf(ROCKY_ASCENT.levels.get(4)!.prompt)]).toEqual(["eighth"]);
  });

  it("warns an attempt early: L2's kit already marks L3's eighths", () => {
    // The player is on L2 (quarters) with L3 (eighths) queued. What they hear
    // is the union, which is the whole point of signalling ahead.
    const current = subdivisionsOf(ROCKY_ASCENT.levels.get(2)!.prompt);
    const next = subdivisionsOf(ROCKY_ASCENT.levels.get(3)!.prompt);
    expect(subdivisionKey(unionSubdivisions(current, next))).toBe("eighth");
    // ...and once L3 is the current attempt, its own grid keeps it marked.
    expect(subdivisionKey(unionSubdivisions(next, NO_SUBDIVISIONS))).toBe("eighth");
  });

  it("authors nothing off the binary grid yet, so the triplet voice stays silent", () => {
    // Not an assertion that triplets are unsupported — the channel is live and
    // unit-tested above. This pins that no shipped scenario triggers it, so a
    // future triplet exercise shows up as a deliberate change here.
    for (const scenario of SCENARIOS) {
      for (const [difficulty, level] of scenario.levels) {
        expect(
          subdivisionsOf(level.prompt).has("triplet"),
          `${scenario.id} L${difficulty}`
        ).toBe(false);
      }
    }
    expect(subdivisionsOf(ROCKY_ASCENT_HIGH.levels.get(6)!.prompt).has("eighth")).toBe(true);
  });
});
