/**
 * Walking a looping pattern across an absolute-beat window.
 *
 * Both backing players — bass and drums — schedule the same way: a timer wakes
 * up, asks "which pattern events start in the next slice of beats?", and hands
 * each one to the audio clock. Only the pattern differs, so the walk lives here
 * rather than twice.
 *
 * Pure and synchronous: no audio, no timers, no transport. That makes the part
 * most likely to be subtly wrong — the half-open interval and the wrap across a
 * loop boundary — testable without an AudioContext.
 */

export type LoopEvent = {
  /** Beats from the start of the loop, `0 <= startBeat < loopBeats`. */
  startBeat: number;
};

/**
 * Visits every occurrence of `events` whose absolute beat falls in
 * `(fromBeat, toBeat]`.
 *
 * The interval is **half-open at the start** on purpose. Scheduling advances by
 * setting `from` to the previous `to`, so an inclusive start would re-schedule
 * every event that landed exactly on a slice boundary — a doubled note on
 * whichever beats the tick happened to align with.
 *
 * Occurrences are walked per loop cycle rather than by taking a modulo per
 * event, so an arbitrary transport position maps onto the pattern regardless of
 * how many cycles have already gone by, and `absoluteBeat` is exact.
 */
export function forEachLoopEvent<T extends LoopEvent>(
  events: readonly T[],
  loopBeats: number,
  fromBeat: number,
  toBeat: number,
  visit: (event: T, absoluteBeat: number) => void
): void {
  if (loopBeats <= 0 || toBeat <= fromBeat) return;

  const firstCycle = Math.floor(fromBeat / loopBeats);
  const lastCycle = Math.floor(toBeat / loopBeats);

  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    const cycleStart = cycle * loopBeats;
    for (const event of events) {
      const absoluteBeat = cycleStart + event.startBeat;
      if (absoluteBeat <= fromBeat || absoluteBeat > toBeat) continue;
      visit(event, absoluteBeat);
    }
  }
}
