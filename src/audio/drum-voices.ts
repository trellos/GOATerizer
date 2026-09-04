/**
 * The kit itself: what each drum *sounds* like, with nothing in it that knows
 * what a beat is.
 *
 * This was inside `DrumPlayer`, which also owns the lookahead timer, the
 * transport and the scheduled tail. Splitting it out separates two questions
 * that change for entirely different reasons — *when* a hit is scheduled, and
 * *what it sounds like* — and buys one concrete thing: this half takes a
 * `BaseAudioContext`, so the kit can be rendered through an
 * `OfflineAudioContext` and listened to. `scripts/render-audio-demo.mjs` does
 * exactly that, and it renders **this** code rather than a copy of it, which is
 * the only way an audition is evidence about the game.
 *
 * ## Why the kit is built the way it is
 *
 * The voices are synthesised rather than sampled — no asset, no licence, no
 * load — and they are shaped for the speakers this game is actually played on.
 * The bass sits at 40-75 Hz by design, which a laptop speaker barely
 * reproduces; the kick therefore leads with a click transient rather than
 * relying on its fundamental, and the snare and hats carry the beat in the
 * midrange where every speaker is honest.
 *
 * The kit is bigger than the pulse needs because the pattern it plays is not
 * fixed: `drum-pattern.ts` picks one of seven intensities per minigame, and the
 * top ones want cymbals and toms. Everything added for those — ride, crash,
 * tom, floor — is deliberately quieter at the peak than the kick and hat, and
 * earns its size from *length* instead.
 *
 * ## The drive, and why the kit is not simply turned up
 *
 * Playtest feedback was that the drums are quiet. They were not quiet because
 * the numbers were small; they were quiet because a drum kit is nearly all
 * transient, so it can be at the ceiling on a meter and low in *average* level,
 * which is the one the ear reports as loudness. The old bus had no processing
 * at all, so the only way to raise the average was to raise the peaks, and the
 * peaks were already the thing rationing everyone else's headroom.
 *
 * So the bus is **driven into a soft clipper** ({@link DEFAULT_KIT}'s `drive`
 * and `knee`) and the makeup brings the ceiling back down. Below the knee the
 * kit is {@link DEFAULT_KIT}'s `drive × level` louder than it was; at the peak
 * it is *quieter* than it was, because that is where the curve bends. The kit
 * gets louder and takes less of the master's headroom while doing it, and the
 * harmonics the bend adds sit in the midrange a small speaker reproduces.
 *
 * PROVISIONAL tuning, per `AGENTS.md` §17: the GDD specifies no percussion at
 * all (see `drum-pattern.ts`), so every number here is a reversible default
 * chosen against measurement and listening, not canonical design.
 */

import type { DrumVoice } from "./drum-pattern.js";
import { softClipCurve } from "./soft-clip.js";

/**
 * The knobs an audition can move, so alternatives can be rendered from the
 * shipped code instead of a copy of it.
 *
 * Deliberately a short list of *layers* rather than a synthesiser's worth of
 * parameters: each entry is something that is either part of the drum or is
 * not, so `scripts/render-audio-demo.mjs` can express "the kit as it shipped
 * before this iteration" as an override and the comparison means something.
 */
export type KitTone = {
  /** The kit's designed level, after the drive and the clipper. */
  level: number;
  /** Pre-gain into the bus clipper. 1 leaves the bus linear. */
  drive: number;
  /** Where the bus clipper bends, 0..1. 1 disables it. */
  knee: number;
  /** The kick's second harmonic, relative to its body. 0 is body alone. */
  kickBeater: number;
  /** The kick's click transient, relative to velocity. */
  kickClick: number;
  /** The kick's high click, for speakers that reproduce nothing below 200 Hz. */
  kickTick: number;
  /** The snare's noise body, relative to velocity. */
  snareBody: number;
  /** The snare's high snap band. 0 is body alone. */
  snareSnap: number;
  /** The snare's tuned shell — the drum under the wires. 0 is body alone. */
  snareShell: number;
  /** Level of the hat pair. */
  hat: number;
};

/**
 * What the kit ships as.
 *
 * `drive × level` is 1.54 against the 0.85 flat gain this replaced, so
 * everything below the knee is a little over half again as loud; a kick at full
 * velocity peaks at 0.58 where it used to peak at 0.77. Louder and smaller at
 * the same time is the whole point of the shape — see the header.
 */
export const DEFAULT_KIT: KitTone = {
  level: 0.7,
  drive: 2.2,
  knee: 0.55,
  kickBeater: 0.34,
  kickClick: 0.6,
  kickTick: 0.3,
  snareBody: 0.72,
  snareSnap: 0.5,
  snareShell: 0.3,
  hat: 1,
};

/** One scheduled hit, kept so it can be silenced before it sounds. */
type KitVoice = {
  startTime: number;
  source: AudioScheduledSourceNode;
  gain: GainNode;
};

/**
 * A synthesised drum kit on one bus.
 *
 * Owns the noise buffer, the drive and the clipper; tracks what it has
 * scheduled so a caller re-programming a running loop can drop the tail.
 */
export class DrumKit {
  readonly #context: BaseAudioContext;
  readonly #tone: KitTone;
  /** Everything lands here, and this is what is driven into the clipper. */
  readonly #bus: GainNode;
  /** After the clipper: the kit's level, and what a caller may turn down. */
  readonly #output: GainNode;
  /** One second of white noise, reused by every snare, hat and cymbal. */
  readonly #noise: AudioBuffer;
  #voices: KitVoice[] = [];

  constructor(
    context: BaseAudioContext,
    destination: AudioNode,
    tone: Partial<KitTone> = {}
  ) {
    this.#context = context;
    this.#tone = { ...DEFAULT_KIT, ...tone };

    this.#output = context.createGain();
    this.#output.gain.value = this.#tone.level;
    this.#output.connect(destination);

    this.#bus = context.createGain();
    this.#bus.gain.value = this.#tone.drive;
    if (this.#tone.knee >= 1) {
      this.#bus.connect(this.#output);
    } else {
      const clipper = context.createWaveShaper();
      clipper.curve = softClipCurve(this.#tone.knee);
      // The bend is generating harmonics of a signal that already reaches the
      // top of the band; without oversampling those alias back down as a
      // metallic ring on every hit, which is a thing you hear before you see it
      // on a meter.
      clipper.oversample = "2x";
      this.#bus.connect(clipper);
      clipper.connect(this.#output);
    }

    const frames = Math.floor(context.sampleRate);
    this.#noise = context.createBuffer(1, frames, context.sampleRate);
    const channel = this.#noise.getChannelData(0);
    for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1;
  }

  /**
   * Scales the kit's designed level, 0..1. A fraction of the designed level
   * rather than an absolute gain, so turning the kit down cannot become a
   * second place the kit's level is decided.
   */
  setLevel(fraction: number): void {
    this.#output.gain.value = this.#tone.level * Math.max(0, Math.min(1, fraction));
  }

  /** Sounds one hit at `at`, on the audio clock. */
  strike(voice: DrumVoice, at: number, velocity: number): void {
    switch (voice) {
      case "kick":
        this.#kick(at, velocity);
        break;
      case "snare":
        this.#snare(at, velocity);
        break;
      case "tick":
        this.#sixteenthTick(at, velocity);
        break;
      case "trip":
        this.#tripletClick(at, velocity);
        break;
      case "ride":
        this.#ride(at, velocity);
        break;
      case "crash":
        this.#crash(at, velocity);
        break;
      case "tom":
        this.#tom(at, velocity, 260, 150, 0.22, 900);
        break;
      case "floor":
        this.#tom(at, velocity, 165, 92, 0.34, 620);
        break;
      default:
        this.#hat(at, velocity);
        break;
    }
  }

  /** Silences everything scheduled at or after `contextTime` but not sounding. */
  cancelFrom(contextTime: number): void {
    const surviving: KitVoice[] = [];
    for (const voice of this.#voices) {
      if (voice.startTime > contextTime) {
        try {
          voice.source.stop(contextTime);
        } catch {
          // Already stopped; nothing to do.
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
    this.#output.disconnect();
  }

  /**
   * A struck membrane: a sine swept downwards under a fast attack.
   *
   * Kick, rack tom and floor tom are the same instrument at three sizes, so they
   * are one synth with three sets of numbers rather than three near-identical
   * methods. The sweep is a third of the decay in every case, which is what
   * makes a drum sound struck rather than plucked.
   */
  #drumTone(
    at: number,
    velocity: number,
    fromHz: number,
    toHz: number,
    seconds: number,
    harmonic = 1
  ): void {
    const osc = this.#context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fromHz * harmonic, at);
    osc.frequency.exponentialRampToValueAtTime(toHz * harmonic, at + seconds * 0.32);

    const gain = this.#context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.9 * velocity), at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    osc.connect(gain);
    gain.connect(this.#bus);
    osc.start(at);
    osc.stop(at + seconds + 0.04);
    this.#voices.push({ startTime: at, source: osc, gain });
  }

  /**
   * Pitch-swept sine, a beater harmonic over it, and two clicks on top.
   *
   * The sweep from 150 Hz down to 48 Hz is the body, and on a small speaker
   * almost none of it survives — which is why the kick used to be the hit
   * players could not find. Three things are stacked over it now, each aimed at
   * a band the last one leaves empty: the same sweep an octave up
   * ({@link KitTone.kickBeater}), where a phone speaker is starting to work; the
   * original 1.4 kHz click, longer and louder; and a short bright tick at 3.5
   * kHz, which is squarely in the band every speaker is honest in.
   *
   * They are layers of *one* drum, not a second drum: all four are inside 30 ms
   * and the two clicks are gone before the body has decayed a quarter.
   */
  #kick(at: number, velocity: number): void {
    this.#drumTone(at, velocity, 150, 48, 0.28);
    if (this.#tone.kickBeater > 0) {
      this.#drumTone(at, velocity * this.#tone.kickBeater, 150, 48, 0.13, 2);
    }
    this.#noiseBurst(at, 0.03, velocity * this.#tone.kickClick, {
      type: "bandpass",
      frequency: 1400,
      Q: 0.8,
    });
    if (this.#tone.kickTick > 0) {
      this.#noiseBurst(at, 0.014, velocity * this.#tone.kickTick, {
        type: "bandpass",
        frequency: 3500,
        Q: 0.9,
      });
    }
  }

  /**
   * A tom: the same membrane an octave or two up, with a stick attack.
   *
   * Toms only appear in the top rung's fill, where they have to be heard as
   * *different drums* arriving rather than as the kick moving around. The tone
   * is pulled back slightly and the attack noise pitched into the midrange, so
   * the fill reads on a small speaker for the same reason the hat does.
   */
  #tom(
    at: number,
    velocity: number,
    fromHz: number,
    toHz: number,
    seconds: number,
    attackHz: number
  ): void {
    this.#drumTone(at, velocity * 0.85, fromHz, toHz, seconds);
    this.#noiseBurst(at, 0.022, velocity * 0.2, { type: "bandpass", frequency: attackHz, Q: 1 });
  }

  /**
   * The ride: a longer, lower-centred wash laid *over* the on-beat hat.
   *
   * It never replaces the hat, because the hat is the transient the pulse
   * survives on. What the ride adds is sustain — the beat stops being a row of
   * clicks and starts ringing — which is the cheapest way to make a bar sound
   * bigger without making it louder. Its peak is deliberately well under the
   * hat's for that reason.
   */
  #ride(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.25, velocity * 0.16, { type: "bandpass", frequency: 5200, Q: 1.8 });
  }

  /**
   * The crash: a wide, bright wash lasting most of a beat.
   *
   * Peak level is modest and the *length* does the work, which is both how a
   * crash actually behaves and what keeps the top rungs off the ceiling: a crash
   * lands on the same instant as a kick and a hat. Capped under the noise
   * buffer's one second, or it would be truncated rather than decayed.
   */
  #crash(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.85, velocity * 0.2, { type: "highpass", frequency: 3000, Q: 0.7 });
  }

  /**
   * Three layers, because a snare is three things and only one of them was
   * being synthesised.
   *
   * The band-passed body at 1.9 kHz is the wires, and on its own it is a
   * *shush* — present on a meter, easy to lose behind a guitar. The snap above
   * 4.5 kHz is the stick hitting the head, which is the part the ear locates the
   * backbeat by; the tuned shell under it — two short sines a fifth apart, gone
   * in 90 ms — is the drum the wires are stretched across, and is what stops the
   * hit reading as a burst of noise rather than as somebody hitting something.
   */
  #snare(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.16, velocity * this.#tone.snareBody, {
      type: "bandpass",
      frequency: 1900,
      Q: 0.55,
    });
    if (this.#tone.snareSnap > 0) {
      this.#noiseBurst(at, 0.045, velocity * this.#tone.snareSnap, {
        type: "highpass",
        frequency: 4500,
        Q: 0.7,
      });
    }
    if (this.#tone.snareShell > 0) {
      for (const hz of [185, 278]) {
        this.#shellTone(at, velocity * this.#tone.snareShell * (hz === 185 ? 1 : 0.6), hz, 0.09);
      }
    }
  }

  /** A short tuned sine. The snare's shell; not swept, because a shell is not. */
  #shellTone(at: number, velocity: number, hz: number, seconds: number): void {
    const osc = this.#context.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(hz, at);

    const gain = this.#context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocity), at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    osc.connect(gain);
    gain.connect(this.#bus);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
    this.#voices.push({ startTime: at, source: osc, gain });
  }

  /** Very short high-passed noise. Marks the eighths without masking anything. */
  #hat(at: number, velocity: number): void {
    // Two bursts, and the lower one is the point.
    //
    // This was a single 7 kHz burst at 0.4, which is what a hi-hat looks like
    // on a spectrum and not what one sounds like on a laptop. Small speakers
    // roll off hard at the top as well as the bottom, so a hat living entirely
    // above 7 kHz measures present and is heard as a faint shimmer — playtest
    // feedback was that the drums were "not obvious" and that nothing was
    // arriving between the beats, when in fact every one of those hits was
    // being scheduled and sounded.
    //
    // The body at 3.2 kHz is what carries it; the bright burst on top is what
    // still makes it a hat rather than a click. Together they are audible in
    // the band every speaker actually reproduces.
    const level = this.#tone.hat;
    this.#noiseBurst(at, 0.05, velocity * 0.55 * level, {
      type: "bandpass",
      frequency: 3200,
      Q: 0.7,
    });
    this.#noiseBurst(at, 0.035, velocity * 0.4 * level, {
      type: "highpass",
      frequency: 7000,
      Q: 0.7,
    });
  }

  /**
   * The sixteenth marker: brighter and shorter than the hat.
   *
   * Sixteenths arrive twice as often as the hats they sit between, so this has
   * to be small enough not to become the loudest thing in the mix while still
   * being clearly a *different* sound — separated by timbre, not volume.
   *
   * Centred at 6 kHz rather than high-passed at 11 kHz. The old placement was
   * above where most laptop and phone speakers reproduce anything at all, so
   * the sixteenth grid — the one feel a player most needs warning of — was the
   * least audible thing in the kit.
   */
  #sixteenthTick(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.022, velocity * 0.42, { type: "bandpass", frequency: 6000, Q: 0.6 });
  }

  /**
   * The triplet marker: a short pitched click, deliberately woody.
   *
   * Triplets and sixteenths can be signalled in the same bar, and two noise
   * bursts an octave apart would just blur. Pitching this one down into the
   * midrange makes the two grids separable even when they overlap.
   */
  #tripletClick(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.03, velocity * 0.3, { type: "bandpass", frequency: 2600, Q: 5 });
  }

  #noiseBurst(
    at: number,
    seconds: number,
    peak: number,
    filterSpec: { type: BiquadFilterType; frequency: number; Q: number }
  ): void {
    const source = this.#context.createBufferSource();
    source.buffer = this.#noise;
    // Start at a random offset so consecutive hits are not bit-identical.
    const offset = Math.random() * Math.max(0, this.#noise.duration - seconds - 0.01);

    const filter = this.#context.createBiquadFilter();
    filter.type = filterSpec.type;
    filter.frequency.value = filterSpec.frequency;
    filter.Q.value = filterSpec.Q;

    const gain = this.#context.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, peak), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.#bus);
    source.start(at, offset, seconds + 0.01);
    source.stop(at + seconds + 0.02);

    this.#voices.push({ startTime: at, source, gain });
  }
}
