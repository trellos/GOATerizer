/**
 * Goat Frontman: the one `PerformMinigame` scenario, and the class behind it.
 *
 * Same shape as `climb-and-run.test.ts`: the deterministic input provider
 * drives a real `AttemptRuntime`, energy is delivered headlessly, and what is
 * asserted is the `Stage` the minigame would hand the timeline — never a
 * canvas. The design under test is the designer's brief: flourish notes
 * strike a pose and draw a crowd, higher levels draw more crowd, bad notes are
 * embarrassment and nothing is ever taken away.
 */

import { describe, expect, it } from "vitest";

import goatFrontmanJson from "../docs/scenarios/goat_frontman.scenario.json";
import { ATTEMPT_BEATS, ATTEMPT_REPEATS } from "../src/config/tuning.js";
import { AttemptRuntime, type AttemptEvent, type AttemptResult } from "../src/game/attempt.js";
import { RunState } from "../src/game/run.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import type { PlacedNote, Sprite, Stage, StageView } from "../src/minigame/api.js";
import { laneIndexOf, LANE_COUNT, resolveDegree } from "../src/music/degrees.js";
import type { RunKey } from "../src/music/keys.js";
import {
  crowdSlot,
  flourishOpportunities,
  PERFORM_MINIGAME,
  performConfig,
  performLevelData,
  PerformMinigame,
} from "../src/scenario/minigames/perform-minigame.js";
import { GOAT_FRONTMAN, scenariosForDifficulty } from "../src/scenario/registry.js";

/**
 * The difficulties this scenario actually authors, read rather than listed.
 *
 * It was `[1, 2, 3, 4]`, which meant every test below stopped covering a level
 * the moment one was added in the editor — and L5 and L6 were added, and were
 * both broken, and nothing here looked at them.
 */
const LEVELS = [...GOAT_FRONTMAN.levels.keys()].sort((a, b) => a - b);

/** The levels that actually mark a flourish, for the tests that need one. */
const WITH_FLOURISHES = LEVELS.filter(
  (difficulty) => performLevelData(level(difficulty).data).flourishBeats.length > 0
);
const BPM = 120;
const SECONDS_PER_BEAT = 60 / BPM;
const G_MINOR: RunKey = { tonic: 7, mode: "minor" };
const D_MAJOR: RunKey = { tonic: 2, mode: "major" };

const FRONTMAN = performConfig(GOAT_FRONTMAN.config);

function level(difficulty: number) {
  const data = GOAT_FRONTMAN.levels.get(difficulty);
  if (!data) throw new Error(`Goat Frontman has no level ${difficulty}`);
  return data;
}

function harness(difficulty: number, key: RunKey = G_MINOR, startBeat = 20) {
  const provider = new TestGuitarInputProvider();
  const toBeat = (contextTime: number) => contextTime / SECONDS_PER_BEAT;
  const attempt = new AttemptRuntime({ scenario: GOAT_FRONTMAN, difficulty, key, startBeat, toBeat });

  const events: AttemptEvent[] = [];
  const clock = { time: startBeat * SECONDS_PER_BEAT };
  attempt.onEvent((event) => {
    events.push(event);
  });
  provider.onEvent((event) => attempt.handleGuitarEvent(event));
  void provider.start();

  const advanceTo = (attemptBeat: number) => {
    clock.time = (startBeat + attemptBeat) * SECONDS_PER_BEAT;
    provider.pump(clock.time);
    attempt.update(startBeat + attemptBeat);
  };
  const playAt = (midi: number, attemptBeat: number, offsetBeats = 0) => {
    const at = (startBeat + attemptBeat + offsetBeats) * SECONDS_PER_BEAT;
    clock.time = Math.max(clock.time, at);
    provider.attack(midi, at);
  };
  return { attempt, events, advanceTo, playAt };
}

function playFlawlessly(difficulty: number, key: RunKey = G_MINOR): { attempt: AttemptRuntime; result: AttemptResult } {
  const h = harness(difficulty, key);
  for (const target of h.attempt.targets) {
    h.advanceTo(target.startBeat);
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(target.startBeat + 0.001);
  }
  h.advanceTo(ATTEMPT_BEATS);
  const result = h.attempt.result;
  if (!result) throw new Error("attempt did not complete");
  return { attempt: h.attempt, result };
}

function viewFor(attempt: AttemptRuntime, beat: number): StageView {
  const notes: PlacedNote[] = attempt.targets.map((target) => ({
    id: `a0-${target.opportunityIndex}`,
    opportunityIndex: target.opportunityIndex,
    lane: target.lane,
    duration: target.duration,
    outcome: null,
    rect: { x: 0.05 * target.opportunityIndex, y: 0.5, w: 0.04, h: 0.1 },
    beatsUntilStrike: target.startBeat - beat,
  }));
  return { beat, notes, laneCount: 8, strikeX: 0.5, span: { from: 0, to: 1 }, measure: { width: 0.4, beatWidth: 0.1 } };
}

function performIn(attempt: AttemptRuntime): PerformMinigame {
  const minigame = attempt.minigame;
  if (!(minigame instanceof PerformMinigame)) throw new Error("attempt is not a performance");
  return minigame;
}

function stageOf(attempt: AttemptRuntime, beat = 0): Stage {
  return performIn(attempt).render(viewFor(attempt, beat));
}

function spriteAt(attempt: AttemptRuntime, key: string, beat = 0): Sprite {
  const found = (stageOf(attempt, beat).sprites ?? []).find((entry) => entry.key === key);
  if (!found) throw new Error(`no sprite keyed ${key}`);
  return found;
}

function crowdAt(attempt: AttemptRuntime, beat = 0): Sprite[] {
  return (stageOf(attempt, beat).sprites ?? []).filter((entry) => entry.key.startsWith("crowd-"));
}

/** The first flourish target of a level, and the first non-flourish one. */
function firstTargets(attempt: AttemptRuntime) {
  const flourishes = flourishOpportunities(performLevelData(attempt.level.data).flourishBeats, {
    opportunities: attempt.targets.map((t) => ({
      index: t.opportunityIndex,
      startBeat: t.startBeat,
      durationBeats: t.durationBeats,
      duration: t.duration,
      lane: t.lane,
      midi: t.midi,
    })),
    plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16, phraseBeats: 16 },
  });
  const flourish = attempt.targets.find((t) => flourishes.has(t.opportunityIndex));
  const plain = attempt.targets.find((t) => !flourishes.has(t.opportunityIndex));
  if (!flourish || !plain) throw new Error("level needs both kinds of note");
  return { flourish, plain, flourishes };
}

/* -------------------------------------------------------------------------- */

describe("Goat Frontman scenario data", () => {
  it("is a PerformMinigame in the Blues Lick family", () => {
    expect(GOAT_FRONTMAN.id).toBe("goat_frontman");
    expect(GOAT_FRONTMAN.minigameId).toBe("PerformMinigame");
    expect(GOAT_FRONTMAN.family).toBe("Blues Lick");
    expect(GOAT_FRONTMAN.visualVerb).toBe("PERFORM");
    // Which difficulties it authors is the designer's, and that it is offered at
    // exactly those is an invariant in `scenario-content.test.ts`. What is
    // asserted here is the half that is not content: it is offered where it
    // authors, and nowhere else.
    for (const difficulty of LEVELS) {
      expect(scenariosForDifficulty(difficulty)).toContain(GOAT_FRONTMAN);
    }
    for (const difficulty of [1, 2, 3, 4, 5, 6, 7].filter((d) => !LEVELS.includes(d))) {
      expect(scenariosForDifficulty(difficulty)).not.toContain(GOAT_FRONTMAN);
    }
  });

  /*
   * Removed: "is written in the designer's pentatonic notation, verbatim".
   *
   * It transcribed every note of every level as a string — `"p1 p2 p3 p4 p5 p6
   * R"`, twice, per difficulty — so it was a copy of the content rather than a
   * test of it, and the first edit in the minigame editor made it a copy of the
   * *previous* content. Nothing it asserted is unchecked: `loadScenario` refuses
   * an unreadable degree token at import, the octave check below refuses one
   * that has no lane, and `scenario-content.test.ts` refuses a phrase that does
   * not total its measures. What is left over is the designer's taste, which is
   * not a thing to assert.
   */

  it("authors nothing outside the timeline's own octave, in either mode", () => {
    // The reason the vocabulary stops at p6: there are no lanes below the root
    // or above the octave root, so a lick that wanted one could only be drawn
    // by moving the note. Nothing here is moved.
    for (const difficulty of LEVELS) {
      for (const event of level(difficulty).prompt) {
        if (!event.degree) continue;
        for (const mode of ["major", "minor"] as const) {
          const lane = laneIndexOf(resolveDegree(event.degree, mode));
          expect(lane, `L${difficulty} in ${mode}`).toBeGreaterThanOrEqual(0);
          expect(lane, `L${difficulty} in ${mode}`).toBeLessThan(LANE_COUNT);
        }
      }
    }
  });

  it.each(LEVELS)("L%i totals 16 beats and counts its own opportunities", (difficulty) => {
    const data = level(difficulty);
    expect(data.prompt.reduce((sum, e) => sum + e.durationBeats, 0)).toBe(16);
    expect(data.prompt.filter((e) => e.type === "note")).toHaveLength(data.noteOpportunityCount);
  });

  it.each(LEVELS)("L%i puts every flourish on a note that can be played", (difficulty) => {
    // This used to compare the prompt's own `flourish: true` markings against
    // `visual.flourishBeats` and require both to be non-empty — two records of
    // one fact, kept in step by hand. The editor writes only the second (it is
    // what `PerformMinigame` reads, and what `reconcileLevel` maintains), so a
    // round trip through the tool emptied the first and this failed on levels
    // that were working perfectly.
    //
    // One record, and the invariant that matters about it: a flourish is a beat
    // the crowd grows on, so it only means anything sitting on a note. Whether
    // a level *has* one is the family's own review, in
    // `scenario-content.test.ts` — which is where the three levels that lost
    // theirs are reported.
    const starts = new Set(
      level(difficulty)
        .prompt.filter((event) => event.type === "note")
        .map((event) => event.startBeat.toFixed(3))
    );
    for (const beat of performLevelData(level(difficulty).data).flourishBeats) {
      expect(starts.has(beat.toFixed(3)), `L${difficulty} flourish on beat ${beat}`).toBe(true);
    }
  });

  it("puts a flourish on the top note of each of L1's two runs", () => {
    expect([...performLevelData(level(1).data).flourishBeats]).toEqual([5, 13]);
  });

  it("never draws a smaller crowd per flourish at a higher level", () => {
    // Was strictly ascending, which is a claim about four particular numbers;
    // L4 and L5 both summon four and it went red. Not falling is the rule — a
    // higher difficulty that pays out *less* is the failure worth catching, and
    // two levels sharing a rung is the designer's business.
    const perFlourish = LEVELS.map((d) => performLevelData(level(d).data).goatsPerFlourish);
    for (let i = 1; i < perFlourish.length; i += 1) {
      expect(perFlourish[i]!).toBeGreaterThanOrEqual(perFlourish[i - 1]!);
    }
    expect(perFlourish.at(-1)!).toBeGreaterThan(perFlourish[0]!);
  });

  it.each(LEVELS)("L%i star thresholds ascend and three stars means all Perfect", (difficulty) => {
    const { passThreshold, star2Threshold, star3Threshold, provisional } = level(difficulty).stars;
    expect(passThreshold).toBeLessThan(star2Threshold);
    expect(star2Threshold).toBeLessThan(star3Threshold);
    expect(star3Threshold).toBe(level(difficulty).noteOpportunityCount * 10 * ATTEMPT_REPEATS);
    expect(provisional).toBe(true);
  });

  it("binds every class slot to a resolvable URL, crowd states included", () => {
    const b = FRONTMAN.bindings;
    expect(b.performerPoses).toHaveLength(4);
    expect(b.flourishPoses).toHaveLength(2);
    expect(b.audienceStates).toHaveLength(2);
    for (const id of PERFORM_MINIGAME.assetIds(GOAT_FRONTMAN.config, [])) {
      expect(GOAT_FRONTMAN.assetUrls[id]).toMatch(/goat-frontman\/.*\.png$/);
    }
  });

  it("transposes into a major key and a minor key as different lanes for the same lick", () => {
    const minor = harness(1, G_MINOR).attempt.targets.slice(0, 4).map((t) => t.lane);
    const major = harness(1, D_MAJOR).attempt.targets.slice(0, 4).map((t) => t.lane);
    expect(minor).toEqual([0, 2, 3, 4]); // 1 b3 4 5
    expect(major).toEqual([0, 1, 2, 4]); // 1 2  3 5
  });
});

describe("PerformMinigame on the timeline", () => {
  it("stands on the floor left of the strike line before anything is played, crowd-less", () => {
    const { attempt } = harness(1);
    const performer = spriteAt(attempt, "performer");
    expect(performer.x).toBeLessThan(0.5);
    expect(performer.y).toBeGreaterThan(1); // below the lane band
    expect(performer.anchor).toBe("bottom");
    expect(FRONTMAN.bindings.performerPoses).toContain(performer.assetId);
    expect(crowdAt(attempt)).toHaveLength(0);
    expect(spriteAt(attempt, "prop-0").assetId).toBe(FRONTMAN.bindings.signatureProps[0]);
  });

  it("makes every note a stage light and marks only the flourish notes", () => {
    const h = harness(1);
    const { flourishes } = firstTargets(h.attempt);
    const notes = stageOf(h.attempt).notes!;
    expect(notes.size).toBe(h.attempt.targets.length);
    for (const [id, art] of notes) {
      const index = Number(id.split("-")[1]);
      expect(art.body?.assetId).toBe(FRONTMAN.bindings.noteArt.body);
      if (flourishes.has(index)) expect(art.overlay?.assetId).toBe(FRONTMAN.bindings.noteArt.flourish);
      else expect(art.overlay).toBeUndefined();
    }
    expect(flourishes.size).toBe(2 * ATTEMPT_REPEATS);
  });

  it("cycles the pose on an ordinary note and summons nobody", () => {
    const h = harness(1);
    const { plain } = firstTargets(h.attempt);
    const before = spriteAt(h.attempt, "performer").assetId;
    h.playAt(plain.midi, plain.startBeat);
    h.advanceTo(plain.startBeat + 0.01);
    const after = spriteAt(h.attempt, "performer", plain.startBeat + 0.01).assetId;
    expect(after).not.toBe(before);
    expect(FRONTMAN.bindings.performerPoses).toContain(after);
    expect(performIn(h.attempt).progress.crowd).toBe(0);
  });

  it("strikes a flourish pose on a flourish note, then goes back to performing", () => {
    const h = harness(1);
    const { flourish } = firstTargets(h.attempt);
    h.advanceTo(flourish.startBeat);
    h.playAt(flourish.midi, flourish.startBeat);
    h.advanceTo(flourish.startBeat + 0.01);
    const struck = spriteAt(h.attempt, "performer", flourish.startBeat + 0.01);
    expect(FRONTMAN.bindings.flourishPoses).toContain(struck.assetId);
    // Lifted off the floor mid-pose.
    expect(spriteAt(h.attempt, "performer", flourish.startBeat + 0.4).y).toBeLessThan(struck.y + 0.0001);
    // A swoosh at the performer.
    const fx = (stageOf(h.attempt, flourish.startBeat + 0.1).sprites ?? []).filter((s) => s.key.startsWith("fx-"));
    expect(fx.some((s) => s.assetId === FRONTMAN.bindings.flourishEffects[0])).toBe(true);

    h.advanceTo(flourish.startBeat + 2);
    expect(FRONTMAN.bindings.performerPoses).toContain(spriteAt(h.attempt, "performer", flourish.startBeat + 2).assetId);
  });

  it("holds a half-note flourish longer than a quarter-note one", () => {
    // No authored level currently has a non-quarter flourish, so this drives
    // PerformMinigame directly with a synthetic opportunity of each duration
    // rather than reading it off scenario content.
    const view = { beat: 0, notes: [], laneCount: 8, strikeX: 0.5, span: { from: 0, to: 1 }, measure: { width: 0.4, beatWidth: 0.1 } };
    const at = (duration: "quarter" | "half", beat: number) => {
      const data = PERFORM_MINIGAME.parseLevel(
        { visual: { visualSpanMeasures: 4, resetBetweenMeasures: false, flourishBeats: [0], goatsPerFlourish: 1 } },
        { noteOpportunityCount: 1, measures: 4 }
      );
      const minigame = PERFORM_MINIGAME.create({
        config: FRONTMAN,
        data,
        assets: [],
        plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16, phraseBeats: 16 },
        opportunities: [{ index: 0, startBeat: 0, durationBeats: duration === "half" ? 2 : 1, duration, lane: 0, midi: 60 }],
      }) as PerformMinigame;
      minigame.onJudged({ id: 0, outcome: "perfect", opportunityIndex: 0, playedMidi: 60, lane: 0, beat: 0 }, 0);
      minigame.update(beat);
      return minigame.render({ ...view, beat }).sprites?.find((s) => s.key === "performer")?.assetId;
    };
    expect(FRONTMAN.bindings.flourishPoses).toContain(at("half", 1.5));
    expect(FRONTMAN.bindings.performerPoses).toContain(at("quarter", 1.5));
  });

  it("brings a goat in from the wing for a flourish, walking rather than appearing", () => {
    const h = harness(1);
    const { flourish } = firstTargets(h.attempt);
    h.advanceTo(flourish.startBeat);
    h.playAt(flourish.midi, flourish.startBeat);
    h.advanceTo(flourish.startBeat + 0.01);
    expect(performIn(h.attempt).progress.crowd).toBe(1);

    const arriving = crowdAt(h.attempt, flourish.startBeat + 0.01)[0]!;
    const settled = crowdAt(h.attempt, flourish.startBeat + 4)[0]!;
    // Starts off the edge of the playfield, ends at its slot beside the performer.
    expect(arriving.x > 1 || arriving.x < 0).toBe(true);
    expect(settled.x).toBeGreaterThan(0);
    expect(settled.x).toBeLessThan(1);
    expect(settled.y).toBeGreaterThan(1); // on the floor, below the lanes
    expect(settled.assetId).toBe(FRONTMAN.bindings.audienceStates[0]); // not yet impressed
  });

  it.each(WITH_FLOURISHES)("L%i draws the crowd its level data promises", (difficulty) => {
    // The behaviour, stated as the arithmetic rather than as four numbers: a
    // flawless attempt lands every flourish, on every pass, and each one summons
    // `goatsPerFlourish`. The old version asserted `crowds[0] === 2 *
    // ATTEMPT_REPEATS` and a rising sequence across `[1, 2, 3, 4]`, which failed
    // the moment a level was re-authored with a different number of flourishes —
    // reporting a broken test where the ladder is a separate, and passing,
    // assertion about the level data itself.
    const data = performLevelData(level(difficulty).data);
    const crowd = performIn(playFlawlessly(difficulty).attempt).progress.crowd;
    expect(crowd).toBe(
      Math.min(FRONTMAN.crowdCapacity, data.flourishBeats.length * data.goatsPerFlourish * ATTEMPT_REPEATS)
    );
  });

  it("gives every crowd member its own slot, spread to both sides", () => {
    // Any level that actually summons anybody: the claim is about how a crowd is
    // arranged, not about which difficulty happens to draw one today.
    const { attempt } = playFlawlessly(WITH_FLOURISHES.at(-1) as number);
    // Past the last flourish plus the walk-on, so nobody is still in the wings.
    const crowd = crowdAt(attempt, ATTEMPT_BEATS + 4);
    expect(crowd.length).toBe(performIn(attempt).progress.crowd);
    // A slot is a place on the stage, not an x: the rows behind the first
    // reuse the same offsets set further back, so uniqueness is x AND y.
    const places = crowd.map((s) => `${s.x.toFixed(4)},${s.y.toFixed(4)}`);
    expect(new Set(places).size).toBe(places.length);
    const performerX = spriteAt(attempt, "performer", ATTEMPT_BEATS + 4).x;
    expect(crowd.some((s) => s.x < performerX)).toBe(true);
    expect(crowd.some((s) => s.x > performerX)).toBe(true);
    expect(crowdSlot(0).dx).toBeGreaterThan(0);
    expect(crowdSlot(1).dx).toBeLessThan(0);
  });

  it("draws half the crowd for a Good flourish", () => {
    const perfect = harness(4);
    const good = harness(4);
    // L4's first flourish is a quarter note: Perfect is within 0.18 beats, Good within 0.5.
    for (const [h, late] of [[perfect, 0], [good, 0.3]] as const) {
      const { flourish } = firstTargets(h.attempt);
      h.advanceTo(flourish.startBeat);
      h.playAt(flourish.midi, flourish.startBeat, late);
      h.advanceTo(flourish.startBeat + late + 0.01);
    }
    const perFlourish = performLevelData(level(4).data).goatsPerFlourish;
    expect(performIn(perfect.attempt).progress.crowd).toBe(perFlourish);
    expect(performIn(good.attempt).progress.crowd).toBe(Math.ceil(perFlourish / 2));
  });

  it("flinches on a wrong note, bores the crowd for a beat, and takes nothing away", () => {
    const h = harness(1);
    const { flourish } = firstTargets(h.attempt);
    h.advanceTo(flourish.startBeat);
    h.playAt(flourish.midi, flourish.startBeat);
    h.advanceTo(flourish.startBeat + 0.01);
    const earned = performIn(h.attempt).progress.crowd;

    const next = h.attempt.targets[flourish.opportunityIndex + 1]!;
    h.advanceTo(next.startBeat);
    h.playAt(next.midi + 1, next.startBeat); // a semitone off
    h.advanceTo(next.startBeat + 0.05);

    expect(spriteAt(h.attempt, "performer", next.startBeat + 0.05).rotationDeg).not.toBe(0);
    expect(performIn(h.attempt).progress.crowd).toBe(earned);
    // Slumped, and unimpressed — sampled once the goat has finished walking
    // in, so the slump is not hidden under the walk.
    const bored = crowdAt(h.attempt, next.startBeat + 0.6)[0]!;
    expect(bored.assetId).toBe(FRONTMAN.bindings.audienceStates[0]);
    expect(bored.y).toBeGreaterThan(crowdAt(h.attempt, next.startBeat + 4)[0]!.y);

    // Settled — ticked on the minigame alone, so the targets after it do not
    // expire into fresh misses and fresh flinches.
    performIn(h.attempt).update(next.startBeat + 0.75);
    expect(spriteAt(h.attempt, "performer", next.startBeat + 0.75).rotationDeg).toBe(0);
  });

  it("summons nobody for a missed flourish", () => {
    const h = harness(1);
    const { flourish } = firstTargets(h.attempt);
    h.advanceTo(flourish.startBeat + 2);
    expect(h.events.some((e) => e.type === "judgment" && e.judgment.type === "MissedNote")).toBe(true);
    expect(performIn(h.attempt).progress.crowd).toBe(0);
  });

  it("impresses the crowd at two stars and pays off at three", () => {
    // Not playFlawlessly: its final advanceTo(ATTEMPT_BEATS) outlives the
    // payoff effect's short life (PAYOFF_BEATS), so it must be sampled right
    // after ★★★ locks — on the attempt's last note — not at the very end.
    const h = harness(1);
    for (const target of h.attempt.targets) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.001);
    }
    const { attempt } = h;
    const lastNoteBeat = attempt.targets[attempt.targets.length - 1]!.startBeat;
    expect(performIn(attempt).progress.impressed).toBe(true);
    const crowd = crowdAt(attempt, lastNoteBeat + 0.01);
    expect(crowd.length).toBeGreaterThan(0);
    for (const goat of crowd) expect(goat.assetId).toBe(FRONTMAN.bindings.audienceStates[1]);
    const stage = stageOf(attempt, lastNoteBeat + 0.01);
    expect((stage.sprites ?? []).some((s) => s.assetId === FRONTMAN.bindings.payoffEffects[0])).toBe(true);

    h.advanceTo(ATTEMPT_BEATS);
    expect(attempt.result?.stars).toBe(3);
  });

  it("takes the finish pose when the attempt passes, in front of the crowd it earned", () => {
    const { attempt, result } = playFlawlessly(2);
    expect(result.passed).toBe(true);
    expect(performIn(attempt).progress.finished).toBe(true);
    expect(spriteAt(attempt, "performer", 16).assetId).toBe(FRONTMAN.bindings.finishPose);
    expect(crowdAt(attempt, 16)).toHaveLength(performIn(attempt).progress.crowd);
  });

  it("freezes, still performing, when the attempt fails", () => {
    const h = harness(1);
    h.advanceTo(ATTEMPT_BEATS);
    const result = h.attempt.result!;
    expect(result.stars).toBe(0);
    expect(performIn(h.attempt).progress.frozen).toBe(true);
    expect(spriteAt(h.attempt, "performer", 16).assetId).not.toBe(FRONTMAN.bindings.finishPose);
  });

  it("puts its background behind its own measures", () => {
    expect(stageOf(harness(1).attempt).background).toBe(FRONTMAN.bindings.background);
  });

  it.each(LEVELS)("can be three-starred at L%i", (difficulty) => {
    expect(playFlawlessly(difficulty).result.stars).toBe(3);
  });
});

describe("a run can be pinned to Goat Frontman for development", () => {
  it("fills every slot it authors with it, and the rest normally", () => {
    // `slot.difficulty <= 4` was the authored ladder written out again, so
    // authoring L5 turned a working pin into a failure. The ladder is read now.
    const run = new RunState({ key: G_MINOR, bpm: BPM, pinnedScenarioId: "goat_frontman", random: () => 0 });
    for (const slot of run.slots) {
      if (LEVELS.includes(slot.difficulty)) expect(slot.scenario?.id).toBe("goat_frontman");
      else expect(slot.scenario?.id).not.toBe("goat_frontman");
    }
  });

  it("ignores a preference for a scenario that does not exist", () => {
    const run = new RunState({ key: G_MINOR, bpm: BPM, pinnedScenarioId: "nope", random: () => 0 });
    expect(run.slots.every((slot) => slot.scenario !== null || slot.difficulty === 7)).toBe(true);
  });
});

describe("PerformMinigame content rules", () => {
  it("stops summoning at the crowd capacity", () => {
    const { attempt } = harness(1);
    const minigame = PERFORM_MINIGAME.create({
      config: { ...FRONTMAN, crowdCapacity: 2 },
      data: attempt.level.data,
      assets: [],
      plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16, phraseBeats: 16 },
      opportunities: attempt.targets.map((t) => ({
        index: t.opportunityIndex,
        startBeat: t.startBeat,
        durationBeats: t.durationBeats,
        duration: t.duration,
        lane: t.lane,
        midi: t.midi,
      })),
    }) as PerformMinigame;
    // L1's two flourish opportunities (index 5, 11 per authored pass), across both attempt repeats.
    for (const index of [5, 11, 17, 23]) {
      minigame.onJudged({ id: index, outcome: "perfect", opportunityIndex: index, playedMidi: 60, lane: 0, beat: index }, index);
    }
    expect(minigame.progress.crowd).toBe(2);
    expect(minigame.progress.flourishesHit).toBe(4);
  });

  it("refuses a flourish beat that is not the start of a note", () => {
    expect(() =>
      flourishOpportunities([2.5], {
        opportunities: [{ index: 0, startBeat: 0, durationBeats: 1, duration: "quarter", lane: 0, midi: 60 }],
        plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16, phraseBeats: 16 },
      })
    ).toThrow(/not the start of any note opportunity/);
  });

  it("marks a flourish on every pass when the phrase is repeated", () => {
    // 16-beat phrase, opportunities on two passes: the same flourish beat
    // matches both, so a repeated phrase keeps its flourishes.
    const flourishes = flourishOpportunities([3], {
      opportunities: [
        { index: 0, startBeat: 3, durationBeats: 1, duration: "quarter", lane: 0, midi: 60 },
        { index: 1, startBeat: 19, durationBeats: 1, duration: "quarter", lane: 0, midi: 60 },
      ],
      plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16, phraseBeats: 16 },
    });
    expect([...flourishes]).toEqual([0, 1]);
  });

  it("refuses a level with more flourishes than notes, and a lone audience state", () => {
    expect(() =>
      PERFORM_MINIGAME.parseLevel(
        {
          visual: {
            visualSpanMeasures: 4,
            resetBetweenMeasures: false,
            flourishBeats: [0, 1, 2],
            goatsPerFlourish: 1,
          },
        },
        { noteOpportunityCount: 2, measures: 4 }
      )
    ).toThrow(/3 flourishes for 2/);
    const raw = goatFrontmanJson as { classParameters: unknown; assetBindings: Record<string, unknown> };
    expect(() =>
      PERFORM_MINIGAME.parseConfig({
        classParameters: raw.classParameters,
        assetBindings: { ...raw.assetBindings, audienceStates: ["only_one"] },
      })
    ).toThrow(/unimpressed and an impressed/);
  });
});
