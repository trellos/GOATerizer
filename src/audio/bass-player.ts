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
 */

import type { BassLine } from "./bass-line.js";
import { midiToFrequency } from "../music/pitch.js";
import type { Transport } from "./transport.js";

const TICK_MS = 25;
const LOOKAHEAD_S = 0.15;

type ScheduledVoice = {
  startTime: number;
  osc: OscillatorNode;
  gain: GainNode;
};

export class BassPlayer {
  readonly #context: AudioContext;
  readonly #transport: Transport;
  readonly #output: GainNode;
  #line: BassLine | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #scheduledThroughBeat = 0;
  #voices: ScheduledVoice[] = [];

  constructor(context: AudioContext, transport: Transport, destination: AudioNode) {
    this.#context = context;
    this.#transport = transport;
    this.#output = context.createGain();
    // Subordinate by design: the bass is context, not a second target track.
    this.#output.gain.value = 0.34;
    this.#output.connect(destination);
  }

  get line(): BassLine | null {
    return this.#line;
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
    const line = this.#line;
    if (!line || !this.#transport.running) return;

    const horizonBeat = this.#transport.beatAt(this.#context.currentTime + LOOKAHEAD_S);
    const from = this.#scheduledThroughBeat;
    if (horizonBeat <= from) return;

    // Walk loop occurrences rather than absolute beats, so an arbitrary
    // transport position maps onto the four-measure pattern without a modulo
    // per note.
    const loop = line.loopBeats;
    const firstCycle = Math.floor(from / loop);
    const lastCycle = Math.floor(horizonBeat / loop);

    for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
      for (const note of line.notes) {
        const absoluteBeat = cycle * loop + note.startBeat;
        if (absoluteBeat <= from || absoluteBeat > horizonBeat) continue;
        this.#scheduleNote(note.midi, absoluteBeat, note.durationBeats);
      }
    }

    this.#scheduledThroughBeat = horizonBeat;
    this.#reapVoices();
  }

  #scheduleNote(midi: number, atBeat: number, durationBeats: number): void {
    const startTime = this.#transport.contextTimeAt(atBeat);
    const seconds = durationBeats * this.#transport.secondsPerBeat;
    const stopTime = startTime + seconds;

    const osc = this.#context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFrequency(midi);

    const gain = this.#context.createGain();
    // A plucked-ish envelope. Short attack so the beat is unmistakable, decay
    // well before the next beat so the pulse stays articulated.
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.7, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopTime * 0.35 + startTime * 0.65);

    const filter = this.#context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.#output);
    osc.start(startTime);
    osc.stop(stopTime + 0.05);

    this.#voices.push({ startTime, osc, gain });
  }

  /** Silences anything scheduled but not yet sounding. */
  #cancelFutureVoices(): void {
    const now = this.#context.currentTime;
    const surviving: ScheduledVoice[] = [];
    for (const voice of this.#voices) {
      if (voice.startTime > now) {
        try {
          voice.osc.stop(now);
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
