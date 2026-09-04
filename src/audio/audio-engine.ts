/**
 * The one AudioContext in GOATerizer.
 *
 * It is shared deliberately, and with the recognizer too: `createRecognizer`
 * accepts a caller-owned `audioContext` and never closes one it did not create.
 * Sharing it is what makes `Timebase.originContextTime` directly comparable
 * with the transport's own clock, so a detected guitar attack lands in beat
 * space without a wall-clock estimate anywhere in the chain.
 *
 * Browser audio needs a user gesture. Everything here is created lazily on
 * {@link AudioEngine.unlock}, which is only ever called from a click handler.
 */

import { softClipCurve } from "./soft-clip.js";

export type AudioEngineStatus = "locked" | "running" | "suspended" | "failed";

export class AudioEngine {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #status: AudioEngineStatus = "locked";
  #failure: string | null = null;

  get status(): AudioEngineStatus {
    return this.#status;
  }

  get failure(): string | null {
    return this.#failure;
  }

  get context(): AudioContext | null {
    return this.#context;
  }

  /** Master bus. Scenario audio and the bass both land here. */
  get master(): GainNode | null {
    return this.#master;
  }

  /** Audio-clock time, in seconds. The transport's time source. */
  now(): number {
    return this.#context?.currentTime ?? 0;
  }

  /**
   * How far ahead of what the player *hears* the audio clock runs, in seconds.
   *
   * The player responds to sound leaving the speakers, so a note they play in
   * perfect time is captured this much late. It is the measured half of the
   * judgment's latency compensation; the rest is the manual trim in
   * `src/config/tuning.ts`.
   */
  get outputLatencySeconds(): number {
    const context = this.#context;
    if (!context) return 0;
    const output = typeof context.outputLatency === "number" ? context.outputLatency : 0;
    return output + context.baseLatency;
  }

  /** Must be called from a user gesture. Idempotent. */
  async unlock(): Promise<boolean> {
    try {
      if (!this.#context) {
        const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error("Web Audio is not available in this browser");
        this.#context = new Ctor({ latencyHint: "interactive" });
        this.#master = this.#context.createGain();
        this.#master.gain.value = 0.9;

        // A soft clipper between the mix and the speakers.
        //
        // Everything upstream — the bass, seven drum rungs, the guitar coming
        // back through the room — is summed with no protection, and the loudest
        // rungs stack a crash, a ride and a kick on the same beat. Without this
        // the only way to stay under the ceiling is to keep every part quiet
        // enough that nothing is heard on a laptop, which is exactly the
        // complaint the backing drew: "a faint bass line", drums "not obvious".
        //
        // A `DynamicsCompressorNode` was tried first and is the wrong tool: it
        // is a level detector with an attack, so the transients that actually
        // clip here — a kick click, a crash — are through it before it responds.
        // A waveshaper is sample-accurate by construction. The curve is linear
        // through the region ordinary playing occupies and bends smoothly above
        // it, so it does nothing at all until something would have clipped, and
        // then rounds the peak instead of squaring it off. The harmonics that
        // adds on a peak are the same ones that make a limiter sound "punchy",
        // which is a fair description of what the backing was missing.
        //
        // The curve is `softClipCurve`, which is shared with the drum bus and
        // documents its own shape and the trap it avoids. The knee is high here
        // because this one is *protection* — nothing below 0.7 is touched at all
        // — where the drum bus deliberately drives into a lower one.
        const clipper = this.#context.createWaveShaper();
        clipper.curve = softClipCurve(0.7);
        clipper.oversample = "2x";

        this.#master.connect(clipper);
        clipper.connect(this.#context.destination);
      }
      if (this.#context.state === "suspended") await this.#context.resume();
      this.#status = this.#context.state === "running" ? "running" : "suspended";
      this.#failure = null;
      return this.#status === "running";
    } catch (error) {
      this.#status = "failed";
      this.#failure = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** Releases the context. Only the app teardown path calls this. */
  async dispose(): Promise<void> {
    const context = this.#context;
    this.#context = null;
    this.#master = null;
    this.#status = "locked";
    if (context && context.state !== "closed") await context.close();
  }
}
