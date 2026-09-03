/**
 * The note editor's model.
 *
 * The editor's UI is a canvas and cannot be unit-tested usefully; everything it
 * actually decides can be, and is here. Two groups matter most:
 *
 *   - **the grid rules** — where a triplet may start, what rests spell a gap,
 *     which note survives an overlap, what a one-measure loop saves as;
 *   - **the round trip** — every level of every shipped scenario read onto the
 *     timeline and written back out has to produce the same notes and still load.
 *     That is the guarantee that opening a file in the editor cannot quietly
 *     damage it, and it is checked against the real authored data rather than a
 *     fixture, because the real data is what has triplets, pentatonic degrees
 *     and a one-pitch vocabulary in it.
 */

import { describe, expect, it } from "vitest";

import { ATTEMPT_REPEATS, JUDGMENT_POINTS, PHRASE_BEATS } from "../src/config/tuning.js";
import { loadScenario } from "../src/scenario/load.js";
import {
  SCENARIO_SOURCES,
  assetUrlResolver,
  scenarioById,
} from "../src/scenario/registry.js";
import { climbLevel } from "../src/scenario/minigames/climb-minigame.js";
import { EditorDocument } from "../src/editor/document.js";
import {
  DURATION_TICKS,
  PHRASE_TICKS,
  TICKS_PER_BEAT,
  TICKS_PER_MEASURE,
  inferLoopMeasures,
  isPlaceable,
  mergeNotes,
  notesOverrunningLoop,
  snapLoopMeasures,
  snapStart,
  spellRest,
  tileToPhrase,
  type EditorNote,
} from "../src/editor/grid.js";
import { buildLevel, starLadder, withLevel, withoutLevel } from "../src/editor/level.js";
import { notesFromPrompt, promptFromNotes } from "../src/editor/prompt.js";
import { laneVocabularyOf } from "../src/editor/vocabulary.js";

type Json = Record<string, unknown>;

const note = (startTick: number, lane: number, duration: EditorNote["duration"], id = startTick + 1): EditorNote => ({
  id,
  startTick,
  lane,
  duration,
});

/* -------------------------------------------------------------------------- */

describe("the tick grid", () => {
  it("is the same 12-tick grid the loader reads authored data on", () => {
    expect(TICKS_PER_BEAT).toBe(12);
    expect(DURATION_TICKS.sixteenth).toBe(3);
    expect(DURATION_TICKS.eighthTriplet).toBe(4);
    // The one fact that makes the grid worth having: a beat of triplets lands
    // on the next beat exactly, which three floats of 0.333 do not.
    expect(DURATION_TICKS.eighthTriplet * 3).toBe(TICKS_PER_BEAT);
    expect(PHRASE_TICKS).toBe(PHRASE_BEATS * TICKS_PER_BEAT);
  });

  it("snaps binary durations to sixteenths and triplets to thirds of a beat", () => {
    expect(snapStart(4, "quarter")).toBe(3);
    expect(snapStart(5, "quarter")).toBe(6);
    expect(snapStart(3, "eighthTriplet")).toBe(4);
    expect(snapStart(9, "eighthTriplet")).toBe(8);
    expect(snapStart(11, "eighthTriplet")).toBe(12);
  });

  it("keeps a note inside the phrase however far it is dragged", () => {
    expect(snapStart(1000, "quarter")).toBe(PHRASE_TICKS - DURATION_TICKS.quarter);
    expect(snapStart(-40, "sixteenth")).toBe(0);
    expect(isPlaceable(note(PHRASE_TICKS - 3, 0, "sixteenth"))).toBe(true);
    expect(isPlaceable(note(PHRASE_TICKS - 3, 0, "quarter"))).toBe(false);
    // On the grid of its own duration, and no other.
    expect(isPlaceable(note(3, 0, "eighthTriplet"))).toBe(false);
    expect(isPlaceable(note(4, 0, "eighthTriplet"))).toBe(true);
  });
});

describe("spelling a silence as rests", () => {
  it("uses the fewest rests that fit", () => {
    expect(spellRest(0, 12)).toEqual(["quarter"]);
    expect(spellRest(0, 48)).toEqual(["whole"]);
    expect(spellRest(0, 18)).toEqual(["quarter", "eighth"]);
  });

  it("keeps a short rest inside one beat and a long one on a beat", () => {
    // Six ticks from the middle of a beat is not an eighth rest: it would
    // straddle the beat line and read as the wrong rhythm.
    expect(spellRest(9, 15)).toEqual(["sixteenth", "sixteenth"]);
    expect(spellRest(3, 27)).toEqual(["sixteenth", "eighth", "quarter", "sixteenth"]);
  });

  it("spells a triplet gap in triplet rests", () => {
    expect(spellRest(0, 4)).toEqual(["eighthTriplet"]);
    expect(spellRest(4, 12)).toEqual(["eighthTriplet", "eighthTriplet"]);
  });

  it("refuses a gap no rest can express rather than rounding a rhythm", () => {
    // A sixteenth ending on tick 6 and a triplet starting on tick 8 leave two
    // ticks between them, and nothing written is two ticks long.
    expect(spellRest(6, 8)).toBeNull();
    expect(spellRest(0, 1)).toBeNull();
    expect(spellRest(0, 5)).toBeNull();
  });
});

describe("overlapping notes", () => {
  it("keeps the longer note, whatever lane either is on", () => {
    const quarter = note(0, 0, "quarter", 1);
    const sixteenth = note(3, 4, "sixteenth", 2);
    expect(mergeNotes([quarter], [sixteenth])).toEqual([quarter]);
    expect(mergeNotes([sixteenth], [quarter])).toEqual([quarter]);
  });

  it("lets the incoming note win a tie, so a drop replaces", () => {
    const was = note(0, 0, "quarter", 1);
    const now = note(0, 5, "quarter", 2);
    expect(mergeNotes([was], [now])).toEqual([now]);
  });

  it("leaves notes that merely touch alone", () => {
    const first = note(0, 0, "quarter", 1);
    const second = note(12, 1, "quarter", 2);
    expect(mergeNotes([first], [second])).toEqual([first, second]);
  });
});

describe("the loop handle", () => {
  const bar = [note(0, 0, "quarter", 1), note(6, 2, "eighth", 2)];

  it("snaps to one bar, two bars or the phrase", () => {
    expect(snapLoopMeasures(TICKS_PER_MEASURE * 0.7)).toBe(1);
    expect(snapLoopMeasures(TICKS_PER_MEASURE * 1.6)).toBe(2);
    expect(snapLoopMeasures(TICKS_PER_MEASURE * 3.2)).toBe(4);
  });

  it("repeats a one-bar loop across the four-measure phrase", () => {
    const tiled = tileToPhrase(bar, 1);
    expect(tiled).toHaveLength(8);
    expect(tiled.map((entry) => entry.startTick)).toEqual([0, 6, 48, 54, 96, 102, 144, 150]);
    expect(new Set(tiled.map((entry) => entry.id)).size).toBe(8);
  });

  it("leaves the phrase alone at four bars", () => {
    expect(tileToPhrase(bar, 4)).toEqual(bar);
  });

  it("drops nothing but reports a note that runs past the loop's own end", () => {
    const straddling = [note(TICKS_PER_MEASURE - 6, 0, "half", 9)];
    expect(notesOverrunningLoop(straddling, 1)).toHaveLength(1);
    expect(tileToPhrase(straddling, 1)).toHaveLength(0);
  });

  it("comes back where it must have been to produce the phrase", () => {
    expect(inferLoopMeasures(tileToPhrase(bar, 1))).toBe(1);
    expect(inferLoopMeasures(tileToPhrase(bar, 2))).toBe(2);
    expect(inferLoopMeasures([note(0, 0, "quarter"), note(60, 3, "quarter")])).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */

describe("the star ladder", () => {
  it("reproduces every threshold in every authored scenario exactly", () => {
    for (const scenario of SCENARIO_SOURCES) {
      const definition = scenarioById(scenario.id);
      expect(definition).toBeDefined();
      for (const [difficulty, level] of definition!.levels) {
        const ladder = starLadder(level.noteOpportunityCount);
        expect({ id: scenario.id, difficulty, ...ladder }).toEqual({
          id: scenario.id,
          difficulty,
          passThreshold: level.stars.passThreshold,
          star2Threshold: level.stars.star2Threshold,
          star3Threshold: level.stars.star3Threshold,
        });
      }
    }
  });

  it("puts three stars at every opportunity of the attempt taken at Perfect", () => {
    expect(starLadder(10).star3Threshold).toBe(10 * JUDGMENT_POINTS.perfect * ATTEMPT_REPEATS);
    // And the pass bar below a single clean pass, so the repeat can redeem.
    expect(starLadder(10).passThreshold).toBeLessThan(10 * JUDGMENT_POINTS.perfect);
  });
});

/* -------------------------------------------------------------------------- */

/** Every scenario, every level. The round trip runs over all of it. */
const EVERY_LEVEL: readonly { id: string; raw: Json; difficulty: number }[] =
  SCENARIO_SOURCES.flatMap((source) => {
    const raw = source.raw as Json;
    const levels = Object.keys((raw["levels"] ?? {}) as Json).map(Number);
    return levels.map((difficulty) => ({ id: source.id, raw, difficulty }));
  });

describe("reading and writing authored levels", () => {
  it("covers all seven scenarios", () => {
    expect(new Set(EVERY_LEVEL.map((entry) => entry.id)).size).toBe(7);
    expect(EVERY_LEVEL.length).toBeGreaterThan(30);
  });

  it.each(EVERY_LEVEL.map((entry) => [`${entry.id} L${entry.difficulty}`, entry] as const))(
    "%s survives a round trip through the timeline",
    (_name, entry) => {
      const vocabulary = laneVocabularyOf(entry.raw);
      const authored = ((entry.raw["levels"] as Json)[String(entry.difficulty)] as Json)["prompt"];

      const read = notesFromPrompt(authored, vocabulary);
      expect(read.problems).toEqual([]);
      expect(read.notes.length).toBeGreaterThan(0);

      const written = promptFromNotes(read.notes, inferLoopMeasures(read.notes), vocabulary);
      expect(written.problems).toEqual([]);

      // The notes come back identical: same lane, same written duration, same
      // position. Rest *spelling* may differ from the authored file — two eighth
      // rests where the editor writes a quarter — and that is the one thing the
      // round trip does not promise, because it is not musical content.
      const back = notesFromPrompt(written.events, vocabulary);
      expect(back.problems).toEqual([]);
      expect(back.notes.map(({ id: _id, ...rest }) => rest)).toEqual(
        read.notes.map(({ id: _id, ...rest }) => rest)
      );
    }
  );

  it.each(EVERY_LEVEL.map((entry) => [`${entry.id} L${entry.difficulty}`, entry] as const))(
    "%s still loads after being rebuilt by the editor",
    (_name, entry) => {
      const document = new EditorDocument(entry.raw, entry.difficulty);
      expect(document.readProblems).toEqual([]);
      const { raw, problems } = document.toScenario();
      expect(problems).toEqual([]);

      const before = loadScenario(entry.raw, assetUrlResolver(entry.raw));
      const after = loadScenario(raw!, assetUrlResolver(raw!));
      const wasLevel = before.levels.get(entry.difficulty)!;
      const isLevel = after.levels.get(entry.difficulty)!;

      expect(isLevel.noteOpportunityCount).toBe(wasLevel.noteOpportunityCount);
      expect(isLevel.authoredBeatCount).toBe(wasLevel.authoredBeatCount);
      expect(isLevel.stars).toEqual(wasLevel.stars);
      // Note-for-note, including the degree each one resolved to.
      expect(isLevel.prompt.filter((event) => event.type === "note").map(promptShape)).toEqual(
        wasLevel.prompt.filter((event) => event.type === "note").map(promptShape)
      );
    }
  );
});

describe("a timeline that cannot be written down", () => {
  const diatonic = laneVocabularyOf({
    runTransposition: { promptRepresentation: "diatonic_scale_degree" },
  });

  it("says so when a triplet and a sixteenth leave a gap no rest can spell", () => {
    // A sixteenth ending on tick 6, then a triplet starting on tick 8.
    const built = promptFromNotes(
      [note(0, 0, "sixteenth", 1), note(3, 0, "sixteenth", 2), note(8, 1, "eighthTriplet", 3)],
      4,
      diatonic
    );
    expect(built.events).toEqual([]);
    expect(built.problems[0]).toMatch(/no rest can spell/);
  });

  it("says so when two notes would sound at once", () => {
    const built = promptFromNotes([note(0, 0, "half", 1), note(6, 4, "quarter", 2)], 4, diatonic);
    expect(built.events).toEqual([]);
    expect(built.problems[0]).toMatch(/two notes sound at once/);
  });

  it("reads a prompt written in a vocabulary this timeline has no lane for", () => {
    // A pentatonic scenario read against diatonic lanes: `p3` is not a lane
    // here, and which one it would be depends on a mode nobody has rolled yet.
    const read = notesFromPrompt(
      [
        { type: "note", duration: "whole", scaleDegree: "p3" },
        { type: "rest", duration: "whole" },
        { type: "rest", duration: "whole" },
        { type: "rest", duration: "whole" },
      ],
      diatonic
    );
    expect(read.notes).toEqual([]);
    expect(read.problems[0]).toMatch(/not a lane/);
  });

  it("reads a prompt that is not four measures long", () => {
    const read = notesFromPrompt([{ type: "note", duration: "quarter", scaleDegree: "1" }], diatonic);
    expect(read.problems[0]).toMatch(/1 beats long/);
  });
});

function promptShape(event: {
  startBeat: number;
  duration: string;
  degree: unknown;
}): unknown {
  return { startBeat: event.startBeat, duration: event.duration, degree: event.degree };
}

/* -------------------------------------------------------------------------- */

describe("a family's own level data after an edit", () => {
  const rockyAscent = SCENARIO_SOURCES.find((source) => source.id === "rocky_ascent")!.raw as Json;

  it("keeps one climb waypoint per note opportunity when notes are removed", () => {
    const document = new EditorDocument(rockyAscent, 1);
    const before = document.notes.length;
    document.select(document.notes.slice(0, 3).map((entry) => entry.id));
    expect(document.deleteSelection()).toBe(true);

    const { raw } = document.toScenario();
    const scenario = loadScenario(raw!, assetUrlResolver(raw!));
    const level = scenario.levels.get(1)!;
    expect(level.noteOpportunityCount).toBe(before - 3);
    // `loadScenario` would have thrown otherwise — the count check is the
    // family's, in `parseLevel` — so this asserts the route was resampled, and
    // that it still starts and ends where the designer put it.
    const route = ((raw!["levels"] as Json)["1"] as Json)["visual"] as Json;
    const waypoints = (route["route"] as Json)["waypoints"] as unknown[];
    expect(waypoints).toHaveLength(before - 3);
    expect(climbLevel(level.data).visualSpanMeasures).toBe(4);
  });

  it("keeps a perform level's flourishes on notes that still exist", () => {
    const frontman = SCENARIO_SOURCES.find((source) => source.id === "goat_frontman")!.raw as Json;
    const document = new EditorDocument(frontman, 1);
    // L1 is a two-bar phrase played twice, so the editor opens it on a two-bar
    // loop. Widen it first: this is about the flourish filter, not the loop.
    document.setLoopMeasures(4);
    const flourishBeats = (
      ((frontman["levels"] as Json)["1"] as Json)["visual"] as Json
    )["flourishBeats"] as number[];
    expect(flourishBeats.length).toBeGreaterThan(0);

    // Delete the note the first flourish sits on.
    const doomed = document.notes.find(
      (entry) => entry.startTick === (flourishBeats[0] as number) * TICKS_PER_BEAT
    );
    expect(doomed).toBeDefined();
    document.select([doomed!.id]);
    document.deleteSelection();

    const { raw } = document.toScenario();
    const visual = ((raw!["levels"] as Json)["1"] as Json)["visual"] as Json;
    expect(visual["flourishBeats"]).toEqual(flourishBeats.slice(1));
    // And the crowd it promises follows the flourishes that are left.
    expect(visual["expectedCrowd"]).toBe(
      (flourishBeats.length - 1) * (visual["goatsPerFlourish"] as number) * ATTEMPT_REPEATS
    );
    expect(() => loadScenario(raw!, assetUrlResolver(raw!))).not.toThrow();
  });

  it("refuses to write a three-step level whose triplets do not group in threes", () => {
    const bonk = SCENARIO_SOURCES.find((source) => source.id === "butt_butt_bonk")!.raw as Json;
    const document = new EditorDocument(bonk, 1);
    document.select([document.notes[0]!.id]);
    document.deleteSelection();

    const { raw, problems } = document.toScenario();
    // The editor writes it — the prompt is legal on its own terms — and the
    // family refuses it, which is where that rule lives.
    expect(problems).toEqual([]);
    expect(() => loadScenario(raw!, assetUrlResolver(raw!))).toThrow(/groups of three/);
  });
});

/* -------------------------------------------------------------------------- */

describe("editing a timeline", () => {
  const rockyAscent = SCENARIO_SOURCES.find((source) => source.id === "rocky_ascent")!.raw as Json;

  it("places a quarter note where it is asked to", () => {
    const document = new EditorDocument(rockyAscent, 3);
    const placed = document.addNote(30, 5, "quarter");
    expect(placed).not.toBeNull();
    expect(placed!.startTick).toBe(30);
    expect(document.selection.has(placed!.id)).toBe(true);
  });

  it("will not place a note on a lane the scenario cannot play", () => {
    const canCrushing = SCENARIO_SOURCES.find((source) => source.id === "can_crushing")!.raw as Json;
    const document = new EditorDocument(canCrushing, 1);
    // Its whole vocabulary is scale degree 1: the performer stands at one lane.
    expect(document.laneAllowed(0)).toBe(true);
    expect(document.laneAllowed(4)).toBe(false);
    expect(document.addNote(24, 4, "quarter")).toBeNull();
  });

  it("moves a whole selection together and drops what leaves the timeline", () => {
    const document = new EditorDocument(rockyAscent, 1);
    const last = document.notes[document.notes.length - 1]!;
    const count = document.notes.length;
    document.select([last.id]);
    expect(document.moveSelection(PHRASE_TICKS, 0, false)).toBe("ok");
    expect(document.notes).toHaveLength(count - 1);
  });

  it("duplicates rather than moves when the drag is a ctrl-drag", () => {
    const document = new EditorDocument(rockyAscent, 1);
    const first = document.notes[0]!;
    const count = document.notes.length;
    document.select([first.id]);
    // One measure later, onto a beat nothing else occupies is not available in
    // a full phrase — so this lands on top of another note and the longer of
    // the two survives. Either way the source note is still there.
    expect(document.moveSelection(TICKS_PER_MEASURE, 0, true)).toBe("ok");
    expect(document.notes.some((entry) => entry.id === first.id)).toBe(true);
    expect(document.notes.length).toBeGreaterThanOrEqual(count);
  });

  it("refuses a group shift that would take a note off its own grid", () => {
    const bonk = SCENARIO_SOURCES.find((source) => source.id === "butt_butt_bonk")!.raw as Json;
    const document = new EditorDocument(bonk, 1);
    document.setLoopMeasures(4);
    // Its notes are triplets, on the 4-tick grid; a sixteenth is on the 3-tick
    // one. Move them together by a third of a beat and one of them has nowhere
    // legal to land.
    const sixteenth = document.addNote(45, 0, "sixteenth")!;
    document.select([sixteenth.id, document.notes[0]!.id]);
    expect(document.moveSelection(4, 0, false)).toBe("off-grid");
    // And the timeline is untouched — a refused move is not a half-move.
    expect(document.notes.some((entry) => entry.id === sixteenth.id)).toBe(true);
  });

  it("undoes the last edit, and only the last one", () => {
    const document = new EditorDocument(rockyAscent, 1);
    const original = document.notes.map((entry) => entry.id);
    document.select([document.notes[0]!.id]);
    document.deleteSelection();
    document.select([document.notes[0]!.id]);
    document.deleteSelection();
    expect(document.notes).toHaveLength(original.length - 2);
    expect(document.undo()).toBe(true);
    expect(document.notes).toHaveLength(original.length - 1);
    expect(document.undo()).toBe(true);
    expect(document.notes.map((entry) => entry.id)).toEqual(original);
    expect(document.undo()).toBe(false);
  });

  it("remembers notes outside a shrunken loop and gives them back", () => {
    const document = new EditorDocument(rockyAscent, 1);
    const all = document.notes.length;
    expect(document.loopMeasures).toBe(4);

    document.setLoopMeasures(1);
    expect(document.liveNotes().length).toBeLessThan(all);
    expect(document.rememberedNotes().length).toBeGreaterThan(0);
    // What it saves is the first bar, four times over.
    const built = buildLevel({
      existing: document.levelAt(1),
      difficulty: 1,
      minigameId: document.minigameId,
      notes: document.notes,
      loopMeasures: 1,
      vocabulary: document.vocabulary,
    });
    expect(built.noteOpportunityCount).toBe(document.liveNotes().length * 4);

    document.setLoopMeasures(4);
    expect(document.notes).toHaveLength(all);
    expect(document.rememberedNotes()).toEqual([]);
  });

  it("pastes a copied group, keeping the longer note where they overlap", () => {
    const document = new EditorDocument(rockyAscent, 3);
    document.select(document.notes.slice(0, 2).map((entry) => entry.id));
    const clipboard = document.copy();
    expect(clipboard).toHaveLength(2);
    expect(clipboard[0]!.startTick).toBe(0);

    const marks = document.notes.length;
    expect(document.paste(clipboard, TICKS_PER_MEASURE * 3)).toBe(true);
    expect(document.selection.size).toBe(2);
    expect(document.notes.length).toBeLessThanOrEqual(marks + 2);
  });

  it("offers the written length nearest a dragged width, on grids the start allows", () => {
    const document = new EditorDocument(rockyAscent, 1);
    const onBeat = document.notes[0]!;
    expect(document.durationForWidth(onBeat, 24)).toBe("half");
    expect(document.durationForWidth(onBeat, 5)).toBe("eighth");
    expect(document.durationForWidth(onBeat, 4)).toBe("eighthTriplet");

    // A note on an odd sixteenth cannot become a triplet: that would mean
    // moving it, and moving somebody's note is not a resize.
    const placed = document.addNote(3, 0, "sixteenth")!;
    expect(document.durationForWidth(placed, 4)).not.toBe("eighthTriplet");
  });
});

describe("adding and removing a difficulty", () => {
  const rockyDescent = SCENARIO_SOURCES.find((source) => source.id === "rocky_descent")!.raw as Json;

  it("starts a new level empty, with the family data of its nearest neighbour", () => {
    const document = new EditorDocument(rockyDescent, 1);
    expect(document.supportedLevels).toEqual([1, 2, 3, 4]);
    document.selectLevel(5);
    expect(document.notes).toEqual([]);

    // Nothing to save yet: an attempt with no opportunities cannot be judged.
    expect(document.toScenario().problems).toEqual([
      "this level has no notes — an attempt with no opportunities cannot be judged",
    ]);

    document.addNote(0, 7, "quarter");
    document.addNote(12, 6, "quarter");
    document.addNote(24, 5, "half");
    document.addNote(48, 4, "whole");
    document.addNote(96, 3, "whole");
    document.addNote(144, 2, "whole");
    const { raw, problems } = document.toScenario();
    expect(problems).toEqual([]);

    const scenario = loadScenario(raw!, assetUrlResolver(raw!));
    expect([...scenario.supportedLevels]).toEqual([1, 2, 3, 4, 5]);
    const level = scenario.levels.get(5)!;
    expect(level.noteOpportunityCount).toBe(6);
    expect(level.stars.star3Threshold).toBe(6 * JUDGMENT_POINTS.perfect * ATTEMPT_REPEATS);
  });

  it("drops a level out of supportedLevels, and refuses to drop the last one", () => {
    const one = withLevel({ id: "x", levels: {}, supportedLevels: [] }, 2, { difficulty: 2 });
    expect(one["supportedLevels"]).toEqual([2]);
    expect(withoutLevel(one, 2)).toBeNull();

    const two = withLevel(one, 3, { difficulty: 3 });
    expect(two["supportedLevels"]).toEqual([2, 3]);
    expect(withoutLevel(two, 3)!["supportedLevels"]).toEqual([2]);
  });
});
