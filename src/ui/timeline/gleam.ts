/**
 * The gleam on a Perfect note: how bright the gold is glinting right now.
 *
 * Gold has to *behave* like gold or it is just yellow, and yellow did not read
 * as better than green from the couch. So a Perfect note catches the light —
 * a glint that swells over a beat and peaks exactly on one, so the sparkle is
 * part of the groove rather than noise on top of it. Every other beat, and
 * which beat is a property of the note rather than of the clock, so a run of
 * Perfects twinkles rather than blinking in unison.
 *
 * A pure function of the beat, like every other effect on the timeline: no
 * particle state, nothing accumulated, the same picture on every machine.
 */

/** The gleam period, in beats. */
export const GLEAM_PERIOD_BEATS = 2;

/** Which of the two beats a note gleams on: 0 or 1, stable per note id. */
export function gleamPhase(noteId: string): number {
  let hash = 0;
  for (let i = 0; i < noteId.length; i += 1) {
    hash = (hash * 31 + noteId.charCodeAt(i)) >>> 0;
  }
  return hash % GLEAM_PERIOD_BEATS;
}

/**
 * 0..1: nothing on the off-beat, full at the exact instant of the note's own
 * beat, swelling in over the half beat before and fading over the half after.
 */
export function gleamIntensity(noteId: string, nowBeat: number): number {
  const phase = gleamPhase(noteId);
  const nearest = Math.round(nowBeat);
  const cycle = ((nearest % GLEAM_PERIOD_BEATS) + GLEAM_PERIOD_BEATS) % GLEAM_PERIOD_BEATS;
  if (cycle !== phase) return 0;
  const distance = Math.abs(nowBeat - nearest);
  return Math.max(0, 1 - distance / 0.5);
}
