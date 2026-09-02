/**
 * Integration: guitar event -> beat -> judgment -> energy -> scenario.
 *
 * Everything here runs on the deterministic test input provider, so the whole
 * causal chain is exercised without a microphone. The visual layer is not
 * involved; what is asserted is that the goat moves exactly when the design
 * says it moves.
 */

import { describe, expect, it } from "vitest";

import { planAutoPerformance, type AutoplayMode } from "../src/dev/auto-performance.js";
import { AttemptRuntime, type AttemptEvent, type AttemptResult } from "../src/game/attempt.js";
import { rankForStars, GOAT_RANKS } from "../src/game/ranks.js";
import { DIFFICULTY_SEQUENCE, RunState, RUN_SLOT_COUNT } from "../src/game/run.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import type { PlacedNote, Sprite, Stage, StageView } from "../src/minigame/api.js";
import { ClimbMinigame, climbConfig } from "../src/scenario/minigames/climb-minigame.js";
import { ROCKY_ASCENT, scenariosForDifficulty } from "../src/scenario/registry.js";
import type { RunKey } from "../src/music/keys.js";

const KEY: RunKey = { tonic: 7, mode: "minor" };
const BPM = 120;
const SECONDS_PER_BEAT = 60 / BPM;

/**
 * An attempt driven by injected guitar input on a fake audio clock.
 *
 * `startBeat` is deliberately not 0: an attempt begins wherever the continuous
 * transport happens to be, and off-by-one errors there would otherwise hide.
 */
function harness(
  difficulty: number,
  options: { startBeat?: number; reactionDelayBeats?: number } = {}
) {
  const startBeat = options.startBeat ?? 20;
  const provider = new TestGuitarInputProvider();
  const toBeat = (contextTime: number) => contextTime / SECONDS_PER_BEAT;
  const attempt = new AttemptRuntime({
    scenario: ROCKY_ASCENT,
    difficulty,
    key: KEY,
    startBeat,
    toBeat,
    ...(options.reactionDelayBeats === undefined
      ? {}
      : { reactionDelayBeats: options.reactionDelayBeats }),
  });

  const events: AttemptEvent[] = [];
  attempt.onEvent((event) => {
    events.push(event);
    // Headless: energy is delivered to the scenario as soon as it is emitted.
    if (event.type === "energy") {
      attempt.deliverEnergy(event.energy, attempt.toAttemptBeat(toBeat(clock.time)));
    }
  });

  const clock = { time: startBeat * SECONDS_PER_BEAT };
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

  return { attempt, provider, events, advanceTo, playAt, clock };
}

/** Plays a whole level perfectly, note by note, advancing the clock as it goes. */
function playFlawlessly(difficulty: number): {
  attempt: AttemptRuntime;
  result: AttemptResult;
} {
  const h = harness(difficulty);
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

/* -------------------------------------------------------------------------- */
/* Stage helpers                                                               */
/*                                                                             */
/* A minigame reaches the screen only through `render(view)`, and the view is   */
/* pure data, so these assert what would actually be drawn on the timeline with */
/* no canvas anywhere near them.                                               */
/* -------------------------------------------------------------------------- */

const ASCENT = climbConfig(ROCKY_ASCENT.config);

/**
 * A StageView as the timeline would hand one over.
 *
 * Notes are laid out left to right one beat apart, which is enough for every
 * assertion here: what matters is that a minigame positions itself *from* the
 * notes rather than from authored coordinates.
 */
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
  return {
    beat,
    notes,
    laneCount: 8,
    strikeX: 0.5,
    span: { from: 0, to: 1 },
    measure: { width: 0.4, beatWidth: 0.1 },
  };
}

/**
 * The attempt's minigame, as the concrete class.
 *
 * `AttemptRuntime.minigame` is a `Minigame` — the runtime genuinely does not
 * know it is running a climb — so a climb-specific assertion has to say so.
 */
function climbIn(attempt: AttemptRuntime): ClimbMinigame {
  const minigame = attempt.minigame;
  if (!(minigame instanceof ClimbMinigame)) throw new Error("attempt is not a climb");
  return minigame;
}

function stageOf(attempt: AttemptRuntime, beat = 0): Stage {
  return climbIn(attempt).render(viewFor(attempt, beat));
}

function spriteAt(attempt: AttemptRuntime, key: string, beat = 0): Sprite {
  const found = (stageOf(attempt, beat).sprites ?? []).find((entry) => entry.key === key);
  if (!found) throw new Error(`no sprite keyed ${key}`);
  return found;
}

/** Effect sprites, split by which `stepEffects` slot they came from. */
function effectsAt(attempt: AttemptRuntime, beat = 0): { contact: Sprite[]; accent: Sprite[] } {
  const [contactId, accentId] = ASCENT.bindings.stepEffects;
  const fx = (stageOf(attempt, beat).sprites ?? []).filter((e) => e.key.startsWith("fx-"));
  return {
    contact: fx.filter((entry) => entry.assetId === contactId),
    accent: fx.filter((entry) => entry.assetId === accentId),
  };
}

/** Where the note bar the climber should be standing on sits. */
function noteX(attempt: AttemptRuntime, opportunityIndex: number): number {
  const note = viewFor(attempt, 0).notes[opportunityIndex]!;
  return note.rect.x + note.rect.w / 2;
}

describe("ClimbMinigame on the timeline", () => {
  it("reacts on the beat the note was judged, by default", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(target.startBeat + 0.001);
    // REACTION_DELAY_BEATS is 0: the goat steps on the note, not after it.
    expect(climbIn(h.attempt).progress.noteIndex).toBe(0);
  });

  it("holds the reaction back when a delay is configured", () => {
    // There used to be a fixed ~0.28-beat gap here, carried by a streak flying
    // from the note into the scenario panel. The panel is gone; whether any
    // delay should survive it is a feel question, so it is a tuning value with
    // a seam rather than a constant nobody can try the other side of.
    const h = harness(1, { reactionDelayBeats: 0.5 });
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(target.startBeat + 0.1);
    expect(climbIn(h.attempt).progress.noteIndex).toBe(-1);

    h.advanceTo(target.startBeat + 0.6);
    expect(climbIn(h.attempt).progress.noteIndex).toBe(0);
  });

  it("waits left of the opening foothold before anything is played", () => {
    const { attempt } = harness(1);
    expect(climbIn(attempt).progress.noteIndex).toBe(-1);
    expect(climbIn(attempt).progress.successfulNotes).toBe(0);
    // A beat to the left of note 0: visibly about to start, not standing on a
    // foothold it has not earned.
    expect(spriteAt(attempt, "climber").x).toBeLessThan(noteX(attempt, 0));
  });

  it("stands on the note it just played, and only that note", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(0.01);
    expect(climbIn(h.attempt).progress.noteIndex).toBe(0);
    expect(climbIn(h.attempt).progress.successfulNotes).toBe(1);
    // Landed: well past the hop, the climber is on note 0's bar.
    expect(spriteAt(h.attempt, "climber", 4).x).toBeCloseTo(noteX(h.attempt, 0), 5);
  });

  it("advances exactly one foothold on a Good note too", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat, 0.4); // late, but successful
    h.advanceTo(0.45);
    expect(h.events.some((e) => e.type === "judgment" && e.judgment.type === "GoodNote")).toBe(true);
    expect(climbIn(h.attempt).progress.noteIndex).toBe(0);
  });

  it("hops rather than slides between footholds", () => {
    const h = harness(1);
    const [first, second] = [h.attempt.targets[0]!, h.attempt.targets[1]!];
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(first.startBeat + 0.01);
    h.advanceTo(second.startBeat);
    h.playAt(second.midi, second.startBeat);
    h.advanceTo(second.startBeat + 0.01);

    // Mid-hop the climber is above the bar it is travelling between, which a
    // straight interpolation could never produce.
    const airborne = spriteAt(h.attempt, "climber", second.startBeat + 0.11);
    const landed = spriteAt(h.attempt, "climber", second.startBeat + 4);
    expect(airborne.y).toBeLessThan(landed.y);
  });

  it("does not advance on a wrong note, and does not lose earned progress", () => {
    const h = harness(1);
    const first = h.attempt.targets[0]!;
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(0.01);
    const earned = climbIn(h.attempt).progress.noteIndex;

    const second = h.attempt.targets[1]!;
    h.playAt(second.midi + 1, second.startBeat); // a semitone off
    h.advanceTo(second.startBeat + 0.01);

    expect(climbIn(h.attempt).progress.noteIndex).toBe(earned);
    expect(climbIn(h.attempt).progress.successfulNotes).toBe(1);
    // Wobble is a lean, not a fall.
    expect(spriteAt(h.attempt, "climber", second.startBeat).rotationDeg).not.toBe(0);
  });

  it("does not advance on a miss", () => {
    const h = harness(1);
    h.advanceTo(2); // let the first two targets expire unplayed
    expect(climbIn(h.attempt).progress.noteIndex).toBe(-1);
    expect(h.events.filter((e) => e.type === "judgment" && e.judgment.type === "MissedNote").length)
      .toBeGreaterThan(0);
  });

  it("settles the wobble back onto the same foothold", () => {
    const h = harness(1);
    const first = h.attempt.targets[0]!;
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(0.01);

    const climb = climbIn(h.attempt);
    climb.onJudged({ id: 9, outcome: "wrong", opportunityIndex: null, playedMidi: 60, lane: 0, beat: 1 }, 1);
    climb.update(1.05);
    expect(spriteAt(h.attempt, "climber", 1.05).rotationDeg).not.toBe(0);

    climb.update(2);
    const after = spriteAt(h.attempt, "climber", 2);
    expect(after.rotationDeg).toBe(0);
    // Back on exactly the bar it was on. Earned progress is never taken.
    expect(after.x).toBeCloseTo(noteX(h.attempt, 0), 5);
    expect(climb.progress.noteIndex).toBe(0);
  });

  it("cycles the climber pose so consecutive steps do not look identical", () => {
    const h = harness(1);
    const poses: string[] = [];
    for (const target of h.attempt.targets.slice(0, 5)) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.01);
      poses.push(spriteAt(h.attempt, "climber", target.startBeat + 0.01).assetId);
    }
    expect(new Set(poses).size).toBeGreaterThan(1);
    for (const pose of poses) expect(ASCENT.bindings.climberPoses).toContain(pose);
  });

  it("shows a contact effect and an accent, weaker for Good than for Perfect", () => {
    const perfect = harness(1);
    const first = perfect.attempt.targets[0]!;
    perfect.playAt(first.midi, first.startBeat);
    perfect.advanceTo(0.01);
    const perfectFx = effectsAt(perfect.attempt, first.startBeat);
    expect(perfectFx.contact).toHaveLength(1);
    expect(perfectFx.accent).toHaveLength(1);

    const good = harness(1);
    good.playAt(first.midi, first.startBeat, 0.4);
    good.advanceTo(0.45);
    const goodFx = effectsAt(good.attempt, first.startBeat + 0.4);
    // Same asset, drawn smaller: Perfect reads stronger than Good.
    expect(goodFx.accent[0]!.scale).toBeLessThan(perfectFx.accent[0]!.scale!);
  });

  it("dresses every note as a foothold, lighting them as they are climbed", () => {
    const h = harness(1);
    const notes = () => stageOf(h.attempt).notes!;
    expect(notes().size).toBe(h.attempt.targets.length);
    for (const art of notes().values()) {
      expect(art.body?.assetId).toBe(ASCENT.bindings.footholdArt.body);
      expect(art.underlay?.assetId).toBe(ASCENT.bindings.footholdArt.crag);
    }
    const faded = notes().get("a0-0")!.underlay!.opacity!;

    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(0.01);
    expect(notes().get("a0-0")!.underlay!.opacity!).toBeGreaterThan(faded);
    expect(notes().get("a0-1")!.underlay!.opacity!).toBe(faded);
  });

  it("puts its background behind its own measures and nothing else", () => {
    const { attempt } = harness(1);
    expect(stageOf(attempt).background).toBe(ASCENT.bindings.background);
  });

  it("keeps its footing after the note it stands on scrolls off screen", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(0.01);
    // The host hands over EVERY note, including off-screen ones, precisely so
    // this cannot happen. A climber with no anchor would have no sprite at all.
    const climber = spriteAt(h.attempt, "climber", 15);
    expect(Number.isFinite(climber.x)).toBe(true);
    expect(climber.x).toBeCloseTo(noteX(h.attempt, 0), 5);
  });

  it("keeps climbing across all four measures with no reset", () => {
    const h = harness(1);
    const seen: number[] = [];
    for (const target of h.attempt.targets) {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      h.advanceTo(target.startBeat + 0.001);
      seen.push(climbIn(h.attempt).progress.noteIndex);
    }
    // Strictly increasing, one per note, right through the measure boundaries.
    expect(seen).toEqual([...Array(15).keys()]);
    expect(h.events.filter((e) => e.type === "measureComplete")).toHaveLength(3);
  });

  it("maps every successful note onto its own foothold at L4's 30 notes", () => {
    const { attempt } = playFlawlessly(4);
    expect(climbIn(attempt).progress.successfulNotes).toBe(30);
    expect(attempt.targets).toHaveLength(30);
  });

  it("takes the finish pose when the attempt passes", () => {
    const { attempt, result } = playFlawlessly(1);
    expect(result.passed).toBe(true);
    expect(climbIn(attempt).progress.finished).toBe(true);
    expect(spriteAt(attempt, "climber", 16).assetId).toBe(ASCENT.bindings.finishPose);
  });

  it("freezes on the furthest earned foothold when the attempt fails", () => {
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.playAt(target.midi, target.startBeat);
    h.advanceTo(16);

    const result = h.attempt.result!;
    expect(result.stars).toBe(0);
    expect(result.passed).toBe(false);
    expect(climbIn(h.attempt).progress.finished).toBe(false);
    expect(climbIn(h.attempt).progress.frozen).toBe(true);
    expect(climbIn(h.attempt).progress.noteIndex).toBe(0);
    // No bespoke failure art: still a climbing pose, just not the finish.
    expect(spriteAt(h.attempt, "climber", 16).assetId).not.toBe(ASCENT.bindings.finishPose);
  });
});

describe("a whole attempt", () => {
  it("earns three stars for a flawless L1 and updates every counter", () => {
    const { result } = playFlawlessly(1);
    expect(result).toMatchObject({
      scenarioId: "rocky_ascent",
      difficulty: 1,
      stars: 3,
      passed: true,
      perfect: 15,
      good: 0,
      missed: 0,
      wrongNotes: 0,
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.judgmentPoints).toBe(ROCKY_ASCENT.levels.get(1)!.stars.star3Threshold);
  });

  it.each([1, 2, 3, 4])("can be three-starred at L%i", (difficulty) => {
    const { result } = playFlawlessly(difficulty);
    expect(result.stars).toBe(3);
  });

  it("fails with zero stars when nothing is played", () => {
    const h = harness(2);
    h.advanceTo(16);
    expect(h.attempt.result).toMatchObject({ stars: 0, passed: false, missed: 14 });
  });

  it("survives with one star on a scruffy but mostly-right attempt", () => {
    const h = harness(1);
    h.attempt.targets.forEach((target, index) => {
      h.advanceTo(target.startBeat);
      if (index % 5 !== 0) h.playAt(target.midi, target.startBeat, 0.35); // Good
      h.advanceTo(target.startBeat + 0.4);
    });
    h.advanceTo(16);
    const result = h.attempt.result!;
    expect(result.passed).toBe(true);
    expect(result.stars).toBeGreaterThanOrEqual(1);
    expect(result.stars).toBeLessThan(3);
    expect(result.good).toBeGreaterThan(0);
  });

  it("emits energy for every judgment, with the right polarity", () => {
    const h = harness(1);
    const first = h.attempt.targets[0]!;
    h.playAt(first.midi, first.startBeat);
    h.advanceTo(0.01);
    h.playAt(first.midi + 1, 1.4);
    h.advanceTo(2.4);

    const energies = h.events.filter((e) => e.type === "energy").map((e) => e.energy);
    expect(energies[0]).toMatchObject({ polarity: "good", cause: "perfect", lane: 0 });
    expect(energies.some((e) => e.polarity === "bad" && e.cause === "wrong")).toBe(true);
    expect(energies.some((e) => e.polarity === "bad" && e.cause === "miss")).toBe(true);
  });

  it("refuses a difficulty the scenario does not author", () => {
    expect(
      () =>
        new AttemptRuntime({
          scenario: ROCKY_ASCENT,
          difficulty: 6,
          key: KEY,
          startBeat: 0,
          toBeat: (t) => t,
        })
    ).toThrow(/no authored level 6/);
  });
});

describe("run shell", () => {
  it("models 16 slots on the real difficulty sequence", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    expect(run.slots).toHaveLength(RUN_SLOT_COUNT);
    expect(run.slots.map((slot) => slot.difficulty)).toEqual([...DIFFICULTY_SEQUENCE]);
    expect(DIFFICULTY_SEQUENCE).toEqual([1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7]);
  });

  it("fills only the slots the library actually authors", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    for (const slot of run.slots) {
      const eligibleIds = scenariosForDifficulty(slot.difficulty).map((scenario) => scenario.id);
      if (eligibleIds.length === 0) {
        expect(slot.scenario).toBeNull();
      } else {
        expect(slot.scenario).not.toBeNull();
        expect(eligibleIds).toContain(slot.scenario!.id);
      }
    }
  });

  it("ends the run at the first slot nothing authors, as a content limit", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    const pass = (stars: number): AttemptResult => ({
      scenarioId: run.currentSlot!.scenario!.id,
      difficulty: run.currentSlot!.difficulty,
      stars,
      passed: stars >= 1,
      score: 100,
      judgmentPoints: 100,
      perfect: 1,
      good: 0,
      missed: 0,
      wrongNotes: 0,
      streak: 1,
      bestStreak: 1,
    });

    // DIFFICULTY_SEQUENCE is [1,2,3,4,2,3,4,5,3,4,5,6,4,5,6,7]. With Rocky
    // Ascent High and Rocky Descent High registered, every difficulty up to 6
    // is authored by something -- slots 0..14 are all difficulties 1..6, and
    // only the final slot (difficulty 7) is a real content limit.
    for (let i = 0; i < 14; i += 1) expect(run.recordResult(pass(2))).toBeNull();
    // Passing slot 14 (difficulty 6, the last authored slot) lands on slot 15,
    // difficulty 7, which nothing in the library authors.
    expect(run.recordResult(pass(2))).toBe("content-limit");
    expect(run.over).toBe(true);
    expect(run.slotsPlayed).toBe(15);
    expect(run.totalStars).toBe(30);
    expect(run.summary.ending).toBe("content-limit");
  });

  it("ends immediately on a zero-star attempt", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    const ending = run.recordResult({
      scenarioId: "rocky_ascent",
      difficulty: 1,
      stars: 0,
      passed: false,
      score: 0,
      judgmentPoints: 0,
      perfect: 0,
      good: 0,
      missed: 15,
      wrongNotes: 0,
      streak: 0,
      bestStreak: 0,
    });
    expect(ending).toBe("failed");
    expect(run.summary.rank).toBe("Hairless Baby Lamb");
  });

  it("shows the upcoming scenario before the current one ends", () => {
    const run = new RunState({ key: KEY, bpm: BPM, random: () => 0 });
    expect(run.currentSlot?.ordinal).toBe(0);
    expect(run.nextSlot?.ordinal).toBe(1);
    expect(run.previousSlot).toBeNull();
  });

  it("has a rank for every possible star total", () => {
    expect(GOAT_RANKS).toHaveLength(49);
    expect(rankForStars(0)).toBe("Hairless Baby Lamb");
    expect(rankForStars(48)).toBe("GOAT Markhor");
    expect(new Set(GOAT_RANKS).size).toBe(49);
  });
});

/**
 * Autoplay, end to end, through the same sink the app uses.
 *
 * The planner's own tests prove the gestures are well-formed; these prove the
 * tiers mean what they claim once a real judge, a real score and a real star
 * meter have had them — which is the only definition of "50% correct" that
 * matters. Scheduling `attack` + `release` pairs rather than bare attacks
 * mirrors `#scheduleAutoPerformance` exactly, releases included.
 */
function playAutoPerformance(difficulty: number, mode: AutoplayMode, seed = 7) {
  const startBeat = 20;
  const h = harness(difficulty, { startBeat });
  const performance = planAutoPerformance({
    targets: h.attempt.targets,
    mode,
    seed,
    attemptIndex: 0,
  });

  performance.gestures.forEach((gesture, index) => {
    const at = (startBeat + gesture.beat) * SECONDS_PER_BEAT;
    const id = `auto-${index}`;
    h.provider.schedule([
      { at, kind: "attack", midi: gesture.midi, id },
      { at: at + gesture.durationBeats * SECONDS_PER_BEAT, kind: "release", id },
    ]);
  });

  // Small steps, so the queue drains in order and `tick` expires targets on
  // time rather than all at once at the end.
  for (let beat = 0; beat <= 16; beat += 0.125) h.advanceTo(beat);
  const result = h.attempt.result;
  if (!result) throw new Error("attempt did not complete");
  return { performance, result };
}

describe("autoplay tiers", () => {
  it("plays a flawless attempt at 100%, worth three stars", () => {
    // The unit-level guard on browser-validate's "three stars for a flawless
    // attempt": if this tier ever stops being perfect, the browser suite starts
    // failing for a reason that has nothing to do with the browser.
    for (const difficulty of [1, 2, 3, 4]) {
      const { result } = playAutoPerformance(difficulty, "perfect");
      expect(result).toMatchObject({ missed: 0, wrongNotes: 0, good: 0, stars: 3 });
      expect(result.passed).toBe(true);
    }
  });

  it("fumbles audibly at 50%: some hits, some wrong notes, some misses", () => {
    const { result } = playAutoPerformance(3, "50");
    expect(result.perfect + result.good).toBeGreaterThan(0);
    expect(result.missed).toBeGreaterThan(0);
    expect(result.wrongNotes).toBeGreaterThan(0);
    expect(result.stars).toBeLessThan(3);
  });

  it("hits less often at 25% than at 50%, on the same seed", () => {
    for (const seed of [1, 7, 42]) {
      const half = playAutoPerformance(3, "50", seed).result;
      const quarter = playAutoPerformance(3, "25", seed).result;
      expect(quarter.perfect + quarter.good).toBeLessThan(half.perfect + half.good);
      expect(quarter.stars).toBeLessThanOrEqual(half.stars);
    }
  });

  it("intends exactly what the judge then sees, on the deterministic sink", () => {
    // The test provider injects already-judged events, so intent and outcome
    // must agree exactly here. Any drift means the planner and the judge
    // disagree about what counts as a hit.
    const { performance, result } = playAutoPerformance(2, "50");
    expect(result.perfect + result.good).toBe(performance.counts.hits);
    expect(result.missed).toBe(performance.counts.wrong + performance.counts.dropped);
  });
});
