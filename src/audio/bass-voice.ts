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

    this.#gritIn = this.#tone.grit > 0 ? this.#buildGrit() : null;
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
    level.gain.value = this.#tone.grit;

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
      level.gain.value = this.#tone.sub;
      sub.connect(level);
      level.connect(gain);
      oscs.push(sub);
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
  }
}
