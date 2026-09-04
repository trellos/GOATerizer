/**
 * The minigame editor screen: the timeline, and everything around it.
 *
 * Dev-only, reached from the start screen with `?dev=1` and addressable
 * directly as `?dev=1&editor=1`. It edits the files under `docs/scenarios/`
 * through the dev server (`api-client.ts`), which is why it has to be run
 * locally: the point of the tool is a diff you commit.
 *
 * It owns no gameplay. Preview hands the edited scenario to the real game
 * through {@link EditorHost}, so what an author previews is the game running
 * their file rather than a second implementation of it that could disagree.
 */

import { TEMPOS, tempoById, type TempoId } from "../config/tempos.js";
import { PHRASE_MEASURES } from "../config/tuning.js";
import type { AutoplayMode } from "../dev/auto-performance.js";
import type { NoteDuration } from "../minigame/api.js";
import { loadScenario } from "../scenario/load.js";
import {
  SCENARIO_SOURCES,
  assetDirectoryOf,
  assetScenarioIdOf,
  assetUrlResolver,
  installAuthoredScenario,
  uninstallAuthoredScenario,
} from "../scenario/registry.js";
import type { ScenarioDefinition } from "../scenario/types.js";
import { deleteScenarioFile, saveScenarioFile } from "./api-client.js";
import { EditorDocument } from "./document.js";
import {
  DURATION_LABELS,
  EDITABLE_DURATIONS,
  notesOverrunningLoop,
  tileToPhrase,
} from "./grid.js";
import { EditorPlayback, editorKeyFor, type Program } from "./playback.js";
import { TimelineEditorView } from "./timeline-editor.js";

type Json = Record<string, unknown>;

/** What the editor needs from the app around it. Implemented by `GameApp`. */
export type EditorHost = {
  /** Plays one attempt of this scenario at this level, autoplayed at `accuracy`. */
  preview(options: {
    scenario: ScenarioDefinition;
    difficulty: number;
    accuracy: AutoplayMode;
    /** The mode to preview in; a pentatonic scenario asks for minor. */
    mode: "major" | "minor";
  }): Promise<void>;
  /** Leave the editor for the start screen. */
  exit(): void;
};

/** The difficulty buttons. One and only one is always selected. */
const LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/** Preview accuracy, in the order the buttons offer it. */
const ACCURACIES: readonly { label: string; mode: AutoplayMode }[] = [
  { label: "0%", mode: "0" },
  { label: "25%", mode: "25" },
  { label: "50%", mode: "50" },
  { label: "75%", mode: "75" },
  { label: "100%", mode: "perfect" },
];

const SESSION_KEY = "goaterizer.editor.at";

/** One rung of the difficulty ladder, measured with the row at rest. */
type LevelSlot = {
  readonly level: number;
  readonly element: HTMLElement;
  readonly left: number;
  readonly centre: number;
};

/** One difficulty being dragged along the ladder. */
type LevelDrag = {
  readonly from: number;
  /** The rung the pointer is nearest, which is where a release would drop it. */
  over: number;
  readonly pointerId: number;
  readonly startX: number;
  readonly slots: readonly LevelSlot[];
};

/**
 * What a reorder did to the levels it stepped over, in the author's terms.
 *
 * The move itself is one sentence — L3 is now L5 — and the useful half is the
 * other end of it: everything between slid one rung the other way.
 */
function describeShift(ladder: readonly number[], from: number, to: number): string {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const stepped = ladder.filter((level) => level !== from && level >= low && level <= high);
  if (stepped.length === 0) return "";
  const towards = from < to ? -1 : 1;
  const moves = stepped.map((level) => {
    const at = ladder.indexOf(level);
    return `L${level}→L${ladder[at + towards]}`;
  });
  return ` — ${moves.join(", ")}`;
}

function must<T extends Element>(id: string, ctor: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof ctor)) throw new Error(`#${id} is missing or is not a ${ctor.name}`);
  return element;
}

/** A scenario id, from a display name a designer typed. */
export function scenarioIdFrom(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z]/.test(id) ? id : `scenario_${id}`;
}

export class EditorScreen {
  readonly #host: EditorHost;
  readonly #playback: EditorPlayback;
  readonly #view: TimelineEditorView;
  /** Every scenario the editor knows, by id: the directory plus this session's. */
  readonly #library = new Map<string, Json>();
  #document: EditorDocument;
  #tempoId: TempoId;
  #accuracy: AutoplayMode = "50";
  #status = "";
  #problems: readonly string[] = [];
  /** Whether what is listed below the timeline would actually refuse a save. */
  #blocked = false;
  #validateTimer: ReturnType<typeof setTimeout> | null = null;
  #active = false;
  /** A difficulty being dragged along the ladder, with the row measured at rest. */
  #levelDrag: LevelDrag | null = null;

  constructor(host: EditorHost, playback: EditorPlayback, tempoId: TempoId) {
    this.#host = host;
    this.#playback = playback;
    this.#tempoId = tempoId;

    for (const source of SCENARIO_SOURCES) {
      this.#library.set(source.id, structuredClone(source.raw) as Json);
    }

    this.#view = new TimelineEditorView(must("editor-canvas", HTMLCanvasElement), {
      onEdit: () => this.#refresh(),
      onAudition: (note) => this.#playback.audition(note, this.#document.vocabulary),
      onStatus: (message) => {
        this.#status = message;
        this.#refresh();
      },
    });

    const opened = this.#restore();
    this.#document = new EditorDocument(this.#library.get(opened.id) as Json, opened.difficulty);
    this.#view.setDocument(this.#document);

    this.#buildPalette();
    this.#buildLevels();
    this.#wire();
    this.#refresh();
  }

  get active(): boolean {
    return this.#active;
  }

  /** Where the editor was when the page last reloaded — a save triggers one. */
  #restore(): { id: string; difficulty: number } {
    const first = SCENARIO_SOURCES[0];
    const fallback = { id: first?.id ?? "", difficulty: 1 };
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (!stored) return fallback;
      const parsed = JSON.parse(stored) as { id?: string; difficulty?: number };
      if (typeof parsed.id !== "string" || !this.#library.has(parsed.id)) return fallback;
      return { id: parsed.id, difficulty: parsed.difficulty ?? 1 };
    } catch {
      return fallback;
    }
  }

  #remember(): void {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ id: this.#document.scenarioId, difficulty: this.#document.difficulty })
      );
    } catch {
      // A browser with storage disabled loses only where the editor was.
    }
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  enter(): void {
    this.#active = true;
    this.#refresh();
  }

  leave(): void {
    this.#active = false;
    this.#playback.pause();
  }

  /** Called every frame while the editor screen is up. */
  frame(): void {
    if (!this.#active) return;
    this.#view.setPlayhead(this.#playback.playheadTick);
    this.#view.render();
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                            */
  /* ---------------------------------------------------------------- */

  #buildPalette(): void {
    const palette = must("editor-palette", HTMLDivElement);
    palette.replaceChildren();
    for (const duration of [...EDITABLE_DURATIONS].reverse()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "palette-chip";
      chip.dataset["duration"] = duration;
      chip.title = `${DURATION_LABELS[duration]} — click to arm, or drag onto the timeline`;
      const bar = document.createElement("span");
      bar.className = "palette-bar";
      bar.dataset["duration"] = duration;
      chip.append(bar, document.createTextNode(DURATION_LABELS[duration]));
      chip.addEventListener("pointerdown", () => {
        this.#view.setActiveDuration(duration);
        this.#view.beginPaletteDrag(duration);
        this.#refresh();
      });
      palette.append(chip);
    }
  }

  #buildLevels(): void {
    const row = must("editor-levels", HTMLDivElement);
    row.replaceChildren();
    for (const level of LEVELS) {
      const slot = document.createElement("div");
      slot.className = "level-slot";
      slot.dataset["level"] = String(level);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = String(level);
      button.addEventListener("click", () => {
        const leaving = this.#document.difficulty;
        const problems = this.#document.selectLevel(level);
        this.#status =
          problems.length > 0
            ? `L${leaving} was left as it is on disk: ${problems[0]}`
            : this.#document.levelAt(level)
              ? ""
              : `L${level} is new — it starts empty, with the scenario data of the level nearest it`;
        this.#view.setDocument(this.#document);
        this.#remember();
        this.#refresh();
      });

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "level-handle";
      handle.tabIndex = -1;
      handle.textContent = "⠿";
      handle.addEventListener("pointerdown", (event) => this.#beginLevelDrag(level, handle, event));
      // A handle is dragged, never pressed: without this a click that did not
      // move would fall through and select the level under it, which is the one
      // thing the row already does everywhere else.
      handle.addEventListener("click", (event) => event.preventDefault());

      slot.append(button, handle);
      row.append(slot);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Reordering the difficulty ladder                                  */
  /* ---------------------------------------------------------------- */

  /** The slots a level may be dragged onto: the ones the scenario authors. */
  #levelSlots(): LevelSlot[] {
    const authored = new Set(this.#document.supportedLevels);
    return [...must("editor-levels", HTMLDivElement).querySelectorAll<HTMLElement>(".level-slot")]
      .filter((element) => authored.has(Number(element.dataset["level"])))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          level: Number(element.dataset["level"]),
          element,
          left: rect.left,
          centre: rect.left + rect.width / 2,
        };
      });
  }

  #beginLevelDrag(level: number, handle: HTMLElement, event: PointerEvent): void {
    if (event.button !== 0) return;
    const slots = this.#levelSlots();
    if (slots.length < 2 || !slots.some((slot) => slot.level === level)) return;
    // Measured before anything moves, so the geometry a drag reasons about is
    // the row at rest however far the pointer has travelled since.
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    this.#levelDrag = {
      from: level,
      over: level,
      pointerId: event.pointerId,
      startX: event.clientX,
      slots,
    };
    this.#paintLevelDrag(0);
  }

  /** The rung nearest the pointer becomes the one a release would drop onto. */
  #dragLevelTo(clientX: number): void {
    const drag = this.#levelDrag;
    if (!drag) return;
    let nearest = drag.over;
    let distance = Infinity;
    for (const slot of drag.slots) {
      const gap = Math.abs(slot.centre - clientX);
      if (gap < distance) {
        distance = gap;
        nearest = slot.level;
      }
    }
    drag.over = nearest;
    this.#paintLevelDrag(clientX - drag.startX);
  }

  /**
   * Shows the rotation the drop would apply, rather than only where the pointer is.
   *
   * The dragged slot follows the pointer; every slot the move steps over is
   * offset to the place it would land, which is measured from the row itself so
   * that a ladder with gaps in it — a scenario authoring 1, 3 and 5 — slides by
   * the distance between its own rungs rather than by an assumed pitch.
   */
  #paintLevelDrag(dx: number): void {
    const drag = this.#levelDrag;
    if (!drag) return;
    const fromIndex = drag.slots.findIndex((slot) => slot.level === drag.from);
    const toIndex = drag.slots.findIndex((slot) => slot.level === drag.over);
    drag.slots.forEach((slot, index) => {
      let lands = index;
      if (index === fromIndex) lands = toIndex;
      else if (fromIndex < index && index <= toIndex) lands = index - 1;
      else if (toIndex <= index && index < fromIndex) lands = index + 1;
      const landing = drag.slots[lands];
      const shift = index === fromIndex ? dx : (landing?.left ?? slot.left) - slot.left;
      slot.element.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
      slot.element.dataset["dragging"] = String(index === fromIndex);
    });
  }

  #endLevelDrag(commit: boolean): void {
    const drag = this.#levelDrag;
    if (!drag) return;
    this.#levelDrag = null;
    for (const slot of drag.slots) {
      slot.element.style.transform = "";
      delete slot.element.dataset["dragging"];
    }
    if (!commit || drag.over === drag.from) return;

    // The rungs the drag was measured against, which is what it just promised.
    const ladder = drag.slots.map((slot) => slot.level);
    const leaving = this.#document.difficulty;
    const problems = this.#document.moveLevel(drag.from, drag.over);
    const moved = `L${drag.from} is now L${drag.over}${describeShift(ladder, drag.from, drag.over)}`;
    this.#status =
      problems.length > 0
        ? `${moved}, but L${leaving} moved as it is on disk: ${problems[0]}`
        : moved;
    this.#view.setDocument(this.#document);
    this.#remember();
    this.#refresh();
  }

  #wire(): void {
    must("editor-family", HTMLSelectElement).addEventListener("change", (event) => {
      const family = (event.target as HTMLSelectElement).value;
      const first = this.#scenariosInFamily(family)[0];
      if (first) this.#openScenario(first.id);
    });

    must("editor-scenario", HTMLSelectElement).addEventListener("change", (event) => {
      this.#openScenario((event.target as HTMLSelectElement).value);
    });

    must("editor-scenario-new", HTMLButtonElement).addEventListener("click", () => this.#newScenario());
    must("editor-scenario-rename", HTMLButtonElement).addEventListener("click", () => this.#rename());
    must("editor-scenario-delete", HTMLButtonElement).addEventListener("click", () => {
      void this.#deleteScenario();
    });

    must("editor-bpm-down", HTMLButtonElement).addEventListener("click", () => this.#stepTempo(-1));
    must("editor-bpm-up", HTMLButtonElement).addEventListener("click", () => this.#stepTempo(1));

    must("editor-play", HTMLButtonElement).addEventListener("click", () => {
      void this.#togglePlay();
    });
    must("editor-save", HTMLButtonElement).addEventListener("click", () => {
      void this.#save();
    });
    must("editor-preview", HTMLButtonElement).addEventListener("click", () => {
      void this.#preview();
    });
    must("editor-accuracy", HTMLSelectElement).addEventListener("change", (event) => {
      this.#accuracy = (event.target as HTMLSelectElement).value as AutoplayMode;
    });
    must("editor-exit", HTMLButtonElement).addEventListener("click", () => {
      this.leave();
      this.#host.exit();
    });

    const premise = must("editor-premise", HTMLTextAreaElement);
    premise.addEventListener("input", () => this.#document.setPremise(premise.value));

    // The handle takes the pointer capture, so the rest of the drag arrives
    // through it and bubbles to here — including the release outside the row,
    // which is the one a listener on the slot would miss.
    window.addEventListener("pointermove", (event) => {
      if (this.#levelDrag?.pointerId === event.pointerId) this.#dragLevelTo(event.clientX);
    });
    window.addEventListener("pointerup", (event) => {
      if (this.#levelDrag?.pointerId === event.pointerId) this.#endLevelDrag(true);
    });
    window.addEventListener("pointercancel", (event) => {
      if (this.#levelDrag?.pointerId === event.pointerId) this.#endLevelDrag(false);
    });

    window.addEventListener("keydown", (event) => {
      if (!this.#active) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (this.#view.handleKey(event)) event.preventDefault();
    });
  }

  /* ---------------------------------------------------------------- */
  /* The library                                                       */
  /* ---------------------------------------------------------------- */

  #families(): string[] {
    const families = new Set<string>();
    for (const raw of this.#library.values()) families.add(String(raw["family"] ?? "—"));
    return [...families].sort();
  }

  #scenariosInFamily(family: string): { id: string; name: string }[] {
    return [...this.#library.entries()]
      .filter(([, raw]) => String(raw["family"] ?? "—") === family)
      .map(([id, raw]) => ({ id, name: String(raw["displayName"] ?? id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Folds the open scenario's edits back into the library before leaving it. */
  #stash(): void {
    const { raw } = this.#document.toScenario();
    if (raw) this.#library.set(this.#document.scenarioId, raw);
  }

  #openScenario(id: string): void {
    const raw = this.#library.get(id);
    if (!raw) return;
    this.#stash();
    const supported = Array.isArray(raw["supportedLevels"]) ? (raw["supportedLevels"] as number[]) : [];
    this.#document = new EditorDocument(raw, supported[0] ?? 1);
    this.#view.setDocument(this.#document);
    this.#status = "";
    this.#remember();
    this.#refresh();
  }

  /**
   * A new scenario, as a copy of the one open.
   *
   * A scenario is much more than its notes — a minigame class, class
   * parameters, an asset binding per slot — and none of that can be invented
   * from a name. Copying means the new scenario is playable from the moment it
   * exists, shares the art of the one it came from (`assetDirectory`), and is
   * edited from something rather than from nothing.
   */
  #newScenario(): void {
    const name = window.prompt(
      `New scenario. It starts as a copy of ${this.#document.raw["displayName"]} — same minigame ` +
        "class, same art, same notes — for you to edit.\n\nName:"
    );
    if (name === null || name.trim() === "") return;

    const id = scenarioIdFrom(name);
    if (this.#library.has(id)) {
      this.#status = `there is already a scenario called ${id}`;
      this.#refresh();
      return;
    }

    this.#stash();
    const source = this.#library.get(this.#document.scenarioId) as Json;
    const clone = structuredClone(source);
    clone["id"] = id;
    clone["displayName"] = name.trim();
    // The art stays where it is, in both senses: the same directory, and the
    // same names inside it. A brand new scenario has neither of its own, and
    // pointing at the source's is the difference between a scenario that runs
    // and one that renders nothing. Point them at real art of its own once
    // there is some — that is two fields, and deleting them is the same thing.
    clone["assetDirectory"] = assetDirectoryOf(source);
    clone["assetScenarioId"] = assetScenarioIdOf(source);
    this.#library.set(id, clone);
    this.#openScenario(id);
    this.#status = `${name.trim()} is a copy of ${source["displayName"]} — edit its notes, then Save`;
    this.#refresh();
  }

  #rename(): void {
    const name = window.prompt(
      "Rename this scenario. Its id and file name do not change.",
      String(this.#document.raw["displayName"] ?? "")
    );
    if (name === null || name.trim() === "") return;
    this.#stash();
    const raw = this.#library.get(this.#document.scenarioId) as Json;
    raw["displayName"] = name.trim();
    this.#openScenario(this.#document.scenarioId);
  }

  async #deleteScenario(): Promise<void> {
    const id = this.#document.scenarioId;
    if (this.#library.size <= 1) {
      this.#status = "that is the only scenario there is";
      this.#refresh();
      return;
    }
    if (!window.confirm(`Delete ${this.#document.raw["displayName"]} and its file from disk?`)) return;

    const result = await deleteScenarioFile(id);
    if (!result.ok) {
      this.#status = `not deleted: ${result.error}`;
      this.#refresh();
      return;
    }
    this.#library.delete(id);
    uninstallAuthoredScenario(id);
    const next = [...this.#library.keys()][0] as string;
    this.#openScenario(next);
    this.#status = `deleted ${id}`;
    this.#refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Transport, saving, preview                                        */
  /* ---------------------------------------------------------------- */

  #stepTempo(direction: number): void {
    const at = TEMPOS.findIndex((tempo) => tempo.id === this.#tempoId);
    const next = TEMPOS[Math.min(TEMPOS.length - 1, Math.max(0, at + direction))];
    if (!next) return;
    this.#tempoId = next.id;
    this.#playback.setBpm(next.bpm);
    this.#refresh();
  }

  /**
   * What the loop should be playing right now.
   *
   * Read fresh every time rather than captured when Play was pressed: the whole
   * point of hearing it is to hear the edit.
   */
  #program(): Program {
    return {
      notes: tileToPhrase(this.#document.notes, this.#document.loopMeasures),
      vocabulary: this.#document.vocabulary,
      difficulty: this.#document.difficulty,
    };
  }

  async #togglePlay(): Promise<void> {
    if (this.#playback.playing) {
      this.#playback.pause();
      this.#refresh();
      return;
    }
    const started = await this.#playback.play({
      ...this.#program(),
      bpm: tempoById(this.#tempoId).bpm,
    });
    if (!started) this.#status = "the browser would not start audio";
    this.#refresh();
  }

  /**
   * The edited scenario as the game would load it, or null with the reasons.
   *
   * This is the one validation that matters: `loadScenario` is what the game
   * runs, and a minigame's own `parseLevel` is where a family's rules live. The
   * editor does not restate any of them.
   */
  #validate(): ScenarioDefinition | null {
    const { raw, problems } = this.#document.toScenario();
    if (!raw) {
      this.#problems = problems;
      this.#blocked = true;
      return null;
    }
    try {
      const definition = loadScenario(raw, assetUrlResolver(raw));
      this.#problems = this.#document.readProblems;
      this.#blocked = false;
      return definition;
    } catch (error) {
      this.#problems = [error instanceof Error ? error.message : String(error)];
      this.#blocked = true;
      return null;
    }
  }

  async #save(): Promise<void> {
    const definition = this.#validate();
    if (!definition) {
      this.#status = "not saved — see below";
      this.#refresh();
      return;
    }
    const { raw } = this.#document.toScenario();
    const result = await saveScenarioFile(this.#document.scenarioId, raw);
    if (!result.ok) {
      this.#status = `not saved: ${result.error}`;
    } else {
      this.#library.set(this.#document.scenarioId, raw as Json);
      installAuthoredScenario(definition);
      this.#document.markSaved();
      this.#remember();
      this.#status = `saved ${result.path}`;
    }
    this.#refresh();
  }

  async #preview(): Promise<void> {
    const definition = this.#validate();
    if (!definition) {
      this.#status = "cannot preview — see below";
      this.#refresh();
      return;
    }
    if (!definition.levels.has(this.#document.difficulty)) {
      this.#status = `this scenario has no L${this.#document.difficulty} to preview`;
      this.#refresh();
      return;
    }
    this.#playback.pause();
    // Preview plays the *edited* scenario, saved or not, which means the run
    // shell has to be able to find it: it picks scenarios out of the library.
    installAuthoredScenario(definition);
    this.leave();
    await this.#host.preview({
      scenario: definition,
      difficulty: this.#document.difficulty,
      accuracy: this.#accuracy,
      mode: editorKeyFor(this.#document.vocabulary).mode,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Painting the controls                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Re-validates shortly after an edit settles.
   *
   * `loadScenario` over the whole scenario is cheap but not free, and an edit
   * arrives on every pointer move while a marquee is open. The delay is short
   * enough that the problem list still reads as live.
   */
  #scheduleValidate(): void {
    if (this.#validateTimer !== null) clearTimeout(this.#validateTimer);
    this.#validateTimer = setTimeout(() => {
      this.#validateTimer = null;
      this.#validate();
      this.#paint();
    }, 200);
  }

  #refresh(): void {
    this.#scheduleValidate();
    this.#paint();
  }

  #paint(): void {
    const document_ = this.#document;
    // Every edit, level switch, scenario switch and loop change comes through
    // here, so this is the one place the running loop has to be told. It costs
    // nothing when the notes did not actually change (`programSignature`).
    if (this.#playback.playing) this.#playback.setProgram(this.#program());
    const raw = document_.raw;

    const family = must("editor-family", HTMLSelectElement);
    const currentFamily = String(raw["family"] ?? "—");
    family.replaceChildren(
      ...this.#families().map((name) => new Option(name, name, false, name === currentFamily))
    );

    const scenario = must("editor-scenario", HTMLSelectElement);
    scenario.replaceChildren(
      ...this.#scenariosInFamily(currentFamily).map((entry) =>
        new Option(entry.name, entry.id, false, entry.id === document_.scenarioId)
      )
    );

    const supported = new Set(document_.supportedLevels);
    for (const slot of must("editor-levels", HTMLDivElement).querySelectorAll<HTMLElement>(
      ".level-slot"
    )) {
      const level = Number(slot.dataset["level"]);
      const authored = supported.has(level);
      const button = slot.querySelector("button.chip") as HTMLButtonElement;
      button.dataset["selected"] = String(level === document_.difficulty);
      button.dataset["authored"] = String(authored);
      button.title = authored
        ? `Level ${level}`
        : `Level ${level} — not authored yet; selecting it starts one`;
      // Nothing to move, and nowhere to move it: a level the scenario does not
      // author is not a rung, and a ladder of one has no order to change.
      const handle = slot.querySelector("button.level-handle") as HTMLButtonElement;
      handle.hidden = !authored || supported.size < 2;
      handle.title = `Drag to move L${level} along the difficulty ladder`;
    }

    for (const chip of must("editor-palette", HTMLDivElement).querySelectorAll("button")) {
      chip.dataset["selected"] = String(chip.dataset["duration"] === this.#view.activeDuration);
    }

    const premise = must("editor-premise", HTMLTextAreaElement);
    if (premise.value !== document_.premise) premise.value = document_.premise;

    must("editor-bpm", HTMLElement).textContent = `${tempoById(this.#tempoId).bpm}`;
    must("editor-tempo-name", HTMLElement).textContent = tempoById(this.#tempoId).name;
    must("editor-play", HTMLButtonElement).textContent = this.#playback.playing ? "Pause" : "Play";
    must("editor-accuracy", HTMLSelectElement).replaceChildren(
      ...ACCURACIES.map((entry) =>
        new Option(entry.label, entry.mode, false, entry.mode === this.#accuracy)
      )
    );

    must("editor-class", HTMLElement).textContent = `${document_.minigameId} · ${
      document_.notes.length
    } notes · ${document_.loopMeasures === PHRASE_MEASURES ? "4 bars" : `${document_.loopMeasures}-bar loop`}`;

    const overrunning = notesOverrunningLoop(document_.notes, document_.loopMeasures);
    // Said only once the level has actually left the ladder, which is also when
    // its button dims. A scenario's *last* level cannot leave, so emptying that
    // one is refused instead and says so through `#problems` — this would only
    // be a second, vaguer way of putting it.
    const offTheLadder =
      document_.liveNotes().length === 0 && !supported.has(document_.difficulty);
    const warnings = [
      ...document_.readProblems,
      ...this.#problems,
      // The family's own reading of the open level. Non-blocking by design —
      // see `EditorDocument.notices` — and prefixed so it is legible as coming
      // from the minigame rather than from the editor's own spelling rules.
      ...document_.notices.map((notice) => `L${document_.difficulty}: ${notice}`),
      ...(offTheLadder
        ? [
            `L${document_.difficulty} has no notes${document_.notes.length > 0 ? " inside the loop" : ""}` +
              " — a difficulty with no note opportunities cannot be judged, so it is not one of " +
              "this scenario's levels. Add notes to put it on the ladder",
          ]
        : []),
      ...(overrunning.length > 0
        ? [
            `${overrunning.length} note(s) run past the end of the loop and will not be saved — ` +
              "shorten them or widen the loop",
          ]
        : []),
    ];
    const problems = must("editor-problems", HTMLUListElement);
    problems.replaceChildren(
      ...warnings.map((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
      })
    );
    // Not everything worth saying below the timeline stops a save. A level that
    // has left the ladder and notes the loop does not reach are statements about
    // the file the editor *would* write, and reading them in the same red as a
    // refusal is the tool crying wolf.
    problems.dataset["blocking"] = String(this.#blocked);
    problems.hidden = warnings.length === 0;

    must("editor-status", HTMLElement).textContent = this.#status;
  }
}
