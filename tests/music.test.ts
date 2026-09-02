import { describe, expect, it } from "vitest";

import { KEY_WEIGHTS, pickWeightedKey } from "../src/config/key-weighting.js";
import {
  ALL_LANES,
  DegreeTokenError,
  formatDegreeToken,
  laneIndexOf,
  LANE_COUNT,
  laneToDegreeRef,
  parseDegreeToken,
} from "../src/music/degrees.js";
import {
  degreeToMidi,
  isDiatonic,
  keyDisplayName,
  keyId,
  laneLabel,
  laneMidiNotes,
  keyShortName,
  laneOfMidi,
  lanePositionOfMidi,
  parseKeyName,
  tonicMidi,
  type RunKey,
} from "../src/music/keys.js";
import { midiToName, type PitchClassIndex } from "../src/music/pitch.js";
import { parseTempo, TEMPOS } from "../src/config/tempos.js";
import { ATTEMPT_REPEATS } from "../src/config/tuning.js";
import { phraseBeats, resolveTargets } from "../src/game/targets.js";
import { ROCKY_ASCENT } from "../src/scenario/registry.js";

const G_MINOR: RunKey = { tonic: 7, mode: "minor" };
const C_MAJOR: RunKey = { tonic: 0, mode: "major" };

describe("authored octave-band tokens", () => {
  it("reads the band prefix as a band, not as a flat", () => {
    expect(parseDegreeToken("3")).toEqual({ degree: 3, octaveBand: 0 });
    // The authored `b1` is "first degree, SECOND octave" -- the octave root,
    // not "flat one".
    expect(parseDegreeToken("b1")).toEqual({ degree: 1, octaveBand: 1 });
  });

  it("round-trips every lane", () => {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const ref = laneToDegreeRef(lane);
      expect(laneIndexOf(ref)).toBe(lane);
      expect(parseDegreeToken(formatDegreeToken(ref))).toEqual(ref);
    }
  });

  it("orders the 8 lanes as 1..7, b1", () => {
    expect(LANE_COUNT).toBe(8);
    expect(ALL_LANES.map(formatDegreeToken)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "b1",
    ]);
  });

  it("rejects tokens it cannot map instead of guessing", () => {
    // `b2`..`b7` and `c1` were the second-octave vocabulary of the retired
    // two-octave timeline. They must fail loudly rather than fold into the
    // lower octave, which would silently rewrite an authored exercise.
    for (const bad of ["", "8", "b2", "b7", "c1", "c2", "d1", "b8", "#3", "b", "1b"]) {
      expect(() => parseDegreeToken(bad)).toThrow(DegreeTokenError);
    }
  });
});

describe("transposition", () => {
  it("places the tonic in the octave starting at A2", () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const midi = tonicMidi({ tonic: tonic as PitchClassIndex, mode: "major" });
      expect(midi).toBeGreaterThanOrEqual(45);
      expect(midi).toBeLessThan(57);
    }
  });

  it("keeps the whole one-octave span inside a guitar's range", () => {
    for (const { key } of KEY_WEIGHTS) {
      const notes = laneMidiNotes(key);
      expect(notes).toHaveLength(8);
      expect(notes[0]).toBeGreaterThanOrEqual(45); // A2, fifth fret of the low E
      expect(notes[7]).toBeLessThanOrEqual(68); // G#4, well inside the neck
    }
  });

  it("produces the G natural-minor scale over one octave", () => {
    expect(laneMidiNotes(G_MINOR).map((m) => midiToName(m, true))).toEqual([
      "G3", "A3", "Bb3", "C4", "D4", "Eb4", "F4", "G4",
    ]);
  });

  it("produces the C major scale over one octave", () => {
    expect(laneMidiNotes(C_MAJOR).map((m) => midiToName(m))).toEqual([
      "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4",
    ]);
  });

  it("puts the two endpoint roots exactly one octave apart in every key", () => {
    for (const { key } of KEY_WEIGHTS) {
      const notes = laneMidiNotes(key);
      expect(notes[7]! - notes[0]!).toBe(12);
    }
  });

  it("resolves the same degree an octave apart across bands", () => {
    const low = degreeToMidi({ degree: 3, octaveBand: 0 }, G_MINOR);
    const high = degreeToMidi({ degree: 3, octaveBand: 1 }, G_MINOR);
    expect(high - low).toBe(12);
  });

  it("knows what is diatonic", () => {
    expect(isDiatonic(degreeToMidi({ degree: 3, octaveBand: 0 }, G_MINOR), G_MINOR)).toBe(true);
    // B natural is the major third -- not in G minor.
    expect(isDiatonic(59, G_MINOR)).toBe(false);
    expect(isDiatonic(59, C_MAJOR)).toBe(true);
  });

  it("maps played MIDI back to a lane, and off-scale notes to none", () => {
    expect(laneOfMidi(55, G_MINOR)).toBe(0); // G3, the tonic
    expect(laneOfMidi(67, G_MINOR)).toBe(7); // G4, the octave root
    expect(laneOfMidi(56, G_MINOR)).toBeNull(); // G#3, non-diatonic
    expect(laneOfMidi(43, G_MINOR)).toBeNull(); // G2, an octave below the span
  });

  it("places a non-diatonic pitch between the lanes it falls between", () => {
    const position = lanePositionOfMidi(56, G_MINOR); // G#3, between G3 and A3
    expect(position).toBeGreaterThan(0);
    expect(position).toBeLessThan(1);
    expect(lanePositionOfMidi(90, G_MINOR)).toBeNull();
  });
});

describe("lane labels", () => {
  it("shows the harmonic degree with its accidental, plus the note name", () => {
    // This `b3` IS a flat: it is the harmonic label, not the authored token.
    expect(laneLabel(2, G_MINOR)).toEqual({ degree: "b3", note: "Bb" });
    expect(laneLabel(5, G_MINOR)).toEqual({ degree: "b6", note: "Eb" });
    expect(laneLabel(0, G_MINOR)).toEqual({ degree: "1", note: "G" });
    expect(laneLabel(2, C_MAJOR)).toEqual({ degree: "3", note: "E" });
  });

  it("spells flat keys with flats and sharp keys with sharps", () => {
    expect(keyDisplayName({ tonic: 10, mode: "major" })).toBe("Bb major");
    expect(keyDisplayName({ tonic: 6, mode: "major" })).toBe("F# major");
    expect(keyDisplayName(G_MINOR)).toBe("G minor");
  });

  it("writes the short name the way a chart does: major unmarked, minor `m`", () => {
    expect(keyShortName({ tonic: 10, mode: "major" })).toBe("Bb");
    expect(keyShortName({ tonic: 10, mode: "minor" })).toBe("Bbm");
    expect(keyShortName({ tonic: 6, mode: "major" })).toBe("F#");
    expect(keyShortName(G_MINOR)).toBe("Gm");
  });

  it("spells the short name the same way the lanes do", () => {
    // A header reading `A#` over lanes labelled `Bb` would be the UI
    // disagreeing with itself about what note the player is looking at.
    for (const { key } of KEY_WEIGHTS) {
      const tonicLane = laneLabel(0, key);
      expect(keyShortName(key).replace(/m$/, "")).toBe(tonicLane.note);
    }
  });
});

describe("key weighting", () => {
  it("covers all 24 keys exactly once, each with a nonzero chance", () => {
    expect(KEY_WEIGHTS).toHaveLength(24);
    const ids = new Set(KEY_WEIGHTS.map((entry) => keyId(entry.key)));
    expect(ids.size).toBe(24);
    for (const entry of KEY_WEIGHTS) expect(entry.weight).toBeGreaterThan(0);
  });

  it("selects deterministically from an injected random source", () => {
    expect(keyId(pickWeightedKey(() => 0))).toBe(keyId(KEY_WEIGHTS[0]!.key));
    expect(keyId(pickWeightedKey(() => 0.999999))).toBe(keyId(KEY_WEIGHTS[23]!.key));
  });

  it("favours guitar-friendly keys without excluding awkward ones", () => {
    const weightOf = (id: string) =>
      KEY_WEIGHTS.find((entry) => keyId(entry.key) === id)?.weight ?? 0;
    expect(weightOf("A-minor")).toBeGreaterThan(weightOf("C#-major"));
    expect(weightOf("G-major")).toBeGreaterThan(weightOf("A#-minor"));
  });
});

describe("target resolution", () => {
  /** Notes in one pass at the authored phrase. An attempt plays several. */
  const L1_PHRASE_NOTES = 15;

  it("resolves Rocky Ascent L1 into the octave of the run key, then a second climb", () => {
    const level = ROCKY_ASCENT.levels.get(1)!;
    const targets = resolveTargets(level, G_MINOR).slice(0, L1_PHRASE_NOTES);
    // One full octave, then as much of a second climb as the bar allows.
    expect(targets.map((t) => t.midi)).toEqual([
      ...laneMidiNotes(G_MINOR),
      ...laneMidiNotes(G_MINOR).slice(0, 7),
    ]);
    expect(targets.map((t) => t.lane)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6]);
    expect(targets.map((t) => t.startBeat)).toEqual([...Array(L1_PHRASE_NOTES).keys()]);
  });

  it("plays that phrase again, a phrase-length later, in one attempt", () => {
    // The repeat is a rule of the game loop, not something a scenario authors:
    // an attempt is the phrase over again, so the player's first pass is the
    // read and the second is the performance.
    const level = ROCKY_ASCENT.levels.get(1)!;
    const targets = resolveTargets(level, G_MINOR);
    const span = phraseBeats(level);
    expect(targets).toHaveLength(L1_PHRASE_NOTES * ATTEMPT_REPEATS);

    const phrase = targets.slice(0, L1_PHRASE_NOTES);
    for (let pass = 1; pass < ATTEMPT_REPEATS; pass += 1) {
      const again = targets.slice(pass * L1_PHRASE_NOTES, (pass + 1) * L1_PHRASE_NOTES);
      expect(again.map((t) => t.midi)).toEqual(phrase.map((t) => t.midi));
      expect(again.map((t) => t.startBeat)).toEqual(phrase.map((t) => t.startBeat + pass * span));
      expect(again.map((t) => t.pass)).toEqual(again.map(() => pass));
      // The authored index repeats; the opportunity index does not, because the
      // judge and the timeline both key on it for the whole attempt.
      expect(again.map((t) => t.promptIndex)).toEqual(phrase.map((t) => t.promptIndex));
    }
    expect(targets.map((t) => t.opportunityIndex)).toEqual([...targets.keys()]);
  });

  it("skips rests and keeps opportunity indices contiguous", () => {
    const level = ROCKY_ASCENT.levels.get(6)!;
    const targets = resolveTargets(level, C_MAJOR);
    expect(targets).toHaveLength(30 * ATTEMPT_REPEATS);
    expect(targets.map((t) => t.opportunityIndex)).toEqual([
      ...Array(30 * ATTEMPT_REPEATS).keys(),
    ]);
    // The rest at prompt index 15 leaves a gap in promptIndex but not in
    // opportunityIndex.
    expect(targets[14]?.promptIndex).toBe(14);
    expect(targets[15]?.promptIndex).toBe(16);
    expect(targets[15]?.startBeat).toBe(8);
    // ...and the same gap, one phrase later, on the repeat.
    expect(targets[45]?.promptIndex).toBe(16);
    expect(targets[45]?.startBeat).toBe(8 + phraseBeats(level));
  });

  it("transposes the same authored level into every key without changing its shape", () => {
    const level = ROCKY_ASCENT.levels.get(5)!;
    for (const { key } of KEY_WEIGHTS) {
      const targets = resolveTargets(level, key);
      expect(targets).toHaveLength(23 * ATTEMPT_REPEATS);
      expect(targets.map((t) => t.lane)).toEqual(
        resolveTargets(level, C_MAJOR).map((t) => t.lane)
      );
      // Interval structure is key-independent; absolute pitch is not.
      const intervals = targets.map((t) => t.midi - targets[0]!.midi);
      const reference = resolveTargets(level, C_MAJOR);
      const majorish = key.mode === "major";
      if (majorish) {
        expect(intervals).toEqual(reference.map((t) => t.midi - reference[0]!.midi));
      }
    }
  });
});

describe("written key names", () => {
  it("reads the flat key a link asks for", () => {
    expect(parseKeyName("Eb")).toEqual({ tonic: 3, mode: "major" });
    expect(parseKeyName("eb")).toEqual({ tonic: 3, mode: "major" });
    expect(parseKeyName("Eb minor")).toEqual({ tonic: 3, mode: "minor" });
    expect(parseKeyName("ebm")).toEqual({ tonic: 3, mode: "minor" });
    expect(parseKeyName("eb-min")).toEqual({ tonic: 3, mode: "minor" });
    expect(parseKeyName("EbMajor")).toEqual({ tonic: 3, mode: "major" });
  });

  it("defaults to major, as a chord chart does", () => {
    expect(parseKeyName("G")).toEqual({ tonic: 7, mode: "major" });
    expect(parseKeyName("F#")).toEqual({ tonic: 6, mode: "major" });
  });

  it("accepts enharmonics as the pitch class they are, and spells them its own way", () => {
    const sharp = parseKeyName("D#")!;
    expect(sharp).toEqual(parseKeyName("Eb"));
    // Spelling on screen follows the key, not the request.
    expect(keyShortName(sharp)).toBe("Eb");
    expect(keyDisplayName(sharp)).toBe("Eb major");
  });

  it("wraps around the octave rather than falling off it", () => {
    expect(parseKeyName("Cb")).toEqual({ tonic: 11, mode: "major" });
    expect(parseKeyName("B#")).toEqual({ tonic: 0, mode: "major" });
  });

  it("round-trips every key it can display", () => {
    for (const { key } of KEY_WEIGHTS) {
      expect(parseKeyName(keyShortName(key))).toEqual(key);
      expect(parseKeyName(keyDisplayName(key))).toEqual(key);
    }
  });

  it("returns null for anything it cannot read", () => {
    for (const bad of ["", "H", "Eb7", "Eb dorian", "42", "Ebbb", "minor"]) {
      expect(parseKeyName(bad)).toBeNull();
    }
  });
});

describe("written tempo requests", () => {
  it("reads an id or a display name", () => {
    expect(parseTempo("ibex")).toBe("ibex");
    expect(parseTempo("Markhor GOAT")).toBe("markhor-goat");
    expect(parseTempo("markhor-goat")).toBe("markhor-goat");
    expect(parseTempo("baby lamb")).toBe("baby-lamb");
  });

  it("reads a bpm as the tempo choice nearest it", () => {
    expect(parseTempo("120")).toBe("ibex");
    expect(parseTempo("100")).toBe("cashmere");
    expect(parseTempo("300")).toBe("markhor-goat");
    expect(parseTempo("10")).toBe("baby-lamb");
  });

  it("maps every choice's own bpm back to itself", () => {
    for (const tempo of TEMPOS) {
      expect(parseTempo(String(tempo.bpm))).toBe(tempo.id);
      expect(parseTempo(tempo.id)).toBe(tempo.id);
    }
  });

  it("returns null for anything it cannot read", () => {
    for (const bad of ["", "presto", "-90", "fast"]) {
      expect(parseTempo(bad)).toBeNull();
    }
  });
});
