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
 */

import type { BassLine } from "./bass-line.js";
import { forEachLoopEvent } from "./loop-scheduling.js";
import { midiToFrequency } from "../music/pitch.js";
import type { Transport } from "./transport.js";

const TICK_MS = 25;
const LOOKAHEAD_S = 0.15;

/**
 * The bass's own level, before anything ducks it.
 *
 * Subordinate by design: the bass is context, not a second target track. This
 * is the one place that decision lives — {@link BassPlayer.setDuck} scales this
 * number rather than replacing it, so tuning "how loud is the bass" stays a
 * one-line edit here and does not have to be reconciled with whatever the duck
 * happens to be doing at the time.
 */
const BASE_OUTPUT_GAIN = 0.46;

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

type ScheduledVoice = {
  startTime: number;
  osc: OscillatorNode;
  /** The octave doubling. Cancelled and reaped with its fundamental. */
  octave: OscillatorNode;
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
  #duck = 1;

  constructor(context: AudioContext, transport: Transport, destination: AudioNode) {
    this.#context = context;
    this.#transport = transport;
    this.#output = context.createGain();
    this.#output.gain.value = BASE_OUTPUT_GAIN;
    this.#output.connect(destination);
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

    forEachLoopEvent(line.notes, line.loopBeats, from, horizonBeat, (note, beat) =>
      this.#scheduleNote(note.midi, beat, note.durationBeats)
    );

    this.#scheduledThroughBeat = horizonBeat;
    this.#reapVoices();
  }

  #scheduleNote(midi: number, atBeat: number, durationBeats: number): void {
    const startTime = this.#transport.contextTimeAt(atBeat);
    const seconds = durationBeats * this.#transport.secondsPerBeat;
    const stopTime = startTime + seconds;

    // Two oscillators: the written pitch, and the octave above it.
    //
    // The line is voiced at 40-75 Hz so it sits under the guitar, and a laptop
    // speaker reproduces almost none of that. A sawtooth was already chosen so
    // the ear could reconstruct the missing fundamental from its harmonics, but
    // a saw's harmonics fall away as 1/n and the octave — the one partial that
    // most defines the note — arrives at half amplitude and then goes through a
    // low-pass. Doubling it explicitly puts real energy at 80-150 Hz, which is
    // where a small speaker starts being honest, and is what turns the part
    // from a rumble into something with pitch and attack.
    const osc = this.#context.createOscillator();
    const octave = this.#context.createOscillator();
    // Sawtooth, not triangle. The line is voiced at 40-75 Hz so it sits under
    // the guitar (see bass-line.ts), and almost no speaker a browser game is
    // played on reproduces that fundamental at all — a laptop rolls off hard
    // below ~150 Hz. What makes a bass note audible there is its harmonics: the
    // ear reconstructs the missing fundamental from them. A triangle's
    // harmonics fall off as 1/n² and had nothing left by the third, so the part
    // was being rendered and simply not heard.
    osc.type = "sawtooth";
    osc.frequency.value = midiToFrequency(midi);
    octave.type = "sawtooth";
    octave.frequency.value = midiToFrequency(midi + 12);

    // Under the fundamental, so the part still reads as bass rather than as a
    // second melody competing with the guitar for the midrange.
    const octaveGain = this.#context.createGain();
    octaveGain.gain.value = 0.42;

    const gain = this.#context.createGain();
    // A plucked-ish envelope. Short attack so the beat is unmistakable, decay
    // well before the next beat so the pulse stays articulated.
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.5, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopTime * 0.35 + startTime * 0.65);

    const filter = this.#context.createBiquadFilter();
    filter.type = "lowpass";
    // High enough to pass the first ~20 harmonics, which is what carries the
    // note on a small speaker; low enough that the line still reads as bass and
    // stays out of the register the target notes occupy.
    filter.frequency.value = 1200;

    osc.connect(filter);
    octave.connect(octaveGain);
    octaveGain.connect(filter);
    filter.connect(gain);
    gain.connect(this.#output);
    osc.start(startTime);
    octave.start(startTime);
    osc.stop(stopTime + 0.05);
    octave.stop(stopTime + 0.05);

    this.#voices.push({ startTime, osc, gain, octave });
  }

  /** Silences anything scheduled but not yet sounding. */
  #cancelFutureVoices(): void {
    const now = this.#context.currentTime;
    const surviving: ScheduledVoice[] = [];
    for (const voice of this.#voices) {
      if (voice.startTime > now) {
        // Both oscillators, or a cancelled note keeps sounding its octave —
        // which is exactly what a reroll or a tempo change would leave behind.
        for (const source of [voice.osc, voice.octave]) {
          try {
            source.stop(now);
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

  #reapVoices(): void {
    const cutoff = this.#context.currentTime - 2;
    this.#voices = this.#voices.filter((voice) => voice.startTime > cutoff);
  }
}
