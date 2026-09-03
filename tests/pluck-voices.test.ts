/**
 * The dev pluck voice.
 *
 * Two callers with opposite requirements share this file, and the tests are
 * about keeping them apart. `SyntheticGuitarSource` plucks into a mocked
 * microphone that the *real recognizer* listens to, so its tone must stay one
 * clean sine — a partial it did not ask for is a pitch detector being handed
 * something to disagree with. `AutoplayMonitor` and the editor pluck into the
 * speakers, where a bare sine at the bottom of the guitar's register is the
 * hardest thing there is to hear against a drum kit.
 *
 * Web Audio does not exist under Node, so the context is a recording double.
 * That is enough: everything asserted here is a decision this module makes
 * about *what to build*, not something the audio engine does with it.
 */

import { describe, expect, it } from "vitest";

import { AUTOPLAY_PLUCK_PEAK_GAIN } from "../src/config/tuning.js";
import { PluckVoicePool } from "../src/dev/pluck-voices.js";
import { midiToFrequency } from "../src/music/pitch.js";

type FakeOsc = {
  type: string;
  frequency: { value: number };
  started: number | null;
  stopped: number[];
  connectedTo: unknown;
  onended: (() => void) | null;
};

type FakeGain = { level: number; connectedTo: unknown; ramps: number[] };

function fakeContext() {
  const oscs: FakeOsc[] = [];
  const gains: FakeGain[] = [];
  const context = {
    currentTime: 0,
    createOscillator(): unknown {
      const osc: FakeOsc = {
        type: "sine",
        frequency: { value: 0 },
        started: null,
        stopped: [],
        connectedTo: null,
        onended: null,
      };
      oscs.push(osc);
      return {
        set type(value: string) {
          osc.type = value;
        },
        frequency: { setValueAtTime: (v: number) => (osc.frequency.value = v) },
        connect: (node: unknown) => (osc.connectedTo = node),
        start: (at: number) => (osc.started = at),
        stop: (at: number) => osc.stopped.push(at),
        set onended(fn: () => void) {
          osc.onended = fn;
        },
      };
    },
    createGain(): unknown {
      const gain: FakeGain = { level: 1, connectedTo: null, ramps: [] };
      gains.push(gain);
      const node = {
        gain: {
          get value() {
            return gain.level;
          },
          set value(v: number) {
            gain.level = v;
          },
          setValueAtTime: (v: number) => gain.ramps.push(v),
          exponentialRampToValueAtTime: (v: number) => gain.ramps.push(v),
          linearRampToValueAtTime: (v: number) => gain.ramps.push(v),
          cancelScheduledValues: () => undefined,
        },
        connect: (target: unknown) => (gain.connectedTo = target),
        disconnect: () => undefined,
      };
      return node;
    },
  };
  return { context: context as unknown as BaseAudioContext, oscs, gains };
}

const DESTINATION = { id: "destination" } as unknown as AudioNode;

describe("the pluck voice the recognizer hears", () => {
  it("is one sine at the note, and nothing else", () => {
    const { context, oscs } = fakeContext();
    new PluckVoicePool(context, DESTINATION).pluck(57, 1, 0.2);

    expect(oscs).toHaveLength(1);
    expect(oscs[0]?.type).toBe("sine");
    expect(oscs[0]?.frequency.value).toBeCloseTo(midiToFrequency(57), 6);
    expect(oscs[0]?.started).toBe(1);
  });
});

describe("the pluck voice a person hears", () => {
  it("adds the two partials a small speaker can actually reproduce", () => {
    const { context, oscs } = fakeContext();
    new PluckVoicePool(context, DESTINATION, "pluck").pluck(48, 0, 0.2);

    const fundamental = midiToFrequency(48);
    expect(oscs.map((osc) => osc.frequency.value)).toEqual([
      fundamental,
      fundamental * 2,
      fundamental * 3,
    ]);
    // A triangle fundamental already carries a little of the third and fifth.
    expect(oscs[0]?.type).toBe("triangle");
  });

  it("peaks where the single sine did, so this is tone and not level", () => {
    const { context, gains } = fakeContext();
    new PluckVoicePool(context, DESTINATION, "pluck").pluck(48, 0, 0.2);

    // One envelope, ramped to the shared peak, plus one level gain per partial.
    // Those levels sum to about 1, so the voice reaches the master bus at the
    // same ceiling a single sine did — a change of tone, not of volume.
    const envelope = gains[0] as FakeGain;
    expect(envelope.ramps).toContain(AUTOPLAY_PLUCK_PEAK_GAIN);
    const partials = gains.slice(1).map((gain) => gain.level);
    expect(partials).toHaveLength(3);
    const total = partials.reduce((sum, level) => sum + level, 0);
    expect(total).toBeGreaterThan(0.9);
    expect(total).toBeLessThan(1.1);
  });
});

describe("silencing voices", () => {
  it("stops every partial of a note that has not started", () => {
    const { context, oscs } = fakeContext();
    const pool = new PluckVoicePool(context, DESTINATION, "pluck");
    pool.pluck(48, 5, 0.2);

    pool.dropUnstarted(1);
    expect(oscs).toHaveLength(3);
    for (const osc of oscs) expect(osc.stopped).toContain(1);
  });

  it("leaves a note that is already sounding to ring out", () => {
    const { context, oscs } = fakeContext();
    const pool = new PluckVoicePool(context, DESTINATION, "pluck");
    pool.pluck(48, 0, 2);

    pool.dropUnstarted(1);
    // Only the stop scheduled when it was created — nothing cut it short.
    for (const osc of oscs) expect(osc.stopped).toHaveLength(1);
  });

  it("releases a sounding note rather than cutting it, on a full cancel", () => {
    const { context, oscs } = fakeContext();
    const pool = new PluckVoicePool(context, DESTINATION, "pluck");
    pool.pluck(48, 0, 2);

    pool.cancelFrom(1);
    // Re-stopped, but *after* the release ramp rather than at the cancel.
    for (const osc of oscs) {
      expect(osc.stopped).toHaveLength(2);
      expect(osc.stopped[1]).toBeGreaterThan(1);
    }
  });
});
