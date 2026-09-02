/**
 * Authored prompt -> concrete target opportunities in the run key.
 *
 * This is the one place a scale degree becomes a MIDI note. The judgment
 * engine and the timeline both consume the result, so there is exactly one
 * transposition in the game and everything that draws a note agrees with it.
 *
 * It is also, for the same reason, the one place a *pentatonic* degree becomes
 * a diatonic one: which lane `p3` sits on depends on whether the run is major
 * or minor, and the run key is only known here (`music/degrees.ts`,
 * {@link resolveDegree}).
 */

import { laneIndexOf, resolveDegree, type ScaleDegreeRef } from "../music/degrees.js";
import { degreeToMidi, type RunKey } from "../music/keys.js";
import type { NoteDuration, ScenarioLevelData } from "../scenario/types.js";

export type ResolvedTarget = {
  /** Index among *note* opportunities only. Rests do not consume one. */
  opportunityIndex: number;
  /** Index in the authored prompt, rests included. */
  promptIndex: number;
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

export function resolveTargets(level: ScenarioLevelData, key: RunKey): ResolvedTarget[] {
  const targets: ResolvedTarget[] = [];
  for (const event of level.prompt) {
    if (event.type !== "note" || event.degree === null) continue;
    const degree = resolveDegree(event.degree, key.mode);
    targets.push({
      opportunityIndex: targets.length,
      promptIndex: event.index,
      startBeat: event.startBeat,
      durationBeats: event.durationBeats,
      duration: event.duration,
      degree,
      lane: laneIndexOf(degree),
      midi: degreeToMidi(degree, key),
    });
  }
  return targets;
}

/** Rests, kept separately so the timeline can draw the gap deliberately. */
export function restEvents(level: ScenarioLevelData): readonly { startBeat: number; durationBeats: number }[] {
  return level.prompt
    .filter((event) => event.type === "rest")
    .map((event) => ({ startBeat: event.startBeat, durationBeats: event.durationBeats }));
}
