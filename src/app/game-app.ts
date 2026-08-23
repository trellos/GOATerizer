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
 *                              AttemptRuntime (judge, score, stars, actors)
 *                                            │ judgment
 *                        ┌───────────────────┼───────────────────┐
 *                        ▼                   ▼                   ▼
 *                  TimelineModel        TimelineView      ScenarioBackdropView
 *                                     (notes + actors)      (background only)
 *
 * `EnergyLayer` hangs off the run rather than the attempt: it flies a trophy
 * from the scenario to the shelf when an attempt ends, and nothing else.
 */

import { AudioEngine } from "../audio/audio-engine.js";
import { generateBassLine, type BassLine } from "../audio/bass-line.js";
import { BassPlayer } from "../audio/bass-player.js";
import { drumPatternFor } from "../audio/drum-pattern.js";
import { DrumPlayer } from "../audio/drum-player.js";
import { Transport } from "../audio/transport.js";
import { SyntheticGuitarSource } from "../dev/synthetic-guitar.js";
import { pickWeightedKey } from "../config/key-weighting.js";
import { DEFAULT_TEMPO_ID, TEMPOS, tempoById, type TempoId } from "../config/tempos.js";
import {
  ATTEMPT_BEATS,
  EXTRA_INPUT_LATENCY_MS,
  RUN_LEAD_IN_BEATS,
  TRANSITION_BEATS,
} from "../config/tuning.js";
import { AttemptRuntime, type AttemptEvent } from "../game/attempt.js";
import { RunState, type RunSlot } from "../game/run.js";
import { subdivisionKey, subdivisionsOf, unionSubdivisions } from "../game/subdivisions.js";
import { offBeatMs, TimingDeltaLog } from "../game/timing-log.js";
import type { GuitarInputEvent, GuitarInputProvider, GuitarInputStatus } from "../input/guitar-input.js";
import { TestGuitarInputProvider } from "../input/test-provider.js";
import { TuninatorGuitarInputProvider } from "../input/tuninator-provider.js";
import { fingeringsForKey, STRING_NAMES, type Fingering } from "../music/fingering.js";
import { keyDisplayName, keyShortName, type RunKey } from "../music/keys.js";
import { midiToName } from "../music/pitch.js";
import { readHighScores, recordHighScore } from "../persistence/high-scores.js";
import {
  MAX_LATENCY_TRIM_MS,
  readLatencyTrimMs,
  writeLatencyTrimMs,
} from "../persistence/latency.js";
import { SCENARIOS, scenarioById } from "../scenario/registry.js";
import type { ScenarioDefinition } from "../scenario/types.js";
import { AssetStore } from "../ui/assets.js";
import { DebugPanel, type AutoplayMode } from "../ui/debug-panel.js";
import { EnergyLayer } from "../ui/energy-layer.js";
import { renderFingeringDiagram } from "../ui/fingering-diagram.js";
import { ScenarioBackdropView, type BackdropPanel } from "../ui/scenario-backdrop.js";
import { trophyLabel, trophySvg } from "../ui/trophy.js";
import type { ActorSprites } from "../ui/timeline/actor-layer.js";
import { TimelineModel } from "../ui/timeline/timeline-model.js";
import {
  OVERLAY_BAND_FRACTION,
  TimelineView,
  type TimelineViewMode,
} from "../ui/timeline/timeline-view.js";

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

/**
 * Puts one slot's trophy on the shelf. `null` clears it — an unplayed slot.
 *
 * `innerHTML` with a string this module built from a number: no user or asset
 * content reaches it, and the alternative is hand-building eight SVG nodes.
 */
function setTrophy(slot: HTMLElement, stars: number | null): void {
  const label = slot.querySelector(".slot-trophy");
  if (!(label instanceof HTMLElement)) return;
  label.innerHTML = stars === null ? "" : trophySvg(stars);
  if (stars === null) slot.removeAttribute("aria-label");
  else slot.setAttribute("aria-label", trophyLabel(stars));
}

/** A scenario with no climber art — pregame, and every non-climb class. */
const EMPTY_SPRITES: ActorSprites = { poses: [] };

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
  /** Which subdivision grid the kit is currently marking. See `#refreshDrumGrid`. */
  #drumGridKey = "";

  /* Input ------------------------------------------------------------ */
  #provider: GuitarInputProvider | null = null;
  #providerKind: "tuninator" | "test" = "tuninator";
  #synth: SyntheticGuitarSource | null = null;
  /**
   * True while `#provider` is a real `TuninatorGuitarInputProvider` whose mic
   * was intercepted by `#synth`. Tracked separately from `#providerKind`,
   * which stays `"tuninator"` in this case — as far as the adapter can tell,
   * it is one. This is what keeps the "not a real guitar" banner honest for a
   * source the provider itself has no way to distinguish from a real mic.
   */
  #micMocked = false;
  /** What `#enterPregame`'s first `#switchProvider` call should use. */
  #initialInputKind: "tuninator" | "test" | "synth" = "tuninator";
  #unsubscribeInput: (() => void)[] = [];
  #inputStatus: GuitarInputStatus | null = null;
  /**
   * The player's own latency compensation, on top of what the browser reports.
   * Seeded from a previous session's calibration; `EXTRA_INPUT_LATENCY_MS` is
   * the default for a rig that has never been measured.
   */
  #latencyTrimMs = readLatencyTrimMs() ?? EXTRA_INPUT_LATENCY_MS;
  readonly #timing = new TimingDeltaLog();

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
  #strip: ScenarioBackdropView | null = null;
  #energy: EnergyLayer | null = null;
  #debug: DebugPanel | null = null;
  #devMode = false;
  /** EXPERIMENT: draw the run's timeline over the scenario. */
  #overlayTimeline = true;
  /**
   * Dev-only: forces every slot to one difficulty level. `?dev=1&level=4`.
   *
   * Which scenario fills that level is still whatever `scenariosForDifficulty`
   * picks — with more than one Rocky-family scenario authoring the same level,
   * that is no longer always Rocky Ascent.
   */
  #actorSpriteCache: { id: string; sprites: ActorSprites } | null = null;
  #devLevel: number | null = null;
  #devScenarioId: string | null = null;
  #autoplay: AutoplayMode = "off";
  #autoplayScheduledFor: string | null = null;

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async start(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    this.#devMode = params.get("dev") === "1";
    // EXPERIMENT (see `styles.css`): the timeline drawn over the scenario
    // rather than beside it. On by default on this branch; `?overlay=0` gives
    // the two-pane layout back for an A/B in the same build.
    this.#overlayTimeline = params.get("overlay") !== "0";

    this.#pregameView = new TimelineView(must("pregame-canvas", HTMLCanvasElement), this.#setup.key);
    this.#gameView = new TimelineView(must("game-canvas", HTMLCanvasElement), this.#setup.key);
    this.#strip = new ScenarioBackdropView(must("scenario-canvas", HTMLCanvasElement), this.#assets);
    this.#energy = new EnergyLayer(must("energy-canvas", HTMLCanvasElement));

    // Every registered scenario, not just one: a run can draw any of them into
    // a slot (`scenariosForDifficulty`), and asset ids are namespaced per
    // scenario so there is nothing to collide by loading them all up front.
    await this.#assets.load(Object.assign({}, ...SCENARIOS.map((scenario) => scenario.assetUrls)));
    if (this.#assets.failed.length > 0) {
      console.warn("[goaterizer] assets failed to load:", this.#assets.failed);
    }

    // Both play screens take the overlay geometry, so the lane band is in the
    // identical rectangle while warming up and while playing. Pregame has no
    // scenario behind it — its controls take the space above and below the
    // band instead.
    for (const id of ["screen-game", "screen-pregame"]) {
      const screen = document.getElementById(id);
      if (screen instanceof HTMLElement) screen.dataset["overlay"] = String(this.#overlayTimeline);
    }
    // One source of truth for the band's height: the canvas lays the lanes out
    // from the constant, the stylesheet keeps the controls clear of it.
    document.documentElement.style.setProperty(
      "--timeline-band",
      `${OVERLAY_BAND_FRACTION * 100}%`
    );
    this.#gameView?.setOverlay(this.#overlayTimeline);
    this.#pregameView?.setOverlay(this.#overlayTimeline);

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

  /**
   * Rebuilds the fingering picker for the current key.
   *
   * Each offer is a five-fret neck diagram rather than a line of text: the
   * choice being made is "where on the neck do I want to practise this", and
   * that is a picture. The label under it names the root string and the
   * position so the choice is still readable without the diagram.
   */
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
      button.className = "fingering-option";
      button.dataset["fingering"] = fingering.id;
      button.dataset["selected"] = String(fingering.id === this.#setup.fingeringId);
      button.title = fingering.label;

      // Two short lines rather than one long one: which string the root is on,
      // and where the hand sits. The full description is on the tooltip.
      const root = document.createElement("span");
      root.textContent = `root on ${STRING_NAMES[fingering.rootString] ?? "?"}`;
      const frets = document.createElement("span");
      frets.className = "fingering-frets";
      frets.textContent = `frets ${fingering.lowestFret}–${fingering.highestFret}`;
      button.append(renderFingeringDiagram(fingering), root, frets);

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
    must("pregame-calibrate-apply", HTMLButtonElement).addEventListener("click", () =>
      this.#applyCalibration()
    );
    must("pregame-calibrate-reset", HTMLButtonElement).addEventListener("click", () =>
      this.#resetCalibration()
    );
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
        this.#applyGameViewMode();
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
      onLatencyChange: (ms) => this.#setLatencyTrim(ms),
      onAutoplay: (mode) => {
        this.#autoplay = mode;
        this.#autoplayScheduledFor = null;
        if (mode === "off" && this.#provider instanceof TestGuitarInputProvider) {
          this.#provider.clearSchedule();
        }
      },
    });
    this.#debug.setEnabled(this.#devMode);
    // A trim remembered from a previous session has to show in the panel, or
    // the input reads 0 while a real compensation is being applied.
    this.#debug.setLatencyTrim(this.#latencyTrimMs);

    // `?input=test` and `?input=synth` are dev-only on purpose. `test` is the
    // only way to make the deterministic provider drive scoring, and it is
    // what the browser validation suite uses in place of a guitar. `synth`
    // exists for environments (like the Browser pane used to build this game)
    // that cannot grant microphone access at all, and still need to exercise
    // the real Tuninator path rather than bypass it.
    const level = Number(params.get("level"));
    if (this.#devMode && Number.isInteger(level) && level >= 1 && level <= 7) {
      this.#devLevel = level;
    }

    // `?scenario=<id>` pins every slot that scenario authors to it. Dev-only,
    // and it must name a real scenario: silently ignoring a typo would look
    // like the pin working and selection disagreeing with it.
    const scenarioId = params.get("scenario");
    if (this.#devMode && scenarioId) {
      if (!scenarioById(scenarioId)) {
        console.warn(`[goaterizer] ?scenario=${scenarioId} is not a registered scenario id`);
      } else {
        this.#devScenarioId = scenarioId;
      }
    }

    const requestedInput = params.get("input");
    if (this.#devMode && (requestedInput === "test" || requestedInput === "synth")) {
      this.#initialInputKind = requestedInput;
      if (requestedInput === "test") this.#providerKind = "test";
      const select = root.querySelector("#dev-source");
      if (select instanceof HTMLSelectElement) select.value = requestedInput;
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
    this.#applyGameViewMode();
    this.#updateKeyReadouts();

    await this.#switchProvider(this.#initialInputKind);
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

  /**
   * The key, twice: the chart-style short name to read at a glance, and the
   * long name on the tooltip for anyone who wants it spelled out.
   */
  /**
   * The run screen's view mode.
   *
   * The overlay is Key View only: tablature's six string rows carry no pitch
   * contour, so laid over a scenario they read as a grille rather than as a
   * melody. Pregame still offers both, and turning the overlay off
   * (`?overlay=0`) restores the choice in the run too.
   */
  #applyGameViewMode(): void {
    this.#gameView?.setMode(this.#overlayTimeline ? "key" : this.#setup.viewMode);
  }

  #updateKeyReadouts(): void {
    const short = keyShortName(this.#setup.key);
    const long = keyDisplayName(this.#setup.key);
    for (const id of ["pregame-key", "hud-key"]) {
      const element = must(id, HTMLElement);
      element.textContent = short;
      element.title = long;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  async #switchProvider(kind: "tuninator" | "test" | "synth"): Promise<void> {
    if (kind !== "tuninator" && !this.#devMode) {
      // Belt and braces: neither dev source must be reachable in normal play,
      // whatever calls this.
      console.warn(`[goaterizer] refusing to use ${kind} input outside dev mode`);
      return;
    }

    for (const off of this.#unsubscribeInput) off();
    this.#unsubscribeInput = [];
    await this.#provider?.dispose();

    const context = this.#audio.context;
    if (kind !== "test" && !context) {
      this.#setInputStatusText("error", "Audio is not running yet.");
      return;
    }

    // Only "synth" wants the mic mocked. Leaving a previous install in place
    // would silently mock a genuine "Tuninator (live guitar)" selection too.
    if (kind === "synth") {
      if (!this.#synth) this.#synth = new SyntheticGuitarSource(context as AudioContext);
      this.#synth.install();
    } else {
      this.#synth?.uninstall();
    }
    this.#micMocked = kind === "synth";

    // The synthetic mic is still consumed through the real recognizer: as far
    // as TuninatorGuitarInputProvider or Tuninator can tell, "synth" and
    // "tuninator" are the same input.
    this.#providerKind = kind === "test" ? "test" : "tuninator";
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
    // `status.kind` cannot see the mocked mic -- as far as the provider is
    // concerned it opened a real one -- so the synthetic case is read from
    // `#micMocked`, tracked at the one place that actually knows. A real error
    // still shows as an error: the mock does not hide a genuinely broken
    // recognizer.
    const state =
      status.kind === "test"
        ? "test"
        : status.state === "error"
          ? "error"
          : this.#micMocked
            ? "synth"
            : status.state;
    this.#setInputStatusText(
      state,
      this.#micMocked
        ? `${status.message} (DEV: synthetic sine input, not a real guitar)`
        : status.message
    );

    const warning = document.getElementById("game-input-warning");
    if (warning instanceof HTMLElement) {
      const problem = status.state === "error" || status.kind === "test" || this.#micMocked;
      warning.hidden = !problem;
      warning.textContent =
        status.kind === "test"
          ? "DEV: deterministic test input — not a guitar"
          : this.#micMocked
            ? "DEV: synthetic sine input — not a guitar"
            : status.message;
    }
  }

  #setInputStatusText(state: string, message: string): void {
    const element = document.getElementById("pregame-input-state");
    if (!(element instanceof HTMLElement)) return;
    element.dataset["state"] = state;
    element.textContent = message;
  }

  /**
   * Total latency compensation, in seconds: what the browser reports plus the
   * player's own calibration trim.
   */
  get #latencySeconds(): number {
    return this.#audio.outputLatencySeconds + this.#latencyTrimMs / 1000;
  }

  /** Audio-clock seconds -> absolute transport beats, latency-compensated. */
  #toBeat = (contextTime: number): number => {
    return this.#transport.beatAt(contextTime - this.#latencySeconds);
  };

  /**
   * **The beat the player is hearing right now**, and the clock everything
   * downstream of the speakers runs on.
   *
   * `Transport.beat` is the beat being *scheduled*: audio written at context
   * time `t` reaches the player's ears at `t + outputLatency`, so the raw
   * transport clock runs that far ahead of the room. Drawing the timeline on it
   * put the note bar across the strike line before the drum hit arrived, by the
   * whole output latency — a few milliseconds on a wired output, but a third of
   * a beat at 90bpm on Bluetooth headphones, which is exactly the "the beat
   * feels laggy" complaint.
   *
   * It also quietly broke judgment. Played notes are timestamped in this
   * compensated space (`#toBeat`) while the judge was *ticked* in raw transport
   * time, so its windows closed a full latency early and a note played on the
   * beat could be marked missed before its own attack was delivered.
   *
   * One clock, then: scheduling audio stays in raw transport time — that is
   * what `contextTimeAt` is for — and everything the player sees or is judged
   * on runs here.
   */
  get #heardBeat(): number {
    return this.#toBeat(this.#audio.now());
  }

  #onGuitarEvent(event: GuitarInputEvent): void {
    const beat = this.#toBeat(event.contextTime);
    switch (event.type) {
      case "attack":
        this.#timeline.addPlayed(event.id, event.midi, beat);
        if (this.#screen === "pregame") this.#recordCalibrationSample(beat);
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
  /* Latency calibration                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * One note of the pregame calibration: how far off the nearest beat it was.
   *
   * Pregame has no targets, so the reference is the beat grid itself — the
   * drums the player is hearing. The measurement therefore only works while
   * they are playing *on* beats, and it can only see an offset up to half a
   * beat: past that, `Math.round` picks the next beat instead and the error
   * folds over. At 90bpm that is ±333ms, which covers every rig short of a
   * badly-paired Bluetooth speaker; at the slowest tempo it is ±500ms.
   *
   * The sign convention is the log's: positive is late. `beat` is already
   * latency-compensated, so what is measured is the residual the current
   * compensation does *not* explain — exactly the thing the trim exists for.
   */
  #recordCalibrationSample(beat: number): void {
    if (!this.#transport.running) return;
    this.#timing.record(offBeatMs(beat, this.#transport.secondsPerBeat));
  }

  /** Adopts the measured bias, remembers it, and starts measuring again. */
  #applyCalibration(): void {
    const suggested = this.#timing.suggestedTrimMs(this.#latencyTrimMs);
    if (suggested === null) return;
    this.#setLatencyTrim(Math.max(-MAX_LATENCY_TRIM_MS, Math.min(MAX_LATENCY_TRIM_MS, suggested)));
  }

  /** Forgets the calibration; the browser's own reported latency stands alone. */
  #resetCalibration(): void {
    this.#setLatencyTrim(EXTRA_INPUT_LATENCY_MS);
    writeLatencyTrimMs(null);
  }

  #setLatencyTrim(milliseconds: number): void {
    this.#latencyTrimMs = Math.round(milliseconds);
    // Samples taken under the old trim describe a rig that no longer exists;
    // averaging them with the new ones hides the very change being tested.
    this.#timing.clear();
    writeLatencyTrimMs(this.#latencyTrimMs);
    this.#debug?.setLatencyTrim(this.#latencyTrimMs);
  }

  /* ------------------------------------------------------------------ */
  /* Run                                                                 */
  /* ------------------------------------------------------------------ */

  #beginRun(): void {
    if (!this.#transport.running) return;

    this.#run = new RunState({
      key: this.#setup.key,
      bpm: tempoById(this.#setup.tempoId).bpm,
      // Dev-only. Normal play always uses the design's fixed difficulty curve
      // and random scenario selection.
      ...(this.#devLevel !== null
        ? { difficultySequence: Array.from({ length: 16 }, () => this.#devLevel as number) }
        : {}),
      ...(this.#devScenarioId !== null ? { pinnedScenarioId: this.#devScenarioId } : {}),
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
        setTrophy(slot, null);
      }
    }

    // Start on the next measure boundary plus a lead-in, so the first target
    // arrives in time rather than instantly. The beat never stops. Measured
    // from the beat the player is *hearing*, so the lead-in they actually get
    // is the one the constant names however much latency their rig has.
    const startBeat = this.#transport.nextMeasureBoundary(this.#heardBeat) + RUN_LEAD_IN_BEATS;
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
      this.#refreshDrumGrid();
      return;
    }
    this.#next = this.#createAttempt(run.nextSlot, current.runtime.endBeat + TRANSITION_BEATS);
    this.#refreshDrumGrid();
  }

  /**
   * Points the kit at the rhythmic grid of what is being played *and* what is
   * coming next.
   *
   * The union of the two is what makes the signal useful: a sixteenth run
   * announces itself during the attempt before it, and — because that attempt
   * then becomes the current one — the marking carries on underneath it rather
   * than stopping at the moment it is needed most.
   *
   * Guarded on the resulting key: `setPattern` re-schedules the queued tail, so
   * calling it when nothing changed would restate the kit every transition.
   */
  #refreshDrumGrid(): void {
    const grids = [this.#current, this.#next]
      .filter((attempt): attempt is ActiveAttempt => attempt !== null)
      .map((attempt) => subdivisionsOf(attempt.runtime.level.prompt));
    const combined = unionSubdivisions(...grids);
    const key = subdivisionKey(combined);
    if (key === this.#drumGridKey) return;

    this.#drumGridKey = key;
    this.#drums?.setPattern(drumPatternFor(combined));
  }

  #onAttemptEvent(attempt: ActiveAttempt, event: AttemptEvent): void {
    switch (event.type) {
      case "judgment": {
        const judgment = event.judgment;
        if (judgment.type === "PerfectNote" || judgment.type === "GoodNote") {
          // Calibration samples come from a human and a real guitar only.
          // Autoplay -- discrete or synthetic -- schedules its attacks at the
          // target time plus the current compensation, so it reports ~0 by
          // construction; letting that into the log would quietly confirm
          // whatever trim is already set.
          if (this.#autoplay === "off" && this.#providerKind === "tuninator" && !this.#micMocked) {
            this.#timing.record(judgment.beatDelta * this.#transport.secondsPerBeat * 1000);
          }
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
    this.#slideStartBeat = this.#heardBeat;
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
    /**
     * Each star that lands upgrades the trophy it lands on: bare at one, horns
     * at two, a crown at three. The ornament arriving with the star is the
     * whole "goats lead to stars, stars lead to the trophy" chain shown rather
     * than explained.
     */
    const setTrophyTier = (count: number) => {
      if (slot) setTrophy(slot, count);
    };

    // The slot's *state* flips now, so a finished minigame never looks unplayed
    // while its trophy is still in the air. Only the trophy arrives with them.
    if (slot) slot.dataset["state"] = stars > 0 ? "done" : "failed";

    if (!slot || !layer || !strip || stars === 0) {
      setTrophyTier(stars);
      return;
    }

    const from = this.#toOverlay("scenario-canvas", strip.currentPanelTarget);
    const rect = slot.getBoundingClientRect();
    const overlay = document.getElementById("energy-canvas");
    if (!from || !(overlay instanceof HTMLCanvasElement)) {
      setTrophyTier(stars);
      return;
    }
    const overlayRect = overlay.getBoundingClientRect();
    const to = {
      x: rect.left - overlayRect.left + rect.width / 2,
      y: rect.top - overlayRect.top + rect.height / 2,
    };

    const nowBeat = this.#heardBeat;
    for (let i = 0; i < stars; i += 1) {
      layer.spawn({
        from,
        to,
        polarity: "good",
        strong: true,
        bornBeat: nowBeat + i * 0.08,
        onArrive: () => setTrophyTier(i + 1),
      });
    }
  }

  #finishRun(ending: "failed" | "completed" | "content-limit"): void {
    const run = this.#run;
    if (!run) return;

    this.#current = null;
    this.#next = null;
    this.#timeline.clearTargets();
    // Back to the bare pulse: there is no upcoming phrase to warn about.
    this.#refreshDrumGrid();

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
      setTrophy(slot, entry?.result ? stars : null);
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
    // Everything below runs on the beat the player is hearing, never the beat
    // being scheduled. See `#heardBeat`.
    const beat = this.#heardBeat;

    if (this.#provider instanceof TestGuitarInputProvider) {
      this.#provider.pump(this.#audio.now());
      this.#maybeScheduleAutoplay();
    } else if (this.#micMocked) {
      // The synthetic mic has no queue to pump -- plucks are real scheduled
      // audio -- but it still needs the same per-attempt scheduling call.
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
      // PROTOTYPE: the actor belongs to the attempt being played, and its beat
      // is that attempt's, so its hop arc is in the phrase's own time.
      const attempt = this.#current?.runtime;
      this.#gameView?.setActor(
        attempt ? attempt.actor.state : null,
        attempt ? attempt.toAttemptBeat(beat) : 0
      );
      this.#gameView?.setActorSprites(this.#actorSpritesFor(attempt?.scenario ?? null));
      // A repeat scenario puts its own performer on the bars instead.
      this.#gameView?.setRepeat(attempt?.repeat ? attempt.repeat.state : null);
      this.#gameView?.render(this.#timeline, beat);
      this.#renderStrip(beat);
      this.#energy?.render(beat);
    }

    this.#updateDebug(beat);
  }

  /**
   * The climber art for a scenario, resolved through the asset store.
   *
   * Cached on the scenario id: this runs every frame, and rebuilding an array
   * of four image lookups sixty times a second to hand the same four images to
   * the same view is work for nothing.
   */
  #actorSpritesFor(scenario: ScenarioDefinition | null): ActorSprites {
    if (!scenario) return EMPTY_SPRITES;
    if (this.#actorSpriteCache?.id === scenario.id) return this.#actorSpriteCache.sprites;
    const bindings = scenario.assetBindings;
    const poses =
      bindings.kind === "climb"
        ? bindings.climberPoses
            .map((id) => this.#assets.get(id))
            .filter((image): image is HTMLImageElement => image !== null)
        : [];
    const sprites: ActorSprites = { poses };
    this.#actorSpriteCache = { id: scenario.id, sprites };
    return sprites;
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

    const panelFor = (slot: RunSlot | null, attempt: ActiveAttempt | null): BackdropPanel | null => {
      if (!slot) return null;
      // Only the attempt that actually belongs to this slot may drive its meter.
      const runtime = attempt?.slotOrdinal === slot.ordinal ? attempt.runtime : null;
      return {
        scenario: slot.scenario,
        stars: runtime ? runtime.starMeter.stars : slot.result?.stars ?? 0,
        starProgress: runtime ? runtime.starMeter.progressToNextStar : 0,
        difficulty: slot.difficulty,
        label: slot.scenario
          ? `${slot.scenario.displayName} · L${slot.difficulty}`
          : `L${slot.difficulty}`,
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
    this.#updateCalibrationReadouts();
  }

  /**
   * The two halves of the compensation, and what the player's own playing says
   * about whether it is right.
   *
   * Both are shown because they answer different questions. The reported figure
   * is what the browser knows about its own audio path, and a large one is a
   * fact about the rig rather than a problem to fix. The measured figure is the
   * part nothing reported — and it is the only one that can say "you are still
   * playing 40ms late after all of that".
   */
  #updateCalibrationReadouts(): void {
    const reportedMs = Math.round(this.#audio.outputLatencySeconds * 1000);
    const latency = document.getElementById("pregame-latency");
    if (latency instanceof HTMLElement) {
      latency.textContent =
        `${reportedMs + this.#latencyTrimMs} ms total — ` +
        `${reportedMs} reported by the browser, ${this.#latencyTrimMs} yours`;
    }

    const state = document.getElementById("pregame-calibration");
    const apply = document.getElementById("pregame-calibrate-apply");
    const median = this.#timing.median;
    const spread = this.#timing.spread;
    // Enough notes to have a median worth trusting, and a cluster tight enough
    // that it describes a rig rather than a player still warming up. A spread
    // wider than the offset means the honest answer is "keep playing".
    const usable =
      this.#timing.count >= 8 && median !== null && spread !== null && spread < Math.abs(median);

    if (state instanceof HTMLElement) {
      if (median === null) {
        state.textContent = "Play single notes on the beat to measure your rig.";
      } else {
        const direction = median >= 0 ? "late" : "early";
        state.textContent =
          `${Math.abs(Math.round(median))} ms ${direction} ` +
          `(±${Math.round(spread ?? 0)}, ${this.#timing.count} notes)` +
          (usable ? "" : " — keep playing");
      }
    }
    if (apply instanceof HTMLButtonElement) apply.disabled = !usable;
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
      // Split, because "the browser says 180ms" and "you are 40ms late on top
      // of that" are different findings with different fixes.
      "latency reported ms": (this.#audio.outputLatencySeconds * 1000).toFixed(1),
      "latency trim ms": String(this.#latencyTrimMs),
      "latency comp ms": (
        this.#audio.outputLatencySeconds * 1000 +
        this.#latencyTrimMs
      ).toFixed(1),
      "timing delta": this.#timingReadout(),
      "suggested trim ms":
        this.#timing.count >= 8 ? this.#timing.suggestedTrimMs(this.#latencyTrimMs)!.toFixed(1) : "—",
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
      // One readout per class, so the panel says "—" for the one this scenario
      // is not rather than quietly reporting a zero that means nothing.
      "cans crushed/missed": attempt?.repeat
        ? `${attempt.repeat.state.crushed}/${attempt.repeat.state.beaned}`
        : "—",
      "actor lane/streak": attempt
        ? `${attempt.actor.state.lane ?? "—"}/${attempt.actor.state.streak}`
        : "—",
      "energy in flight": String(this.#energy?.activeCount ?? 0),
      autoplay: this.#autoplay,
      "assets failed": this.#assets.failed.join(",") || "none",
    });
  }

  /**
   * "n ms last, n ms median ± spread (n=count)" — positive is late. See
   * `TimingDeltaLog` for why median/spread rather than a running mean.
   */
  #timingReadout(): string {
    if (this.#timing.count === 0) return "— (no calibration samples yet)";
    const last = this.#timing.last!;
    const median = this.#timing.median!;
    const spread = this.#timing.spread!;
    return `${last.toFixed(1)} last, ${median.toFixed(1)} median ±${spread.toFixed(1)} (n=${this.#timing.count})`;
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
   *
   * Two playback paths, same target loop and timing math: `TestGuitarInputProvider`
   * takes already-judged discrete events; the synthetic mic (`#micMocked`)
   * takes real sine plucks that the real recognizer has to detect, which is
   * the whole reason it exists (`src/dev/synthetic-guitar.ts`).
   */
  #maybeScheduleAutoplay(): void {
    const provider = this.#provider;
    const attempt = this.#current;
    const synth = this.#micMocked ? this.#synth : null;
    const testProvider = provider instanceof TestGuitarInputProvider ? provider : null;
    if (
      this.#autoplay === "off" ||
      !attempt ||
      (!testProvider && !synth) ||
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
      // `fumbled` is in time but on the wrong string: every third note lands a
      // fifth high. It is the only way to see wrong-pitch feedback -- which is
      // a whole mechanic in `RepeatMinigame` -- without a guitar in the room.
      const midi = mode === "fumbled" && index % 3 === 1 ? target.midi + 7 : target.midi;
      const at = this.#transport.contextTimeAt(attempt.runtime.startBeat + target.startBeat);
      const latency = this.#audio.outputLatencySeconds + this.#latencyTrimMs / 1000;
      const attackTime = at + offsetBeats * secondsPerBeat + latency;
      if (testProvider) {
        testProvider.schedule([{ at: attackTime, kind: "attack", midi }]);
      } else if (synth) {
        // A hair short of the full duration, so consecutive notes at the same
        // pitch still get a real onset each rather than reading as one long
        // sustain -- the recognizer needs an amplitude dip to find the second
        // attack.
        const duration = Math.max(0.12, target.durationBeats * secondsPerBeat * 0.85);
        synth.pluck(target.midi, attackTime, duration);
      }
    });
  }
}
