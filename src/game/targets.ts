/**
 * Authored prompt -> concrete target opportunities in the run key.
 *
 * This is the one place a scale degree becomes a MIDI note. The judgment engine
 * and the timeline both consume the result, so there is exactly one
 * transposition in the game and everything that draws a note agrees with it.
 *
 * It is also the one place the phrase is *repeated*. An attempt plays the
 * authored phrase {@link ATTEMPT_REPEATS} times, and expanding that here rather
 * than in the scenario data means the repeat is a rule of the game loop instead
 * of something every scenario has to author twice — and everything downstream
 * (the judge, the timeline, the autoplay planner, the actors) gets it for free,
 * because they all read this list and nothing else.
 *
 * It is also, for the same reason, the one place a *pentatonic* degree becomes
 * a diatonic one: which lane `p3` sits on depends on whether the run is major
 * or minor, and the run key is only known here (`music/degrees.ts`,
 * {@link resolveDegree}).
 */

import { ATTEMPT_REPEATS } from "../config/tuning.js";
import { laneIndexOf, resolveDegree, type ScaleDegreeRef } from "../music/degrees.js";
import { degreeToMidi, type RunKey } from "../music/keys.js";
import type { NoteDuration, ScenarioLevelData } from "../scenario/types.js";

export type ResolvedTarget = {
  /**
   * Index among *note* opportunities only, across the whole attempt. Rests do
   * not consume one, and the second time through the phrase continues the
   * count rather than restarting it — the judge slots and the timeline both key
   * on this, so it has to be unique for the attempt, not for the phrase.
   */
  opportunityIndex: number;
  /** Index in the authored prompt, rests included. Repeats each pass. */
  promptIndex: number;
  /** Which time through the phrase this is, from 0. */
  pass: number;
  /** Beats from the start of the attempt. */
  startBeat: number;
  durationBeats: number;
  duration: NoteDuration;
  /** Diatonic in the run key — already resolved from whatever was authored. */
  degree: ScaleDegreeRef;
  /** 0..7 in the Key View. */
  lane: number;
  midi: number;
};

/**
 * How long one pass at the phrase lasts, from the level's own measure plan.
 *
 * Read from the authored data rather than from `PHRASE_BEATS`, because it is
 * the number the loader validated the prompt's durations against: if a scenario
 * ever authors a phrase of a different length, the repeat still lands exactly
 * on its end rather than on a constant's idea of it.
 */
export function phraseBeats(level: ScenarioLevelData): number {
  return level.measurePlan.attemptMeasures * level.measurePlan.beatsPerMeasure;
}

export function resolveTargets(level: ScenarioLevelData, key: RunKey): ResolvedTarget[] {
  const span = phraseBeats(level);
  const targets: ResolvedTarget[] = [];
  for (let pass = 0; pass < ATTEMPT_REPEATS; pass += 1) {
    for (const event of level.prompt) {
      if (event.type !== "note" || event.degree === null) continue;
      const degree = resolveDegree(event.degree, key.mode);
      targets.push({
        opportunityIndex: targets.length,
        promptIndex: event.index,
        pass,
        startBeat: event.startBeat + pass * span,
        durationBeats: event.durationBeats,
        duration: event.duration,
        degree,
        lane: laneIndexOf(degree),
        midi: degreeToMidi(degree, key),
      });
    }
  }
  return targets;
}

/**
 * Rests, kept separately so the timeline can draw the gap deliberately.
 *
 * Repeated on the same schedule as the targets, so the two describe the same
 * attempt — a rest list that stopped after the first pass would put a silent
 * hole in the second half of every phrase that has one.
 */
export function restEvents(
  level: ScenarioLevelData
): readonly { startBeat: number; durationBeats: number }[] {
  const span = phraseBeats(level);
  const rests: { startBeat: number; durationBeats: number }[] = [];
  for (let pass = 0; pass < ATTEMPT_REPEATS; pass += 1) {
    for (const event of level.prompt) {
      if (event.type !== "rest") continue;
      rests.push({ startBeat: event.startBeat + pass * span, durationBeats: event.durationBeats });
    }
  }
  return rests;
}
