/**
 * The bass voice: what one note of the backing line *sounds* like.
 *
 * Split out of `BassPlayer` for the same reason the kit was split out of
 * `DrumPlayer` — scheduling and timbre change for different reasons, and this
 * half takes a `BaseAudioContext`, so the voice can be rendered offline and
 * listened to (`scripts/render-audio-demo.mjs`).
 *
 * ## The problem this voice is shaped around
 *
 * The line is voiced at 40-75 Hz so it sits under the guitar (`bass-line.ts`),
 * and almost no speaker a browser game is played on reproduces that fundamental
 * at all — a laptop rolls off hard below ~150 Hz. What makes a bass note
 * audible there is its harmonics: the ear reconstructs the missing fundamental
 * from them. A triangle's fall off as 1/n² and had nothing left by the third,
 * so the part was being rendered and simply not heard; a sawtooth's fall off as
 * 1/n, which was better and still left the part reading as a distant hum.
 *
 * So the note is four layers, and each one is aimed at a band the others leave
 * empty:
 *
 *   - **The sub.** A sine at the written pitch. It is the layer nobody with a
 *     laptop will ever hear and the reason the part has weight on headphones or
 *     anything with a woofer — the rumble, and nothing else in the game
 *     produces it.
 *   - **The body.** A custom periodic wave rather than a named oscillator type:
 *     a sawtooth's own recipe with the 2nd to 5th harmonics pushed well above
 *     where 1/n would put them. Those partials land at 80-400 Hz for this
 *     register, which is where a small speaker starts telling the truth, and
 *     they are what give the note a *pitch* there instead of a thud.
 *   - **The octave.** A sawtooth an octave up, under the body, so the one
 *     partial that most defines a bass note is present at full strength rather
 *     than at the 1/2 the body's own recipe gives it.
 *   - **The grit.** A parallel band, driven hard into a clipper and filtered to
 *     roughly 450-1800 Hz. This is a bass overdrive blended under a clean
 *     signal, which is what a bass player reaches for when they cannot be heard,
 *     and for the same reason: distortion generates harmonics *above* the notes
 *     it is fed, so it puts the line in the band a phone speaker reproduces
 *     without moving the line itself out of the bass register.
 *
 * A filter envelope over the body and octave — open, closing over 180 ms — is
 * what makes the attack read as a pluck rather than as an organ note starting.
 *
 * ## The drift
 *
 * The sub is the one layer that is otherwise *dead* still — a sine at a fixed
 * pitch and a fixed level, four beats a bar, forever — and a perfectly steady
 * rumble is the sound of a test tone rather than of a room. So its level is
 * modulated by a pair of free-running oscillators at {@link WOBBLE_SLOW_HZ} and
 * that frequency times the golden ratio.
 *
 * Two properties do the work, and both are the reason it is a *pair*:
 *
 *   - **It never repeats.** Two sines whose frequencies are in an irrational
 *     ratio sum to something quasi-periodic — it comes close to where it was and
 *     never arrives. The golden ratio is the worst-approximated irrational there
 *     is, so this is as far from a repeating pattern as two oscillators get.
 *   - **It cannot lock to the beat.** The frequencies are in Hz and are chosen
 *     so that at every tempo the game offers, neither period is near a whole
 *     number of beats ({@link WOBBLE_SLOW_HZ} says how far). A modulation that
 *     divided the bar would be read as *rhythm* — a drummer's part nobody
 *     authored — where this one drifts against the bar and is only heard as the
 *     rumble breathing.
 *
 * The oscillators are started once and run for the pool's lifetime, which is the
 * whole point: restarted per note they would be identical on every note, which
 * is an envelope shape, not drift.
 *
 * PROVISIONAL tuning, per `AGENTS.md` §17: the GDD (§23) leaves the bass
 * generator unspecified, so these are reversible defaults chosen by ear and by
 * measurement, not canonical design.
 */

import { midiToFrequency } from "../music/pitch.js";
import { softClipCurve } from "./soft-clip.js";

/**
 * The knobs an audition can move. Layers, not a synthesiser — the same bargain
 * as `KitTone`, so `scripts/render-audio-demo.mjs` can render alternatives from
 * this code rather than from a copy of it.
 */
export type BassTone = {
  /** `"growl"` is the custom wave described in the header. */
  wave: "sawtooth" | "growl";
  /** The sine at the written pitch. 0 is no sub. */
  sub: number;
  /** The sawtooth an octave up, under the body. */
  octave: number;
  /** The parallel overdriven band. 0 is a clean bass. */
  grit: number;
  /** Centre of the grit band, in Hz. */
  gritHz: number;
  /** Where the note's low-pass settles, in Hz. */
  cutoffHz: number;
  /** Where that low-pass starts, in Hz. Equal to `cutoffHz` is no envelope. */
  sweepHz: number;
  /** The body level the note decays to, as a fraction of its peak. */
  sustain: number;
  /** How far the drift moves the sub's level, 0..1. 0 is a dead-still sub. */
  wobble: number;
  /** The same drift on the overdriven band. 0 keeps the grit steady. */
  gritWobble: number;
};

/** What the bass ships as. */
export const DEFAULT_BASS: BassTone = {
  wave: "growl",
  sub: 0.5,
  octave: 0.38,
  grit: 0.2,
  gritHz: 900,
  cutoffHz: 1150,
  sweepHz: 2800,
  sustain: 0.34,
  // Deep enough to hear the rumble move, shallow enough that it is never a
  // tremolo: the sub swings between 65% and 100% of its level and back.
  wobble: 0.35,
  // The grit stays steady by default. The drift belongs to the rumble, which is
  // what it was asked for; putting it on the band a laptop reproduces as well is
  // one number away, and `npm run audio:demo` renders that as a candidate.
  gritWobble: 0,
};

/**
 * Harmonic amplitudes of the `"growl"` wave, from the fundamental up.
 *
 * A sawtooth is `1/n`: 1, 0.5, 0.33, 0.25. This pushes the 2nd to 5th well
 * above that and lets the rest fall away normally, which is the difference
 * between a bass you can hear on a laptop and one you cannot — those four
 * partials are the whole of what a small speaker gets from a 50 Hz note. The
 * `WebAudio` normalisation is left on, so the wave peaks where any other
 * oscillator does and this is a change of tone, not of level.
 */
const GROWL_HARMONICS = [
  1, 0.8, 0.55, 0.5, 0.42, 0.28, 0.24, 0.2, 0.14, 0.12, 0.1, 0.09, 0.07, 0.06, 0.05, 0.04,
] as const;

/** Peak of one note's amplitude envelope, before the pool's destination gain. */
const PEAK_GAIN = 0.5;
/** How long the attack takes. Short: the beat has to be unmistakable. */
const ATTACK_SECONDS = 0.012;
/** How far into the note the body has decayed to {@link BassTone.sustain}. */
const DECAY_FRACTION = 0.45;
/** How far into the note it is silent. Just short, so the pulse stays articulated. */
const RELEASE_FRACTION = 0.96;
/** How long the low-pass takes to close. */
const SWEEP_SECONDS = 0.18;

/**
 * The slower of the two drift oscillators, in Hz — a cycle every 3.8 seconds.
 *
 * Picked by search rather than by taste, against the one property that matters:
 * at all five tempos (`config/tempos.ts` — 60, 90, 106, 120 and 140bpm), and for
 * both this and {@link WOBBLE_FAST_HZ}, the period is at least 0.14 of a beat
 * away from a whole number of beats. That is what stops the drift being heard as
 * an unauthored rhythm; `tests/backing-voices.test.ts` re-runs the check, so a
 * later edit to either number has to keep it true rather than merely hope.
 */
const WOBBLE_SLOW_HZ = 0.2636;

/**
 * The faster one: the slow one times the golden ratio.
 *
 * Any irrational multiple would make the pair never repeat. This one is the
 * furthest from *any* simple ratio, which is the same reason a sunflower uses
 * it.
 */
const WOBBLE_FAST_HZ = WOBBLE_SLOW_HZ * ((1 + Math.sqrt(5)) / 2);

const EPSILON_GAIN = 0.0001;

/** One scheduled note, kept so it can be silenced before it sounds. */
type BassVoice = {
  startTime: number;
  oscs: OscillatorNode[];
  gain: GainNode;
};

/** Plays bass notes onto one destination, and can drop what it has queued. */
export class BassVoicePool {
  readonly #context: BaseAudioContext;
  readonly #destination: AudioNode;
  readonly #tone: BassTone;
  readonly #wave: PeriodicWave | null;
  /** Where a note sends its overdriven copy. Shared: one pedal, not one each. */
  readonly #gritIn: GainNode | null;
  /**
   * The drift, as a signal in -1..1, or null when nothing asks for it.
   *
   * One pair of oscillators for the pool's lifetime — see the header. It is
   * connected to *`AudioParam`s*, not to the audio path: a `GainNode`'s `gain`
   * sums whatever is connected to it on top of its own value, which is how one
   * shared modulator reaches every note without a node per note.
   */
  readonly #drift: GainNode | null;
  /** What the drift adds to a sub's level: half the swing, so it centres. */
  readonly #subDrift: GainNode | null;
  #lfos: OscillatorNode[] = [];
  #voices: BassVoice[] = [];

  constructor(
    context: BaseAudioContext,
    destination: AudioNode,
    tone: Partial<BassTone> = {}
  ) {
    this.#context = context;
    this.#destination = destination;
    this.#tone = { ...DEFAULT_BASS, ...tone };

    this.#wave =
      this.#tone.wave === "growl"
        ? context.createPeriodicWave(
            new Float32Array(GROWL_HARMONICS.length + 1),
            Float32Array.from([0, ...GROWL_HARMONICS])
          )
        : null;

    this.#drift = this.#buildDrift();
    this.#subDrift = this.#tapDrift(this.#tone.sub, this.#tone.wobble);
    this.#gritIn = this.#tone.grit > 0 ? this.#buildGrit() : null;
  }

  /**
   * The two free-running oscillators, summed to a signal in -1..1.
   *
   * Started at construction and never restarted, so the phase a note lands on
   * is wherever the drift happens to have got to — which is the difference
   * between a bass that breathes and a bass with a shape on every note.
   *
   * `null` when nothing is modulated, so a tone that asks for a still bass pays
   * for no oscillators at all.
   */
  #buildDrift(): GainNode | null {
    const wanted =
      (this.#tone.sub > 0 && this.#tone.wobble > 0) ||
      (this.#tone.grit > 0 && this.#tone.gritWobble > 0);
    if (!wanted) return null;

    const sum = this.#context.createGain();
    // Two unit sines summed would reach 2; halve them so the drift is in -1..1
    // and a depth means the same thing however many oscillators make it.
    sum.gain.value = 0.5;
    for (const hz of [WOBBLE_SLOW_HZ, WOBBLE_FAST_HZ]) {
      const lfo = this.#context.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = hz;
      lfo.connect(sum);
      lfo.start(this.#context.currentTime);
      this.#lfos.push(lfo);
    }
    return sum;
  }

  /**
   * A scaled tap off the drift, or `null` if this layer is not modulated.
   *
   * The depth is *half* the swing, and the caller sets the layer's own level to
   * `level * (1 - depth / 2)`: together those make the modulated level move
   * between `level * (1 - depth)` and `level`, so the layer is never driven
   * through zero into phase inversion and never louder than it was asked to be.
   */
  #tapDrift(level: number, depth: number): GainNode | null {
    if (!this.#drift || level <= 0 || depth <= 0) return null;
    const tap = this.#context.createGain();
    tap.gain.value = (level * Math.min(1, depth)) / 2;
    this.#drift.connect(tap);
    return tap;
  }

  /**
   * The overdrive: drive hard, clip, then keep only the band it was built for.
   *
   * Built once and shared by every note. The drive is deliberately far past the
   * clipper's knee — the point is the harmonics the bend generates, not the
   * signal that goes in — and the band-pass afterwards is what stops it being a
   * fuzz pedal across the whole spectrum. It takes its send *after* each note's
   * amplitude envelope, so a hard attack distorts more than a decaying tail,
   * which is how a real one behaves.
   */
  #buildGrit(): GainNode {
    const input = this.#context.createGain();
    input.gain.value = 5;

    const shaper = this.#context.createWaveShaper();
    shaper.curve = softClipCurve(0.12);
    shaper.oversample = "2x";

    const band = this.#context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = this.#tone.gritHz;
    // Wide — about two octaves. A resonant band here would read as a whistle
    // riding the line rather than as the line having a bite.
    band.Q.value = 0.5;

    const level = this.#context.createGain();
    const gritDrift = this.#tapDrift(this.#tone.grit, this.#tone.gritWobble);
    level.gain.value = this.#tone.grit * (gritDrift ? 1 - Math.min(1, this.#tone.gritWobble) / 2 : 1);
    // One connection, not one per note: the overdrive is already shared, so
    // modulating it costs nothing per note.
    gritDrift?.connect(level.gain);

    input.connect(shaper);
    shaper.connect(band);
    band.connect(level);
    level.connect(this.#destination);
    return input;
  }

  /** Sounds one note at `at`, on the audio clock, lasting `seconds`. */
  play(midi: number, at: number, seconds: number): void {
    const frequency = midiToFrequency(midi);
    const decayAt = at + seconds * DECAY_FRACTION;
    const silentAt = at + seconds * RELEASE_FRACTION;

    const gain = this.#context.createGain();
    // A plucked envelope with a body under it. Short attack so the beat is
    // unmistakable; a definite sustain so the note is still there when the next
    // one arrives, which is what makes a bass line rumble rather than tick.
    gain.gain.setValueAtTime(EPSILON_GAIN, at);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(EPSILON_GAIN, PEAK_GAIN * this.#tone.sustain),
      decayAt
    );
    gain.gain.exponentialRampToValueAtTime(EPSILON_GAIN, silentAt);
    gain.connect(this.#destination);
    if (this.#gritIn) gain.connect(this.#gritIn);

    const filter = this.#context.createBiquadFilter();
    filter.type = "lowpass";
    // High enough to pass the partials that carry the note on a small speaker;
    // low enough that the line still reads as bass and stays out of the register
    // the target notes occupy. Swept down from wide open, which is the attack.
    filter.frequency.setValueAtTime(Math.max(this.#tone.cutoffHz, this.#tone.sweepHz), at);
    if (this.#tone.sweepHz > this.#tone.cutoffHz) {
      filter.frequency.exponentialRampToValueAtTime(
        this.#tone.cutoffHz,
        at + Math.min(SWEEP_SECONDS, seconds * 0.9)
      );
    }
    filter.connect(gain);

    const oscs: OscillatorNode[] = [];
    const body = this.#context.createOscillator();
    if (this.#wave) body.setPeriodicWave(this.#wave);
    else body.type = "sawtooth";
    body.frequency.value = frequency;
    body.connect(filter);
    oscs.push(body);

    if (this.#tone.octave > 0) {
      const octave = this.#context.createOscillator();
      octave.type = "sawtooth";
      octave.frequency.value = frequency * 2;
      const level = this.#context.createGain();
      level.gain.value = this.#tone.octave;
      octave.connect(level);
      level.connect(filter);
      oscs.push(octave);
    }

    if (this.#tone.sub > 0) {
      // Straight into the envelope, past the low-pass: the sub is already an
      // octave below the sweep's floor, and running it through a closing filter
      // would only phase-shift the one layer whose whole job is weight.
      const sub = this.#context.createOscillator();
      sub.type = "sine";
      sub.frequency.value = frequency;
      const level = this.#context.createGain();
      // Centred under the drift when there is one, so the swing lands on the
      // level the tone asked for rather than above it. See `#tapDrift`.
      level.gain.value =
        this.#tone.sub * (this.#subDrift ? 1 - Math.min(1, this.#tone.wobble) / 2 : 1);
      sub.connect(level);
      level.connect(gain);
      oscs.push(sub);

      if (this.#subDrift) {
        // The one connection in here that outlives its note if nobody takes it
        // down. The drift is a pool-lifetime node and this points *from* it to a
        // per-note param, so every note played would be kept alive by it — four
        // a bar, for a whole run. `onended` is when the note is genuinely over,
        // and it fires whether the note decayed or was cancelled.
        this.#subDrift.connect(level.gain);
        sub.onended = () => {
          try {
            this.#subDrift?.disconnect(level.gain);
          } catch {
            // Already disconnected; nothing to do.
          }
          level.disconnect();
        };
      }
    }

    const stopAt = silentAt + 0.05;
    for (const osc of oscs) {
      osc.start(at);
      osc.stop(stopAt);
    }
    this.#voices.push({ startTime: at, oscs, gain });
  }

  /** Silences everything scheduled at or after `contextTime` but not sounding. */
  cancelFrom(contextTime: number): void {
    const surviving: BassVoice[] = [];
    for (const voice of this.#voices) {
      if (voice.startTime > contextTime) {
        // Every layer, or a cancelled note keeps sounding its octave — which is
        // exactly what a reroll or a tempo change would leave behind.
        for (const osc of voice.oscs) {
          try {
            osc.stop(contextTime);
          } catch {
            // Already stopped; nothing to do.
          }
        }
        voice.gain.disconnect();
      } else {
        surviving.push(voice);
      }
    }
    this.#voices = surviving;
  }

  /** Forgets voices that started before `contextTime`. */
  reap(contextTime: number): void {
    this.#voices = this.#voices.filter((voice) => voice.startTime > contextTime);
  }

  dispose(): void {
    this.cancelFrom(this.#context.currentTime);
    this.#voices = [];
    // The drift runs for the pool's lifetime, so this is the only thing that
    // ever stops it. Left running it would keep the context awake with an
    // inaudible pair of sub-hertz sines after the bass has gone.
    for (const lfo of this.#lfos) {
      try {
        lfo.stop(this.#context.currentTime);
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.#lfos = [];
  }
}
