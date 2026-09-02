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
 * How many frames the measurement keeps.
 *
 * Bounded rather than everything-since-the-mic-opened, for two reasons that
 * both showed up the moment this was left running for a whole session.
 *
 * The measurement has to describe the rig *now*. A player who turns their
 * interface up mid-session — the exact thing this feature exists to stop them
 * having to do, and therefore exactly what they will try — must not be averaged
 * against ten minutes of the old level. A window forgets, which is the correct
 * behaviour for a thing that answers "what is coming in".
 *
 * And the state is derived by sorting, once per read, on the render path. With
 * an unbounded buffer that cost grows for as long as the player sits there; a
 * window makes it a constant.
 *
 * Sized from a measured frame rate rather than a guessed one: Tuninator
 * delivered about 20 diagnostic frames a second in a browser check, so this is
 * roughly 25 seconds of audio — long enough to hold a phrase and the gaps
 * between notes that reveal the floor, short enough to follow a knob being
 * turned. An inference from hop size had put the rate four times higher, which
 * would have made this window a minute and a half.
 */
export const MEASUREMENT_WINDOW_FRAMES = 512;

/**
 * Extra evidence demanded before the gate is moved *without being asked*.
 *
 * A player pressing the button has decided; automatic calibration has to decide
 * for them, so it is deliberately stricter than what it would let them choose
 * by hand — four times the playing frames, and separation comfortably past the
 * point where the verdict would have warned them about their noise.
 */
export const AUTO_APPLY_MIN_PLAYING_FRAMES = MIN_PLAYING_FRAMES * 4;
export const AUTO_APPLY_MIN_HEADROOM = 8;

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

/** The `p`-quantile of an already-sorted slice `[from, to)`. */
function quantileOfSorted(sorted: readonly number[], from: number, to: number, p: number): number | null {
  const count = to - from;
  if (count <= 0) return null;
  const offset = Math.min(count - 1, Math.max(0, Math.round((count - 1) * p)));
  return sorted[from + offset] ?? null;
}

/**
 * The first index of `sorted` holding a value strictly above `threshold`.
 *
 * The playing frames are every frame above a multiple of the noise floor, and
 * in a sorted array that set is a suffix — so it is found by bisection instead
 * of by filtering into a second array and sorting that too.
 */
function firstAbove(sorted: readonly number[], threshold: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! > threshold) high = mid;
    else low = mid + 1;
  }
  return low;
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
  /** Ring buffer, unsorted, at most {@link MEASUREMENT_WINDOW_FRAMES} long. */
  #window: number[] = [];
  #next = 0;
  /** Frames ever seen, which the window itself cannot report once it is full. */
  #observed = 0;
  /**
   * The last derived state, dropped on every new frame.
   *
   * `state` is read several times per rendered frame — the readout wants it,
   * and the dev panel wants it again for two more rows — and each read sorts
   * the window. Memoising means the sort happens once per *audio* frame at
   * worst rather than once per reader.
   */
  #cache: InputGateState | null = null;

  /** One frame's RMS. Order does not matter; quantiles are taken at the end. */
  observe(rms: number): void {
    if (!Number.isFinite(rms) || rms < 0) return;
    if (this.#window.length < MEASUREMENT_WINDOW_FRAMES) this.#window.push(rms);
    else this.#window[this.#next] = rms;
    this.#next = (this.#next + 1) % MEASUREMENT_WINDOW_FRAMES;
    this.#observed += 1;
    this.#cache = null;
  }

  reset(): void {
    this.#window = [];
    this.#next = 0;
    this.#observed = 0;
    this.#cache = null;
  }

  /** Frames ever observed, across window turnovers. */
  get frames(): number {
    return this.#observed;
  }

  get state(): InputGateState {
    return (this.#cache ??= this.#derive());
  }

  #derive(): InputGateState {
    const sorted = [...this.#window].sort((a, b) => a - b);
    // The noise floor is a low quantile rather than the minimum: a single
    // anomalously quiet frame between notes is not the rig's noise, and a
    // minimum would let one of them drag the gate down to nothing.
    const noiseFloor = quantileOfSorted(sorted, 0, sorted.length, 0.1);
    if (noiseFloor === null || sorted.length < MIN_FLOOR_FRAMES) {
      return {
        noiseFloor,
        playingLevel: null,
        floorFrames: sorted.length,
        playingFrames: 0,
        recommended: null,
        worthApplying: false,
        headroom: null,
      };
    }

    const playingFrom = firstAbove(sorted, noiseFloor * PLAYING_MULTIPLE);
    const playingFrames = sorted.length - playingFrom;
    // The median of the playing frames, not the peak: a gate set from the
    // loudest thing the player did would reject everything quieter, and the
    // note that matters is the ordinary one, not the hardest strum.
    const playingLevel =
      playingFrames >= MIN_PLAYING_FRAMES
        ? quantileOfSorted(sorted, playingFrom, sorted.length, 0.5)
        : null;
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
      floorFrames: sorted.length,
      playingFrames,
      recommended,
      // Only worth offering when it actually moves the gate down. A rig that is
      // already loud enough gets told it is fine rather than given a button
      // that changes nothing.
      worthApplying: gateChangesAnything(recommended, null),
      headroom,
    };
  }
}

/**
 * Whether a recommendation is a real change from the gate actually in force.
 *
 * `inForce` is null when the player has never calibrated, in which case the
 * gate in force is Tuninator's own default. This exists because the two
 * questions are not the same one: `worthApplying` asks whether a measurement
 * beats the *default*, and stays true forever once it does — so after applying
 * a gate, the button that set it would re-enable and offer to set it again.
 */
export function gateChangesAnything(recommended: number | null, inForce: number | null): boolean {
  if (recommended === null) return false;
  return recommended < (inForce ?? TUNINATOR_DEFAULT_RMS_GATE) * 0.9;
}

/**
 * Whether to move the gate on the player's behalf, without being asked.
 *
 * The original request was for the level to *auto* calibrate, so the button is
 * the fallback rather than the mechanism. What makes it safe to do silently is
 * that it only ever moves the gate down, only from a measurement with real
 * separation behind it, and only when it is reversible — the player can put it
 * back, and doing so also ends automatic calibration for the session, so Reset
 * is never immediately undone.
 *
 * A null headroom is the *cleanest* case rather than a missing one: it means
 * the measured noise floor was zero, so there is no noise for a lower gate to
 * let through.
 */
export function shouldAutoApply(state: InputGateState): boolean {
  if (!state.worthApplying || state.recommended === null) return false;
  if (state.playingFrames < AUTO_APPLY_MIN_PLAYING_FRAMES) return false;
  return state.headroom === null || state.headroom >= AUTO_APPLY_MIN_HEADROOM;
}

/**
 * What to tell the player, from a measurement.
 *
 * The wording is deliberately about *their rig* rather than about the game's
 * internals: nobody tuning a guitar wants to be told about an RMS gate.
 */
export function inputGateVerdict(state: InputGateState): string {
  if (state.floorFrames < MIN_FLOOR_FRAMES) return "Listening to your input…";
  if (state.playingLevel === null) {
    return "Listening. Play a few notes at your normal strength and this sets itself.";
  }
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
