/**
 * THREE-STEP, the Triplets family: the A/B/C role, what a judged note does to
 * it, and what survives a measure line.
 *
 * The load-bearing test in here is the first one. Deriving A/B/C from
 * `index % 3` passes every uniform phrase and fails silently on the ones a real
 * scenario contains — a rest through a partial, a quarter note between groups,
 * two groups back to back — so the cases below are chosen to be exactly the
 * ones a counting implementation gets wrong.
 */

import { describe, expect, it } from "vitest";

import type { Judged, NoteDuration, Opportunity, StageView } from "../src/minigame/api.js";
import { MINIGAME_API_VERSION } from "../src/minigame/api.js";
import {
  stepOf,
  THREE_STEP_MINIGAME,
  ThreeStepMinigame,
  threeStepConfig,
  threeStepGroups,
  threeStepLevel,
  TUMBLE_BEATS,
} from "../src/scenario/minigames/three-step-minigame.js";
import { BUTT_BUTT_BONK, SCENARIOS } from "../src/scenario/registry.js";
import { subdivisionsOf } from "../src/game/subdivisions.js";

function opportunity(
  index: number,
  startBeat: number,
  lane = 0,
  duration: NoteDuration = "eighthTriplet"
): Opportunity {
  return {
    index,
    startBeat,
    durationBeats: duration === "eighthTriplet" ? 1 / 3 : 1,
    duration,
    lane,
    midi: 60 + lane,
  };
}

function judged(index: number, outcome: Judged["outcome"], beat: number): Judged {
  return { id: index, outcome, opportunityIndex: index, playedMidi: 60, lane: 0, beat };
}

/** A minimal stage view: the host owns all of this, so a test may state it flatly. */
function view(beat = 0.7): StageView {
  return {
    beat,
    notes: [],
    laneCount: 8,
    strikeX: 0.3,
    span: { from: 0, to: 1 },
    measure: { width: 0.4, beatWidth: 0.1 },
  };
}

/** A running instance over the given opportunities, using the real scenario's config. */
function instance(opportunities: readonly Opportunity[]) {
  return THREE_STEP_MINIGAME.create({
    config: BUTT_BUTT_BONK.config,
    data: BUTT_BUTT_BONK.levels.get(1)?.data,
    assets: [],
    plan: { measures: 4, beatsPerMeasure: 4, totalBeats: 16, phraseBeats: 16 },
    opportunities,
  });
}

describe("the A/B/C role comes from position within the beat", () => {
  it("reads the three partials of a beat", () => {
    expect(stepOf(opportunity(0, 0))).toBe("a");
    expect(stepOf(opportunity(1, 1 / 3))).toBe("b");
    expect(stepOf(opportunity(2, 2 / 3))).toBe("c");
  });

  it("reads them the same in any beat of any measure", () => {
    expect(stepOf(opportunity(0, 9))).toBe("a");
    expect(stepOf(opportunity(1, 9 + 1 / 3))).toBe("b");
    expect(stepOf(opportunity(2, 9 + 2 / 3))).toBe("c");
  });

  it("is not index % 3 — a rested first partial does not shift the roles", () => {
    // The group's A is a rest, so the two notes are at 1/3 and 2/3. Counting
    // opportunities would call them A and B; they are B and C.
    expect(stepOf(opportunity(0, 1 / 3))).toBe("b");
    expect(stepOf(opportunity(1, 2 / 3))).toBe("c");
  });

  it("is not index % 3 — a quarter note between groups does not shift them", () => {
    const afterAQuarter = [opportunity(1, 2), opportunity(2, 2 + 1 / 3), opportunity(3, 2 + 2 / 3)];
    expect(afterAQuarter.map(stepOf)).toEqual(["a", "b", "c"]);
  });

  it("gives a non-triplet note no role at all rather than a wrong one", () => {
    expect(stepOf(opportunity(0, 0, 0, "quarter"))).toBeNull();
  });
});

describe("a judged note becomes a step", () => {
  it("credits a group only when both taps landed before the headbutt", () => {
    const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    minigame.onJudged(judged(1, "perfect", 1 / 3), 1 / 3);
    expect(threeStepGroups(minigame)).toBe(0);
    minigame.onJudged(judged(2, "perfect", 2 / 3), 2 / 3);
    expect(threeStepGroups(minigame)).toBe(1);
  });

  it("does not credit a group whose tap was missed", () => {
    const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    minigame.onJudged(judged(1, "miss", 1 / 3), 1 / 3);
    minigame.onJudged(judged(2, "perfect", 2 / 3), 2 / 3);
    expect(threeStepGroups(minigame)).toBe(0);
  });

  it("does not credit a group broken by a wrong note", () => {
    const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    minigame.onJudged({ ...judged(1, "wrong", 1 / 3), opportunityIndex: null }, 1 / 3);
    minigame.onJudged(judged(2, "perfect", 2 / 3), 2 / 3);
    expect(threeStepGroups(minigame)).toBe(0);
  });

  it("counts a Good note toward a group, the same as a Perfect one", () => {
    const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "good", 0), 0);
    minigame.onJudged(judged(1, "good", 1 / 3), 1 / 3);
    minigame.onJudged(judged(2, "good", 2 / 3), 2 / 3);
    expect(threeStepGroups(minigame)).toBe(1);
  });
});

describe("what a measure line resets, and what it does not", () => {
  it("stands the target back up but keeps the attempt-global group count", () => {
    const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    minigame.onJudged(judged(1, "perfect", 1 / 3), 1 / 3);
    minigame.onJudged(judged(2, "perfect", 2 / 3), 2 / 3);
    expect(threeStepGroups(minigame)).toBe(1);

    minigame.onMeasure(1, 4);
    // AGENTS.md §9: a visual-cycle reset never resets attempt-global state.
    expect(threeStepGroups(minigame)).toBe(1);
  });
});

describe("the authored escalation", () => {
  it("switches to the alternate ending only after the level's own group count", () => {
    // "after N landed groups" means group N+1 is the first altered one: the
    // pose is chosen during a group's third partial, before that group has been
    // credited. `alternateAfterGroups` is authored per level, so this is the
    // test that the parameter is read rather than parsed and ignored.
    const level = threeStepLevel(BUTT_BUTT_BONK.levels.get(1)?.data);
    const opportunities: Opportunity[] = [];
    for (let i = 0; i < 60; i += 1) {
      opportunities.push(opportunity(i, Math.floor(i / 3) + (i % 3) / 3, i % 8));
    }
    const minigame = instance(opportunities);
    let played = 0;
    const ramAfter = (groups: number): string | undefined => {
      for (let g = 0; g < groups; g += 1, played += 1) {
        for (let partial = 0; partial < 3; partial += 1) {
          minigame.onJudged(judged(played * 3 + partial, "perfect", 0), 0);
        }
      }
      return minigame.render(view()).sprites?.find((sprite) => sprite.key === "ram")?.assetId;
    };

    expect(ramAfter(level.alternateAfterGroups)).toBe("goat_butt_butt_bonk_step_3");
    expect(ramAfter(1)).toBe("goat_butt_butt_bonk_step_3_alt");
  });

  it("keeps every sprite inside the contract's 0..1 opacity range", () => {
    const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    minigame.onJudged(judged(2, "perfect", 2 / 3), 2 / 3);
    for (const sprite of minigame.render(view()).sprites ?? []) {
      if (sprite.opacity === undefined) continue;
      expect(sprite.opacity).toBeGreaterThanOrEqual(0);
      expect(sprite.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("rides in with its first measure and out with its last, rather than standing at the line early", () => {
    const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    const wolfAt = (span: { from: number; to: number }, beat: number) => {
      const sprites = minigame.render({ ...view(beat), span }).sprites ?? [];
      return sprites.find((sprite) => sprite.key === "target")!;
    };
    const ahead = 0.1 * 0.35; // TARGET_AHEAD_BEATS * beatWidth
    // During play: at the strike line.
    expect(wolfAt({ from: -0.5, to: 1.1 }, 0.7).x).toBeCloseTo(0.3 + ahead, 9);
    // Before its measures reach the line: at its own first measure line.
    expect(wolfAt({ from: 0.9, to: 2.5 }, -6).x).toBeCloseTo(0.9 + ahead, 9);
    // After its last measure has passed: leaving with it.
    expect(wolfAt({ from: -1.6, to: 0.1 }, 34).x).toBeCloseTo(0.1 + ahead, 9);
  });

  it("bounds the effect list under a dense passage", () => {
    const opportunities: Opportunity[] = [];
    for (let i = 0; i < 60; i += 1) {
      opportunities.push(opportunity(i, Math.floor(i / 3) + (i % 3) / 3));
    }
    const minigame = instance(opportunities);
    for (let i = 0; i < 40; i += 1) minigame.onJudged(judged(i, "perfect", 0), 0);
    const effects = (minigame.render(view()).sprites ?? []).filter((s) => s.key.startsWith("fx-"));
    expect(effects.length).toBeLessThanOrEqual(6);
  });
});

describe("the headbutt is a round trip", () => {
  /** The x the ram is drawn at on this frame, after letting it decay to it. */
  function ramX(minigame: ReturnType<typeof instance>, beat: number): number {
    minigame.update(beat);
    const ram = minigame.render(view(beat)).sprites?.find((sprite) => sprite.key === "ram");
    if (!ram) throw new Error("no ram on stage");
    return ram.x;
  }

  /** A group whose headbutt lands on a different lane from its taps. */
  function afterAHeadbutt() {
    const group = [opportunity(0, 0, 0), opportunity(1, 1 / 3, 0), opportunity(2, 2 / 3, 5)];
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    minigame.onJudged(judged(1, "perfect", 1 / 3), 1 / 3);
    minigame.onJudged(judged(2, "perfect", 2 / 3), 2 / 3);
    return minigame;
  }

  // `view()` puts the strike line at 0.3 with a beat 0.1 wide, so the ram rests
  // at 0.18 and the headbutt lands it at 0.23.
  const REST_X = 0.18;
  const LANDING_X = 0.23;

  it("arrives at the wolf, and is home again a third of a beat later", () => {
    const minigame = afterAHeadbutt();
    expect(ramX(minigame, 2 / 3)).toBeCloseTo(REST_X, 6);
    expect(ramX(minigame, 1)).toBeCloseTo(LANDING_X, 6);
    expect(ramX(minigame, 1 + 1 / 3)).toBeCloseTo(REST_X, 6);
    // And stays there rather than drifting once the leap state is dropped.
    expect(ramX(minigame, 2)).toBeCloseTo(REST_X, 6);
  });

  it("never crosses the gap in one frame", () => {
    // The bug this pins: the leap used to be dropped the moment it finished, so
    // the ram lunged at the wolf and was home on the very next frame. The whole
    // trip is 0.05 wide; a teleport puts all of it into one frame, and an arc
    // spends it over twenty.
    const minigame = afterAHeadbutt();
    let previous = ramX(minigame, 2 / 3);
    let biggestStep = 0;
    for (let beat = 2 / 3; beat <= 2.5; beat += 1 / 60) {
      const x = ramX(minigame, beat);
      biggestStep = Math.max(biggestStep, Math.abs(x - previous));
      previous = x;
    }
    expect(biggestStep).toBeLessThan((LANDING_X - REST_X) / 4);
  });
});

describe("the battle", () => {
  const group = [opportunity(0, 0), opportunity(1, 1 / 3), opportunity(2, 2 / 3)];
  const spriteOf = (minigame: ReturnType<typeof instance>, key: string, beat: number) => {
    const sprite = minigame.render(view(beat)).sprites?.find((s) => s.key === key);
    if (!sprite) throw new Error(`no ${key} on stage`);
    return sprite;
  };
  const battleOf = (minigame: ReturnType<typeof instance>) => (minigame as ThreeStepMinigame).battle;

  it("grows the ram on a landed note, and lifts it, and never shrinks it on a miss", () => {
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    expect(battleOf(minigame).ram).toBeGreaterThan(0);
    const ramNow = spriteOf(minigame, "ram", 2);
    // Bigger than the family's base scale, once the pulse has passed, and
    // lifted off its lane.
    expect(ramNow.scale!).toBeGreaterThan(0.62);
    expect(ramNow.y).toBeLessThan(1 - 0.5 / 8);
    const grown = battleOf(minigame).ram;
    minigame.onJudged(judged(1, "miss", 1 / 3), 1 / 3);
    expect(battleOf(minigame).ram).toBe(grown);
  });

  it("pulses on the step that grew it, then settles at its new size", () => {
    const minigame = instance(group);
    minigame.onJudged(judged(0, "perfect", 0), 0);
    const mid = spriteOf(minigame, "ram", 0.15).scale!;
    const settled = spriteOf(minigame, "ram", 1).scale!;
    expect(mid).toBeGreaterThan(settled);
    expect(settled).toBeGreaterThan(0.62);
  });

  it("grows the wolf and flashes it red on a miss or a wrong note, and the flash fades", () => {
    const minigame = instance(group);
    minigame.onJudged(judged(0, "miss", 0), 0);
    expect(battleOf(minigame).wolf).toBeGreaterThan(0);
    const flashing = spriteOf(minigame, "target", 0.05);
    expect(flashing.tint?.colour).toBe("#ff3b3b");
    expect(flashing.tint?.amount).toBeGreaterThan(0);
    expect(flashing.scale!).toBeGreaterThan(0.62);
    const faded = spriteOf(minigame, "target", 0.5);
    expect(faded.tint).toBeUndefined();
    minigame.onJudged({ id: 9, outcome: "wrong", opportunityIndex: null, playedMidi: 61, lane: 1, beat: 0.6 }, 0.6);
    expect(battleOf(minigame).wolf).toBeGreaterThan(1 / 3 - 1e-9);
  });

  it("caps growth at full size", () => {
    const minigame = instance(group);
    for (let i = 0; i < 20; i += 1) minigame.onJudged(judged(0, "perfect", i), i);
    expect(battleOf(minigame).ram).toBe(1);
  });

  it("tumbles the wolf upside down off the bottom when the fight is won, and leaves it there", () => {
    const minigame = instance(group);
    minigame.onStarEarned(1, 2);
    expect(battleOf(minigame).won).toBe(true);
    const standing = spriteOf(minigame, "target", 15.9);
    minigame.onComplete(true, 1, 16);
    expect(battleOf(minigame).tumbling).toBe(true);
    const mid = spriteOf(minigame, "target", 16 + TUMBLE_BEATS / 2);
    expect(mid.rotationDeg!).toBeGreaterThan(0);
    expect(mid.rotationDeg!).toBeLessThan(180);
    expect(mid.y).toBeGreaterThan(standing.y);
    const down = spriteOf(minigame, "target", 16 + TUMBLE_BEATS + 0.01);
    expect(down.rotationDeg).toBe(180);
    expect(down.y).toBeGreaterThan(1);
    // Still there, still down, well after — it rides out with the measures.
    const later = spriteOf(minigame, "target", 19);
    expect(later.rotationDeg).toBe(180);
    expect(later.y).toBe(down.y);
  });

  it("leaves the wolf standing after a failed attempt", () => {
    const minigame = instance(group);
    minigame.onComplete(false, 0, 16);
    expect(battleOf(minigame).tumbling).toBe(false);
    const wolf = spriteOf(minigame, "target", 17);
    expect(wolf.rotationDeg ?? 0).toBe(0);
    expect(wolf.y).toBe(spriteOf(minigame, "target", 15).y);
  });
});

describe("the module's own parsers", () => {
  it("is registered against the current API version", () => {
    expect(THREE_STEP_MINIGAME.apiVersion).toBe(MINIGAME_API_VERSION);
    expect(THREE_STEP_MINIGAME.id).toBe("ThreeStepMinigame");
  });

  it("throws on a level that authors no triplet at all", () => {
    expect(() =>
      THREE_STEP_MINIGAME.parseLevel(
        {
          measurePlan: { visualSpanMeasures: 1 },
          visual: { alternateAfterGroups: 2 },
          prompt: [{ type: "note", duration: "quarter" }],
        },
        { noteOpportunityCount: 1, measures: 4 }
      )
    ).toThrow(/at least one eighthTriplet/);
  });

  it("throws on triplets that do not divide into whole groups", () => {
    expect(() =>
      THREE_STEP_MINIGAME.parseLevel(
        {
          measurePlan: { visualSpanMeasures: 1 },
          visual: { alternateAfterGroups: 2 },
          prompt: [
            { type: "note", duration: "eighthTriplet" },
            { type: "note", duration: "eighthTriplet" },
          ],
        },
        { noteOpportunityCount: 2, measures: 4 }
      )
    ).toThrow(/whole groups of three/);
  });

  it("throws on a missing asset slot, naming the slot", () => {
    expect(() =>
      THREE_STEP_MINIGAME.parseConfig({ assetBindings: { background: ["bg"] }, classParameters: {} })
    ).toThrow(/stepAPoseOrEffect/);
  });

  it("declares every bound asset so the host can preload it", () => {
    const ids = THREE_STEP_MINIGAME.assetIds(BUTT_BUTT_BONK.config, []);
    expect(ids).toContain("bg_butt_butt_bonk");
    expect(ids).toContain("goat_butt_butt_bonk_step_3");
    expect(ids).toContain("prop_butt_butt_bonk_target_hit");
    expect(ids).toContain("fx_butt_butt_bonk_accent");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Butt-Butt-BONK, as authored", () => {
  it("is registered and covers L1-6", () => {
    expect(SCENARIOS.map((s) => s.id)).toContain("butt_butt_bonk");
    expect(BUTT_BUTT_BONK.minigameId).toBe("ThreeStepMinigame");
    expect([...BUTT_BUTT_BONK.levels.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("binds the target's two states in slot order: standing, then bonked", () => {
    const config = threeStepConfig(BUTT_BUTT_BONK.config);
    expect(config.targetVisuals[0]).toBe("prop_butt_butt_bonk_target");
    expect(config.targetVisuals[1]).toBe("prop_butt_butt_bonk_target_hit");
  });

  it("authors every note opportunity as a triplet partial with a real role", () => {
    for (const [difficulty, level] of BUTT_BUTT_BONK.levels) {
      const notes = level.prompt.filter((event) => event.type === "note");
      for (const note of notes) {
        const role = stepOf({
          index: note.index,
          startBeat: note.startBeat,
          durationBeats: note.durationBeats,
          duration: note.duration,
          lane: 0,
          midi: 60,
        });
        expect(role, `L${difficulty} note at beat ${note.startBeat} has no A/B/C role`).not.toBeNull();
      }
      expect(notes.length % 3, `L${difficulty} does not divide into groups`).toBe(0);
    }
  });

  it("is the content that finally selects the triplet drum variant", () => {
    // `docs/IDEAS.md`: the triplet rhythm variant was built, tested and unheard
    // because nothing authored a triplet. This is the scenario that changes it.
    for (const [difficulty, level] of BUTT_BUTT_BONK.levels) {
      const grids = subdivisionsOf(level.prompt);
      expect(grids.has("triplet"), `L${difficulty} does not read as triplets`).toBe(true);
      expect(grids.has("sixteenth"), `L${difficulty} would mix two feels`).toBe(false);
    }
  });

  it("sets ★★★ at every opportunity taken at Perfect, across both repeats", () => {
    for (const [difficulty, level] of BUTT_BUTT_BONK.levels) {
      expect(level.stars.star3Threshold, `L${difficulty}`).toBe(level.noteOpportunityCount * 2 * 10);
      expect(level.stars.provisional).toBe(true);
    }
  });

  it("is streak-eligible, unlike the Scale family", () => {
    for (const [, level] of BUTT_BUTT_BONK.levels) {
      expect(level.scoring.streakBonusEligible).toBe(true);
    }
  });

  it("escalates note count with difficulty and never goes backwards", () => {
    const counts = [...BUTT_BUTT_BONK.levels.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, level]) => level.noteOpportunityCount);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1] as number);
    }
  });

  it("parses its level data through its own parser", () => {
    const level = threeStepLevel(BUTT_BUTT_BONK.levels.get(1)?.data);
    expect(level.visualSpanMeasures).toBe(1);
    expect(level.resetBetweenMeasures).toBe(true);
    expect(level.alternateAfterGroups).toBeGreaterThan(0);
  });
});
