/**
 * Reading a phrase's rhythmic grid, which is what picks the drums' feel.
 *
 * The assertions that matter here are about the *reading*, not about taste: what
 * this returns chooses the rhythm variant of a whole minigame's beat
 * (`tests/drum-intensity.test.ts` covers that half), so mistaking a dotted
 * eighth figure for a straight one puts the kit in the wrong feel for eight
 * measures.
 */

import { describe, expect, it } from "vitest";

import { subdivisionsOf } from "../src/game/subdivisions.js";
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

});

describe("the shipped scenarios' grids", () => {
  it("reads Rocky Ascent's ladder: quarters, then eighths", () => {
    expect(subdivisionsOf(ROCKY_ASCENT.levels.get(1)!.prompt).size).toBe(0);
    expect(subdivisionsOf(ROCKY_ASCENT.levels.get(2)!.prompt).size).toBe(0);
    expect([...subdivisionsOf(ROCKY_ASCENT.levels.get(3)!.prompt)]).toEqual(["eighth"]);
    expect([...subdivisionsOf(ROCKY_ASCENT.levels.get(4)!.prompt)]).toEqual(["eighth"]);
  });

  it("selects the triplet feel from exactly one scenario, and nothing else", () => {
    // This used to assert that NO shipped scenario reached the triplet variant,
    // and said a future triplet exercise should show up here as a deliberate
    // change. Butt-Butt-BONK is that change: the variant was built, unit-tested
    // and never heard because nothing authored a triplet.
    for (const scenario of SCENARIOS) {
      for (const [difficulty, level] of scenario.levels) {
        expect(
          subdivisionsOf(level.prompt).has("triplet"),
          `${scenario.id} L${difficulty}`
        ).toBe(scenario.id === "butt_butt_bonk");
      }
    }
    expect(subdivisionsOf(ROCKY_ASCENT_HIGH.levels.get(6)!.prompt).has("eighth")).toBe(true);
  });
});
