/**
 * The developer panel.
 *
 * Hidden unless dev mode is explicitly on (`?dev=1`). It is the only place the
 * deterministic test input provider can be selected, which is the whole reason
 * it is gated: scoring injected input while presenting as a guitar game would
 * be a lie, so the switch lives behind the flag and the UI says loudly which
 * source is driving the game.
 */

export type DebugSnapshot = Record<string, string>;

/**
 * How the autoplay driver plays: dead on, late enough for Good, late and
 * dropping notes, or in time on the wrong pitch. `fumbled` exists because
 * wrong-pitch feedback is a mechanic of its own in `RepeatMinigame` — the can
 * lands where you played — and nothing else here can produce a wrong note.
 */
export type AutoplayMode = "perfect" | "good" | "scruffy" | "fumbled" | "off";

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

    for (const [id, mode] of [
      ["dev-autoplay-perfect", "perfect"],
      ["dev-autoplay-good", "good"],
      ["dev-autoplay-scruffy", "scruffy"],
      ["dev-autoplay-fumbled", "fumbled"],
      ["dev-autoplay-off", "off"],
    ] as const) {
      root.querySelector(`#${id}`)?.addEventListener("click", () => handlers.onAutoplay(mode));
    }

    root.querySelector("#dev-close")?.addEventListener("click", () => this.setEnabled(false));
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
