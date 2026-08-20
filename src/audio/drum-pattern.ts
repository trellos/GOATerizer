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
 * Per `AGENTS.md` §17 this is tuning data, labelled provisional, not presented
 * as canonical design. It is deliberately the plainest possible backbeat: its
 * job is to mark time unambiguously, not to be interesting. If the design later
 * specifies percussion, this is the file that changes.
 *
 * Pure — no audio, no DOM — so the grid is testable on its own.
 */

import { BEATS_PER_MEASURE } from "../config/tuning.js";

export type DrumVoice = "kick" | "snare" | "hat";

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

/**
 * A one-measure backbeat: kick on 1 and 3, snare on 2 and 4, eighth-note hats.
 *
 * One measure rather than the bass's four: the pattern's job is to say where
 * the beat is, and repeating every measure states that more often. Four divides
 * the bass's sixteen exactly, so the two loops never drift out of phase.
 *
 * Hats alternate loud/soft so the eighths group into beats by ear instead of
 * arriving as an undifferentiated tick.
 */
function buildBackbeat(): DrumPattern {
  const hits: DrumHit[] = [];

  for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
    const onBeat = beat % 2 === 0;
    hits.push({ startBeat: beat, voice: onBeat ? "kick" : "snare", velocity: onBeat ? 1 : 0.9 });
    hits.push({ startBeat: beat, voice: "hat", velocity: 0.75 });
    hits.push({ startBeat: beat + 0.5, voice: "hat", velocity: 0.45 });
  }

  return { hits, loopBeats: BEATS_PER_MEASURE };
}

export const BACKBEAT_PATTERN: DrumPattern = buildBackbeat();
