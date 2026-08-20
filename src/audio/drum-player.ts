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
    // Subordinate to the guitar, like the bass: this is a pulse, not a part.
    this.#output.gain.value = 0.5;
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
    if (hit.voice === "kick") this.#kick(at, hit.velocity);
    else if (hit.voice === "snare") this.#snare(at, hit.velocity);
    else this.#hat(at, hit.velocity);
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
    const osc = this.#context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(48, at + 0.09);

    const gain = this.#context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.9 * velocity, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);

    osc.connect(gain);
    gain.connect(this.#output);
    osc.start(at);
    osc.stop(at + 0.32);
    this.#voices.push({ startTime: at, source: osc, gain });

    this.#noiseBurst(at, 0.02, velocity * 0.35, { type: "bandpass", frequency: 1400, Q: 0.8 });
  }

  /** Band-passed noise, wide and short: the backbeat, in the midrange. */
  #snare(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.16, velocity * 0.5, { type: "bandpass", frequency: 1900, Q: 0.55 });
  }

  /** Very short high-passed noise. Marks the eighths without masking anything. */
  #hat(at: number, velocity: number): void {
    this.#noiseBurst(at, 0.045, velocity * 0.22, { type: "highpass", frequency: 7000, Q: 0.7 });
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
