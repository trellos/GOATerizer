/**
 * The backing-track duck: the band getting out of the way of a player who is
 * missing notes, and coming back when they stop.
 *
 * Three layers, in order:
 *
 *   1. the ladder itself, as a pure state machine — no judge, no attempt;
 *   2. the rule about which judgment events move it, which is where the
 *      deliberate decisions live (a wrong note does not duck; a clean release
 *      restores);
 *   3. the whole chain, driven by injected guitar input through a real
 *      `AttemptRuntime` and a real `TargetJudge`, because "four missed notes"
 *      has to mean four *actually missed* notes and not four calls to a method.
 *
 * The last block covers `BassPlayer.setDuck` against a fake AudioContext. That
 * is the one place a number becomes audio, and the property worth pinning is
 * that it *scales* the bass's designed level rather than replacing it.
 */

import { describe, expect, it } from "vitest";

import { BassPlayer } from "../src/audio/bass-player.js";
import type { Transport } from "../src/audio/transport.js";
import {
  BackingDuck,
  DUCK_GAIN_LADDER,
  DUCK_MAX_MISSES,
  duckInputFor,
} from "../src/game/backing-duck.js";
import { climbActor } from "../src/scenario/minigames/climb-minigame.js";
import { AttemptRuntime } from "../src/game/attempt.js";
import type { JudgmentEvent } from "../src/game/judgment.js";
import type { ResolvedTarget } from "../src/game/targets.js";
import { TestGuitarInputProvider } from "../src/input/test-provider.js";
import type { RunKey } from "../src/music/keys.js";
import { ROCKY_ASCENT } from "../src/scenario/registry.js";

const KEY: RunKey = { tonic: 7, mode: "minor" };

/** A stand-in target, for the classification tests that need one. */
const TARGET: ResolvedTarget = {
  opportunityIndex: 0,
  promptIndex: 0,
  pass: 0,
  startBeat: 0,
  durationBeats: 1,
  duration: "quarter",
  degree: { degree: 1, octaveBand: 0 },
  lane: 0,
  midi: 43,
};

describe("the gain ladder", () => {
  it("has one rung per miss, up to four", () => {
    expect(DUCK_MAX_MISSES).toBe(4);
    expect(DUCK_GAIN_LADDER).toHaveLength(DUCK_MAX_MISSES + 1);
  });

  it("starts at full volume", () => {
    expect(DUCK_GAIN_LADDER[0]).toBe(1);
  });

  it("ends almost silent, but audibly not silent", () => {
    // The bass is the player's only harmonic reference, so the bottom rung is a
    // comment on the performance and not a punishment. Quiet enough that the
    // drums are plainly the loudest thing left; loud enough to still be there.
    const bottom = DUCK_GAIN_LADDER[DUCK_MAX_MISSES]!;
    expect(bottom).toBeGreaterThan(0);
    expect(bottom).toBeLessThanOrEqual(0.15);
  });

  it("only ever goes down, and stays a multiplier", () => {
    for (const [index, gain] of DUCK_GAIN_LADDER.entries()) {
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThanOrEqual(1);
      if (index > 0) expect(gain).toBeLessThan(DUCK_GAIN_LADDER[index - 1]!);
    }
  });

  it("steps evenly by ear, which means evenly in decibels", () => {
    // A ladder that is even in *linear* gain sounds like nothing happened for
    // two rungs and then falls off a cliff. Equal ratios are equal steps to the
    // ear, so the table is authored as even decibels and then rounded to
    // readable numbers. Half a decibel of rounding error is inaudible; a whole
    // rung's worth would not be.
    const steps = DUCK_GAIN_LADDER.slice(1).map(
      (gain, index) => -20 * Math.log10(gain / DUCK_GAIN_LADDER[index]!)
    );
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 0);
    // ...and the whole ladder is worth 20 dB, a tenth of the amplitude.
    const total = -20 * Math.log10(DUCK_GAIN_LADDER[DUCK_MAX_MISSES]! / DUCK_GAIN_LADDER[0]!);
    expect(total).toBeCloseTo(20, 0);
  });
});

describe("the ladder as a state machine", () => {
  it("starts at full volume", () => {
    const duck = new BackingDuck();
    expect(duck.misses).toBe(0);
    expect(duck.gain).toBe(1);
  });

  it("gets quieter with every miss", () => {
    const duck = new BackingDuck();
    let previous = duck.gain;
    for (let i = 1; i <= DUCK_MAX_MISSES; i += 1) {
      const gain = duck.missed();
      expect(duck.misses).toBe(i);
      expect(gain).toBeLessThan(previous);
      previous = gain;
    }
  });

  it("is almost silent after four misses and goes no lower", () => {
    const duck = new BackingDuck();
    for (let i = 0; i < DUCK_MAX_MISSES; i += 1) duck.missed();
    const bottom = duck.gain;
    expect(bottom).toBe(DUCK_GAIN_LADDER[DUCK_MAX_MISSES]);

    // A player having a genuinely bad minute does not get progressively more
    // silence; there is a floor and it is reached in four.
    for (let i = 0; i < 20; i += 1) duck.missed();
    expect(duck.gain).toBe(bottom);
    expect(duck.misses).toBe(DUCK_MAX_MISSES);
  });

  it("takes exactly four correct events to restore from the bottom", () => {
    const duck = new BackingDuck();
    for (let i = 0; i < DUCK_MAX_MISSES; i += 1) duck.missed();

    for (let i = 1; i < DUCK_MAX_MISSES; i += 1) {
      duck.correct();
      expect(duck.gain).toBeLessThan(1);
    }
    expect(duck.correct()).toBe(1);
  });

  it("is symmetric: one rung down per miss, one rung up per correct event", () => {
    const duck = new BackingDuck();
    duck.missed();
    duck.missed();
    const twoDown = duck.gain;
    duck.correct();
    duck.missed();
    expect(duck.gain).toBe(twoDown);
  });

  it("never goes above full volume however well the player is doing", () => {
    const duck = new BackingDuck();
    for (let i = 0; i < 10; i += 1) duck.correct();
    expect(duck.gain).toBe(1);
    expect(duck.misses).toBe(0);
    // ...and one miss from full still costs exactly one rung.
    expect(duck.missed()).toBe(DUCK_GAIN_LADDER[1]);
  });

  it("resets to full volume, which is what a new attempt gets", () => {
    const duck = new BackingDuck();
    duck.missed();
    duck.missed();
    duck.reset();
    expect(duck.gain).toBe(1);
    expect(duck.misses).toBe(0);
  });
});

describe("which judgments move the duck", () => {
  const missed: JudgmentEvent = { type: "MissedNote", target: TARGET };
  const perfect: JudgmentEvent = {
    type: "PerfectNote",
    target: TARGET,
    attackId: "a",
    playedMidi: TARGET.midi,
    beatDelta: 0,
  };
  const good: JudgmentEvent = {
    type: "GoodNote",
    target: TARGET,
    attackId: "a",
    playedMidi: TARGET.midi,
    beatDelta: 0.3,
    reason: "timing",
  };
  const released: JudgmentEvent = {
    type: "NoteReleasedOnTime",
    target: TARGET,
    attackId: "a",
    beatDelta: 0,
  };
  const wrong: JudgmentEvent = {
    type: "WrongNote",
    attackId: "w",
    playedMidi: 44,
    atBeat: 0.2,
    diatonic: false,
    lanePosition: 0.5,
  };

  it("ducks on a missed note, which is the user's own rule", () => {
    expect(duckInputFor(missed)).toBe("missed");
  });

  it("restores on a note started on time", () => {
    expect(duckInputFor(perfect)).toBe("correct");
    expect(duckInputFor(good)).toBe("correct");
  });

  it("restores on a note ended on time", () => {
    expect(duckInputFor(released)).toBe("correct");
  });

  it("does not duck on a wrong note", () => {
    // A wrong note does not consume its target: the target stays open, and if
    // the player never lands it, it expires as a MissedNote and *that* ducks.
    // Ducking here as well would charge one fumble twice, and would punish
    // reaching for the right fret more than not reaching at all.
    expect(duckInputFor(wrong)).toBeNull();
  });

  it("ignores bookkeeping events", () => {
    expect(duckInputFor({ type: "TargetResolved", target: TARGET, outcome: "miss" })).toBeNull();
    expect(duckInputFor({ type: "PlayedNoteRevised", attackId: "a", playedMidi: 44 })).toBeNull();
  });

  it("counts each judgment once, not once per accompanying event", () => {
    // Every resolution emits its own event *and* a TargetResolved. If both
    // counted, one miss would be worth two rungs and the ladder would be a
    // two-rung ladder wearing a five-rung coat.
    const duck = new BackingDuck();
    duck.apply(missed);
    duck.apply({ type: "TargetResolved", target: TARGET, outcome: "miss" });
    expect(duck.misses).toBe(1);
  });

  it("reports the gain even for an event that changes nothing", () => {
    const duck = new BackingDuck();
    duck.missed();
    expect(duck.apply(wrong)).toBe(duck.gain);
  });
});

/* -------------------------------------------------------------------------- */
/* The whole chain                                                             */
/* -------------------------------------------------------------------------- */

const BPM = 120;
const SECONDS_PER_BEAT = 60 / BPM;

/**
 * An attempt with a duck wired to it exactly the way `game-app.ts` will wire
 * one, driven by injected guitar input on a fake audio clock.
 *
 * `startBeat` is not 0 on purpose: an attempt begins wherever the continuous
 * transport happens to be, and a release forwarded without the attempt-relative
 * conversion would still look right at 0.
 */
function harness(difficulty: number, startBeat = 20) {
  const provider = new TestGuitarInputProvider();
  const attempt = new AttemptRuntime({
    scenario: ROCKY_ASCENT,
    difficulty,
    key: KEY,
    startBeat,
    toBeat: (contextTime: number) => contextTime / SECONDS_PER_BEAT,
  });

  const duck = new BackingDuck();
  const gains: number[] = [];
  attempt.onEvent((event) => {
    if (event.type !== "judgment") return;
    gains.push(duck.apply(event.judgment));
  });

  provider.onEvent((event) => attempt.handleGuitarEvent(event));
  void provider.start();

  const time = (attemptBeat: number) => (startBeat + attemptBeat) * SECONDS_PER_BEAT;

  return {
    attempt,
    duck,
    gains,
    /** Expires everything whose window has closed by this attempt beat. */
    advanceTo: (attemptBeat: number) => attempt.update(startBeat + attemptBeat),
    /** An attack, at an attempt-relative beat. Returns the played-note id. */
    playAt: (midi: number, attemptBeat: number) => provider.attack(midi, time(attemptBeat)),
    releaseAt: (id: string, attemptBeat: number) => provider.release(id, time(attemptBeat)),
  };
}

describe("ducking a real attempt", () => {
  it("gets quieter with each missed target and is almost silent after four", () => {
    const h = harness(1);
    const gainsAfterEachMiss: number[] = [];
    for (const target of h.attempt.targets.slice(0, 4)) {
      h.advanceTo(target.startBeat + 0.6); // past its Good window: a real miss
      gainsAfterEachMiss.push(h.duck.gain);
    }

    expect(h.duck.misses).toBe(4);
    expect(gainsAfterEachMiss).toEqual([...DUCK_GAIN_LADDER].slice(1));
    expect(h.duck.gain).toBeGreaterThan(0);
  });

  it("comes back over four correctly started notes", () => {
    const h = harness(1);
    for (const target of h.attempt.targets.slice(0, 4)) h.advanceTo(target.startBeat + 0.6);
    expect(h.duck.gain).toBeLessThan(1);

    // Four clean attacks and nothing else — no releases, so this is the "starts
    // a note at the correct time" half of the rule on its own.
    const recovering = h.attempt.targets.slice(4, 8);
    recovering.forEach((target, index) => {
      h.advanceTo(target.startBeat);
      h.playAt(target.midi, target.startBeat);
      if (index < recovering.length - 1) expect(h.duck.gain).toBeLessThan(1);
    });
    expect(h.duck.gain).toBe(1);
  });

  it("comes back twice as fast when the player also releases on time", () => {
    const h = harness(1);
    for (const target of h.attempt.targets.slice(0, 4)) h.advanceTo(target.startBeat + 0.6);

    // Two notes, each played and let go where the prompt says: four correct
    // events, so back to full. Starting one *or* ending one counts, and a note
    // that does both is worth both.
    for (const target of h.attempt.targets.slice(4, 6)) {
      h.advanceTo(target.startBeat);
      const id = h.playAt(target.midi, target.startBeat);
      h.releaseAt(id, target.startBeat + target.durationBeats);
    }
    expect(h.duck.gain).toBe(1);
  });

  it("is not restored by letting go of a note that was never right", () => {
    const h = harness(1);
    for (const target of h.attempt.targets.slice(0, 4)) h.advanceTo(target.startBeat + 0.6);
    const bottom = h.duck.gain;

    const target = h.attempt.targets[4]!;
    h.advanceTo(target.startBeat);
    const id = h.playAt(target.midi + 1, target.startBeat); // a semitone off
    h.releaseAt(id, target.startBeat + target.durationBeats);
    expect(h.duck.gain).toBe(bottom);
  });

  it("is not restored by a note dropped nowhere near its end", () => {
    const h = harness(1);
    for (const target of h.attempt.targets.slice(0, 4)) h.advanceTo(target.startBeat + 0.6);

    const target = h.attempt.targets[4]!;
    h.advanceTo(target.startBeat);
    const id = h.playAt(target.midi, target.startBeat);
    const afterAttack = h.duck.gain; // the attack itself was correct: one rung
    h.releaseAt(id, target.startBeat + 0.05); // let go almost immediately
    expect(h.duck.gain).toBe(afterAttack);
  });

  it("leaves the score, the stars and the goat alone when a release lands", () => {
    // The whole reason a release is allowed to exist as a judgment event.
    const h = harness(1);
    const target = h.attempt.targets[0]!;
    h.advanceTo(target.startBeat);
    const id = h.playAt(target.midi, target.startBeat);

    const score = h.attempt.score.snapshot;
    const stars = h.attempt.starMeter.stars;
    const actor = climbActor(h.attempt.minigame);

    h.releaseAt(id, target.startBeat + target.durationBeats);

    expect(h.attempt.score.snapshot).toEqual(score);
    expect(h.attempt.starMeter.stars).toBe(stars);
    // The goat does not take a second step because a note ended tidily.
    expect(climbActor(h.attempt.minigame)).toEqual(actor);
    // ...and it really did happen, so the assertions above mean something.
    expect(h.duck.gain).toBe(1);
    expect(h.gains).toHaveLength(3); // PerfectNote, TargetResolved, release
  });

  it("stays full for a flawless run of notes", () => {
    const h = harness(1);
    for (const target of h.attempt.targets.slice(0, 8)) {
      h.advanceTo(target.startBeat);
      const id = h.playAt(target.midi, target.startBeat);
      h.releaseAt(id, target.startBeat + target.durationBeats);
    }
    expect(h.duck.gain).toBe(1);
    expect(h.gains.every((gain) => gain === 1)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Where the number becomes audio                                              */
/* -------------------------------------------------------------------------- */

class FakeAudioParam {
  value = 0;
  readonly ramps: { to: number; at: number }[] = [];

  cancelScheduledValues(_when: number): void {}

  setValueAtTime(value: number, _when: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number, when: number): void {
    this.ramps.push({ to: value, at: when });
    // The fake runs every ramp to completion at once. These tests are about
    // where the gain is aimed, not about the shape of the curve.
    this.value = value;
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam();
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  currentTime = 3.5;
  readonly gains: FakeGainNode[] = [];

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }
}

function bassHarness() {
  const context = new FakeAudioContext();
  const bass = new BassPlayer(
    context as unknown as AudioContext,
    {} as unknown as Transport,
    {} as unknown as AudioNode
  );
  const output = context.gains[0]!;
  return { context, bass, output, base: output.gain.value };
}

describe("BassPlayer.setDuck", () => {
  it("starts unducked at the bass's own designed level", () => {
    const { bass, base } = bassHarness();
    expect(bass.duck).toBe(1);
    expect(base).toBeGreaterThan(0);
  });

  it("scales that level rather than replacing it", () => {
    // The point of the whole method. "The bass is subordinate by design" is one
    // decision and lives in one place; "the player is missing notes" is another.
    // A duck that assigned an absolute gain would quietly become the second
    // place the first decision is made.
    const { bass, output, base } = bassHarness();
    bass.setDuck(0.5);
    expect(output.gain.ramps.at(-1)?.to).toBeCloseTo(base * 0.5, 9);
  });

  it("ramps instead of stepping, so a miss does not answer with a click", () => {
    const { context, bass, output } = bassHarness();
    bass.setDuck(0.32);
    const ramp = output.gain.ramps.at(-1)!;
    expect(ramp.at).toBeGreaterThan(context.currentTime);
    // Tens of milliseconds: inaudible as an edge, still clearly a response to
    // the note that just went wrong rather than a slow fade.
    expect(ramp.at - context.currentTime).toBeLessThan(0.2);
  });

  it("restores exactly the level it started from", () => {
    const { bass, output, base } = bassHarness();
    for (const gain of DUCK_GAIN_LADDER) bass.setDuck(gain);
    bass.setDuck(1);
    expect(output.gain.value).toBeCloseTo(base, 9);
    expect(bass.duck).toBe(1);
  });

  it("does not re-ramp to a level it is already at", () => {
    // The caller pushes the duck's gain after every judgment event, most of
    // which change nothing; stacking a ramp per note would be pointless work
    // and would keep restarting the previous one.
    const { bass, output } = bassHarness();
    bass.setDuck(1);
    expect(output.gain.ramps).toHaveLength(0);
    bass.setDuck(0.32);
    bass.setDuck(0.32);
    expect(output.gain.ramps).toHaveLength(1);
  });

  it("clamps anything out of range instead of inverting or amplifying", () => {
    const { bass, output, base } = bassHarness();
    bass.setDuck(-1);
    expect(bass.duck).toBe(0);
    expect(output.gain.ramps.at(-1)?.to).toBe(0);
    bass.setDuck(5);
    expect(bass.duck).toBe(1);
    expect(output.gain.ramps.at(-1)?.to).toBeCloseTo(base, 9);
  });
});
