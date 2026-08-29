/**
 * Plays the backing drum pattern against the transport.
 *
 * Same discipline as {@link BassPlayer}, for the same reason: a timer decides
 * when to *look*, `Transport.contextTimeAt()` decides when each hit *sounds*.
 * Nothing here chains `setTimeout` to place a beat, so a slow frame cannot
 * shift the pulse (`AGENTS.md` §5).
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
 * earns its size from *length* instead. The drum bus feeds the master with no
 * limiter anywhere in the chain, so a loud rung has to be loud by being dense,
 * not by being closer to the ceiling.
 */

import { BACKBEAT_PATTERN, type DrumHit, type DrumPattern } from "./drum-pattern.js";
import { forEachLoopEvent } from "./loop-scheduling.js";
import type { Transport } from "./transport.js";

const TICK_MS = 25;
const LOOKAHEAD_S = 0.15;

type ScheduledVoice = {
  startTime: number;
  source: AudioScheduledSourceNode;
  gain: GainNode;
};

export class DrumPlayer {
  readonly #context: AudioContext;
  readonly #transport: Transport;
  readonly #output: GainNode;
  /** One second of white noise, reused by every snare and hat hit. */
  readonly #noise: AudioBuffer;
  #pattern: DrumPattern = BACKBEAT_PATTERN;
  #timer: ReturnType<typeof setInterval> | null = null;
  #scheduledThroughBeat = 0;
  #voices: ScheduledVoice[] = [];

  constructor(context: AudioContext, transport: Transport, destination: AudioNode) {
    this.#context = context;
    this.#transport = transport;
    this.#output = context.createGain();
    // Subordinate to the guitar, like the bass — but the pulse is the one thing
    // the player cannot afford to lose, and at 0.5 it measured 0.14 peak above
    // 800 Hz, which is where a laptop or phone speaker starts reproducing.
    this.#output.gain.value = 0.85;
    this.#output.connect(destination);

    const frames = Math.floor(context.sampleRate);
    this.#noise = context.createBuffer(1, frames, context.sampleRate);
    const channel = this.#noise.getChannelData(0);
    for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1;
  }

  /** Overall level, 0..1. Lets the player turn the kit down without muting. */
  setLevel(level: number): void {
    this.#output.gain.value = Math.max(0, Math.min(1, level));
  }

  setPattern(pattern: DrumPattern): void {
    this.#pattern = pattern;
    this.#reschedule();
  }

  /** Call after a tempo change so the already-queued tail is re-timed. */
  retime(): void {
    this.#reschedule();
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#scheduledThroughBeat = this.#transport.beat;
    this.#timer = setInterval(() => this.#tick(), TICK_MS);
    this.#tick();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#cancelFutureVoices();
  }

  dispose(): void {
    this.stop();
    this.#output.disconnect();
  }

  #reschedule(): void {
    this.#cancelFutureVoices();
    if (this.#timer !== null) {
      this.#scheduledThroughBeat = this.#transport.beat;
      this.#tick();
    }
  }

  #tick(): void {
    if (!this.#transport.running) return;

    const horizonBeat = this.#transport.beatAt(this.#context.currentTime + LOOKAHEAD_S);
    const from = this.#scheduledThroughBeat;
    if (horizonBeat <= from) return;

    forEachLoopEvent(this.#pattern.hits, this.#pattern.loopBeats, from, horizonBeat, (hit, beat) =>
      this.#scheduleHit(hit, beat)
    );

    this.#scheduledThroughBeat = horizonBeat;
    this.#reapVoices();
  }

  #scheduleHit(hit: DrumHit, atBeat: number): void {
    const at = this.#transport.contextTimeAt(atBeat);
    switch (hit.voice) {
      case "kick":
        this.#kick(at, hit.velocity);
        break;
      case "snare":
        this.#snare(at, hit.velocity);
        break;
      case "tick":
        this.#sixteenthTick(at, hit.velocity);
        break;
      case "trip":
        this.#tripletClick(at, hit.velocity);
        break;
      case "ride":
        this.#ride(at, hit.velocity);
        break;
      case "crash":
        this.#crash(at, hit.velocity);
        break;
      case "tom":
        this.#tom(at, hit.velocity, 260, 150, 0.22, 900);
        break;
      case "floor":
        this.#tom(at, hit.velocity, 165, 92, 0.34, 620);
        break;
      default:
        this.#hat(at, hit.velocity);
        break;
    }
  }

  /**
   * A struck membrane: a sine swept downwards under a fast attack.
   *
   * Kick, rack tom and floor tom are the same instrument at three sizes, so they
   * are one synth with three sets of numbers rather than three near-identical
   * methods. The sweep is a third of the decay in every case, which is what
   * makes a drum sound struck rather than plucked.
   */
  #drumTone(at: number, velocity: number, fromHz: number, toHz: number, seconds: number): void {
    const osc = this.#context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fromHz, at);
    osc.frequency.exponentialRampToValueAtTime(toHz, at + seconds * 0.32);

    const gain = this.#context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.9 * velocity), at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    osc.connect(gain);
    gain.connect(this.#output);
    osc.start(at);
    osc.stop(at + seconds + 0.04);
    this.#voices.push({ startTime: at, source: osc, gain });
  }

  /**
   * Pitch-swept sine with a click on top.
   *
   * The sweep from 150 Hz down to 48 Hz is the body. On a small speaker almost
   * none of that survives, so the click — a very short noise burst — is what
   * actually marks beat 1 there. On headphones both are audible and it reads as
   * one drum.
   */
  #kick(at: number, velocity: number): void {
    this.#drumTone(at, velocity, 150, 48, 0.28);
    this.#noiseBurst(at, 0.02, velocity * 0.5, { type: "bandpass", frequency: 1400, Q: 0.8 });
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
   * crash actually behaves and what keeps the top rungs off the master's
   * ceiling: the bus has no limiter, and a crash lands on the same instant as a
   * kick and a hat. Capped under the noise buffer's one second, or it would be
   * truncated rather than decayed.
   */
  #crash(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.85, velocity * 0.2, { type: "highpass", frequency: 3000, Q: 0.7 });
  }

  /** Band-passed noise, wide and short: the backbeat, in the midrange. */
  #snare(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.16, velocity * 0.7, { type: "bandpass", frequency: 1900, Q: 0.55 });
  }

  /** Very short high-passed noise. Marks the eighths without masking anything. */
  #hat(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.045, velocity * 0.4, { type: "highpass", frequency: 7000, Q: 0.7 });
  }

  /**
   * The sixteenth marker: brighter and shorter than the hat.
   *
   * Sixteenths arrive twice as often as the hats they sit between, so this has
   * to be small enough not to become the loudest thing in the mix while still
   * being clearly a *different* sound — separated by timbre, not volume.
   */
  #sixteenthTick(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.022, velocity * 0.16, { type: "highpass", frequency: 11000, Q: 0.7 });
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
    gain.connect(this.#output);
    source.start(at, offset, seconds + 0.01);
    source.stop(at + seconds + 0.02);

    this.#voices.push({ startTime: at, source, gain });
  }

  /** Silences anything scheduled but not yet sounding. */
  #cancelFutureVoices(): void {
    const now = this.#context.currentTime;
    const surviving: ScheduledVoice[] = [];
    for (const voice of this.#voices) {
      if (voice.startTime > now) {
        try {
          voice.source.stop(now);
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

  #reapVoices(): void {
    const cutoff = this.#context.currentTime - 2;
    this.#voices = this.#voices.filter((voice) => voice.startTime > cutoff);
  }
}
