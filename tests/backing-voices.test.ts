/**
 * The backing band's voices: the kit, the bass note, and the curve both buses
 * are shaped by.
 *
 * Web Audio does not exist under Node, so the context is a recording double —
 * the same bargain `pluck-voices.test.ts` strikes, and for the same reason:
 * everything asserted here is a decision these modules make about *what graph
 * to build*, not something an audio engine does with it. What a driven bus
 * sounds like is not a unit test; that it is driven, and into a clipper, is.
 *
 * `npm run audio:demo` is the other half of this — it renders these same
 * modules through a real `OfflineAudioContext` so a person can listen.
 */

import { describe, expect, it } from "vitest";

import { BassVoicePool, DEFAULT_BASS } from "../src/audio/bass-voice.js";
import { DEFAULT_KIT, DrumKit } from "../src/audio/drum-voices.js";
import { softClipCurve } from "../src/audio/soft-clip.js";
import { TEMPOS } from "../src/config/tempos.js";

/* -------------------------------------------------------------------------- */
/* The recording double                                                        */
/* -------------------------------------------------------------------------- */

type Node = {
  kind: string;
  id: number;
  connections: unknown[];
  gain?: { value: number };
  /** Oscillators only: whatever their frequency param was last set to. */
  frequency?: number;
  onended?: () => void;
  /** Sources only. Declared here so a `Node` can be asked without a cast. */
  started?: number | null;
  stopped?: number[];
};
type Source = Node & { started: number | null; stopped: number[] };

function fakeContext() {
  const nodes: Node[] = [];
  const sources: Source[] = [];
  let id = 0;

  const base = (kind: string): Node => {
    const node: Node = { kind, id: (id += 1), connections: [] };
    nodes.push(node);
    return node;
  };

  /**
   * What a `connect()` records: the target's own record, so a test can compare
   * nodes rather than the wrappers the double hands out.
   */
  const link = (target: unknown): unknown =>
    (target as { record?: Node } | null)?.record ?? target;

  const param = () => ({
    value: 0,
    setValueAtTime(v: number) {
      this.value = v;
      return this;
    },
    exponentialRampToValueAtTime(v: number) {
      this.value = v;
      return this;
    },
    linearRampToValueAtTime(v: number) {
      this.value = v;
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  });

  const sourceNode = (kind: string, extra: Record<string, unknown> = {}) => {
    const record = base(kind) as Source;
    record.started = null;
    record.stopped = [];
    sources.push(record);
    return {
      record,
      node: {
        ...extra,
        connect: (target: unknown) => record.connections.push(link(target)),
        disconnect: () => undefined,
        start: (at: number) => (record.started = at),
        stop: (at: number) => record.stopped.push(at),
        set onended(fn: () => void) {
          record.onended = fn;
        },
      },
    };
  };

  const context = {
    currentTime: 0,
    sampleRate: 44100,
    nodes,
    sources,
    createGain() {
      const record = base("gain");
      const level = param();
      record.gain = level;
      return {
        record,
        gain: level,
        connect: (target: unknown) => record.connections.push(link(target)),
        disconnect: () => undefined,
      };
    },
    createOscillator() {
      const frequency = param();
      const built = sourceNode("osc", {
        type: "sine",
        frequency,
        setPeriodicWave(wave: unknown) {
          (built.record as unknown as { wave: unknown }).wave = wave;
        },
      });
      Object.defineProperty(built.record, "frequency", {
        get: () => frequency.value,
        configurable: true,
      });
      return built.node;
    },
    createBufferSource() {
      return sourceNode("buffer", { buffer: null }).node;
    },
    createBiquadFilter() {
      const record = base("biquad");
      return {
        record,
        type: "lowpass",
        frequency: param(),
        Q: param(),
        connect: (target: unknown) => record.connections.push(link(target)),
      };
    },
    createWaveShaper() {
      const record = base("shaper");
      return {
        record,
        curve: null as Float32Array | null,
        oversample: "none",
        connect: (target: unknown) => record.connections.push(link(target)),
      };
    },
    createPeriodicWave(real: Float32Array, imag: Float32Array) {
      base("wave");
      return { real, imag };
    },
    createBuffer(channels: number, frames: number) {
      base("buffer");
      const data = new Float32Array(frames);
      return { duration: frames / 44100, getChannelData: () => data };
    },
  };

  const destination = base("destination");
  const count = (kind: string) => nodes.filter((node) => node.kind === kind).length;
  return { context, destination, nodes, sources, count };
}

/** Sources whose start time is `at`, give or take a scheduling epsilon. */
function startedAt(sources: readonly Source[], at: number): Source[] {
  return sources.filter((source) => source.started !== null && Math.abs(source.started - at) < 1e-9);
}

const kitOf = (tone = {}) => {
  const fake = fakeContext();
  const kit = new DrumKit(
    fake.context as unknown as BaseAudioContext,
    fake.destination as unknown as AudioNode,
    tone
  );
  return { ...fake, kit };
};

const poolOf = (tone = {}) => {
  const fake = fakeContext();
  const pool = new BassVoicePool(
    fake.context as unknown as BaseAudioContext,
    fake.destination as unknown as AudioNode,
    tone
  );
  return { ...fake, pool };
};

/**
 * The drift oscillators' frequencies, read off a built pool.
 *
 * Read rather than imported: they are private to the module, and what the tests
 * below are about is the frequencies the pool actually runs at.
 */
function driftFrequencies(): number[] {
  const { pool, nodes } = poolOf();
  pool.play(33, 5, 0.5);
  return nodes
    .filter((node) => node.kind === "osc" && node.frequency !== undefined && node.frequency < 5)
    .map((node) => node.frequency as number)
    .sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */
/* The curve                                                                   */
/* -------------------------------------------------------------------------- */

describe("softClipCurve", () => {
  const curve = softClipCurve(0.7);
  const at = (x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))] as number;

  it("leaves everything below the knee exactly alone", () => {
    for (const x of [-0.7, -0.4, -0.1, 0, 0.1, 0.4, 0.7]) {
      expect(at(x)).toBeCloseTo(x, 3);
    }
  });

  it("never has gain above one — it is a limiter, not a distortion pedal", () => {
    // The trap `audio-engine.ts` fell into first: a normalised `tanh` scaled so
    // full scale maps to full scale makes everything *below* full scale up to
    // 1.4x louder, which raises every band including the ones already loud
    // enough. Asserted across the whole curve rather than at the knee, because
    // that is where the failure hid.
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      expect(Math.abs(curve[i] as number)).toBeLessThanOrEqual(Math.abs(x) + 1e-6);
    }
  });

  it("approaches full scale without reaching it, and stays monotonic", () => {
    expect(at(1)).toBeLessThan(1);
    expect(at(1)).toBeGreaterThan(0.9);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i] as number).toBeGreaterThanOrEqual(curve[i - 1] as number);
    }
  });

  it("is odd, so it adds no even harmonics and no DC", () => {
    for (const x of [0.2, 0.55, 0.85, 0.99]) expect(at(-x)).toBeCloseTo(-at(x), 5);
  });

  it("bends more as the knee comes down, which is what the drum bus wants", () => {
    const hard = softClipCurve(0.2);
    const soft = softClipCurve(0.9);
    const index = Math.round(((0.85 + 1) / 2) * (hard.length - 1));
    expect(hard[index] as number).toBeLessThan(soft[index] as number);
  });
});

/* -------------------------------------------------------------------------- */
/* The kit                                                                     */
/* -------------------------------------------------------------------------- */

describe("DrumKit", () => {
  it("drives its bus into a clipper and takes the level after it", () => {
    // The whole reason the kit got louder without getting closer to the
    // ceiling. Asserted structurally: a drive gain, then a shaper, then the
    // kit's own level, in that order.
    const { kit, nodes, destination } = kitOf();
    kit.strike("kick", 1, 1);

    const gains = nodes.filter((node) => node.kind === "gain");
    const shaper = nodes.find((node) => node.kind === "shaper");
    expect(shaper).toBeDefined();
    const output = gains.find((gain) => gain.connections.includes(destination));
    const bus = gains.find((gain) => gain.connections.some((target) => target === shaper));
    expect(output).toBeDefined();
    expect(bus).toBeDefined();
    expect(shaper?.connections).toContain(output);
  });

  it("leaves the bus linear when the knee is switched off", () => {
    // How the audition renders the kit as it was, so the comparison is against
    // the old signal path and not merely the old numbers.
    const { kit, count } = kitOf({ knee: 1 });
    kit.strike("kick", 1, 1);
    expect(count("shaper")).toBe(0);
  });

  it("builds the kick from a body, a beater octave and two clicks", () => {
    const { kit, sources } = kitOf();
    kit.strike("kick", 2, 1);
    // Two oscillators (body and beater) and two noise bursts, all landing on
    // the beat — a layered drum, not a drum followed by decoration.
    const onBeat = startedAt(sources, 2);
    expect(onBeat.filter((source) => source.kind === "osc")).toHaveLength(2);
    expect(onBeat.filter((source) => source.kind === "buffer")).toHaveLength(2);
  });

  it("builds the snare from wires, a snap and a tuned shell", () => {
    const { kit, sources } = kitOf();
    kit.strike("snare", 1, 1);
    const onBeat = startedAt(sources, 1);
    expect(onBeat.filter((source) => source.kind === "buffer")).toHaveLength(2);
    expect(onBeat.filter((source) => source.kind === "osc")).toHaveLength(2);
  });

  it("drops a layer the tone switches off, rather than sounding it silently", () => {
    const { kit, sources } = kitOf({ snareSnap: 0, snareShell: 0, kickBeater: 0, kickTick: 0 });
    kit.strike("snare", 1, 1);
    kit.strike("kick", 2, 1);
    expect(startedAt(sources, 1)).toHaveLength(1);
    expect(startedAt(sources, 2)).toHaveLength(2);
  });

  it("sounds every hit at the time it was given, unshifted", () => {
    const { kit, sources } = kitOf();
    for (const voice of ["kick", "snare", "hat", "tick", "trip", "ride", "crash", "tom", "floor"] as const) {
      kit.strike(voice, 5, 0.8);
    }
    expect(sources.every((source) => source.started === 5)).toBe(true);
  });

  it("cancels what has not sounded and leaves what has", () => {
    const { kit, sources } = kitOf();
    kit.strike("kick", 1, 1);
    kit.strike("kick", 9, 1);
    kit.cancelFrom(5);
    for (const source of sources) {
      if (source.started === 9) expect(source.stopped).toContain(5);
      else expect(source.stopped).not.toContain(5);
    }
  });

  it("turns down by a fraction of its designed level, not to an absolute gain", () => {
    // Or "quieter" quietly becomes a second place the kit's level is decided,
    // and the makeup that pays for the drive goes with it.
    const { kit, nodes, destination } = kitOf();
    const output = nodes.find(
      (node) => node.kind === "gain" && node.connections.includes(destination)
    );
    expect(output?.gain?.value).toBe(DEFAULT_KIT.level);
    kit.setLevel(0.5);
    expect(output?.gain?.value).toBeCloseTo(DEFAULT_KIT.level * 0.5, 9);
    kit.setLevel(1);
    expect(output?.gain?.value).toBe(DEFAULT_KIT.level);
  });

  it("is louder below the knee than the flat bus it replaced", () => {
    // The claim the whole change rests on, pinned as a number: `drive x level`
    // against the 0.85 the kit used to run at flat. Everything under the knee
    // is that much louder, and the peak is *lower* — see the audition.
    expect(DEFAULT_KIT.drive * DEFAULT_KIT.level).toBeGreaterThan(0.85 * 1.4);
  });
});

/* -------------------------------------------------------------------------- */
/* The bass                                                                    */
/* -------------------------------------------------------------------------- */

describe("BassVoicePool", () => {
  it("plays one note as a body, an octave and a sub", () => {
    const { pool, sources } = poolOf();
    pool.play(33, 4, 0.6);
    expect(startedAt(sources, 4).filter((source) => source.kind === "osc")).toHaveLength(3);
  });

  it("gives the body a custom wave rather than a named oscillator type", () => {
    // The "weird waveform": a sawtooth's recipe with the 2nd to 5th harmonics
    // pushed up, which is what a small speaker actually reproduces of a 50Hz
    // note.
    const { pool, count } = poolOf();
    pool.play(33, 0, 0.6);
    expect(count("wave")).toBe(1);
    expect(DEFAULT_BASS.wave).toBe("growl");
  });

  it("falls back to a plain sawtooth when the tone asks for one", () => {
    const { pool, count, sources } = poolOf({ wave: "sawtooth", sub: 0, octave: 0, grit: 0 });
    pool.play(33, 0, 0.6);
    expect(count("wave")).toBe(0);
    expect(sources).toHaveLength(1);
  });

  it("builds the overdrive once and shares it across every note", () => {
    // One pedal, not one per note: a shaper and its band per note would be
    // dozens of nodes a bar for a sound that does not change.
    const { pool, count } = poolOf();
    for (let beat = 0; beat < 8; beat += 1) pool.play(33 + beat, beat, 0.6);
    expect(count("shaper")).toBe(1);
  });

  it("builds no overdrive at all when the tone is clean", () => {
    const { pool, count } = poolOf({ grit: 0 });
    pool.play(33, 0, 0.6);
    expect(count("shaper")).toBe(0);
  });

  it("sweeps the note's low-pass down to where the line lives", () => {
    const { pool, nodes } = poolOf();
    pool.play(33, 0, 0.6);
    const filter = nodes.find((node) => node.kind === "biquad" && node.connections.length > 0);
    expect(filter).toBeDefined();
    expect(DEFAULT_BASS.sweepHz).toBeGreaterThan(DEFAULT_BASS.cutoffHz);
  });

  it("stops every layer of a cancelled note, not just its fundamental", () => {
    // The bug this guards: a cancelled note that kept sounding its octave,
    // which is exactly what a reroll or a tempo change used to leave behind.
    const { pool, sources } = poolOf();
    pool.play(33, 8, 0.6);
    pool.cancelFrom(2);
    const note = sources.filter((source) => source.started === 8);
    expect(note).toHaveLength(3);
    for (const source of note) expect(source.stopped).toContain(2);
  });

  it("leaves the drift running when a note is cancelled", () => {
    // A reroll or a tempo change cancels the queued tail. The drift is not part
    // of it — stopping it there would silence the modulation for the rest of the
    // run, and an `OscillatorNode` cannot be restarted once stopped.
    const { pool, nodes } = poolOf();
    pool.play(33, 8, 0.6);
    pool.cancelFrom(2);
    const drift = nodes.filter((node) => node.kind === "osc" && (node.frequency ?? 99) < 5);
    expect(drift).toHaveLength(2);
    for (const lfo of drift) expect(lfo.stopped).toEqual([]);
  });

  it("drifts the sub with a pair of oscillators that run for the pool's life", () => {
    // Not restarted per note, which is the whole point: a modulator that began
    // with each note would be an envelope shape, identical every time, and the
    // rumble would not breathe at all.
    const { pool, nodes, count } = poolOf();
    for (let beat = 1; beat <= 4; beat += 1) pool.play(33 + beat, beat, 0.6);
    // Three oscillators per note, plus exactly two more however many notes are
    // played: the drift, built once.
    expect(count("osc")).toBe(4 * 3 + 2);
    const slow = nodes.filter((node) => node.kind === "osc" && (node.frequency ?? 99) < 5);
    expect(slow).toHaveLength(2);
    expect(slow.every((lfo) => lfo.started === 0)).toBe(true);
  });

  it("builds no modulator at all for a still bass", () => {
    const { pool, sources } = poolOf({ wobble: 0, gritWobble: 0 });
    pool.play(33, 1, 0.6);
    expect(sources.filter((source) => source.started === 0)).toHaveLength(0);
  });

  it("centres the drift, so the sub is never inverted and never louder", () => {
    // The modulated level has to land in `sub * (1 - wobble) .. sub`. Half the
    // depth comes off the layer's own gain and the modulator adds it back, so
    // getting this wrong drives the gain negative — which is not quieter, it is
    // the sub in anti-phase with itself.
    const { pool, nodes } = poolOf();
    pool.play(33, 1, 0.6);
    const depth = DEFAULT_BASS.sub * DEFAULT_BASS.wobble;
    const centred = DEFAULT_BASS.sub - depth / 2;
    const levels = nodes.filter((node) => node.kind === "gain").map((node) => node.gain?.value);
    expect(levels).toContainEqual(centred);
    expect(levels).toContainEqual(depth / 2);
    expect(centred - depth / 2).toBeCloseTo(DEFAULT_BASS.sub * (1 - DEFAULT_BASS.wobble), 9);
  });

  it("lets go of a note's modulation when the note ends", () => {
    // The drift lives as long as the pool and points at a per-note param, so
    // without this every note ever played is held alive by it — four a bar, for
    // a whole run.
    const { pool, sources } = poolOf();
    pool.play(33, 1, 0.6);
    const sub = sources.find((source) => source.started === 1 && source.onended);
    expect(sub).toBeDefined();
    expect(() => sub?.onended?.()).not.toThrow();
  });

  it("cannot lock to the beat at any tempo the game offers", () => {
    // What "a frequency that is not an integer multiple of the tempo" has to
    // mean in practice: at every tempo, neither drift period is near a whole
    // number of beats, or the wobble is heard as a rhythm nobody authored. The
    // numbers were picked by search against exactly this, so the check belongs
    // next to them rather than in a comment.
    for (const tempo of TEMPOS) {
      const beatsPerSecond = tempo.bpm / 60;
      for (const hz of driftFrequencies()) {
        const beatsPerCycle = beatsPerSecond / hz;
        const offGrid = Math.abs(beatsPerCycle - Math.round(beatsPerCycle));
        expect(offGrid).toBeGreaterThan(0.12);
      }
    }
  });

  it("uses two frequencies in an irrational ratio, so the pair never repeats", () => {
    const drift = driftFrequencies();
    expect(drift).toHaveLength(2);
    expect((drift[1] as number) / (drift[0] as number)).toBeCloseTo((1 + Math.sqrt(5)) / 2, 6);
  });

  it("leaves a note that is already sounding alone", () => {
    const { pool, sources } = poolOf();
    pool.play(33, 1, 0.6);
    pool.cancelFrom(2);
    for (const source of sources) expect(source.stopped).not.toContain(2);
  });
});
