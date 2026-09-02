/**
 * What the pregame picker offers, and why the high strings are offered at all.
 *
 * `timeline-and-fingering.test.ts` checks that a fingering is *correct* — right
 * pitches, one hand position, roots on the named string. This file checks that
 * the set of fingerings is *useful*: that a player is shown the D and G string
 * wherever the neck can take them, that no two chips are the same place on the
 * neck wearing different fingerings, and that the row stays a row.
 */

import { describe, expect, it } from "vitest";

import { KEY_WEIGHTS } from "../src/config/key-weighting.js";
import { LANE_COUNT } from "../src/music/degrees.js";
import { fingeringsForKey, OPEN_STRING_MIDI, STRING_NAMES } from "../src/music/fingering.js";
import { keyDisplayName, laneMidiNotes, tonicMidi, type RunKey } from "../src/music/keys.js";

const ALL_KEYS: readonly RunKey[] = KEY_WEIGHTS.map((entry) => entry.key);

const E_STRING = 0;
const A_STRING = 1;
const D_STRING = 2;
const G_STRING = 3;

/**
 * The hard geometric law behind every count in this file.
 *
 * The low root of the octave has to be *on* the root string, so the string's
 * open pitch cannot be above it. The run's tonic lives in a fixed one-octave
 * register (`LOWEST_TONIC_MIDI`), which is why the D and G strings can only ever
 * serve part of the key set: no shape table can put a root on a string the key
 * does not reach.
 */
function canRootOn(key: RunKey, stringIndex: number): boolean {
  return tonicMidi(key) >= (OPEN_STRING_MIDI[stringIndex] as number);
}

function keysThatReach(stringIndex: number): RunKey[] {
  return ALL_KEYS.filter((key) => canRootOn(key, stringIndex));
}

function rootedOn(key: RunKey, stringIndex: number) {
  return fingeringsForKey(key).filter((fingering) => fingering.rootString === stringIndex);
}

describe("which strings the picker reaches", () => {
  it("never roots a shape on a string the key's octave cannot reach", () => {
    for (const key of ALL_KEYS) {
      for (const fingering of fingeringsForKey(key)) {
        // Not a style rule — a root below the open string would need a negative
        // fret. This is the constraint every count below is bounded by.
        expect(canRootOn(key, fingering.rootString)).toBe(true);
      }
    }
  });

  it("offers a D-rooted shape in every key whose octave reaches the D string", () => {
    const reachable = keysThatReach(D_STRING);
    // Seven of the twelve tonics sit at or above open D in the run register, so
    // fourteen of the 24 keys. The other ten are out of reach by construction,
    // not by omission.
    expect(reachable).toHaveLength(14);
    for (const key of reachable) {
      expect(rootedOn(key, D_STRING).length, keyDisplayName(key)).toBeGreaterThanOrEqual(1);
    }
  });

  it("offers a G-rooted shape in every key whose octave reaches the G string", () => {
    const reachable = keysThatReach(G_STRING);
    // Only two tonics — G and G#/Ab — put the run's root at or above the open G
    // string, so four keys. That ceiling is the register, not the shape table:
    // widening it means moving the octave the whole game is written in.
    expect(reachable).toHaveLength(4);
    for (const key of reachable) {
      expect(rootedOn(key, G_STRING).length, keyDisplayName(key)).toBeGreaterThanOrEqual(1);
    }
    // And nothing outside those four pretends otherwise.
    for (const key of ALL_KEYS) {
      if (canRootOn(key, G_STRING)) continue;
      expect(rootedOn(key, G_STRING), keyDisplayName(key)).toHaveLength(0);
    }
  });

  it("puts the low root at the one fret it can sit at, which on G is 0 or 1", () => {
    // The lane pitches are fixed, so a root string does not offer a *choice* of
    // fret for the low root — there is exactly one, and it is decided by the
    // register. This is why no distribution can invent a higher G position: the
    // 12th fret of the G string is the octave, not the tonic, and a shape
    // rooted there would draw the wrong pitches under the lanes.
    for (const key of ALL_KEYS) {
      for (const fingering of fingeringsForKey(key)) {
        const open = OPEN_STRING_MIDI[fingering.rootString] as number;
        expect(fingering.positions[0]?.fret, keyDisplayName(key)).toBe(tonicMidi(key) - open);
      }
      // On the G string that determined fret is never above the first.
      const onG = tonicMidi(key) - (OPEN_STRING_MIDI[G_STRING] as number);
      expect(onG, keyDisplayName(key)).toBeLessThanOrEqual(1);
    }
  });

  it("gives most D-reachable keys two D-string hand positions, not one", () => {
    // The improvement this shape table exists for. With only the two
    // three-string boxes, six keys offered a second D-rooted position; the
    // three-string `3-2-3` deal and the four-string spreads take that to twelve
    // of the fourteen keys that can reach the string at all.
    const withTwo = keysThatReach(D_STRING).filter((key) => rootedOn(key, D_STRING).length >= 2);
    expect(withTwo.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps the low strings offered too — this is a spread, not a swap", () => {
    for (const key of ALL_KEYS) {
      const roots = new Set(fingeringsForKey(key).map((fingering) => fingering.rootString));
      // Every key can be played from the A string; that shape must never be
      // thinned away in the name of variety.
      expect(roots.has(A_STRING), keyDisplayName(key)).toBe(true);
      expect(roots.size).toBeGreaterThanOrEqual(2);
    }
  });
});

/**
 * Every notes-per-string distribution that can *ever* fit a one-octave scale
 * inside five frets, found by exhaustive search over every way to deal eight
 * notes across two to six adjacent strings at up to eight notes on one string,
 * rooted on each of E/A/D/G, in all 24 keys. Five of the eight are shipped in
 * `SHAPES`; the other three are near-duplicates of ones that are.
 *
 * Reproduced here, independently of the module under test, so the tests below
 * can ask a question the module cannot answer about itself: is there a place on
 * the neck the player could stand that the picker is not offering?
 */
const EVERY_FITTING_DISTRIBUTION: readonly (readonly number[])[] = [
  [3, 3, 2], [2, 3, 3], [3, 2, 3],
  [2, 2, 3, 1], [2, 3, 2, 1], [1, 3, 2, 2], [1, 2, 3, 2], [1, 3, 3, 1],
];

const HIGHEST_USEFUL_FRET = 15;

/** Distinct hand positions — first-finger frets — reachable on one root string. */
function reachablePositions(key: RunKey, rootString: number): number[] {
  const laneNotes = laneMidiNotes(key);
  const positions = new Set<number>();

  for (const perString of EVERY_FITTING_DISTRIBUTION) {
    const frets: number[] = [];
    let note = 0;
    let playable = true;
    for (let s = 0; s < perString.length && playable; s += 1) {
      const open = OPEN_STRING_MIDI[rootString + s];
      if (open === undefined) {
        playable = false;
        break;
      }
      for (let n = 0; n < (perString[s] as number); n += 1) {
        const midi = laneNotes[note];
        if (midi === undefined) {
          playable = false;
          break;
        }
        const fret = midi - open;
        if (fret < 0 || fret > HIGHEST_USEFUL_FRET) {
          playable = false;
          break;
        }
        frets.push(fret);
        note += 1;
      }
    }
    if (!playable || note !== laneNotes.length) continue;
    const lowest = Math.min(...frets);
    // The five-fret window, which is load-bearing and never relaxed.
    if (Math.max(...frets) - lowest > 4) continue;
    positions.add(lowest);
  }

  return [...positions].sort((a, b) => a - b);
}

describe("the picker leaves no reachable place unoffered", () => {
  it("offers every hand position the G string can actually take", () => {
    // The headline fact, and the reason more distributions did not move the G
    // count. Across all 24 keys, eight G-rooted shapes fit the window — but they
    // stand in only five places, because on the G string the low root can only
    // sit at fret 0 or 1 (see the test above) and the neck offers nothing higher
    // that is still this key's tonic. The picker offers all five. The three it
    // drops are second fingerings of a place already on the row, not a place
    // the player is being denied.
    let reachable = 0;
    let offered = 0;
    for (const key of ALL_KEYS) {
      const places = reachablePositions(key, G_STRING);
      const shown = rootedOn(key, G_STRING).map((fingering) => fingering.lowestFret);
      expect(shown.sort((a, b) => a - b), keyDisplayName(key)).toEqual(places);
      reachable += places.length;
      offered += shown.length;
    }
    expect(reachable).toBe(5);
    expect(offered).toBe(reachable);
  });

  it("offers the outermost places every root string can take, in every key", () => {
    // The strongest form of the claim, and the one that would have caught the
    // real gap: for a while the shape table reached only some of the places the
    // neck can take, and nothing failed — the offers were all *valid*, just not
    // all there. Twenty places across sixteen keys were missing.
    //
    // `reachablePositions` is derived from the exhaustive distribution family
    // rather than from `SHAPES`, so this compares the picker against the
    // instrument, not against itself. The only licensed reason to show fewer is
    // the two-per-string cap, which keeps the outermost pair.
    for (const stringIndex of [E_STRING, A_STRING, D_STRING, G_STRING]) {
      for (const key of ALL_KEYS) {
        const places = reachablePositions(key, stringIndex);
        const expected =
          places.length <= 2 ? places : [places[0] as number, places[places.length - 1] as number];
        const shown = rootedOn(key, stringIndex)
          .map((fingering) => fingering.lowestFret)
          .sort((a, b) => a - b);
        expect(shown, `${keyDisplayName(key)} on ${STRING_NAMES[stringIndex]}`).toEqual(expected);
      }
    }
  });

  it("never invents a place the neck cannot take", () => {
    // The other half of the completeness claim. Every offered position must be
    // one some real deal actually reaches — a fingering that fits the diagram
    // but not the hand would pass every other test in this file.
    for (const stringIndex of [E_STRING, A_STRING, D_STRING, G_STRING]) {
      for (const key of ALL_KEYS) {
        const places = new Set(reachablePositions(key, stringIndex));
        for (const fingering of rootedOn(key, stringIndex)) {
          expect(
            places.has(fingering.lowestFret),
            `${keyDisplayName(key)} ${STRING_NAMES[stringIndex]}${fingering.lowestFret}`
          ).toBe(true);
        }
      }
    }
  });

  it("keeps the two D-string offers far enough apart to be a choice", () => {
    // Where the cap bites, it must not hand back two chips a fret apart. With
    // only the two original three-string boxes the pair averaged 2.17 frets;
    // `3-2-3`, `2-3-2-1` and especially `1-2-3-2` — which reaches furthest back
    // behind the root — widen that to 2.9 without costing a single extra chip.
    // Two keys (Eb major, D# minor) genuinely reach only frets 0 and 1 on the D
    // string and are honestly shown an adjacent pair, so this is a mean rather
    // than a floor.
    const spreads: number[] = [];
    for (const key of ALL_KEYS) {
      const shown = rootedOn(key, D_STRING)
        .map((fingering) => fingering.lowestFret)
        .sort((a, b) => a - b);
      if (shown.length === 2) spreads.push((shown[1] as number) - (shown[0] as number));
    }
    expect(spreads.length).toBeGreaterThanOrEqual(12);
    const mean = spreads.reduce((sum, s) => sum + s, 0) / spreads.length;
    expect(mean).toBeGreaterThan(2.5);
  });
});

describe("one chip per place on the neck", () => {
  it("never offers two shapes that put the hand in the same place", () => {
    for (const key of ALL_KEYS) {
      const places = fingeringsForKey(key).map(
        (fingering) => `${fingering.rootString}:${fingering.lowestFret}`
      );
      // Same root string, same first-finger fret: one answer to "where on the
      // neck", however differently the two deal the notes out.
      expect(new Set(places).size, keyDisplayName(key)).toBe(places.length);
    }
  });

  it("never offers more than two positions rooted on one string", () => {
    for (const key of ALL_KEYS) {
      for (const stringIndex of [E_STRING, A_STRING, D_STRING, G_STRING]) {
        expect(
          rootedOn(key, stringIndex).length,
          `${keyDisplayName(key)} on ${STRING_NAMES[stringIndex]}`
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it("keeps the chip row a row", () => {
    for (const key of ALL_KEYS) {
      const count = fingeringsForKey(key).length;
      // The row held at most six diagrams before this change and still does;
      // the new deals bought variety, not length.
      expect(count, keyDisplayName(key)).toBeGreaterThanOrEqual(2);
      expect(count, keyDisplayName(key)).toBeLessThanOrEqual(6);
    }
  });

  it("gives unique ids across a key's offering", () => {
    for (const key of ALL_KEYS) {
      const ids = fingeringsForKey(key).map((fingering) => fingering.id);
      expect(new Set(ids).size, keyDisplayName(key)).toBe(ids.length);
    }
  });
});

describe("four-string shapes", () => {
  it("actually offers some — that is how the high roots stay inside five frets", () => {
    const spans = new Set<number>();
    for (const key of ALL_KEYS) {
      for (const fingering of fingeringsForKey(key)) {
        spans.add(new Set(fingering.positions.map((position) => position.stringIndex)).size);
      }
    }
    expect(spans.has(4)).toBe(true);
    // Three or four adjacent strings; nothing else ever fits the window.
    expect([...spans].sort()).toEqual([3, 4]);
  });

  it("uses adjacent strings only, starting at the root string", () => {
    for (const key of ALL_KEYS) {
      for (const fingering of fingeringsForKey(key)) {
        const used = [
          ...new Set(fingering.positions.map((position) => position.stringIndex)),
        ].sort((a, b) => a - b);
        expect(used[0]).toBe(fingering.rootString);
        used.forEach((stringIndex, i) => {
          expect(stringIndex).toBe(fingering.rootString + i);
        });
        expect(used[used.length - 1]).toBeLessThanOrEqual(STRING_NAMES.length - 1);
      }
    }
  });

  it("never crowds more than three notes onto one string", () => {
    for (const key of ALL_KEYS) {
      for (const fingering of fingeringsForKey(key)) {
        const perString = new Map<number, number>();
        for (const position of fingering.positions) {
          perString.set(position.stringIndex, (perString.get(position.stringIndex) ?? 0) + 1);
        }
        expect([...perString.values()].reduce((sum, n) => sum + n, 0)).toBe(LANE_COUNT);
        // Tablature View's gutter is sized for a string name plus three fret
        // numbers. A four-note string would silently overflow it.
        for (const count of perString.values()) expect(count).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("labels", () => {
  it("names the root string, the shape, and the frets it actually uses", () => {
    for (const key of ALL_KEYS) {
      for (const fingering of fingeringsForKey(key)) {
        const match = /^Root on the (\S+) string, (.+) — frets (\d+)–(\d+)$/.exec(fingering.label);
        expect(match, fingering.label).not.toBeNull();
        const [, string, name, low, high] = match as RegExpExecArray;
        expect(string).toBe(STRING_NAMES[fingering.rootString]);
        expect(Number(low)).toBe(fingering.lowestFret);
        expect(Number(high)).toBe(fingering.highestFret);
        // A name a guitarist can act on, not a note-count code like `2-3-2-1`.
        expect(name).toMatch(/^[a-z][a-z -]+$/);
      }
    }
  });
});
