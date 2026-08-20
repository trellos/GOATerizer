/**
 * The game-facing guitar input boundary.
 *
 * Tuninator owns guitar analysis: pitch, onsets, note lifecycles, bends.
 * GOATerizer owns what those mean — scale-degree resolution, target matching,
 * timing judgment, score, stars, scenario consequences. This module is the
 * seam, and it is deliberately narrow: nothing downstream of here knows
 * Tuninator exists, and nothing in the adapter knows what a scale degree is.
 *
 * Two implementations exist, and only one may drive scoring at a time:
 *
 *   - `TuninatorGuitarInputProvider` — the production path, real microphone.
 *   - `TestGuitarInputProvider` — deterministic injection for automated tests
 *     and the dev panel. Never reachable from the normal UI.
 *
 * Event times are **audio-clock seconds** (`AudioContext.currentTime` space),
 * not wall-clock. That is what makes them directly comparable with the
 * transport, and it is only possible because the game hands the recognizer its
 * own AudioContext and reads back `Timebase.originContextTime`.
 */

/** Attack, refinement, sustain and release for one thing the player played. */
export type GuitarInputEvent =
  | {
      type: "attack";
      /** Stable for the lifetime of one played note. */
      id: string;
      /** Nearest equal-tempered note. */
      midi: number;
      frequencyHz: number;
      confidence: number;
      /** Audio-clock seconds at the *onset*, not at delivery. */
      contextTime: number;
    }
  | {
      /**
       * The recognizer changed its mind about a note it already announced.
       *
       * Not a new attack: same `id`, same onset. Judgment re-evaluates an
       * unresolved outcome rather than counting a second played note.
       */
      type: "retune";
      id: string;
      midi: number;
      frequencyHz: number;
      confidence: number;
      contextTime: number;
    }
  | {
      /**
       * Continuous update while a note sounds, including bend excursion.
       *
       * Rocky Ascent does not use this, but discarding it would design bends
       * out of the input model — `AGENTS.md` §4 is explicit that continuous
       * pitch information must survive the boundary.
       */
      type: "sustain";
      id: string;
      midi: number;
      frequencyHz: number;
      /** Signed cents from the note's origin pitch. 0 when not bending. */
      bendCents: number;
      contextTime: number;
    }
  | { type: "release"; id: string; contextTime: number };

export type GuitarInputKind = "tuninator" | "test";

export type GuitarInputState =
  | "idle"
  | "starting"
  | "listening"
  | "stopping"
  | "error"
  | "unsupported";

export type GuitarInputStatus = {
  kind: GuitarInputKind;
  state: GuitarInputState;
  /** Player-facing sentence. Never claims live input that is not live. */
  message: string;
  errorCode?: string;
  /** Latest continuous frame, for the tuner readout and the debug panel. */
  frame?: {
    frequencyHz: number | null;
    confidence: number;
    rms: number;
    /** Per-input-channel level, before mixing. Diagnoses "wrong channel". */
    channelRms?: number[];
    selectedChannel?: number | null;
  };
};

export type Unsubscribe = () => void;

export interface GuitarInputProvider {
  readonly kind: GuitarInputKind;
  /** Must be called from a user gesture on the live path. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Releases the microphone and every subscription. */
  dispose(): Promise<void>;
  getStatus(): GuitarInputStatus;
  onEvent(handler: (event: GuitarInputEvent) => void): Unsubscribe;
  onStatusChange(handler: (status: GuitarInputStatus) => void): Unsubscribe;
}

/** Minimal typed emitter shared by both providers. */
export class Emitter<T> {
  #handlers = new Set<(value: T) => void>();

  on(handler: (value: T) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  emit(value: T): void {
    for (const handler of [...this.#handlers]) handler(value);
  }

  clear(): void {
    this.#handlers.clear();
  }

  get size(): number {
    return this.#handlers.size;
  }
}
