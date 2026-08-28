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
import { drumPatternFor } from "../audio/drum-pattern.js";
import { DrumPlayer } from "../audio/drum-player.js";
import { Transport } from "../audio/transport.js";
import {
  planAutoPerformance,
  parseAutoplayMode,
  type AutoGesture,
  type AutoPerformance,
  type AutoplayMode,
} from "../dev/auto-performance.js";
import { SyntheticGuitarSource } from "../dev/synthetic-guitar.js";
import { pickWeightedKey } from "../config/key-weighting.js";
import {
  DEFAULT_TEMPO_ID,
  parseTempo,
  TEMPOS,
  tempoById,
  type TempoId,
} from "../config/tempos.js";
import {
  ATTEMPT_BEATS,
  AUTOPLAY_DEFAULT_SEED,
  AUTOPLAY_PLUCK_GAP_SECONDS,
  AUTOPLAY_PLUCK_MAX_SOUNDING_SECONDS,
  AUTOPLAY_PLUCK_MIN_SOUNDING_SECONDS,
  AUTOPLAY_SCHEDULE_LEAD_SECONDS,
  EXTRA_INPUT_LATENCY_MS,
  RUN_LEAD_IN_BEATS,
  TRANSITION_BEATS,
} from "../config/tuning.js";
import { AttemptRuntime, type AttemptEvent, type EnergyEvent } from "../game/attempt.js";
import { RunState, type RunSlot } from "../game/run.js";
import { subdivisionKey, subdivisionsOf, unionSubdivisions } from "../game/subdivisions.js";
import { TimingDeltaLog } from "../game/timing-log.js";
import type { GuitarInputEvent, GuitarInputProvider, GuitarInputStatus } from "../input/guitar-input.js";
import { TestGuitarInputProvider } from "../input/test-provider.js";
import { TuninatorGuitarInputProvider } from "../input/tuninator-provider.js";
import { LANE_COUNT } from "../music/degrees.js";
import { fingeringsForKey, STRING_NAMES, type Fingering } from "../music/fingering.js";
import { keyDisplayName, keyShortName, parseKeyName, type RunKey } from "../music/keys.js";
import { midiToName } from "../music/pitch.js";
import { readHighScores, recordHighScore } from "../persistence/high-scores.js";
import { SCENARIOS } from "../scenario/registry.js";
import { AssetStore } from "../ui/assets.js";
import { DebugPanel } from "../ui/debug-panel.js";
import { EnergyLayer } from "../ui/energy-layer.js";
import { renderFingeringDiagram } from "../ui/fingering-diagram.js";
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
  /** Monotonic across a run. Seeds this attempt's autoplay performance. */
  attemptIndex: number;
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
  /**
   * Which source was actually asked for, as opposed to which provider class is
   * running. `#providerKind` cannot tell `synth` from `tuninator` by design.
   */
  #sourceKind: "tuninator" | "test" | "synth" = "tuninator";
  /** What `#enterPregame`'s first `#switchProvider` call should use. */
  #initialInputKind: "tuninator" | "test" | "synth" = "tuninator";
  /**
   * Serialises provider switches.
   *
   * `#switchProvider` disposes the recognizer and awaits a fresh `start()`, and
   * it is now reachable from two sync click handlers (the source select and the
   * autoplay chips). Overlapping calls could otherwise leave `#provider`
   * pointing at a disposed recognizer, with `#micMocked` set by whichever lost.
   */
  #providerSwitch: Promise<void> = Promise.resolve();
  #unsubscribeInput: (() => void)[] = [];
  #inputStatus: GuitarInputStatus | null = null;
  #latencyTrimMs = EXTRA_INPUT_LATENCY_MS;
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
  #strip: ScenarioStripView | null = null;
  #energy: EnergyLayer | null = null;
  #debug: DebugPanel | null = null;
  #devMode = false;
  /**
   * Dev-only: forces every slot to one difficulty level. `?dev=1&level=4`.
   *
   * Which scenario fills that level is still whatever `scenariosForDifficulty`
   * picks — with more than one Rocky-family scenario authoring the same level,
   * that is no longer always Rocky Ascent.
   */
  #devLevel: number | null = null;
  #autoplay: AutoplayMode = "off";
  /** `?dev=1&seed=N`. Fixed by default, so a demo link replays. */
  #autoplaySeed: number = AUTOPLAY_DEFAULT_SEED;
  /**
   * Performances already handed to a sink, keyed by `timelineKey`.
   *
   * A map rather than the single key this used to be: `#current` and `#next`
   * are both scheduled, so an attempt gets a full attempt of lead time instead
   * of the one `TRANSITION_BEATS` beat it had when only the promoted attempt
   * was scheduled.
   */
  readonly #autoplayScheduled = new Map<string, AutoPerformance>();

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async start(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    this.#devMode = params.get("dev") === "1";
    this.#applySetupParams(params);

    this.#pregameView = new TimelineView(must("pregame-canvas", HTMLCanvasElement), this.#setup.key);
    this.#gameView = new TimelineView(must("game-canvas", HTMLCanvasElement), this.#setup.key);
    this.#strip = new ScenarioStripView(must("scenario-canvas", HTMLCanvasElement), this.#assets);
    this.#energy = new EnergyLayer(must("energy-canvas", HTMLCanvasElement));

    // Every registered scenario, not just one: a run can draw any of them into
    // a slot (`scenariosForDifficulty`), and asset ids are namespaced per
    // scenario so there is nothing to collide by loading them all up front.
    await this.#assets.load(Object.assign({}, ...SCENARIOS.map((scenario) => scenario.assetUrls)));
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

  /**
   * `?key=` and `?tempo=`: start the run set up a particular way.
   *
   * Not dev-only, unlike the flags below. Both name choices the player already
   * makes by hand — the reroll button and the tempo chips — so a link that
   * arrives pre-set is a shortcut into normal play, not a way around it. What
   * it buys is practice: "send me the Eb one again" is otherwise a matter of
   * rerolling until Eb comes up, and Eb major is a weight-3 key.
   *
   * The pregame still owns both: Reroll rolls a fresh random key as it always
   * has, and the tempo chips still switch tempo. The URL sets the starting
   * point, it does not pin it.
   *
   * An unreadable value is ignored, with a warning, and the run starts as it
   * would have — a typo in a link should not refuse to start the game.
   */
  #applySetupParams(params: URLSearchParams): void {
    const requestedKey = params.get("key");
    if (requestedKey !== null) {
      const key = parseKeyName(requestedKey);
      if (key) {
        this.#setup.key = key;
        this.#timeline.setKey(key);
      } else {
        console.warn(`[goaterizer] ignoring unreadable ?key=${requestedKey}`);
      }
    }

    const requestedTempo = params.get("tempo");
    if (requestedTempo !== null) {
      const tempoId = parseTempo(requestedTempo);
      if (tempoId) {
        this.#setup.tempoId = tempoId;
      } else {
        console.warn(`[goaterizer] ignoring unreadable ?tempo=${requestedTempo}`);
      }
    }
  }

  #setupDebugPanel(params: URLSearchParams): void {
    const root = document.getElementById("dev-panel");
    if (!(root instanceof HTMLElement)) return;
    this.#debug = new DebugPanel(root, {
      onSourceChange: (source) => {
        void this.#queueProviderSwitch(source);
      },
      onLatencyChange: (ms) => {
        this.#latencyTrimMs = ms;
        // Samples taken under the old trim describe a different rig. Keeping
        // them would average the change away and make the trim look ineffective.
        this.#timing.clear();
        // The compensation is baked in at schedule time, so anything already
        // queued describes the old trim too.
        this.#cancelAutoplay();
      },
      onAutoplay: (mode) => {
        void this.#setAutoplayMode(mode);
      },
    });
    this.#debug.setEnabled(this.#devMode);

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

    const requestedInput = params.get("input");
    if (this.#devMode && (requestedInput === "test" || requestedInput === "synth")) {
      this.#initialInputKind = requestedInput;
      if (requestedInput === "test") this.#providerKind = "test";
      this.#debug.setSourceValue(requestedInput);
    }

    // Guarded on presence, not just on `Number`: `Number(null)` is 0, which
    // would quietly make a bare `?dev=1` a different performance from the
    // documented default rather than the same one.
    const rawSeed = params.get("seed");
    const seed = Number(rawSeed);
    if (this.#devMode && rawSeed !== null && rawSeed !== "" && Number.isFinite(seed)) {
      this.#autoplaySeed = Math.trunc(seed) >>> 0;
    }

    // `?dev=1&autoplay=<mode>` is the shareable-demo path, and it is
    // deliberately the *clean* one: setting the source here means
    // `#enterPregame` opens the synthetic mic on its single provider start,
    // rather than a click tearing a running recognizer down mid-run.
    const autoplay = parseAutoplayMode(params.get("autoplay"));
    if (this.#devMode && autoplay && autoplay !== "off") {
      this.#autoplay = autoplay;
      this.#debug.setAutoplayMode(autoplay);
      if (!requestedInput) {
        this.#initialInputKind = "synth";
        this.#debug.setSourceValue("synth");
      }
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

    await this.#queueProviderSwitch(this.#initialInputKind);
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
      // `setBpm` re-anchors the transport, so every already-computed audio-clock
      // time for a queued gesture now points at the wrong beat.
      this.#cancelAutoplay();
    }
  }

  /**
   * The key, twice: the chart-style short name to read at a glance, and the
   * long name on the tooltip for anyone who wants it spelled out.
   */
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

  /**
   * Switches input source, one at a time.
   *
   * Every caller goes through here rather than calling `#switchProvider`
   * directly: two overlapping switches can interleave a `dispose()` with a
   * `start()` and leave the app holding a disposed recognizer.
   */
  #queueProviderSwitch(kind: "tuninator" | "test" | "synth"): Promise<void> {
    this.#providerSwitch = this.#providerSwitch.then(() => this.#switchProvider(kind));
    return this.#providerSwitch;
  }

  async #switchProvider(kind: "tuninator" | "test" | "synth"): Promise<void> {
    if (kind !== "tuninator" && !this.#devMode) {
      // Belt and braces: neither dev source must be reachable in normal play,
      // whatever calls this.
      console.warn(`[goaterizer] refusing to use ${kind} input outside dev mode`);
      return;
    }

    // Already on it and working: do not tear down a healthy recognizer just to
    // build the same one again. A provider that errored is retried.
    if (kind === this.#sourceKind && this.#provider && this.#provider.getStatus().state !== "error") {
      return;
    }

    // Anything queued was timed against the provider that is about to go away.
    this.#cancelAutoplay();

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
    this.#sourceKind = kind;
    this.#debug?.setSourceValue(kind);

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
    const status = this.#provider.getStatus();
    this.#onInputStatus(status);

    // A mode running against a source that never opened would show
    // `autoplay: 50` in the panel with nothing happening (`AGENTS.md` §13).
    if (status.state === "error" && this.#autoplay !== "off") {
      this.#autoplay = "off";
      this.#debug?.setAutoplayMode("off");
    }
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
    // Without this, a replay inherits the previous run's queued plucks.
    this.#cancelAutoplay();
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
    const attemptIndex = this.#attemptCounter++;
    const timelineKey = `a${attemptIndex}`;
    const runtime = new AttemptRuntime({
      scenario: slot.scenario,
      difficulty: slot.difficulty,
      key: this.#setup.key,
      startBeat,
      toBeat: this.#toBeat,
    });
    const attempt: ActiveAttempt = {
      timelineKey,
      slotOrdinal: slot.ordinal,
      attemptIndex,
      runtime,
    };
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
      // A streak with no lane (a played note off the octave entirely) launches
      // from the middle of the pitch axis rather than from an edge.
      view.pointFor(
        energy.lane ?? (LANE_COUNT - 1) / 2,
        attempt.runtime.startBeat + energy.beat,
        nowBeat
      )
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
    // The run is over; anything still queued belongs to an attempt that will
    // never be judged, and would play over the results screen.
    this.#cancelAutoplay();
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

    // The test provider fires its queue against the audio clock; the synthetic
    // mic has no queue to pump, because its plucks are real scheduled audio.
    if (this.#provider instanceof TestGuitarInputProvider) {
      this.#provider.pump(this.#audio.now());
    }
    this.#syncAutoplay();

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
    const plan = this.#current
      ? (this.#autoplayScheduled.get(this.#current.timelineKey) ?? null)
      : null;

    debug.update({
      screen: this.#screen,
      key: keyDisplayName(this.#setup.key),
      bpm: String(Math.round(this.#transport.bpm)),
      beat: beat.toFixed(2),
      measure: String(this.#transport.measure),
      "input source": this.#provider?.kind ?? "none",
      // A separate row rather than changing what "input source" means: the
      // synthetic path reports `kind: "tuninator"` by design, and quietly
      // redefining an existing readout is the drift this panel exists to catch.
      "input mocked": this.#micMocked ? "yes (synthetic sine)" : "no",
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
      waypoint: attempt
        ? `${attempt.climb.state.waypointIndex + 1}/${attempt.climb.waypointCount}`
        : "—",
      "energy in flight": String(this.#energy?.activeCount ?? 0),
      autoplay: this.#autoplay === "off" ? "off" : `${this.#autoplay} seed ${this.#autoplaySeed}`,
      // What the fake guitarist *intended*. On the synthetic path the
      // recognizer is free to disagree, which is exactly why both this and
      // "perfect/good/miss" are on screen at once.
      "autoplay plan": plan
        ? `${plan.counts.hits} hit / ${plan.counts.wrong} wrong / ` +
          `${plan.counts.dropped} drop / ${plan.counts.noodles} noodle`
        : "—",
      /*
       * A played note with no release grows until it is pruned. Nothing caps it
       * on purpose — a genuinely sustained note *should* grow — so this is the
       * instrument instead of a cap: a number climbing here means a producer
       * stopped emitting note-offs, including real Tuninator dropping a
       * `noteEnded`. It should sit at 0.
       */
      "unreleased played": String(this.#timeline.unreleasedPruned),
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
   * Selects a tier, and makes sure something can actually perform it.
   *
   * Clicking a tier used to be a silent no-op whenever the live microphone was
   * the source — there was no sink, so nothing happened and nothing said so.
   * The rule now is that a mode switches the source **only when the current
   * source cannot be a sink**: a real microphone cannot, and the deterministic
   * test provider very much can.
   *
   * Leaving `?dev=1&input=test` alone is not an oversight. `browser-validate.mjs`
   * drives its whole first run on the test provider and asserts exact outcomes
   * ("three stars for a flawless attempt"); moving it onto real detection would
   * trade a deterministic suite for a flaky one.
   */
  async #setAutoplayMode(mode: AutoplayMode): Promise<void> {
    this.#autoplay = mode;
    this.#debug?.setAutoplayMode(mode);
    this.#cancelAutoplay();
    if (mode === "off" || this.#sourceKind !== "tuninator") return;

    // Before pregame there is no AudioContext, so a switch would only publish
    // an error status. Record the intent and let `#enterPregame` open the
    // synthetic mic on its single provider start instead — which is also the
    // path that avoids tearing down a running recognizer mid-run.
    if (!this.#audio.context) {
      this.#initialInputKind = "synth";
      this.#debug?.setSourceValue("synth");
      return;
    }
    await this.#queueProviderSwitch("synth");
  }

  /**
   * Plans and schedules autoplay for whichever attempts are live.
   *
   * Both `#current` and `#next` are scheduled, and `#next` the moment
   * `#queueNextAttempt` creates it. That is worth the extra bookkeeping: an
   * attempt used to be scheduled only when it was promoted, one
   * `TRANSITION_BEATS` beat before its own beat 0 — 0.43s at 140bpm — so a
   * frame-loop stall could lose the first note of every attempt.
   */
  #syncAutoplay(): void {
    if (this.#autoplay === "off") {
      if (this.#autoplayScheduled.size > 0) this.#cancelAutoplay();
      return;
    }

    /*
     * No sink, nothing to do — and crucially, nothing to *record* either.
     *
     * A tier chosen on the live microphone switches the source asynchronously,
     * so there are frames with a mode set and no sink yet. Marking those
     * attempts as scheduled would leave them permanently marked and silently
     * unplayed, because the plan is only ever built once per attempt.
     */
    const hasSink = this.#micMocked || this.#provider instanceof TestGuitarInputProvider;
    if (!hasSink) return;

    const live = [this.#current, this.#next].filter(
      (attempt): attempt is ActiveAttempt => attempt !== null
    );
    for (const attempt of live) {
      if (this.#autoplayScheduled.has(attempt.timelineKey)) continue;
      const performance = planAutoPerformance({
        targets: attempt.runtime.targets,
        mode: this.#autoplay,
        seed: this.#autoplaySeed,
        attemptIndex: attempt.attemptIndex,
      });
      this.#autoplayScheduled.set(attempt.timelineKey, performance);
      this.#scheduleAutoPerformance(attempt, performance);
    }

    // Drop finished attempts, so the map cannot grow across a 16-slot run.
    const alive = new Set(
      [this.#current, this.#next, this.#previous]
        .filter((attempt): attempt is ActiveAttempt => attempt !== null)
        .map((attempt) => attempt.timelineKey)
    );
    for (const key of this.#autoplayScheduled.keys()) {
      if (!alive.has(key)) this.#autoplayScheduled.delete(key);
    }
  }

  /**
   * Hands one planned performance to whichever fake input is driving.
   *
   * Two sinks, one plan and one piece of timing maths. `TestGuitarInputProvider`
   * takes already-judged discrete events, which is what makes the browser suite
   * deterministic; the synthetic mic takes real sine plucks that Tuninator's
   * own detection has to find, which is what makes the demo honest.
   *
   * Both emit a real note-off. The test path schedules an explicit `release`,
   * without which `TimelineModel.endPlayed` is never called and every played
   * bar grows from its attack to the playhead until it is pruned — the "notes
   * that never stop ringing" this replaces.
   */
  #scheduleAutoPerformance(attempt: ActiveAttempt, performance: AutoPerformance): void {
    const synth = this.#micMocked ? this.#synth : null;
    const testProvider = this.#provider instanceof TestGuitarInputProvider ? this.#provider : null;
    if (!synth && !testProvider) return;

    const secondsPerBeat = this.#transport.secondsPerBeat;
    // The same quantity `#toBeat` subtracts from a detected event, added back
    // so an autoplayed note is judged as landing on the target rather than
    // early. It is also why autoplay hits are kept out of the calibration log.
    const latency = this.#audio.outputLatencySeconds + this.#latencyTrimMs / 1000;
    const earliest = this.#audio.now() + AUTOPLAY_SCHEDULE_LEAD_SECONDS;

    performance.gestures.forEach((gesture: AutoGesture, index: number) => {
      const attackTime =
        this.#transport.contextTimeAt(attempt.runtime.startBeat + gesture.beat) + latency;
      // Already past: `osc.start()` would clamp to now and compress the
      // envelope, and the test provider's queue would fire it out of order.
      if (attackTime <= earliest) return;

      const slotSeconds = gesture.durationBeats * secondsPerBeat;
      if (testProvider) {
        const id = `auto-${attempt.timelineKey}-${index}`;
        testProvider.schedule([
          { at: attackTime, kind: "attack", midi: gesture.midi, id },
          { at: attackTime + slotSeconds, kind: "release", id },
        ]);
        return;
      }

      /*
       * The synthetic pluck has to leave real silence before the next attack:
       * Tuninator ends a Note only after `tracking.releaseGraceMs` of it, and a
       * Note that never ends never becomes a `release`. Take the gap out of the
       * slot, then clamp — the floor is what keeps a fast passage audible at
       * all, at the cost of separation it cannot have.
       */
      const sounding = Math.min(
        AUTOPLAY_PLUCK_MAX_SOUNDING_SECONDS,
        Math.max(AUTOPLAY_PLUCK_MIN_SOUNDING_SECONDS, slotSeconds - AUTOPLAY_PLUCK_GAP_SECONDS)
      );
      synth?.pluck(gesture.midi, attackTime, sounding);
    });
  }

  /** Un-schedules everything both sinks still have pending. */
  #cancelAutoplay(): void {
    this.#autoplayScheduled.clear();
    if (this.#provider instanceof TestGuitarInputProvider) this.#provider.clearSchedule();
    this.#synth?.cancelFrom(this.#audio.now());
  }
}
