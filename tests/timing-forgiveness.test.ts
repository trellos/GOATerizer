/**
 * How the judge behaves for a player whose whole performance is shifted.
 *
 * A systematic offset is the common failure on a real rig — uncompensated
 * interface latency, a browser that under-reports its output latency — and it
 * is the one thing a player cannot fix by playing better, because to them they
 * are dead on the beat.
 *
 * The old half-the-gap window clamp handled it very badly, and badly in a way
 * no unit test noticed because every test played on time. Past a quarter of a
 * beat on eighth material, a note arrives after its own target has expired and
 * is offered to the next one — which is a different pitch, so it is rejected.
 * The player is charged twice for one late note: a miss *and* a wrong note.
 * Sixty targets, a hundred and twelve failures, and it arrives as a cliff
 * rather than as a slope, so the game goes from playable to unplayable inside
 * about thirty milliseconds of extra latency.
 *
 * These tests pin the tolerance as a *behaviour* — how far out of time a whole
 * performance can be before the judge stops recognising it — rather than as the
 * arithmetic that produces the windows.
 */

import { describe, expect, it } from "vitest";

import { TargetJudge, type JudgmentEvent } from "../src/game/judgment.js";
import { resolveTargets, type ResolvedTarget } from "../src/game/targets.js";
import { CAN_CRUSHING, ROCKY_ASCENT } from "../src/scenario/registry.js";
import type { RunKey } from "../src/music/keys.js";
import type { ScenarioDefinition } from "../src/scenario/types.js";

const KEY: RunKey = { tonic: 7, mode: "minor" };

function levelTargets(difficulty: number, scenario: ScenarioDefinition = ROCKY_ASCENT) {
  return resolveTargets(scenario.levels.get(difficulty)!, KEY);
}

/**
 * Plays every target's own pitch, `offset` beats out, with a little jitter.
 *
 * The judge is ticked forward as the transport would tick it, so targets expire
 * when they really would. Without that a late note is judged against a target
 * that should already have been given up on, and the whole failure this file is
 * about disappears.
 */
function performance(targets: readonly ResolvedTarget[], offset: number, jitter = 0.04) {
  const events: JudgmentEvent[] = [];
  const judge = new TargetJudge({ targets, key: KEY });
  judge.onEvent((event) => events.push(event));

  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  const plays = targets
    .map((target, index) => ({
      midi: target.midi,
      beat: target.startBeat + offset + random() * jitter * 2,
      index,
    }))
    .sort((a, b) => a.beat - b.beat);

  let last = -Infinity;
  for (const play of plays) {
    if (play.beat > last) {
      judge.tick(play.beat);
      last = play.beat;
    }
    judge.attack(`a${play.index}`, play.midi, play.beat);
  }
  judge.tick(targets[targets.length - 1]!.startBeat + 8);

  const count = (type: string) => events.filter((event) => event.type === type).length;
  return { failures: count("MissedNote") + count("WrongNote"), total: targets.length };
}

const SCALE_MATERIAL: [string, readonly ResolvedTarget[]][] = [
  ["quarter-note scale material", levelTargets(1)],
  ["eighth-note scale material", levelTargets(4)],
];

const OFFSETS = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];

describe("a performance that is shifted in time", () => {
  it("is recognised up to an eighth note out, in both directions", () => {
    // The headline promise: be a whole eighth note early or late, consistently,
    // and the game still knows what you played. At 90bpm that is +-267ms of
    // slop before anything is called a miss.
    //
    // Exactly zero on material whose pitches move, because pitch is what stops
    // a shifted note being handed to its neighbour: a late note finds the
    // nearest target *that it could be*, and that is still its own.
    for (const [label, targets] of SCALE_MATERIAL) {
      for (const offset of OFFSETS) {
        const { failures } = performance(targets, offset);
        expect(failures, `${label} at ${offset} beats`).toBe(0);
      }
    }
  });

  it("mostly holds on one-pitch material, and admits where it does not", () => {
    // Can Crushing is a single pitch for a whole attempt, so pitch cannot
    // disambiguate anything and a shifted performance really can slide its
    // attribution by one note. Measured: the slide is invisible in the middle
    // of a run of eighths and shows only at the two seams where the rhythm
    // changes, costing one miss and one wrong note at each — four events out of
    // forty-eight, against a hundred percent before the floor existed.
    //
    // Bounded rather than asserted at zero because it is not zero, and a test
    // that pretended otherwise would be the thing that hid the next
    // regression.
    const targets = levelTargets(3, CAN_CRUSHING);
    for (const offset of OFFSETS) {
      const { failures, total } = performance(targets, offset);
      expect(failures, `one-pitch material at ${offset} beats`).toBeLessThanOrEqual(total * 0.1);
    }
  });

  it("does not fall off a cliff where the old clamp did", () => {
    // 0.25 beats used to be the edge on eighth material: one side of it every
    // note landed, the other side almost none did. Both sides are now clean,
    // which is the difference between "getting harder" and "stopping working".
    const eighths = levelTargets(4);
    for (const offset of [0.24, 0.25, 0.26, 0.3]) {
      expect(performance(eighths, offset).failures, `at ${offset} beats`).toBe(0);
    }
  });

  it("still fails a performance that is out by more than the tolerance", () => {
    // Forgiveness with an edge on it. A player a whole beat out is not playing
    // this phrase, and saying so is the point of judging at all.
    const { failures, total } = performance(levelTargets(4), 1.1);
    expect(failures).toBeGreaterThan(total / 2);
  });
});
