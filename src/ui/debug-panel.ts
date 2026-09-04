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
import {
  cellKey,
  MINIGAME_DIFFICULTY_LEVELS,
  MINIGAME_FAMILIES,
  scenariosForFamily,
} from "../dev/minigame-families.js";

export type DebugSnapshot = Record<string, string>;

export type DebugHandlers = {
  onSourceChange: (source: "tuninator" | "synth" | "test") => void;
  onLatencyChange: (milliseconds: number) => void;
  onAutoplay: (mode: AutoplayMode) => void;
  /** A single click on an `o` widget: toggle that cell's availability. */
  onMinigameCellToggle: (scenarioId: string, level: number) => void;
  /** A click on a difficulty-column header. */
  onMinigameDifficultySelect: (level: number) => void;
  /** A double-click on an `o` widget: pin it for the next minigame. */
  onMinigameCellPin: (scenarioId: string, level: number) => void;
  /** The "snap Perfect played bar to its note" checkbox. */
  onSnapPerfectPlayed: (snap: boolean) => void;
};

export class DebugPanel {
  readonly #root: HTMLElement;
  readonly #readouts: HTMLElement;
  readonly #rows = new Map<string, HTMLElement>();
  readonly #minigameCellButtons = new Map<string, HTMLButtonElement>();
  readonly #minigameDifficultyButtons = new Map<number, HTMLButtonElement>();
  #minigamePulsingCell: string | null = null;
  #minigameCurrentCell: string | null = null;
  #enabled = false;

  constructor(root: HTMLElement, handlers: DebugHandlers) {
    this.#root = root;
    const readouts = root.querySelector("#dev-readouts");
    if (!(readouts instanceof HTMLElement)) throw new Error("#dev-readouts missing");
    this.#readouts = readouts;

    const minigameTable = root.querySelector("#dev-minigame-table");
    if (minigameTable instanceof HTMLElement) {
      this.#buildMinigameTable(minigameTable, handlers);
    }

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

    const snap = root.querySelector("#dev-snap-played");
    if (snap instanceof HTMLInputElement) {
      snap.addEventListener("change", () => handlers.onSnapPerfectPlayed(snap.checked));
    }

    root.querySelector("#dev-close")?.addEventListener("click", () => this.setEnabled(false));
  }

  /** Reflects the snap setting, which may have been seeded from the URL. */
  setSnapPerfectPlayed(snap: boolean): void {
    const box = this.#root.querySelector("#dev-snap-played");
    if (box instanceof HTMLInputElement) box.checked = snap;
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

  /**
   * Builds the family x difficulty table once. Structure (which rows and
   * cells exist at all) comes from the scenario library and never changes at
   * runtime; only each cell's disabled/pulsing/current state does, through
   * the setters below.
   *
   * A family with more than one registered scenario (Rocky Ascent and Rocky
   * Ascent High both author "Scale") gets one row per scenario rather than
   * one row per family: two scenarios that both author the same level used
   * to share that level's single cell, so a toggle or a pin there could not
   * say which of them it meant. The family name heads its scenarios as its
   * own full-width row rather than a second label column — the panel is
   * narrow, and a second column of mostly-repeated family names was making
   * the table wider than the panel for no information the heading row does
   * not already give. A family nothing authors yet is just its heading, with
   * no rows under it.
   *
   * One delegated listener pair per event type rather than one per cell:
   * `click` toggles a cell or selects a difficulty column, `dblclick` pins a
   * cell. Both fire for a double-click (`click`, `click`, `dblclick`), so a
   * double-click toggles a cell twice — net no-op — before the pin lands,
   * which is also why a pin is only meaningful on an available cell.
   */
  #buildMinigameTable(container: HTMLElement, handlers: DebugHandlers): void {
    const table = document.createElement("table");
    table.className = "mg-table";

    const headRow = document.createElement("tr");
    headRow.appendChild(document.createElement("th"));
    for (const level of MINIGAME_DIFFICULTY_LEVELS) {
      const th = document.createElement("th");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(level);
      button.dataset["level"] = String(level);
      th.append(button);
      headRow.append(th);
      this.#minigameDifficultyButtons.set(level, button);
    }
    const thead = document.createElement("thead");
    thead.append(headRow);
    table.append(thead);

    const columnCount = 1 + MINIGAME_DIFFICULTY_LEVELS.length;
    const tbody = document.createElement("tbody");
    for (const { family } of MINIGAME_FAMILIES) {
      const familyRow = document.createElement("tr");
      familyRow.className = "mg-family-row";
      const familyLabel = document.createElement("th");
      familyLabel.colSpan = columnCount;
      familyLabel.textContent = family;
      familyRow.append(familyLabel);
      tbody.append(familyRow);

      for (const scenario of scenariosForFamily(family)) {
        const row = document.createElement("tr");
        const variantLabel = document.createElement("th");
        variantLabel.scope = "row";
        variantLabel.textContent = scenario.displayName;
        row.append(variantLabel);

        for (const level of MINIGAME_DIFFICULTY_LEVELS) {
          const cell = document.createElement("td");
          if (scenario.levels.has(level)) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mg-cell";
            button.textContent = "o";
            button.dataset["scenario"] = scenario.id;
            button.dataset["level"] = String(level);
            button.dataset["disabled"] = "false";
            cell.append(button);
            this.#minigameCellButtons.set(cellKey(scenario.id, level), button);
          }
          row.append(cell);
        }
        tbody.append(row);
      }
    }
    table.append(tbody);
    container.replaceChildren(table);

    container.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const level = button.dataset["level"];
      if (level === undefined) return;
      const scenarioId = button.dataset["scenario"];
      if (scenarioId !== undefined) {
        handlers.onMinigameCellToggle(scenarioId, Number(level));
      } else {
        handlers.onMinigameDifficultySelect(Number(level));
      }
    });

    container.addEventListener("dblclick", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const scenarioId = button.dataset["scenario"];
      const level = button.dataset["level"];
      if (scenarioId === undefined || level === undefined) return;
      handlers.onMinigameCellPin(scenarioId, Number(level));
    });
  }

  /** Reflects one cell's availability, toggled from the table or forced by a pin. */
  setMinigameCellDisabled(scenarioId: string, level: number, disabled: boolean): void {
    const button = this.#minigameCellButtons.get(cellKey(scenarioId, level));
    if (button) button.dataset["disabled"] = String(disabled);
  }

  /** Highlights the sticky difficulty selected at the top of the table, or none. */
  setMinigameTargetDifficulty(level: number | null): void {
    for (const [candidate, button] of this.#minigameDifficultyButtons) {
      button.dataset["selected"] = String(candidate === level);
    }
  }

  /**
   * Marks which column the *playing* minigame is actually at — distinct from
   * `setMinigameTargetDifficulty`, which shows what the player forced (if
   * anything). Normal, untouched play still moves this column-to-column as
   * `DIFFICULTY_SEQUENCE` runs, so it is the only one of the two guaranteed to
   * mean something on a run nobody has clicked the table for.
   */
  setMinigameCurrentDifficulty(level: number | null): void {
    for (const [candidate, button] of this.#minigameDifficultyButtons) {
      button.dataset["current"] = String(candidate === level);
    }
  }

  /** Pulses the pinned cell, or clears the pulse once the pin is consumed. */
  setMinigamePendingPin(key: string | null): void {
    if (this.#minigamePulsingCell) {
      this.#minigameCellButtons.get(this.#minigamePulsingCell)?.removeAttribute("data-pulsing");
    }
    this.#minigamePulsingCell = key;
    if (key) this.#minigameCellButtons.get(key)?.setAttribute("data-pulsing", "true");
  }

  /**
   * Marks the exact scenario+level cell actually playing right now, or none.
   * Complements `setMinigameCurrentDifficulty`'s column ring: with more than
   * one scenario able to share a difficulty column (`scenariosForFamily`),
   * the column alone cannot say *which* row is live — this can, because a
   * cell now names exactly one scenario.
   */
  setMinigameCurrentCell(key: string | null): void {
    if (this.#minigameCurrentCell) {
      this.#minigameCellButtons.get(this.#minigameCurrentCell)?.removeAttribute("data-current");
    }
    this.#minigameCurrentCell = key;
    if (key) this.#minigameCellButtons.get(key)?.setAttribute("data-current", "true");
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#root.hidden = !enabled;
  }

  /**
   * Reflects a trim set somewhere else — the pregame calibration, or a value
   * remembered from a previous session — back into the panel's own input, so
   * the two controls cannot disagree about what the compensation currently is.
   */
  setLatencyTrim(milliseconds: number): void {
    const input = this.#root.querySelector("#dev-latency");
    if (input instanceof HTMLInputElement) input.value = String(Math.round(milliseconds));
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
