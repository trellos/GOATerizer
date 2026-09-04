/**
 * Plays the backing drum pattern against the transport.
 *
 * Same discipline as {@link BassPlayer}, for the same reason: a timer decides
 * when to *look*, `Transport.contextTimeAt()` decides when each hit *sounds*.
 * Nothing here chains `setTimeout` to place a beat, so a slow frame cannot
 * shift the pulse (`AGENTS.md` §5).
 *
 * What each drum sounds like is not here — it is `DrumKit` in `drum-voices.ts`,
 * which knows nothing about beats and takes a plain `BaseAudioContext`. This
 * file is the scheduler and nothing else.
 */

import { BACKBEAT_PATTERN, type DrumHit, type DrumPattern } from "./drum-pattern.js";
import { DrumKit } from "./drum-voices.js";
import { forEachLoopEvent } from "./loop-scheduling.js";
import type { Transport } from "./transport.js";

const TICK_MS = 25;
const LOOKAHEAD_S = 0.15;

/** How far behind the clock a sounded hit is forgotten about. */
const REAP_SECONDS = 2;

export class DrumPlayer {
  readonly #context: AudioContext;
  readonly #transport: Transport;
  readonly #kit: DrumKit;
  #pattern: DrumPattern = BACKBEAT_PATTERN;
  #timer: ReturnType<typeof setInterval> | null = null;
  #scheduledThroughBeat = 0;

  constructor(context: AudioContext, transport: Transport, destination: AudioNode) {
    this.#context = context;
    this.#transport = transport;
    this.#kit = new DrumKit(context, destination);
  }

  /** Scales the kit's designed level, 0..1. Turns it down without muting. */
  setLevel(fraction: number): void {
    this.#kit.setLevel(fraction);
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
    this.#kit.cancelFrom(this.#context.currentTime);
  }

  dispose(): void {
    this.stop();
    this.#kit.dispose();
  }

  #reschedule(): void {
    this.#kit.cancelFrom(this.#context.currentTime);
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
    this.#kit.reap(this.#context.currentTime - REAP_SECONDS);
  }

  #scheduleHit(hit: DrumHit, atBeat: number): void {
    this.#kit.strike(hit.voice, this.#transport.contextTimeAt(atBeat), hit.velocity);
  }
}
