/**
 * The timing check: measuring how far a player's notes land from the beat.
 *
 * ## What is actually being measured
 *
 * Not "latency". The number this produces is the sum of three things, and all
 * three want cancelling:
 *
 *   1. **Output latency the browser did not report** — an interface's own
 *      buffering, an amp, Bluetooth headphones. The player hears the click late.
 *   2. **Input latency** — their note is captured and timestamped after they
 *      played it.
 *   3. **Their own anticipation.** Asked to play along with a click, people
 *      systematically play slightly *early* — 20-50ms is normal, and musicians
 *      more than non-musicians. It is not an error to correct; for a game it is
 *      the thing that makes "on the beat" mean what the player feels it means.
 *
 * A loopback measurement would isolate (1) and (2). This measures all three
 * together, on purpose, because what the judge needs is the offset that makes
 * the player's *sense* of the beat agree with the game's. That is why the UI
 * calls it a timing offset rather than a latency.
 *
 * ## Why quarter notes, and why not eighths
 *
 * A sample is matched to the nearest beat, so an offset larger than half a beat
 * lands on the *wrong* beat and folds over — 0.6 beats late measures as 0.4
 * early. Quarters at 90bpm give ±333ms of headroom before that happens; eighths
 * would give ±167ms, which is inside the range of a genuinely bad Bluetooth
 * rig, and they add the player's own subdivision error on top. Eighths would
 * only be the better choice if the thing being measured were jitter.
 *
 * {@link CalibrationSession} then extends the range further by unwrapping
 * against the running median: once a few samples agree, the *expected* beat for
 * the next one is chosen around that estimate rather than around zero, which
 * roughly doubles what can be resolved.
 *
 * ## Why a warm-up bar is thrown away
 *
 * The first notes of any tapping task are the player finding the tempo, not
 * playing at it. Including them widens the spread — the number that decides
 * whether the offset is trustworthy at all — for no gain.
 *
 * Pure. No audio, no DOM, no transport: it is fed beats and told what happened.
 */

import { BEATS_PER_MEASURE } from "../config/tuning.js";

/**
 * The tempo the check always runs at, whatever the player picked for their run.
 *
 * Fixed rather than inherited so the measurement is comparable between sessions
 * and the fold-over headroom is a known quantity. 90bpm is the game's own
 * default and sits where hand timing is still reliable — synchronising with a
 * click gets measurably worse below about 75bpm, where the gaps are long enough
 * that the player is estimating rather than entraining.
 */
export const CALIBRATION_BPM = 90;

/** Bars of click before anything is recorded, so the player can find the tempo. */
export const COUNT_IN_BARS = 2;
/** Played, then discarded. See the note above. */
export const WARMUP_BARS = 1;
/** Bars that count. Four quarters each, so sixteen samples at best. */
export const MEASURED_BARS = 4;

export const TOTAL_BARS = COUNT_IN_BARS + WARMUP_BARS + MEASURED_BARS;

/**
 * Fewest samples worth a median.
 *
 * The median's own error falls as 1/sqrt(n): at eight samples a player with a
 * 25ms spread has about 11ms of uncertainty in the result, which is under the
 * resolution anyone can feel. Below eight it is guesswork.
 */
export const MIN_SAMPLES = 8;

/**
 * The widest spread that still describes a rig rather than a player.
 *
 * Above this the notes are not clustered tightly enough for their middle to
 * mean anything, and the honest response is "play more evenly", not a number.
 * A steady player lands around 10-25ms; 45ms is scruffy but still usable.
 */
export const MAX_USABLE_SPREAD_MS = 45;

/**
 * Below this, the rig is already accurate and applying the result would be
 * chasing noise. Ten milliseconds is well under what anyone perceives.
 */
export const NEGLIGIBLE_OFFSET_MS = 10;

export type CalibrationPhase = "countIn" | "warmUp" | "measuring" | "done";

export type CalibrationState = {
  phase: CalibrationPhase;
  /** 1-based, across the whole check, for a progress readout. */
  bar: number;
  totalBars: number;
  samples: number;
  /** Median offset in ms, positive late. Null until there is anything to say. */
  offsetMs: number | null;
  /** Median absolute deviation in ms — how steadily the player played. */
  spreadMs: number | null;
  /** Enough samples, clustered tightly enough, for the offset to mean something. */
  usable: boolean;
  /** Usable *and* worth applying — a rig already inside 10ms needs nothing. */
  worthApplying: boolean;
};

export class CalibrationSession {
  readonly #startBeat: number;
  readonly #secondsPerBeat: number;
  #samples: number[] = [];
  #beat: number;

  /**
   * @param startBeat absolute transport beat the count-in begins on. Callers
   * should start it on a bar line, or the count-in is not a count-in.
   * @param secondsPerBeat at {@link CALIBRATION_BPM}; injected so the maths is
   * testable without a transport.
   */
  constructor(startBeat: number, secondsPerBeat = 60 / CALIBRATION_BPM) {
    this.#startBeat = startBeat;
    this.#secondsPerBeat = secondsPerBeat;
    this.#beat = startBeat;
  }

  /** Advances the clock. Safe to call every frame. */
  update(beat: number): void {
    this.#beat = Math.max(this.#beat, beat);
  }

  /**
   * Records one played note, if the check is in its measured bars.
   *
   * @param beat the **heard** beat the note landed on — already compensated by
   * whatever trim is currently applied, so what is measured is the residual the
   * current compensation does not explain.
   */
  note(beat: number): void {
    this.update(beat);
    if (this.phase !== "measuring") return;
    this.#samples.push(this.#offsetOf(beat));
  }

  get phase(): CalibrationPhase {
    const bars = (this.#beat - this.#startBeat) / BEATS_PER_MEASURE;
    if (bars < COUNT_IN_BARS) return "countIn";
    if (bars < COUNT_IN_BARS + WARMUP_BARS) return "warmUp";
    if (bars < TOTAL_BARS) return "measuring";
    return "done";
  }

  get state(): CalibrationState {
    const offsetMs = median(this.#samples);
    const spreadMs =
      offsetMs === null
        ? null
        : median(this.#samples.map((sample) => Math.abs(sample - offsetMs)));
    const usable =
      this.#samples.length >= MIN_SAMPLES &&
      spreadMs !== null &&
      spreadMs <= MAX_USABLE_SPREAD_MS;
    const bars = Math.floor((this.#beat - this.#startBeat) / BEATS_PER_MEASURE);
    return {
      phase: this.phase,
      bar: Math.max(1, Math.min(TOTAL_BARS, bars + 1)),
      totalBars: TOTAL_BARS,
      samples: this.#samples.length,
      offsetMs,
      spreadMs,
      usable,
      worthApplying: usable && Math.abs(offsetMs ?? 0) >= NEGLIGIBLE_OFFSET_MS,
    };
  }

  /**
   * How far one note was from the beat it was aiming at, in ms, positive late.
   *
   * The beat it was aiming at is chosen *around the running median* rather than
   * around zero. On a rig 300ms late at 90bpm every sample sits 0.45 beats out,
   * and one noisy note at 0.55 would otherwise be recorded as 0.45 *early* —
   * a 600ms error in a single sample, in the wrong direction. Unwrapping keeps
   * such a note with its neighbours.
   */
  #offsetOf(beat: number): number {
    const estimateBeats = (median(this.#samples) ?? 0) / 1000 / this.#secondsPerBeat;
    const expected = Math.round(beat - estimateBeats);
    return (beat - expected) * this.#secondsPerBeat * 1000;
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}
