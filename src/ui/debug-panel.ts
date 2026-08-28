/**
 * The developer panel.
 *
 * Hidden unless dev mode is explicitly on (`?dev=1`). It is the only place the
 * deterministic test input provider can be selected, which is the whole reason
 * it is gated: scoring injected input while presenting as a guitar game would
 * be a lie, so the switch lives behind the flag and the UI says loudly which
 * source is driving the game.
 */

import { AUTOPLAY_MODES, type AutoplayMode } from "../dev/auto-performance.js";

export type DebugSnapshot = Record<string, string>;

export type DebugHandlers = {
  onSourceChange: (source: "tuninator" | "synth" | "test") => void;
  onLatencyChange: (milliseconds: number) => void;
  onAutoplay: (mode: AutoplayMode) => void;
};

export class DebugPanel {
  readonly #root: HTMLElement;
  readonly #readouts: HTMLElement;
  readonly #rows = new Map<string, HTMLElement>();
  #enabled = false;

  constructor(root: HTMLElement, handlers: DebugHandlers) {
    this.#root = root;
    const readouts = root.querySelector("#dev-readouts");
    if (!(readouts instanceof HTMLElement)) throw new Error("#dev-readouts missing");
    this.#readouts = readouts;

    const source = root.querySelector("#dev-source");
    if (source instanceof HTMLSelectElement) {
      source.addEventListener("change", () => {
        const value = source.value;
        handlers.onSourceChange(value === "test" || value === "synth" ? value : "tuninator");
      });
    }

    const latency = root.querySelector("#dev-latency");
    if (latency instanceof HTMLInputElement) {
      latency.addEventListener("change", () => {
        handlers.onLatencyChange(Number(latency.value) || 0);
      });
    }

    // Ids are derived from the mode ids, so the buttons, the `?autoplay=` value
    // and the mode itself cannot drift apart.
    for (const mode of AUTOPLAY_MODES) {
      root
        .querySelector(`#dev-autoplay-${mode}`)
        ?.addEventListener("click", () => handlers.onAutoplay(mode));
    }

    root.querySelector("#dev-close")?.addEventListener("click", () => this.setEnabled(false));
  }

  /** Marks the active tier, so the panel says which one is running. */
  setAutoplayMode(mode: AutoplayMode): void {
    for (const other of AUTOPLAY_MODES) {
      const button = this.#root.querySelector(`#dev-autoplay-${other}`);
      if (button instanceof HTMLElement) button.dataset["selected"] = String(other === mode);
    }
  }

  /**
   * Points the source select at what is actually driving the game.
   *
   * Autoplay can switch the source by itself, and a select still reading
   * "Tuninator (live guitar)" while a synthetic sine drives the game is the
   * same honesty problem as the banner (`AGENTS.md` §13), in miniature.
   * Assigning `.value` does not fire `change`, so this cannot loop.
   */
  setSourceValue(kind: "tuninator" | "synth" | "test"): void {
    const select = this.#root.querySelector("#dev-source");
    if (select instanceof HTMLSelectElement) select.value = kind;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#root.hidden = !enabled;
  }

  /** Called every frame while enabled. Rows are created once and then reused. */
  update(snapshot: DebugSnapshot): void {
    if (!this.#enabled) return;
    for (const [label, value] of Object.entries(snapshot)) {
      let row = this.#rows.get(label);
      if (!row) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        this.#readouts.append(dt, dd);
        row = dd;
        this.#rows.set(label, dd);
      }
      if (row.textContent !== value) row.textContent = value;
    }
  }
}
