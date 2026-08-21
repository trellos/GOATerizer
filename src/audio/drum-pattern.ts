/**
 * The backing drum pattern.
 *
 * PROVISIONAL. The GDD describes the backing as a bass line and says nothing
 * about percussion (§23 leaves the bass grammar unspecified; drums are not
 * specified at all — the "Building Drums" entries in the scenario catalogue are
 * a minigame's *visual* subject, not an audio track). This exists because the
 * bass alone did not read as a pulse: it is voiced below the guitar on purpose,
 * which on laptop speakers puts the beat somewhere the hardware barely
 * reproduces. Percussion carries the pulse in a register that any speaker can
 * actually produce, which is what a rhythm game needs its backing to do.
 *
 * Two jobs, and they are deliberately different voices:
 *
 *   1. **The pulse.** Kick on 1 and 3, snare on 2 and 4 — quarter notes and
 *      nothing else. Unambiguous, and the same in every scenario, so the player
 *      never has to work out where the beat is.
 *   2. **The grid ahead.** Extra hits marking whatever subdivision the current
 *      and *upcoming* phrases sit on (`game/subdivisions.ts`). A sixteenth run
 *      is unplayable if the first sixteenth is also the first warning, so the
 *      kit starts counting it one attempt early and keeps counting through it.
 *
 * Each grid gets its own voice rather than a louder version of the same one,
 * because sixteenths and triplets can be signalled at the same time and the
 * whole point is being able to tell them apart by ear.
 *
 * Per `AGENTS.md` §17 this is tuning data, labelled provisional, not presented
 * as canonical design. If the design later specifies percussion, this is the
 * file that changes.
 *
 * Pure — no audio, no DOM — so the grid is testable on its own.
 */

import { BEATS_PER_MEASURE } from "../config/tuning.js";
import { NO_SUBDIVISIONS, type SubdivisionSet } from "../game/subdivisions.js";

export type DrumVoice = "kick" | "snare" | "hat" | "tick" | "trip";

export type DrumHit = {
  /** Beats from the start of the loop. */
  startBeat: number;
  voice: DrumVoice;
  /** Relative level, 0..1. Accents the pulse; it is not a scoring input. */
  velocity: number;
};

export type DrumPattern = {
  hits: readonly DrumHit[];
  loopBeats: number;
};

/** Which voice marks which grid. One timbre each, so two can sound at once. */
const SUBDIVISION_VOICE = {
  eighth: "hat",
  sixteenth: "tick",
  triplet: "trip",
} as const;

/**
 * Builds a one-measure pattern: the pulse, plus a layer per signalled grid.
 *
 * One measure rather than the bass's four: the pattern's job is to say where
 * the beat is, and repeating every measure states that more often. Four divides
 * the bass's sixteen exactly, so the two loops never drift out of phase.
 *
 * Every layer accents its first hit within the beat, so a subdivision groups
 * into beats by ear instead of arriving as an undifferentiated tick.
 */
export function drumPatternFor(subdivisions: SubdivisionSet = NO_SUBDIVISIONS): DrumPattern {
  const hits: DrumHit[] = [];

  for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
    // The pulse. Quarter notes, always, whatever is being signalled over it.
    const onBeat = beat % 2 === 0;
    hits.push({ startBeat: beat, voice: onBeat ? "kick" : "snare", velocity: onBeat ? 1 : 0.9 });

    if (subdivisions.has("eighth")) {
      hits.push({ startBeat: beat + 0.5, voice: SUBDIVISION_VOICE.eighth, velocity: 0.5 });
    }
    if (subdivisions.has("sixteenth")) {
      // Only the `e` and the `a`: the `and` is already the eighth layer's, and
      // a sixteenth grid always brings its eighths with it.
      hits.push({ startBeat: beat + 0.25, voice: SUBDIVISION_VOICE.sixteenth, velocity: 0.34 });
      hits.push({ startBeat: beat + 0.75, voice: SUBDIVISION_VOICE.sixteenth, velocity: 0.34 });
    }
    if (subdivisions.has("triplet")) {
      hits.push({ startBeat: beat + 1 / 3, voice: SUBDIVISION_VOICE.triplet, velocity: 0.42 });
      hits.push({ startBeat: beat + 2 / 3, voice: SUBDIVISION_VOICE.triplet, velocity: 0.42 });
    }
  }

  return { hits, loopBeats: BEATS_PER_MEASURE };
}

/** The pulse on its own: what plays in pregame, and under quarter-note content. */
export const BACKBEAT_PATTERN: DrumPattern = drumPatternFor();
