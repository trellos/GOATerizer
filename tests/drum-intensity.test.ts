/**
 * The drum-intensity ladder, and the rhythm variant a minigame selects.
 *
 * Two separable claims, tested separately:
 *
 *   1. **Selection.** A minigame's difficulty picks the rung and its authored
 *      notes pick the feel — and the selection is total, because it runs when a
 *      minigame starts and a throw there would end a run over a drum pattern.
 *   2. **The patterns themselves.** Everything the players and the mix depend
 *      on: a hit on every beat at every intensity, an audible high transient
 *      among them, velocities inside 0..1, nothing outside the loop, and a
 *      ladder that actually escalates instead of restating one bar louder.
 *
 * Plus one assertion about *content* rather than code: no authored level tests
 * triplets and sixteenths at once, because a minigame has exactly one feel.
 */

import { describe, expect, it } from "vitest";

import {
  BACKBEAT_PATTERN,
  MAX_INTENSITY,
  MIN_INTENSITY,
  RHYTHM_VARIANTS,
  drumIntensityName,
  drumPatternAt,
  drumPatternForAttempt,
  rhythmVariantFor,
  type DrumPattern,
  type RhythmVariant,
} from "../src/audio/drum-pattern.js";
import { BEATS_PER_MEASURE } from "../src/config/tuning.js";
import { subdivisionsOf } from "../src/game/subdivisions.js";
import { ROCKY_ASCENT, SCENARIOS } from "../src/scenario/registry.js";
import type { NoteDuration, PromptEvent } from "../src/scenario/types.js";

/** A minimal prompt: `[startBeat, duration, durationBeats]`, all of them notes. */
function prompt(...events: readonly (readonly [number, NoteDuration, number])[]): PromptEvent[] {
  return events.map(([startBeat, duration, durationBeats], index) => ({
    index,
    type: "note",
    duration,
    durationBeats,
    startBeat,
    measureIndex: Math.floor(startBeat / BEATS_PER_MEASURE),
    beatWithinMeasure: startBeat % BEATS_PER_MEASURE,
    degree: { degree: 1, octaveBand: 0 },
  }));
}

const INTENSITIES = [1, 2, 3, 4, 5, 6, 7] as const;

/** Every pattern the ladder can produce, plus the bare pulse. */
function everyPattern(): DrumPattern[] {
  const all = RHYTHM_VARIANTS.flatMap((variant) =>
    INTENSITIES.map((intensity) => drumPatternAt(intensity, variant))
  );
  return [...all, BACKBEAT_PATTERN];
}

/** Where in its beat a hit sits, as a fraction. Absorbs binary float error. */
function offsetWithinBeat(startBeat: number): number {
  return startBeat - Math.floor(startBeat + 1e-9);
}

function isNear(value: number, allowed: readonly number[]): boolean {
  return allowed.some((position) => Math.abs(value - position) < 1e-6);
}

function beatsOf(pattern: DrumPattern, voice: string): number[] {
  return pattern.hits
    .filter((hit) => hit.voice === voice)
    .map((hit) => hit.startBeat)
    .sort((a, b) => a - b);
}

describe("choosing the rhythm variant from the notes", () => {
  it("plays a quarter-note beat when the phrase only lands on beats", () => {
    // Nothing between the beats, because the exercise has nothing between the
    // beats. A subdivision the material does not contain is the drummer
    // counting something the player is not playing.
    expect(rhythmVariantFor(prompt([0, "quarter", 1], [1, "half", 2]))).toBe("quarters");
  });

  it("marks the eighths when the phrase has eighths in it", () => {
    const eighths = prompt([0, "eighth", 0.5], [0.5, "eighth", 0.5]);
    expect(subdivisionsOf(eighths).has("eighth")).toBe(true);
    expect(rhythmVariantFor(eighths)).toBe("eighth");
  });

  it("selects the sixteenth variant from a single sixteenth", () => {
    expect(rhythmVariantFor(prompt([0.25, "sixteenth", 0.25]))).toBe("sixteenth");
    // ...including one that starts on the beat, where only its length gives it
    // away.
    expect(rhythmVariantFor(prompt([0, "sixteenth", 0.25]))).toBe("sixteenth");
  });

  it("selects the triplet variant from a single triplet", () => {
    const triplets = prompt([0, "quarter", 1 / 3], [1 / 3, "quarter", 1 / 3]);
    expect(rhythmVariantFor(triplets)).toBe("triplet");
  });

  it("ignores rests, which are not note opportunities", () => {
    const events = prompt([0, "quarter", 1]);
    events.push({ ...events[0]!, index: 1, type: "rest", startBeat: 0.25, degree: null });
    expect(rhythmVariantFor(events)).toBe("quarters");
  });

  it("stays total on a phrase that should not exist, and picks triplets", () => {
    // A level containing both is a content bug (asserted below), but this runs
    // at the moment a minigame starts. Throwing would cost the player a run
    // over a drum pattern, so it picks — deterministically, and triplets,
    // because `subdivisionsOf` never infers a triplet from anything else while
    // it can infer a sixteenth from a note's length alone.
    const mixed = prompt([0.25, "sixteenth", 0.25], [1 + 1 / 3, "quarter", 1 / 3]);
    expect(subdivisionsOf(mixed).has("sixteenth")).toBe(true);
    expect(subdivisionsOf(mixed).has("triplet")).toBe(true);
    expect(() => rhythmVariantFor(mixed)).not.toThrow();
    expect(rhythmVariantFor(mixed)).toBe("triplet");
  });

  it("reads an empty phrase without complaint", () => {
    expect(rhythmVariantFor([])).toBe("quarters");
  });
});

describe("the authored content's one-feel-per-minigame rule", () => {
  it("never tests triplets and sixteenths in the same level", () => {
    // A minigame gets one beat and that beat has one feel, so a level that
    // asked for both would be asking the kit to state two grids at once — and
    // asking the player to count them. This is the check that keeps
    // `rhythmVariantFor`'s tie-break unreachable in practice.
    for (const scenario of SCENARIOS) {
      for (const [difficulty, level] of scenario.levels) {
        const grids = subdivisionsOf(level.prompt);
        expect(
          grids.has("triplet") && grids.has("sixteenth"),
          `${scenario.id} L${difficulty} mixes triplets and sixteenths`
        ).toBe(false);
      }
    }
  });
});

describe("selecting a beat for a minigame", () => {
  it("names the pattern by rung and feel, so a caller can tell it changed", () => {
    expect(drumPatternAt(4, "sixteenth").id).toBe("L4/sixteenth");
    expect(BACKBEAT_PATTERN.id).toBe("pulse");
  });

  it("takes the rung from the difficulty and the feel from the notes", () => {
    const quarters = ROCKY_ASCENT.levels.get(3)!;
    // Rocky Ascent L3 is a quarter-note ladder, at rung 3; L5 is where the
    // eighths arrive, and the rung follows the difficulty rather than the feel.
    expect(drumPatternForAttempt(quarters.difficulty, quarters.prompt).id).toBe("L3/quarters");
    const eighths = ROCKY_ASCENT.levels.get(5)!;
    expect(drumPatternForAttempt(eighths.difficulty, eighths.prompt).id).toBe("L5/eighth");
    expect(drumPatternForAttempt(6, prompt([0.25, "sixteenth", 0.25])).id).toBe("L6/sixteenth");
    expect(drumPatternForAttempt(1, prompt([1 / 3, "quarter", 1 / 3])).id).toBe("L1/triplet");
  });

  it("covers difficulty 1 through 7 with seven different rungs", () => {
    const names = new Set(INTENSITIES.map((intensity) => drumIntensityName(intensity)));
    expect(names.size).toBe(INTENSITIES.length);
    expect(MIN_INTENSITY).toBe(1);
    expect(MAX_INTENSITY).toBe(7);
  });

  it("clamps rather than throws for a difficulty off the ladder", () => {
    // Dev overrides, a future eighth rung, a bad scenario file: all of these
    // reach this function mid-run, and none of them may end the run.
    expect(drumPatternAt(0, "eighth").id).toBe("L1/eighth");
    expect(drumPatternAt(-3, "eighth").id).toBe("L1/eighth");
    expect(drumPatternAt(99, "eighth").id).toBe("L7/eighth");
    expect(drumPatternAt(3.4, "eighth").id).toBe("L3/eighth");
    expect(drumPatternAt(Number.NaN, "eighth").id).toBe("L1/eighth");
  });
});

describe("what every pattern guarantees", () => {
  it("loops every measure, dividing the bass's four-measure loop exactly", () => {
    for (const pattern of everyPattern()) {
      expect(pattern.loopBeats, pattern.id).toBe(BEATS_PER_MEASURE);
      expect((BEATS_PER_MEASURE * 4) % pattern.loopBeats).toBe(0);
    }
  });

  it("keeps every hit inside the loop and at a usable level", () => {
    for (const pattern of everyPattern()) {
      for (const hit of pattern.hits) {
        expect(hit.startBeat, pattern.id).toBeGreaterThanOrEqual(0);
        expect(hit.startBeat, pattern.id).toBeLessThan(pattern.loopBeats);
        expect(hit.velocity, pattern.id).toBeGreaterThan(0);
        expect(hit.velocity, pattern.id).toBeLessThanOrEqual(1);
      }
    }
  });

  it("puts a hat on every beat, so the pulse survives a small speaker", () => {
    // A kick is mostly sub-bass and a laptop throws that away. Measured on the
    // real output, dropping the on-beat hat took the peak above 800 Hz — where
    // small speakers start reproducing — from 0.49 down to 0.14: loud by the
    // numbers, inaudible in the room. That is true of the minimal rung too,
    // which is why "minimal" means sparse and not quiet.
    for (const pattern of everyPattern()) {
      // The straight feel's ornament is a hat too, so only the on-beat ones
      // are the pulse.
      expect(beatsOf(pattern, "hat").filter(Number.isInteger), pattern.id).toEqual([0, 1, 2, 3]);
      for (const beat of [0, 1, 2, 3]) {
        const hat = pattern.hits.find((hit) => hit.voice === "hat" && hit.startBeat === beat);
        expect(hat!.velocity, `${pattern.id} beat ${beat}`).toBeGreaterThanOrEqual(0.7);
      }
    }
  });

  it("marks the downbeat harder than the rest, so the measure has a top", () => {
    for (const pattern of everyPattern()) {
      const hat = (beat: number) =>
        pattern.hits.find((hit) => hit.voice === "hat" && hit.startBeat === beat)!;
      expect(hat(0).velocity, pattern.id).toBeGreaterThan(hat(1).velocity);
    }
  });

  it("keeps a kick on the downbeat and a snare on a backbeat at every rung", () => {
    for (const pattern of everyPattern()) {
      expect(beatsOf(pattern, "kick"), pattern.id).toContain(0);
      const snares = beatsOf(pattern, "snare");
      expect(snares.some((beat) => beat === 1 || beat === 2 || beat === 3), pattern.id).toBe(true);
    }
  });
});

describe("the rhythm variant reshapes the whole bar", () => {
  it("keeps a straight pattern on the eighth grid", () => {
    for (const intensity of INTENSITIES) {
      const pattern = drumPatternAt(intensity, "eighth");
      for (const hit of pattern.hits) {
        expect(isNear(offsetWithinBeat(hit.startBeat), [0, 0.5]), `L${intensity}`).toBe(true);
      }
    }
  });

  it("marks the e and the a with their own voice when the feel is sixteenths", () => {
    // The `and` stays a hat: a bar of sixteenths still has to divide into four
    // by ear, and doubling the tick onto the `and` would flatten it into an
    // undifferentiated stream.
    for (const intensity of INTENSITIES) {
      const pattern = drumPatternAt(intensity, "sixteenth");
      for (const hit of pattern.hits) {
        expect(isNear(offsetWithinBeat(hit.startBeat), [0, 0.25, 0.5, 0.75]), `L${intensity}`).toBe(
          true
        );
      }
      for (const beat of beatsOf(pattern, "tick")) {
        expect(isNear(offsetWithinBeat(beat), [0.25, 0.75]), `L${intensity}`).toBe(true);
      }
      expect(beatsOf(pattern, "tick").length, `L${intensity}`).toBeGreaterThanOrEqual(6);
    }
  });

  it("puts a triplet pattern on its own grid, which no binary one divides", () => {
    for (const intensity of INTENSITIES) {
      const pattern = drumPatternAt(intensity, "triplet");
      for (const hit of pattern.hits) {
        expect(isNear(offsetWithinBeat(hit.startBeat), [0, 1 / 3, 2 / 3]), `L${intensity}`).toBe(
          true
        );
      }
      expect(beatsOf(pattern, "trip").length, `L${intensity}`).toBeGreaterThanOrEqual(6);
    }
  });

  it("never sounds two feels at once, whatever the rung", () => {
    // The whole point of committing to one variant per minigame: the player
    // hears one grid, so the timbre that states it is unambiguous.
    for (const pattern of everyPattern()) {
      const voices = new Set(pattern.hits.map((hit) => hit.voice));
      expect(voices.has("tick") && voices.has("trip"), pattern.id).toBe(false);
    }
  });

  it("moves the pickups and the fill onto the variant's grid too", () => {
    // A pickup kick lands on the last slot of the beat: the `and` straight, the
    // `a` in sixteenths, the third partial in a shuffle. The fill follows the
    // same rule, which is what makes the top rung state the feel loudest.
    expect(beatsOf(drumPatternAt(4, "eighth"), "kick")).toContain(0.5);
    expect(beatsOf(drumPatternAt(4, "sixteenth"), "kick")).toContain(0.75);
    expect(
      beatsOf(drumPatternAt(4, "triplet"), "kick").some((beat) => Math.abs(beat - 2 / 3) < 1e-6)
    ).toBe(true);

    expect(beatsOf(drumPatternAt(7, "eighth"), "floor")).toEqual([3.5]);
    expect(beatsOf(drumPatternAt(7, "sixteenth"), "tom")).toEqual([3.25, 3.5]);
    expect(beatsOf(drumPatternAt(7, "sixteenth"), "floor")).toEqual([3.75]);
    expect(beatsOf(drumPatternAt(7, "triplet"), "tom")[0]).toBeCloseTo(3 + 1 / 3, 9);
    expect(beatsOf(drumPatternAt(7, "triplet"), "floor")[0]).toBeCloseTo(3 + 2 / 3, 9);
  });
});

describe("the ladder escalates", () => {
  const weight = (pattern: DrumPattern): number =>
    pattern.hits.reduce((sum, hit) => sum + hit.velocity, 0);

  it("adds something at every rung, in every feel", () => {
    // Not seven copies of one bar at rising volume: each rung has to be *more
    // drumming*. Hit count never falls and total energy always rises, so a
    // future retune cannot quietly flatten a step.
    for (const variant of RHYTHM_VARIANTS) {
      for (let intensity = MIN_INTENSITY + 1; intensity <= MAX_INTENSITY; intensity += 1) {
        const lower = drumPatternAt(intensity - 1, variant);
        const upper = drumPatternAt(intensity, variant);
        expect(upper.hits.length, `${variant} L${intensity}`).toBeGreaterThanOrEqual(
          lower.hits.length
        );
        expect(weight(upper), `${variant} L${intensity}`).toBeGreaterThan(weight(lower));
      }
    }
  });

  it("starts half-time and ends with the whole kit", () => {
    const minimal = drumPatternAt(1, "eighth");
    // One kick, one snare, and nothing that is not the pulse or the grid.
    expect(beatsOf(minimal, "kick")).toEqual([0]);
    expect(beatsOf(minimal, "snare")).toEqual([2]);
    expect(new Set(minimal.hits.map((hit) => hit.voice))).toEqual(new Set(["kick", "snare", "hat"]));

    const rage = drumPatternAt(7, "eighth");
    expect(beatsOf(rage, "crash")).toEqual([0, 2]);
    expect(beatsOf(rage, "ride")).toEqual([1, 3]);
    expect(beatsOf(rage, "kick")).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it("brings the backbeat in at rung 2 and keeps it from there", () => {
    for (const intensity of INTENSITIES.filter((value) => value >= 2)) {
      // On the beat only: the ghost snares of the higher rungs are not it.
      const backbeat = beatsOf(drumPatternAt(intensity, "eighth"), "snare").filter(
        Number.isInteger
      );
      expect(backbeat, `L${intensity}`).toEqual([1, 3]);
    }
  });

  it("holds cymbals and toms back for the rungs that need them", () => {
    for (const intensity of INTENSITIES) {
      const voices = new Set(drumPatternAt(intensity, "eighth").hits.map((hit) => hit.voice));
      expect(voices.has("crash"), `L${intensity}`).toBe(intensity >= 6);
      expect(voices.has("ride"), `L${intensity}`).toBe(intensity >= 5);
      expect(voices.has("floor"), `L${intensity}`).toBe(intensity === 7);
    }
  });
});

describe("the bare pulse", () => {
  it("sounds nothing between the beats", () => {
    // Pregame, the timing check and the results screen have no phrase to have a
    // feel about, so anything between the beats would be a claim about nothing.
    const beats = [...new Set(BACKBEAT_PATTERN.hits.map((hit) => hit.startBeat))];
    expect(beats.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("puts the kick on 1 and 3 and the snare on 2 and 4, at full level", () => {
    expect(beatsOf(BACKBEAT_PATTERN, "kick")).toEqual([0, 2]);
    expect(beatsOf(BACKBEAT_PATTERN, "snare")).toEqual([1, 3]);
    // The player calibrates their rig against this, so it is not scaled down.
    const downbeatHat = BACKBEAT_PATTERN.hits.find(
      (hit) => hit.voice === "hat" && hit.startBeat === 0
    );
    expect(downbeatHat!.velocity).toBe(1);
  });
});

describe("what a variant is worth, per rung", () => {
  it("is the same groove in three feels, not three unrelated patterns", () => {
    // The rung decides the drumming; the variant decides the grid it is played
    // on. So the pulse — which is the part the player counts — must be
    // identical across all three feels of a rung.
    const pulseOf = (pattern: DrumPattern) =>
      pattern.hits
        .filter((hit) => Number.isInteger(hit.startBeat))
        .map((hit) => `${hit.startBeat}:${hit.voice}:${hit.velocity.toFixed(4)}`)
        .sort();

    for (const intensity of INTENSITIES) {
      const [first, ...rest] = RHYTHM_VARIANTS.map((variant: RhythmVariant) =>
        pulseOf(drumPatternAt(intensity, variant))
      );
      for (const other of rest) expect(other, `L${intensity}`).toEqual(first);
    }
  });
});
