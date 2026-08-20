/**
 * GOATerizer's application shell: screens, wiring, and the one frame loop.
 *
 * Data flows one way. The transport is the clock, the input provider is the
 * guitar, the attempt runtime is the rules, and the views read state and draw
 * it. Views never mutate gameplay; the analyzer never touches a sprite.
 *
 *     AudioEngine ── AudioContext ──┬── Transport ──┬── BassPlayer
 *                                   │               └── DrumPlayer
 *                                   └── TuninatorGuitarInputProvider
 *                                            │ normalised guitar events
 *                                            ▼
 *                                   AttemptRuntime (judge, score, stars, climb)
 *                                            │ judgment + energy
 *                        ┌───────────────────┼───────────────────┐
 *                        ▼                   ▼                   ▼
 *                  TimelineModel        EnergyLayer        ScenarioStripView
 */

import { AudioEngine } from "../audio/audio-engine.js";
import { generateBassLine, type BassLine } from "../audio/bass-line.js";
import { BassPlayer } from "../audio/bass-player.js";
import { DrumPlayer } from "../audio/drum-player.js";
import { Transport } from "../audio/transport.js";
import { pickWeightedKey } from "../config/key-weighting.js";
import { DEFAULT_TEMPO_ID, TEMPOS, tempoById, type TempoId } from "../config/tempos.js";
import {
  ATTEMPT_BEATS,
  EXTRA_INPUT_LATENCY_MS,
  RUN_LEAD_IN_BEATS,
  TRANSITION_BEATS,
} from "../config/tuning.js";
import { AttemptRuntime, type AttemptEvent, type EnergyEvent } from "../game/attempt.js";
import { RunState, type RunSlot } from "../game/run.js";
import type { GuitarInputEvent, GuitarInputProvider, GuitarInputStatus } from "../input/guitar-input.js";
import { TestGuitarInputProvider } from "../input/test-provider.js";
import { TuninatorGuitarInputProvider } from "../input/tuninator-provider.js";
import { fingeringsForKey, type Fingering } from "../music/fingering.js";
import { keyDisplayName, type RunKey } from "../music/keys.js";
import { midiToName } from "../music/pitch.js";
import { readHighScores, recordHighScore } from "../persistence/high-scores.js";
import { ROCKY_ASCENT } from "../scenario/registry.js";
import { AssetStore } from "../ui/assets.js";
import { DebugPanel } from "../ui/debug-panel.js";
import { EnergyLayer } from "../ui/energy-layer.js";
import { ScenarioStripView, type StripPanel } from "../ui/scenario-strip.js";
import { TimelineModel } from "../ui/timeline/timeline-model.js";
import { TimelineView, type TimelineViewMode } from "../ui/timeline/timeline-view.js";

const WORKLET_URL = `${import.meta.env?.BASE_URL ?? "/"}assets/tuninator-worklet.js`;

type Screen = "start" | "pregame" | "game" | "results";

type Setup = {
  key: RunKey;
  tempoId: TempoId;
  viewMode: TimelineViewMode;
  fingeringId: string;
};

type ActiveAttempt = {
  /** Timeline key, so two attempts can share the timeline across a transition. */
  timelineKey: string;
  slotOrdinal: number;
  runtime: AttemptRuntime;
};

function must<T extends Element>(id: string, ctor: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof ctor)) {
    throw new Error(`#${id} is missing or is not a ${ctor.name}`);
  }
  return element;
}

export class GameApp {
  /* Audio and timing ------------------------------------------------- */
  readonly #audio = new AudioEngine();
  readonly #transport = new Transport(() => this.#audio.now());
  #bass: BassPlayer | null = null;
  #drums: DrumPlayer | null = null;
  #bassLine: BassLine | null = null;

  /* Input ------------------------------------------------------------ */
  #provider: GuitarInputProvider | null = null;
  #providerKind: "tuninator" | "test" = "tuninator";
  #unsubscribeInput: (() => void)[] = [];
  #inputStatus: GuitarInputStatus | null = null;
  #latencyTrimMs = EXTRA_INPUT_LATENCY_MS;

  /* Game state ------------------------------------------------------- */
  #screen: Screen = "start";
  #setup: Setup = {
    key: pickWeightedKey(),
    tempoId: DEFAULT_TEMPO_ID,
    viewMode: "key",
    fingeringId: "",
  };
  #fingerings: Fingering[] = [];
  #run: RunState | null = null;
  #current: ActiveAttempt | null = null;
  #next: ActiveAttempt | null = null;
  /**
   * The attempt that just finished. Kept so the outgoing panel still shows its
   * goat at the summit (or frozen at the foothold it reached) while the strip
   * slides — the payoff has to stay readable through the transition.
   */
  #previous: ActiveAttempt | null = null;
  #slideStartBeat: number | null = null;
  #attemptCounter = 0;

  /* Views ------------------------------------------------------------ */
  readonly #assets = new AssetStore();
  readonly #timeline = new TimelineModel(this.#setup.key);
  #pregameView: TimelineView | null = null;
  #gameView: TimelineView | null = null;
  #strip: ScenarioStripView | null = null;
  #energy: EnergyLayer | null = null;
  #debug: DebugPanel | null = null;
  #devMode = false;
  /** Dev-only: forces every slot to one Rocky Ascent level. `?dev=1&level=4`. */
  #devLevel: number | null = null;
  #autoplay: "perfect" | "good" | "scruffy" | "off" = "off";
  #autoplayScheduledFor: string | null = null;

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async start(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    this.#devMode = params.get("dev") === "1";

    this.#pregameView = new TimelineView(must("pregame-canvas", HTMLCanvasElement), this.#setup.key);
    this.#gameView = new TimelineView(must("game-canvas", HTMLCanvasElement), this.#setup.key);
    this.#strip = new ScenarioStripView(must("scenario-canvas", HTMLCanvasElement), this.#assets);
    this.#energy = new EnergyLayer(must("energy-canvas", HTMLCanvasElement));

    await this.#assets.load(ROCKY_ASCENT.assetUrls);
    if (this.#assets.failed.length > 0) {
      console.warn("[goaterizer] assets failed to load:", this.#assets.failed);
    }

    this.#buildStartScreen();
    this.#buildPregameControls();
    this.#buildHistory("hud-history");
    this.#buildHistory("results-history");
    this.#wireButtons();
    this.#setupDebugPanel(params);

    this.#showScreen("start");
    requestAnimationFrame(() => this.#frame());
  }

  /* ------------------------------------------------------------------ */
  /* Screens                                                             */
  /* ------------------------------------------------------------------ */

  #showScreen(screen: Screen): void {
    this.#screen = screen;
    for (const id of ["start", "pregame", "game", "results"] as const) {
      const element = document.getElementById(`screen-${id}`);
      if (element) element.dataset["active"] = String(id === screen);
    }
  }

  #buildStartScreen(): void {
    const list = must("start-high-scores", HTMLUListElement);
    const scores = readHighScores();
    list.replaceChildren();
    for (const tempo of TEMPOS) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${tempo.name} · ${tempo.bpm}`;
      const value = document.createElement("b");
      value.textContent = String(scores[tempo.id] ?? 0);
      item.append(name, value);
      list.append(item);
    }
  }

  #buildHistory(containerId: string): void {
    const container = document.getElementById(containerId);
    const template = document.getElementById("tpl-history-slot");
    if (!(container instanceof HTMLOListElement) || !(template instanceof HTMLTemplateElement)) {
      return;
    }
    container.replaceChildren();
    for (let i = 0; i < 16; i += 1) {
      const node = template.content.cloneNode(true) as DocumentFragment;
      const slot = node.querySelector(".history-slot");
      if (slot instanceof HTMLElement) slot.dataset["ordinal"] = String(i);
      container.append(node);
    }
  }

  #buildPregameControls(): void {
    const tempos = must("pregame-tempos", HTMLDivElement);
    tempos.replaceChildren();
    for (const tempo of TEMPOS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset["tempo"] = tempo.id;
      button.dataset["selected"] = String(tempo.id === this.#setup.tempoId);
      button.textContent = `${tempo.name} ${tempo.bpm}`;
      button.addEventListener("click", () => this.#selectTempo(tempo.id));
      tempos.append(button);
    }
    this.#refreshFingerings();
  }

  #refreshFingerings(): void {
    const container = must("pregame-fingerings", HTMLDivElement);
    this.#fingerings = fingeringsForKey(this.#setup.key);
    if (!this.#fingerings.some((entry) => entry.id === this.#setup.fingeringId)) {
      this.#setup.fingeringId = this.#fingerings[0]?.id ?? "";
    }

    container.replaceChildren();
    for (const fingering of this.#fingerings) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset["fingering"] = fingering.id;
      button.dataset["selected"] = String(fingering.id === this.#setup.fingeringId);
      button.textContent = fingering.label;
      button.addEventListener("click", () => {
        this.#setup.fingeringId = fingering.id;
        for (const other of container.querySelectorAll<HTMLElement>("button")) {
          other.dataset["selected"] = String(other.dataset["fingering"] === fingering.id);
        }
        this.#applyFingering();
      });
      container.append(button);
    }
    this.#applyFingering();
  }

  #applyFingering(): void {
    const fingering =
      this.#fingerings.find((entry) => entry.id === this.#setup.fingeringId) ??
      this.#fingerings[0] ??
      null;
    this.#pregameView?.setFingering(fingering);
    this.#gameView?.setFingering(fingering);
  }

  #wireButtons(): void {
    must("start-play", HTMLButtonElement).addEventListener("click", () => {
      void this.#enterPregame();
    });
    must("pregame-reroll", HTMLButtonElement).addEventListener("click", () => this.#reroll());
    must("pregame-play", HTMLButtonElement).addEventListener("click", () => this.#beginRun());
    must("results-replay", HTMLButtonElement).addEventListener("click", () => this.#beginRun());
    must("results-new", HTMLButtonElement).addEventListener("click", () => {
      this.#reroll();
      this.#showScreen("pregame");
    });

    for (const button of document.querySelectorAll<HTMLElement>("#pregame-views button")) {
      button.addEventListener("click", () => {
        const mode = button.dataset["view"] === "tab" ? "tab" : "key";
        this.#setup.viewMode = mode;
        this.#pregameView?.setMode(mode);
        this.#gameView?.setMode(mode);
        for (const other of document.querySelectorAll<HTMLElement>("#pregame-views button")) {
          other.dataset["selected"] = String(other.dataset["view"] === mode);
        }
      });
    }
  }

  #setupDebugPanel(params: URLSearchParams): void {
    const root = document.getElementById("dev-panel");
    if (!(root instanceof HTMLElement)) return;
    this.#debug = new DebugPanel(root, {
      onSourceChange: (source) => {
        void this.#switchProvider(source);
      },
      onLatencyChange: (ms) => {
        this.#latencyTrimMs = ms;
      },
      onAutoplay: (mode) => {
        this.#autoplay = mode;
        this.#autoplayScheduledFor = null;
        if (mode === "off" && this.#provider instanceof TestGuitarInputProvider) {
          this.#provider.clearSchedule();
        }
      },
    });
    this.#debug.setEnabled(this.#devMode);

    // `?input=test` is dev-only on purpose: it is the only way to make the
    // deterministic provider drive scoring, and it is what the browser
    // validation suite uses in place of a guitar.
    const level = Number(params.get("level"));
    if (this.#devMode && Number.isInteger(level) && level >= 1 && level <= 7) {
      this.#devLevel = level;
    }

    if (this.#devMode && params.get("input") === "test") {
      this.#providerKind = "test";
      const select = root.querySelector("#dev-source");
      if (select instanceof HTMLSelectElement) select.value = "test";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pregame                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * The one user gesture that unlocks everything: audio context, transport,
   * bass, microphone. Nothing before this point touches protected APIs.
   */
  async #enterPregame(): Promise<void> {
    this.#showScreen("pregame");
    const unlocked = await this.#audio.unlock();
    if (!unlocked) {
      this.#setInputStatusText("error", this.#audio.failure ?? "Audio could not start.");
      return;
    }

    if (!this.#transport.running) this.#transport.start(tempoById(this.#setup.tempoId).bpm);

    const context = this.#audio.context;
    const master = this.#audio.master;
    if (context && master && !this.#bass) {
      this.#bass = new BassPlayer(context, this.#transport, master);
    }
    // Guarded separately from the bass so a reload that already built one does
    // not end up with two kits scheduling onto the same bus (AGENTS.md §13).
    if (context && master && !this.#drums) {
      this.#drums = new DrumPlayer(context, this.#transport, master);
    }
    this.#regenerateBass();
    this.#bass?.start();
    this.#drums?.start();

    this.#pregameView?.setShowFingeringLabels(true);
    this.#gameView?.setShowFingeringLabels(false);
    this.#pregameView?.setMode(this.#setup.viewMode);
    this.#gameView?.setMode(this.#setup.viewMode);
    this.#updateKeyReadouts();

    await this.#switchProvider(this.#providerKind);
  }

  /** New key and new bass line. Deliberately does NOT touch the transport. */
  #reroll(): void {
    this.#setup.key = pickWeightedKey();
    this.#timeline.setKey(this.#setup.key);
    this.#pregameView?.setKey(this.#setup.key);
    this.#gameView?.setKey(this.#setup.key);
    this.#refreshFingerings();
    this.#regenerateBass();
    this.#updateKeyReadouts();
  }

  #regenerateBass(): void {
    this.#bassLine = generateBassLine(this.#setup.key);
    this.#timeline.setBassLine(this.#bassLine);
    this.#bass?.setLine(this.#bassLine);
  }

  #selectTempo(tempoId: TempoId): void {
    this.#setup.tempoId = tempoId;
    for (const button of document.querySelectorAll<HTMLElement>("#pregame-tempos button")) {
      button.dataset["selected"] = String(button.dataset["tempo"] === tempoId);
    }
    if (this.#transport.running) {
      // Phase-preserving: the loop keeps its place, only the rate changes.
      this.#transport.setBpm(tempoById(tempoId).bpm);
      this.#bass?.retime();
      this.#drums?.retime();
    }
  }

  #updateKeyReadouts(): void {
    const name = keyDisplayName(this.#setup.key);
    must("pregame-key", HTMLElement).textContent = name;
    must("hud-key", HTMLElement).textContent = name;
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  async #switchProvider(kind: "tuninator" | "test"): Promise<void> {
    if (kind === "test" && !this.#devMode) {
      // Belt and braces: the test provider must never be reachable in normal
      // play, whatever calls this.
      console.warn("[goaterizer] refusing to use test input outside dev mode");
      return;
    }

    for (const off of this.#unsubscribeInput) off();
    this.#unsubscribeInput = [];
    await this.#provider?.dispose();

    const context = this.#audio.context;
    if (kind === "tuninator" && !context) {
      this.#setInputStatusText("error", "Audio is not running yet.");
      return;
    }

    this.#providerKind = kind;
    this.#provider =
      kind === "test"
        ? new TestGuitarInputProvider()
        : new TuninatorGuitarInputProvider({
            audioContext: context as AudioContext,
            workletUrl: WORKLET_URL,
          });

    this.#unsubscribeInput.push(
      this.#provider.onEvent((event) => this.#onGuitarEvent(event)),
      this.#provider.onStatusChange((status) => this.#onInputStatus(status))
    );

    try {
      await this.#provider.start();
    } catch {
      // The provider has already published a status with player-facing copy.
    }
    this.#onInputStatus(this.#provider.getStatus());
  }

  #onInputStatus(status: GuitarInputStatus): void {
    this.#inputStatus = status;
    const state = status.kind === "test" ? "test" : status.state;
    this.#setInputStatusText(state, status.message);

    const warning = document.getElementById("game-input-warning");
    if (warning instanceof HTMLElement) {
      const problem = status.state === "error" || status.kind === "test";
      warning.hidden = !problem;
      warning.textContent =
        status.kind === "test" ? "DEV: deterministic test input — not a guitar" : status.message;
    }
  }

  #setInputStatusText(state: string, message: string): void {
    const element = document.getElementById("pregame-input-state");
    if (!(element instanceof HTMLElement)) return;
    element.dataset["state"] = state;
    element.textContent = message;
  }

  /** Audio-clock seconds -> absolute transport beats, latency-compensated. */
  #toBeat = (contextTime: number): number => {
    const latency = this.#audio.outputLatencySeconds + this.#latencyTrimMs / 1000;
    return this.#transport.beatAt(contextTime - latency);
  };

  #onGuitarEvent(event: GuitarInputEvent): void {
    const beat = this.#toBeat(event.contextTime);
    switch (event.type) {
      case "attack":
        this.#timeline.addPlayed(event.id, event.midi, beat);
        break;
      case "retune":
        this.#timeline.revisePlayed(event.id, event.midi);
        break;
      case "release":
        this.#timeline.endPlayed(event.id, beat);
        break;
      default:
        break;
    }

    // Judgment only ever sees the attempt that is actually being played.
    this.#current?.runtime.handleGuitarEvent(event);
  }

  /* ------------------------------------------------------------------ */
  /* Run                                                                 */
  /* ------------------------------------------------------------------ */

  #beginRun(): void {
    if (!this.#transport.running) return;

    this.#run = new RunState({
      key: this.#setup.key,
      bpm: tempoById(this.#setup.tempoId).bpm,
      // Dev-only. Normal play always uses the design's fixed difficulty curve.
      ...(this.#devLevel !== null
        ? { difficultySequence: Array.from({ length: 16 }, () => this.#devLevel as number) }
        : {}),
    });
    this.#current = null;
    this.#next = null;
    this.#previous = null;
    this.#slideStartBeat = null;
    this.#timeline.clearTargets();
    this.#timeline.clearPlayed();
    this.#energy?.clear();
    this.#pregameView?.setShowFingeringLabels(true);
    this.#gameView?.setShowFingeringLabels(false);

    for (const container of ["hud-history", "results-history"]) {
      for (const slot of document.querySelectorAll<HTMLElement>(`#${container} .history-slot`)) {
        slot.dataset["state"] = "pending";
        const stars = slot.querySelector(".slot-stars");
        if (stars) stars.textContent = "";
      }
    }

    // Start on the next measure boundary plus a lead-in, so the first target
    // arrives in time rather than instantly. The beat never stops.
    const startBeat = this.#transport.nextMeasureBoundary() + RUN_LEAD_IN_BEATS;
    this.#current = this.#createAttempt(this.#run.currentSlot, startBeat);
    this.#queueNextAttempt();
    this.#updateHud();
    this.#showScreen("game");
  }

  #createAttempt(slot: RunSlot | null, startBeat: number): ActiveAttempt | null {
    if (!slot?.scenario) return null;
    const timelineKey = `a${this.#attemptCounter++}`;
    const runtime = new AttemptRuntime({
      scenario: slot.scenario,
      difficulty: slot.difficulty,
      key: this.#setup.key,
      startBeat,
      toBeat: this.#toBeat,
    });
    const attempt: ActiveAttempt = { timelineKey, slotOrdinal: slot.ordinal, runtime };
    runtime.onEvent((event) => this.#onAttemptEvent(attempt, event));
    this.#timeline.addTargets(timelineKey, runtime.targets, startBeat);
    return attempt;
  }

  /** Pre-creates the following attempt so its notes scroll in during the slide. */
  #queueNextAttempt(): void {
    const run = this.#run;
    const current = this.#current;
    if (!run || !current) {
      this.#next = null;
      return;
    }
    this.#next = this.#createAttempt(run.nextSlot, current.runtime.endBeat + TRANSITION_BEATS);
  }

  #onAttemptEvent(attempt: ActiveAttempt, event: AttemptEvent): void {
    switch (event.type) {
      case "judgment": {
        const judgment = event.judgment;
        if (judgment.type === "PerfectNote" || judgment.type === "GoodNote") {
          this.#timeline.markTargetOutcome(
            attempt.timelineKey,
            judgment.target.opportunityIndex,
            judgment.type === "PerfectNote" ? "perfect" : "good"
          );
          this.#timeline.markPlayedOutcome(
            judgment.attackId,
            judgment.type === "PerfectNote" ? "perfect" : "good",
            false
          );
        } else if (judgment.type === "MissedNote") {
          this.#timeline.markTargetOutcome(
            attempt.timelineKey,
            judgment.target.opportunityIndex,
            "miss"
          );
        } else if (judgment.type === "WrongNote") {
          this.#timeline.markPlayedOutcome(judgment.attackId, null, true);
        } else if (judgment.type === "PlayedNoteRevised") {
          this.#timeline.revisePlayed(judgment.attackId, judgment.playedMidi);
        }
        this.#updateHud();
        break;
      }
      case "energy":
        this.#launchEnergy(attempt, event.energy);
        break;
      case "starEarned":
        this.#updateHud();
        break;
      case "complete":
        this.#onAttemptComplete(attempt);
        break;
      default:
        break;
    }
  }

  /**
   * Launches the visual streak, and makes its *arrival* trigger the scenario.
   *
   * The step happening when the streak lands is what makes the causal chain
   * legible: the player sees their note become the goat's next foothold.
   */
  #launchEnergy(attempt: ActiveAttempt, energy: EnergyEvent): void {
    const view = this.#gameView;
    const strip = this.#strip;
    const layer = this.#energy;
    const deliver = () =>
      attempt.runtime.deliverEnergy(
        energy,
        attempt.runtime.toAttemptBeat(this.#transport.running ? this.#transport.beat : 0)
      );

    if (!view || !strip || !layer || this.#screen !== "game") {
      deliver();
      return;
    }

    const nowBeat = this.#transport.beat;
    const from = this.#toOverlay(
      "game-canvas",
      view.pointFor(energy.lane ?? 7, attempt.runtime.startBeat + energy.beat, nowBeat)
    );
    const to = this.#toOverlay("scenario-canvas", strip.currentPanelTarget);
    if (!from || !to) {
      deliver();
      return;
    }

    layer.spawn({
      from,
      to,
      polarity: energy.polarity,
      strong: energy.cause === "perfect",
      bornBeat: nowBeat,
      onArrive: deliver,
    });
  }

  /** Canvas-local point -> the energy overlay's coordinate space. */
  #toOverlay(canvasId: string, point: { x: number; y: number }): { x: number; y: number } | null {
    const canvas = document.getElementById(canvasId);
    const overlay = document.getElementById("energy-canvas");
    if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLCanvasElement)) {
      return null;
    }
    const source = canvas.getBoundingClientRect();
    const target = overlay.getBoundingClientRect();
    return { x: source.left - target.left + point.x, y: source.top - target.top + point.y };
  }

  #onAttemptComplete(attempt: ActiveAttempt): void {
    const run = this.#run;
    const result = attempt.runtime.result;
    if (!run || !result || attempt !== this.#current) return;

    const ending = run.recordResult(result);
    this.#flyStarsToHistory(attempt.slotOrdinal, result.stars);
    this.#updateHud();

    if (ending) {
      this.#finishRun(ending);
      return;
    }

    // Promote immediately so judgment never has a gap; the strip takes exactly
    // one beat to slide, and the beat does not stop.
    this.#slideStartBeat = this.#transport.beat;
    this.#previous = attempt;
    this.#current = this.#next;
    this.#next = null;
    this.#timeline.removeTargets(attempt.timelineKey);
    if (!this.#current) {
      this.#finishRun("content-limit");
      return;
    }
    this.#queueNextAttempt();
  }

  #flyStarsToHistory(ordinal: number, stars: number): void {
    const slot = document.querySelector<HTMLElement>(
      `#hud-history .history-slot[data-ordinal="${ordinal}"]`
    );
    const layer = this.#energy;
    const strip = this.#strip;
    const setStars = (count: number) => {
      const label = slot?.querySelector(".slot-stars");
      if (label) label.textContent = "★".repeat(count);
    };

    // The slot's *state* flips now, so a finished minigame never looks unplayed
    // while its stars are still in the air. Only the glyphs arrive with them.
    if (slot) slot.dataset["state"] = stars > 0 ? "done" : "failed";

    if (!slot || !layer || !strip || stars === 0) {
      setStars(stars);
      return;
    }

    const from = this.#toOverlay("scenario-canvas", strip.currentPanelTarget);
    const rect = slot.getBoundingClientRect();
    const overlay = document.getElementById("energy-canvas");
    if (!from || !(overlay instanceof HTMLCanvasElement)) {
      setStars(stars);
      return;
    }
    const overlayRect = overlay.getBoundingClientRect();
    const to = {
      x: rect.left - overlayRect.left + rect.width / 2,
      y: rect.top - overlayRect.top + rect.height / 2,
    };

    const nowBeat = this.#transport.beat;
    for (let i = 0; i < stars; i += 1) {
      layer.spawn({
        from,
        to,
        polarity: "good",
        strong: true,
        bornBeat: nowBeat + i * 0.08,
        onArrive: () => setStars(i + 1),
      });
    }
  }

  #finishRun(ending: "failed" | "completed" | "content-limit"): void {
    const run = this.#run;
    if (!run) return;

    this.#current = null;
    this.#next = null;
    this.#timeline.clearTargets();

    const summary = run.summary;
    const tempo = tempoById(this.#setup.tempoId);
    recordHighScore(tempo.id, summary.totalScore);
    const best = readHighScores()[tempo.id] ?? 0;

    must("results-heading", HTMLElement).textContent =
      ending === "completed" ? "Run complete" : ending === "failed" ? "Game over" : "Out of content";
    must("results-rank", HTMLElement).textContent = summary.rank;
    must("results-reason", HTMLElement).textContent =
      ending === "failed"
        ? "Zero stars. The run ends there."
        : ending === "completed"
          ? "Sixteen minigames. You did something genuinely difficult."
          : "The library has no scenario authored for the next difficulty, so the run stops " +
            "here. This is a content limit in the vertical slice, not a failure.";
    must("results-score", HTMLElement).textContent = String(summary.totalScore);
    must("results-stars", HTMLElement).textContent = `${summary.totalStars} / 48`;
    must("results-best", HTMLElement).textContent = `${tempo.name} · ${best}`;

    for (const slot of document.querySelectorAll<HTMLElement>("#results-history .history-slot")) {
      const ordinal = Number(slot.dataset["ordinal"] ?? -1);
      const entry = run.slots[ordinal];
      const stars = entry?.result?.stars ?? 0;
      slot.dataset["state"] = entry?.result ? (stars > 0 ? "done" : "failed") : "pending";
      const label = slot.querySelector(".slot-stars");
      if (label) label.textContent = entry?.result ? "★".repeat(stars) : "";
    }

    this.#buildStartScreen();
    this.#showScreen("results");
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                               */
  /* ------------------------------------------------------------------ */

  #frame(): void {
    try {
      this.#tick();
    } catch (error) {
      console.error("[goaterizer] frame failed", error);
    }
    requestAnimationFrame(() => this.#frame());
  }

  #tick(): void {
    if (!this.#transport.running) return;
    const beat = this.#transport.beat;

    if (this.#provider instanceof TestGuitarInputProvider) {
      this.#provider.pump(this.#audio.now());
      this.#maybeScheduleAutoplay();
    }

    this.#current?.runtime.update(beat);
    this.#next?.runtime.update(beat);
    // Keeps the outgoing panel's effects decaying while it slides away.
    this.#previous?.runtime.update(beat);
    this.#timeline.prune(beat);
    this.#energy?.update(beat);

    if (this.#screen === "pregame") {
      this.#pregameView?.render(this.#timeline, beat);
      this.#updatePregameReadouts();
    } else if (this.#screen === "game") {
      this.#gameView?.render(this.#timeline, beat);
      this.#renderStrip(beat);
      this.#energy?.render(beat);
    }

    this.#updateDebug(beat);
  }

  #renderStrip(beat: number): void {
    const run = this.#run;
    const strip = this.#strip;
    if (!run || !strip) return;

    const slide =
      this.#slideStartBeat === null
        ? 0
        : Math.min(1, (beat - this.#slideStartBeat) / TRANSITION_BEATS) - 1;
    if (slide >= 0) this.#slideStartBeat = null;

    const panelFor = (slot: RunSlot | null, attempt: ActiveAttempt | null): StripPanel | null => {
      if (!slot) return null;
      // Only the attempt that actually belongs to this slot may drive it.
      const runtime = attempt?.slotOrdinal === slot.ordinal ? attempt.runtime : null;
      return {
        scenario: slot.scenario,
        route: slot.scenario?.levels.get(slot.difficulty)?.route ?? null,
        climb: runtime ? runtime.climb.state : null,
        stars: runtime ? runtime.starMeter.stars : slot.result?.stars ?? 0,
        starProgress: runtime ? runtime.starMeter.progressToNextStar : 0,
        difficulty: slot.difficulty,
        label: slot.scenario
          ? `${slot.scenario.displayName} · L${slot.difficulty}`
          : `L${slot.difficulty}`,
        beat: runtime ? runtime.toAttemptBeat(beat) : 0,
      };
    };

    strip.render({
      previous: panelFor(run.previousSlot, this.#previous),
      current: panelFor(run.currentSlot, this.#current),
      next: panelFor(run.nextSlot, this.#next),
      slide: Math.min(0, slide),
    });
  }

  #updateHud(): void {
    const run = this.#run;
    if (!run) return;
    const attemptScore = this.#current?.runtime.score.score ?? 0;
    must("hud-score", HTMLElement).textContent = String(run.totalScore + attemptScore);
    must("hud-stars", HTMLElement).textContent = `★ ${run.totalStars}`;

    for (const slot of document.querySelectorAll<HTMLElement>("#hud-history .history-slot")) {
      const ordinal = Number(slot.dataset["ordinal"] ?? -1);
      if (slot.dataset["state"] === "pending" && ordinal === run.currentIndex) {
        slot.dataset["state"] = "current";
      } else if (slot.dataset["state"] === "current" && ordinal !== run.currentIndex) {
        slot.dataset["state"] = "pending";
      }
    }
  }

  #updatePregameReadouts(): void {
    const frame = this.#inputStatus?.frame;
    const meter = document.querySelector<HTMLElement>("#pregame-level span");
    if (meter) {
      const level = Math.min(1, (frame?.rms ?? 0) * 12);
      meter.style.width = `${Math.round(level * 100)}%`;
    }
    const detected = document.getElementById("pregame-detected");
    if (detected instanceof HTMLElement) {
      detected.textContent =
        frame?.frequencyHz != null
          ? `${frame.frequencyHz.toFixed(1)} Hz · ${midiToName(
              69 + 12 * Math.log2(frame.frequencyHz / 440)
            )} · conf ${frame.confidence.toFixed(2)}`
          : "—";
    }
  }

  #updateDebug(beat: number): void {
    const debug = this.#debug;
    if (!debug?.enabled) return;
    const attempt = this.#current?.runtime;
    const target = attempt?.judge.currentTarget(attempt.toAttemptBeat(beat)) ?? null;
    const score = attempt?.score.snapshot;

    debug.update({
      screen: this.#screen,
      key: keyDisplayName(this.#setup.key),
      bpm: String(Math.round(this.#transport.bpm)),
      beat: beat.toFixed(2),
      measure: String(this.#transport.measure),
      "input source": this.#provider?.kind ?? "none",
      "input state": this.#inputStatus?.state ?? "—",
      "input error": this.#inputStatus?.errorCode ?? "—",
      "detected Hz": this.#inputStatus?.frame?.frequencyHz?.toFixed(1) ?? "—",
      "detected conf": this.#inputStatus?.frame?.confidence.toFixed(2) ?? "—",
      "channel rms": this.#inputStatus?.frame?.channelRms?.map((v) => v.toFixed(3)).join(" ") ?? "—",
      "selected channel": String(this.#inputStatus?.frame?.selectedChannel ?? "—"),
      "latency comp ms": (
        this.#audio.outputLatencySeconds * 1000 +
        this.#latencyTrimMs
      ).toFixed(1),
      scenario: attempt ? `${attempt.scenario.displayName} L${attempt.difficulty}` : "—",
      "attempt beat": attempt ? attempt.toAttemptBeat(beat).toFixed(2) : "—",
      "current target": target ? `#${target.opportunityIndex} ${midiToName(target.midi)}` : "—",
      "target beat": target ? target.startBeat.toFixed(2) : "—",
      "good window": target
        ? (attempt?.judge.windowsFor(target.opportunityIndex)?.good.toFixed(3) ?? "—")
        : "—",
      "open targets": attempt ? String(attempt.judge.openTargetCount) : "—",
      "perfect/good/miss": score ? `${score.perfect}/${score.good}/${score.missed}` : "—",
      "wrong notes": score ? String(score.wrongNotes) : "—",
      streak: score ? `${score.streak} (best ${score.bestStreak})` : "—",
      "attempt score": score ? String(score.score) : "—",
      "judgment points": score ? String(score.judgmentPoints) : "—",
      stars: attempt ? String(attempt.starMeter.stars) : "—",
      waypoint: attempt
        ? `${attempt.climb.state.waypointIndex + 1}/${attempt.climb.waypointCount}`
        : "—",
      "energy in flight": String(this.#energy?.activeCount ?? 0),
      autoplay: this.#autoplay,
      "assets failed": this.#assets.failed.join(",") || "none",
    });
  }

  /* ------------------------------------------------------------------ */
  /* Dev autoplay                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Schedules a whole attempt's worth of injected notes.
   *
   * Dev and test only. `scruffy` deliberately drops every fifth note and plays
   * the rest late, which is the shape of a one-star pass — it exists so the
   * failure and partial-credit paths can be exercised in a browser without a
   * guitarist who can play badly on request.
   */
  #maybeScheduleAutoplay(): void {
    const provider = this.#provider;
    const attempt = this.#current;
    if (
      this.#autoplay === "off" ||
      !attempt ||
      !(provider instanceof TestGuitarInputProvider) ||
      this.#autoplayScheduledFor === attempt.timelineKey
    ) {
      return;
    }
    this.#autoplayScheduledFor = attempt.timelineKey;

    const mode = this.#autoplay;
    const secondsPerBeat = this.#transport.secondsPerBeat;
    attempt.runtime.targets.forEach((target, index) => {
      if (mode === "scruffy" && index % 5 === 0) return;
      const offsetBeats = mode === "perfect" ? 0 : mode === "good" ? 0.3 : 0.34;
      const at = this.#transport.contextTimeAt(attempt.runtime.startBeat + target.startBeat);
      const latency = this.#audio.outputLatencySeconds + this.#latencyTrimMs / 1000;
      provider.schedule([
        { at: at + offsetBeats * secondsPerBeat + latency, kind: "attack", midi: target.midi },
      ]);
    });
  }
}
