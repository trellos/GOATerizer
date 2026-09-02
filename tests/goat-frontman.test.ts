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

import goatFrontmanJson from "../docs/scenarios/goat-frontman/goat_frontman.scenario.json";
import { AttemptRuntime, type AttemptEvent, type AttemptResult } from "../src/game/attempt.js";
import { RunState } from "../src/game/run.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import type { PlacedNote, Sprite, Stage, StageView } from "../src/minigame/api.js";
import { formatDegreeToken, laneIndexOf, LANE_COUNT, resolveDegree } from "../src/music/degrees.js";
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

const LEVELS = [1, 2, 3, 4] as const;
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
    if (event.type === "energy") {
      attempt.deliverEnergy(event.energy, attempt.toAttemptBeat(toBeat(clock.time)));
    }
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
  h.advanceTo(16);
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
    plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16 },
  });
  const flourish = attempt.targets.find((t) => flourishes.has(t.opportunityIndex));
  const plain = attempt.targets.find((t) => !flourishes.has(t.opportunityIndex));
  if (!flourish || !plain) throw new Error("level needs both kinds of note");
  return { flourish, plain, flourishes };
}

/* -------------------------------------------------------------------------- */

describe("Goat Frontman scenario data", () => {
  it("is a PerformMinigame in the Blues Lick family, authored at L1-L4", () => {
    expect(GOAT_FRONTMAN.id).toBe("goat_frontman");
    expect(GOAT_FRONTMAN.minigameId).toBe("PerformMinigame");
    expect(GOAT_FRONTMAN.family).toBe("Blues Lick");
    expect(GOAT_FRONTMAN.visualVerb).toBe("PERFORM");
    expect([...GOAT_FRONTMAN.supportedLevels]).toEqual([1, 2, 3, 4]);
    for (const difficulty of LEVELS) expect(scenariosForDifficulty(difficulty)).toContain(GOAT_FRONTMAN);
    for (const difficulty of [5, 6, 7]) expect(scenariosForDifficulty(difficulty)).not.toContain(GOAT_FRONTMAN);
  });

  it("is written in the designer's pentatonic notation, verbatim", () => {
    const tokens = (difficulty: number) =>
      level(difficulty).prompt.map((e) => (e.degree ? formatDegreeToken(e.degree) : "R")).join(" ");
    // L1: variant 1 (5Q 1Q 2Q 1QF), four times.
    expect(tokens(1)).toBe(Array(4).fill("p5 p1 p2 p1").join(" "));
    // L3: variant 1 (5E 1E 2Q 1HF), four times.
    expect(tokens(3)).toBe(Array(4).fill("p5 p1 p2 p1").join(" "));
    expect(level(3).prompt.map((e) => e.duration)).toEqual(
      Array(4).fill(["eighth", "eighth", "quarter", "half"]).flat()
    );
    // L2: two L1 variants, each twice. L4: two L3 variants, alternating.
    expect(tokens(2)).toBe("p5 p5 p1 p2 p1 p5 p5 p1 p2 p1 p3 p1 p4 p1 p3 p1 p4 p1");
    expect(tokens(4)).toBe(
      "p5 p5 p1 p2 p1 R p2 p3 p1 p4 p1 R p6 p5 p5 p1 p2 p1 R p2 p3 p1 p4 p1 R p6"
    );
  });

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

  it.each(LEVELS)("L%i marks the same flourishes in the prompt and in the runtime data", (difficulty) => {
    const raw = (goatFrontmanJson as { levels: Record<string, { prompt: { startBeat: number; flourish?: boolean; type: string }[] }> })
      .levels[String(difficulty)]!;
    const marked = raw.prompt.filter((e) => e.flourish).map((e) => e.startBeat);
    expect(marked.length).toBeGreaterThan(0);
    for (const e of raw.prompt.filter((f) => f.flourish)) expect(e.type).toBe("note");
    expect([...performLevelData(level(difficulty).data).flourishBeats]).toEqual(marked);
  });

  it("puts one flourish in every L1 measure, on the last beat", () => {
    expect([...performLevelData(level(1).data).flourishBeats]).toEqual([3, 7, 11, 15]);
  });

  it("draws a bigger crowd per flourish the higher the level", () => {
    const perFlourish = LEVELS.map((d) => performLevelData(level(d).data).goatsPerFlourish);
    for (let i = 1; i < perFlourish.length; i += 1) expect(perFlourish[i]!).toBeGreaterThan(perFlourish[i - 1]!);
  });

  it.each(LEVELS)("L%i star thresholds ascend and three stars means all Perfect", (difficulty) => {
    const { passThreshold, star2Threshold, star3Threshold, provisional } = level(difficulty).stars;
    expect(passThreshold).toBeLessThan(star2Threshold);
    expect(star2Threshold).toBeLessThan(star3Threshold);
    expect(star3Threshold).toBe(level(difficulty).noteOpportunityCount * 10);
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
    expect(minor).toEqual([6, 0, 2, 0]); // b7 1 b3 1
    expect(major).toEqual([5, 0, 1, 0]); // 6  1 2  1
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
    expect(flourishes.size).toBe(4);
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
    const short = harness(1);
    const long = harness(3);
    for (const h of [short, long]) {
      const { flourish } = firstTargets(h.attempt);
      h.advanceTo(flourish.startBeat);
      h.playAt(flourish.midi, flourish.startBeat);
      h.advanceTo(flourish.startBeat + 0.01);
    }
    const at = (h: ReturnType<typeof harness>, dt: number) => {
      const { flourish } = firstTargets(h.attempt);
      h.advanceTo(flourish.startBeat + dt);
      return spriteAt(h.attempt, "performer", flourish.startBeat + dt).assetId;
    };
    expect(FRONTMAN.bindings.flourishPoses).toContain(at(long, 1.5));
    expect(FRONTMAN.bindings.performerPoses).toContain(at(short, 1.5));
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

  it("summons more goats per flourish at a higher level, and never fewer overall", () => {
    const crowds = LEVELS.map((d) => performIn(playFlawlessly(d).attempt).progress.crowd);
    expect(crowds[0]).toBe(4); // one per L1 flourish
    for (let i = 1; i < crowds.length; i += 1) expect(crowds[i]!).toBeGreaterThanOrEqual(crowds[i - 1]!);
    expect(crowds[3]!).toBeGreaterThan(crowds[0]!);
  });

  it("gives every crowd member its own slot, spread to both sides", () => {
    const { attempt } = playFlawlessly(3);
    const crowd = crowdAt(attempt, 30);
    expect(crowd.length).toBe(performIn(attempt).progress.crowd);
    const xs = crowd.map((s) => s.x.toFixed(4));
    expect(new Set(xs).size).toBe(xs.length);
    const performerX = spriteAt(attempt, "performer", 30).x;
    expect(crowd.some((s) => s.x < performerX)).toBe(true);
    expect(crowd.some((s) => s.x > performerX)).toBe(true);
    expect(crowdSlot(0).dx).toBeGreaterThan(0);
    expect(crowdSlot(1).dx).toBeLessThan(0);
  });

  it("draws half the crowd for a Good flourish", () => {
    const perfect = harness(4);
    const good = harness(4);
    // L4's first flourish is an eighth, whose Good window is a quarter beat.
    for (const [h, late] of [[perfect, 0], [good, 0.18]] as const) {
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
    const { attempt, result } = playFlawlessly(1);
    expect(result.stars).toBe(3);
    expect(performIn(attempt).progress.impressed).toBe(true);
    const crowd = crowdAt(attempt, 16.01);
    expect(crowd.length).toBeGreaterThan(0);
    for (const goat of crowd) expect(goat.assetId).toBe(FRONTMAN.bindings.audienceStates[1]);
    const stage = stageOf(attempt, 16.01);
    expect((stage.sprites ?? []).some((s) => s.assetId === FRONTMAN.bindings.payoffEffects[0])).toBe(true);
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
    h.advanceTo(16);
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
    const run = new RunState({ key: G_MINOR, bpm: BPM, pinnedScenarioId: "goat_frontman", random: () => 0 });
    for (const slot of run.slots) {
      if (slot.difficulty <= 4) expect(slot.scenario?.id).toBe("goat_frontman");
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
      plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16 },
      opportunities: attempt.targets.map((t) => ({
        index: t.opportunityIndex,
        startBeat: t.startBeat,
        durationBeats: t.durationBeats,
        duration: t.duration,
        lane: t.lane,
        midi: t.midi,
      })),
    }) as PerformMinigame;
    for (const index of [3, 7, 11, 15]) {
      minigame.onJudged({ id: index, outcome: "perfect", opportunityIndex: index, playedMidi: 60, lane: 0, beat: index }, index);
    }
    expect(minigame.progress.crowd).toBe(2);
    expect(minigame.progress.flourishesHit).toBe(4);
  });

  it("refuses a flourish beat that is not the start of a note", () => {
    expect(() =>
      flourishOpportunities([2.5], {
        opportunities: [{ index: 0, startBeat: 0, durationBeats: 1, duration: "quarter", lane: 0, midi: 60 }],
        plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16 },
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
      plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16 },
    });
    expect([...flourishes]).toEqual([0, 1]);
  });

  it("refuses a level with more flourishes than notes, and a lone audience state", () => {
    expect(() =>
      PERFORM_MINIGAME.parseLevel(
        { visualSpanMeasures: 4, resetBetweenMeasures: false, flourishBeats: [0, 1, 2], goatsPerFlourish: 1 },
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
