/**
 * The player's input-level calibration, in `localStorage`.
 *
 * A property of their rig — which interface, at what gain, into what — not of a
 * run, so it is remembered the same way the latency trim is. Nothing else about
 * them is stored.
 *
 * See `game/input-gate.ts` for why this exists at all: Tuninator's amplitude
 * gate defaults to a level that assumes a hotter input than a guitarist feeding
 * an amp sim runs, and the only fix otherwise available to the player is to
 * turn their interface up until the sim clips.
 */

import { MIN_RMS_GATE, TUNINATOR_DEFAULT_RMS_GATE } from "../game/input-gate.js";

const STORAGE_KEY = "goaterizer.inputRmsGate.v1";

/**
 * Never throws: a private-mode browser or a corrupt value reads as "no
 * calibration", which leaves Tuninator's own default in force.
 *
 * A stored value outside the sane band is discarded rather than clamped. Out of
 * range means the store is wrong, not that the player meant the nearest legal
 * number, and honouring it would either deafen the detector or open it to hum.
 */
export function readInputRmsGate(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (value < MIN_RMS_GATE || value > TUNINATOR_DEFAULT_RMS_GATE) return null;
    return value;
  } catch {
    return null;
  }
}

/** Remembers a calibration. `null` forgets it, so Tuninator's default stands. */
export function writeInputRmsGate(gate: number | null): void {
  try {
    if (gate === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(gate));
  } catch {
    // A browser that refuses storage still plays; it just forgets between
    // sessions, which is a smaller failure than refusing to run.
  }
}
