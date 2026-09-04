/**
 * Plays the four-measure bass loop against the transport.
 *
 * Lookahead scheduling: a timer wakes up every {@link TICK_MS} and hands the
 * audio clock every note that starts inside the next {@link LOOKAHEAD_S}. The
 * timer decides when to *look*; `Transport.contextTimeAt()` decides when each
 * note actually *sounds*, so the loop cannot drift and a slow frame cannot
 * shift the beat.
 *
 * Two things this has to survive without restarting the loop, because pregame
 * lets the player do both while the bass is playing (GDD §15.1):
 *
 *   - **Reroll.** A new key and a new line adopt the transport's current phase.
 *   - **Tempo change.** The transport re-anchors at the same beat, so only the
 *     already-scheduled tail is wrong; it is cancelled and re-scheduled.
 *
 * A third thing it survives without restarting is being ducked mid-phrase — see
 * {@link BassPlayer.setDuck}. The line keeps playing exactly as scheduled; only
 * the master level moves, so the bass never loses its place because the player
 * did.
 *
 * What a note sounds like is not here — it is `BassVoicePool` in
 * `bass-voice.ts`, which knows nothing about beats and takes a plain
 * `BaseAudioContext`. This file is the scheduler and the duck.
 */

import type { BassLine } from "./bass-line.js";
import { BassVoicePool } from "./bass-voice.js";
import { forEachLoopEvent } from "./loop-scheduling.js";
import type { Transport } from "./transport.js";

const TICK_MS = 25;
const LOOKAHEAD_S = 0.15;

/** How far behind the clock a sounded note is forgotten about. */
const REAP_SECONDS = 2;

/**
 * The bass's own level, before anything ducks it.
 *
 * Subordinate by design: the bass is context, not a second target track. This
 * is the one place that decision lives — {@link BassPlayer.setDuck} scales this
 * number rather than replacing it, so tuning "how loud is the bass" stays a
 * one-line edit here and does not have to be reconciled with whatever the duck
 * happens to be doing at the time.
 *
 * It buys less than it used to: the voice it feeds is four layers now rather
 * than two oscillators (`bass-voice.ts`), so the same number is a good deal
 * more present than it was, which is the point.
 *
 * Exported for `scripts/render-audio-demo.mjs`, so an audition renders the bass
 * at the level the game actually plays it at rather than at a number somebody
 * typed into the script.
 */
export const BASE_OUTPUT_GAIN = 0.5;

/**
 * How long the duck takes to move to a new level, in seconds.
 *
 * Stepping a gain node's value is an instantaneous discontinuity in the
 * waveform, which is a click — and it would land on exactly the beat the player
 * just missed, so the game would answer every mistake with a pop. Long enough
 * to be inaudible as an edge, short enough that the drop still reads as a
 * response to *that* note rather than as a slow fade.
 */
const DUCK_RAMP_SECONDS = 0.04;

export class BassPlayer {
  readonly #context: AudioContext;
  readonly #transport: Transport;
  readonly #output: GainNode;
  readonly #voices: BassVoicePool;
  #line: BassLine | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #scheduledThroughBeat = 0;
  #duck = 1;

  constructor(context: AudioContext, transport: Transport, destination: AudioNode) {
    this.#context = context;
    this.#transport = transport;
    this.#output = context.createGain();
    this.#output.gain.value = BASE_OUTPUT_GAIN;
    this.#output.connect(destination);
    this.#voices = new BassVoicePool(context, this.#output);
  }

  get line(): BassLine | null {
    return this.#line;
  }

  /** The duck multiplier currently applied, in 0..1. */
  get duck(): number {
    return this.#duck;
  }

  /**
   * Scales the bass's own level by `multiplier`, ramped rather than stepped.
   *
   * The multiplier comes from `game/backing-duck.ts`, which decides *how much*
   * the band should get out of the player's way. This method only knows how to
   * do it without clicking, and deliberately does not know why: 1 is the bass
   * playing at the level it was designed to sit at, and everything below that is
   * somebody else's judgment about the performance.
   *
   * It multiplies {@link BASE_OUTPUT_GAIN} rather than assigning an absolute
   * gain, so the duck cannot silently become the place the bass's level is
   * decided. Repeats of the value already in force are dropped, so a caller can
   * push the duck's current gain after every judgment event without stacking a
   * ramp per note.
   */
  setDuck(multiplier: number): void {
    const next = Math.min(1, Math.max(0, multiplier));
    if (next === this.#duck) return;
    this.#duck = next;

    const now = this.#context.currentTime;
    const gain = this.#output.gain;
    // Anchor at where the ramp has actually got to before starting a new one,
    // or an interrupted ramp restarts from wherever the last one was *aiming*
    // and jumps. Four misses in quick succession is exactly that case.
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(BASE_OUTPUT_GAIN * next, now + DUCK_RAMP_SECONDS);
  }

  /**
   * Swaps the line in place. The transport is untouched, so the loop keeps its
   * phase and the player does not get yanked back to beat 1.
   */
  setLine(line: BassLine): void {
    this.#line = line;
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
    this.#voices.cancelFrom(this.#context.currentTime);
  }

  dispose(): void {
    this.stop();
    this.#voices.dispose();
    this.#output.disconnect();
  }

  #reschedule(): void {
    this.#voices.cancelFrom(this.#context.currentTime);
    if (this.#timer !== null) {
      this.#scheduledThroughBeat = this.#transport.beat;
      this.#tick();
    }
  }

  #tick(): void {
    const line = this.#line;
    if (!line || !this.#transport.running) return;

    const horizonBeat = this.#transport.beatAt(this.#context.currentTime + LOOKAHEAD_S);
    const from = this.#scheduledThroughBeat;
    if (horizonBeat <= from) return;

    forEachLoopEvent(line.notes, line.loopBeats, from, horizonBeat, (note, beat) =>
      this.#voices.play(
        note.midi,
        this.#transport.contextTimeAt(beat),
        note.durationBeats * this.#transport.secondsPerBeat
      )
    );

    this.#scheduledThroughBeat = horizonBeat;
    this.#voices.reap(this.#context.currentTime - REAP_SECONDS);
  }
}
