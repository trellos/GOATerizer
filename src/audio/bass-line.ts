/**
 * The four-measure backing bass line.
 *
 * Pure: takes a key and a random source, returns notes. No audio, no DOM, so
 * the grammar is testable and the same line can be redrawn on the timeline.
 *
 * PROVISIONAL GRAMMAR. The GDD (§23) leaves the bass generator unspecified.
 * What is implemented here:
 *
 *   - one diatonic chord per measure, drawn from a small progression table;
 *   - one bass note per beat, so the pulse is unambiguous — a rhythm game
 *     whose backing only marks beats 1 and 3 is asking the player to guess;
 *   - beat 1 is the chord root, beat 3 the fifth, beats 2 and 4 a chord tone or
 *     a stepwise approach into the next chord;
 *   - everything below the timeline's lowest lane, so it sits under the guitar
 *     instead of competing with it.
 *
 * Its job is harmonic orientation and ear training (GDD §3.3), not to be
 * interesting. It is not scored.
 */

import { degreeToMidi, type RunKey } from "../music/keys.js";
import type { Degree } from "../music/degrees.js";
import { BEATS_PER_MEASURE } from "../config/tuning.js";

export type BassNote = {
  /** Beats from the start of the four-measure loop, 0..15. */
  startBeat: number;
  durationBeats: number;
  midi: number;
  /** Scale degree of this note, for the timeline's lane placement. */
  degree: Degree;
};

export type BassLine = {
  /** One chord degree per measure, e.g. `[1, 6, 4, 5]`. */
  progression: readonly Degree[];
  notes: readonly BassNote[];
  loopBeats: number;
};

/** Chord degrees per measure. Roman-numeral quality follows the mode. */
const PROGRESSIONS: Readonly<Record<"major" | "minor", readonly (readonly Degree[])[]>> = {
  major: [
    [1, 5, 6, 4],
    [1, 4, 5, 1],
    [1, 6, 4, 5],
    [1, 4, 1, 5],
  ],
  minor: [
    [1, 6, 3, 7],
    [1, 4, 5, 1],
    [1, 7, 6, 7],
    [1, 4, 1, 5],
  ],
};

/** Degree `n` steps above `degree`, wrapping within the seven-note scale. */
function stepDegree(degree: Degree, steps: number): Degree {
  return (((degree - 1 + steps) % 7) + 1) as Degree;
}

/**
 * Voices one degree into the bass register: the octave below the timeline's
 * bottom lane.
 *
 * Degrees more than a sixth above the tonic are voiced *below* it instead — the
 * fifth becomes a fifth down, the leading tone a semitone under the root. That
 * is ordinary bass voice-leading, and it keeps the line inside a compact range
 * (A#1..G#3 across all 24 keys) instead of leaping a seventh every time the
 * progression touches a high degree. The range is derived from the guitar's own
 * register rather than stated: move `LOWEST_TONIC_MIDI` and this moves with it.
 *
 * Every note lands strictly below the lowest of the eight pitch lanes in every
 * key — the highest a voiced degree can reach is `tonic - 3` — so the bass
 * never sits in the guitar's target register.
 */
const VOICE_DOWN_ABOVE_SEMITONES = 9;

function bassMidi(degree: Degree, key: RunKey): number {
  const tonic = degreeToMidi({ degree: 1, octaveBand: 0 }, key) - 12;
  const step = degreeToMidi({ degree, octaveBand: 0 }, key) - (tonic + 12);
  return tonic + (step > VOICE_DOWN_ABOVE_SEMITONES ? step - 12 : step);
}

export function generateBassLine(key: RunKey, random: () => number = Math.random): BassLine {
  const table = PROGRESSIONS[key.mode];
  const progression = table[Math.min(table.length - 1, Math.floor(random() * table.length))];
  if (!progression) throw new Error("no progression available");

  const notes: BassNote[] = [];
  for (let measure = 0; measure < progression.length; measure += 1) {
    const chord = progression[measure];
    const next = progression[(measure + 1) % progression.length];
    if (chord === undefined || next === undefined) continue;

    const fifth = stepDegree(chord, 4);
    const third = stepDegree(chord, 2);
    // Beat 4 leans towards the next chord: its root, or a step below it.
    const approach = random() < 0.5 ? stepDegree(next, 6) : next;

    const beatDegrees: Degree[] = [chord, third, fifth, approach];
    for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
      const degree = beatDegrees[beat];
      if (degree === undefined) continue;
      notes.push({
        startBeat: measure * BEATS_PER_MEASURE + beat,
        durationBeats: 1,
        midi: bassMidi(degree, key),
        degree,
      });
    }
  }

  // The loop is as long as the progression, not as long as an attempt. They
  // used to be the same number and no longer are: an attempt plays its phrase
  // twice, and the bass should turn round with it rather than leave the second
  // half in silence.
  return { progression, notes, loopBeats: progression.length * BEATS_PER_MEASURE };
}
