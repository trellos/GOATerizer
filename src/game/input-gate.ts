/**
 * Choosing the level below which the recognizer should treat input as silence.
 *
 * Tuninator gates on amplitude before it looks for a pitch, and its gate is
 * `min(rmsGate, noiseFloor * 200)` — a *cap*, not a floor. On a very quiet,
 * very clean input the measured-noise term wins and the gate drops on its own.
 * On any rig whose noise floor is above about 4e-5 the cap binds, and the gate
 * is the flat default of 0.008 RMS — roughly −42 dBFS — no matter what the
 * player's signal actually looks like.
 *
 * That default assumes a hotter input than a lot of people run. A guitarist
 * feeding an amp sim keeps the interface conservative on purpose, because the
 * sim wants headroom and clips if it does not get it; the sim itself is happy
 * with the quiet signal, because it only amplifies and has no gate to fail.
 * Tuninator then hears a note that never crosses 0.008 and reports nothing,
 * which is indistinguishable from a broken detector — and the only fix
 * available to the player is to turn the interface up until their amp sim
 * blows out. That is the bug this exists to remove.
 *
 * **Why the gate and not a gain stage.** Adding gain in software after the
 * converter raises the noise with the signal, so it moves nothing that is
 * measured as a ratio, and the one gate it *would* move is the absolute cap —
 * which is the thing we can simply set correctly instead. Gain before the
 * converter is the only gain that buys signal-to-noise, and that knob is on the
 * player's desk, not in this program.
 *
 * Pure: it takes frame levels and returns a number. No audio, no DOM, no
 * recognizer, so "a quiet rig ends up with a gate under its own noise floor"
 * is a unit test rather than something you need an interface to find out.
 */

/**
 * Tuninator's own default, and the ceiling for anything measured here.
 *
 * Mirrors `rmsGate` in the library's engine config. A measurement is only ever
 * used to move the gate *down*: if a rig is loud enough that the default is
 * already below its noise, the default is the safer number and nothing here
 * improves on it.
 */
export const TUNINATOR_DEFAULT_RMS_GATE = 0.008;

/**
 * How far above the measured noise floor the gate sits.
 *
 * Tuninator's own adaptive term uses 200x, which is a wide margin chosen to be
 * safe on a room mic where "noise" includes a chair creaking. This is used only
 * when a *player* has deliberately measured their own rig, quiet, on a direct
 * input — so it can be far tighter. Eight times the floor is about 18 dB of
 * separation: comfortably above anything that is not a note, comfortably below
 * a real one, on every rig this has been reasoned about.
 */
export const GATE_NOISE_MULTIPLE = 8;

/**
 * The lowest gate that will ever be written.
 *
 * A gate at zero is not a calibration, it is a detector with no gate at all,
 * and it would spend the whole run finding pitches in hum. This is a hundredth
 * of Tuninator's default: low enough for any real interface, high enough that a
 * corrupt measurement cannot switch gating off altogether.
 */
export const MIN_RMS_GATE = 0.00008;

/** Frames needed before a measurement is worth acting on. */
export const MIN_FLOOR_FRAMES = 40;
export const MIN_PLAYING_FRAMES = 12;

/**
 * How much louder than the noise floor a frame has to be to count as playing.
 *
 * Deliberately far below {@link GATE_NOISE_MULTIPLE}: the whole point is to
 * observe notes the current gate is *rejecting*, so the definition of "playing"
 * cannot be the gate we are trying to replace.
 *
 * Twice, and not more, because of who this has to work for. A rig with poor
 * separation — the one player who genuinely does need to turn their interface
 * up — has notes only two or three times its own noise. At a stricter threshold
 * none of their frames count as playing at all, so the measurement reports "I
 * have not heard you play yet" and asks them to do the one thing they have
 * already done. Counting those frames is what lets them be told the truth
 * instead.
 */
const PLAYING_MULTIPLE = 2;

export type InputGateState = {
  /** Quietest sustained level seen — the rig's own noise. Null until measured. */
  noiseFloor: number | null;
  /** Typical level while the player was actually playing. Null until measured. */
  playingLevel: number | null;
  floorFrames: number;
  playingFrames: number;
  /** The gate this measurement recommends, or null when it cannot recommend one. */
  recommended: number | null;
  /** Whether the recommendation is worth offering: it has to be an improvement. */
  worthApplying: boolean;
  /** Signal-to-noise as a plain ratio, for the player-facing readout. */
  headroom: number | null;
};

/** The `p`-quantile of `values`. Copies rather than sorting the caller's array. */
function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? null;
}

/**
 * Watches frame levels and works out where the gate should sit.
 *
 * Fed from Tuninator's `pitchFrame` diagnostics, which carry `rms` on *every*
 * frame — including the ones the engine gated. That is what makes the
 * measurement possible at all: a player whose notes are all being rejected is
 * exactly the player who needs this, and their frames still report a level.
 */
export class InputGateMeasurement {
  #levels: number[] = [];

  /** One frame's RMS. Order does not matter; quantiles are taken at the end. */
  observe(rms: number): void {
    if (!Number.isFinite(rms) || rms < 0) return;
    this.#levels.push(rms);
  }

  reset(): void {
    this.#levels = [];
  }

  get frames(): number {
    return this.#levels.length;
  }

  get state(): InputGateState {
    // The noise floor is a low quantile rather than the minimum: a single
    // anomalously quiet frame between notes is not the rig's noise, and a
    // minimum would let one of them drag the gate down to nothing.
    const noiseFloor = quantile(this.#levels, 0.1);
    if (noiseFloor === null || this.#levels.length < MIN_FLOOR_FRAMES) {
      return {
        noiseFloor,
        playingLevel: null,
        floorFrames: this.#levels.length,
        playingFrames: 0,
        recommended: null,
        worthApplying: false,
        headroom: null,
      };
    }

    const playing = this.#levels.filter((level) => level > noiseFloor * PLAYING_MULTIPLE);
    // The median of the playing frames, not the peak: a gate set from the
    // loudest thing the player did would reject everything quieter, and the
    // note that matters is the ordinary one, not the hardest strum.
    const playingLevel = playing.length >= MIN_PLAYING_FRAMES ? quantile(playing, 0.5) : null;
    // Guarded against a floor of exactly zero, which is not hypothetical: a
    // synthetic source is digitally silent between notes, and dividing by it
    // put `Infinityx` in front of the player.
    const headroom =
      playingLevel === null || noiseFloor <= 0 ? null : playingLevel / noiseFloor;

    // Below this there is no gate that is both under the player's notes and
    // above the floor this will ever write. That is not a rig to calibrate for,
    // it is a rig with no usable signal — so recommend nothing and let the
    // verdict say so, rather than pick one of two wrong answers.
    const measurable = playingLevel !== null && playingLevel > MIN_RMS_GATE * 2;
    const recommended =
      playingLevel === null || !measurable
        ? null
        : Math.min(
            // Never above Tuninator's own default: this only ever helps a quiet
            // rig, it never makes a loud one deafer.
            TUNINATOR_DEFAULT_RMS_GATE,
            // ...and never above half the player's own notes, whatever the
            // noise says. A gate above the notes rejects the notes.
            playingLevel * 0.5,
            Math.max(
              noiseFloor * GATE_NOISE_MULTIPLE,
              // Scaled to the signal when the floor is at or near zero. Without
              // this a digitally silent input drives the noise term to nothing
              // and the gate lands on the absolute minimum — safe, since there
              // is no noise to admit, but unrelated to what the player plays.
              playingLevel / 100,
              MIN_RMS_GATE
            )
          );

    return {
      noiseFloor,
      playingLevel,
      floorFrames: this.#levels.length,
      playingFrames: playing.length,
      recommended,
      // Only worth offering when it actually moves the gate down. A rig that is
      // already loud enough gets told it is fine rather than given a button
      // that changes nothing.
      worthApplying:
        recommended !== null && recommended < TUNINATOR_DEFAULT_RMS_GATE * 0.9,
      headroom,
    };
  }
}

/**
 * What to tell the player, from a measurement.
 *
 * The wording is deliberately about *their rig* rather than about the game's
 * internals: nobody tuning a guitar wants to be told about an RMS gate.
 */
export function inputGateVerdict(state: InputGateState): string {
  if (state.floorFrames < MIN_FLOOR_FRAMES) return "Listening…";
  if (state.playingLevel === null) return "Play a few notes at your normal strength.";
  if (state.headroom !== null && state.headroom < 4) {
    return "Your guitar is barely above the background noise. Turn the interface up a little.";
  }
  if (state.recommended === null) {
    return "That signal is too quiet to work with at all. Turn the interface up.";
  }
  if (!state.worthApplying) {
    return "Your level is fine — the detector is already listening below it.";
  }
  return "Your signal is well clear of the noise but quieter than the detector expects. Applying this lets it hear you without touching your interface.";
}
