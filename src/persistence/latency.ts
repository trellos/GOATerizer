/**
 * The player's latency calibration, in `localStorage`.
 *
 * Two numbers make up the compensation the judge applies. The browser reports
 * one of them (`AudioContext.baseLatency + outputLatency`) and it is measured
 * fresh every session, so it is never stored. The other is this: the residual
 * the browser did not know about — a USB interface's own buffering, Bluetooth
 * headphones, an amp in the chain — which the player measures by playing along
 * to the beat in pregame.
 *
 * That is a property of their rig, not of a run, so it is remembered. Nothing
 * else about them is.
 */

const STORAGE_KEY = "goaterizer.latencyTrimMs.v1";

/**
 * The widest trim that can be a real measurement rather than a mistake.
 *
 * Half a second is already an extreme rig — cheap Bluetooth is 150–300ms. A
 * value past this is a corrupt store or a calibration taken against the wrong
 * beat, and honouring it would put every note in the wrong bar.
 */
export const MAX_LATENCY_TRIM_MS = 500;

/** Never throws: a private-mode browser or corrupt value reads as no trim. */
export function readLatencyTrimMs(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_LATENCY_TRIM_MS) return null;
    return value;
  } catch {
    return null;
  }
}

/** Remembers a calibration. `null` forgets it, so the browser's number stands alone. */
export function writeLatencyTrimMs(milliseconds: number | null): void {
  try {
    if (milliseconds === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(Math.round(milliseconds)));
  } catch {
    // Storage unavailable. The trim still applies for this session.
  }
}
