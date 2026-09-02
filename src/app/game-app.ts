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
import { BACKBEAT_PATTERN, drumPatternForAttempt } from "../audio/drum-pattern.js";
import { DrumPlayer } from "../audio/drum-player.js";
import { BackingDuck } from "../game/backing-duck.js";
import {
  gateChangesAnything,
  InputGateMeasurement,
  inputGateVerdict,
  shouldAutoApply,
} from "../game/input-gate.js";
import { readInputRmsGate, writeInputRmsGate } from "../persistence/input-gate.js";
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
  BEATS_PER_MEASURE,
  EXTRA_INPUT_LATENCY_MS,
  RUN_LEAD_IN_BEATS,
  TRANSITION_BEATS,
} from "../config/tuning.js";
import { AttemptRuntime, type AttemptEvent } from "../game/attempt.js";
import { RunState, type RunSlot } from "../game/run.js";
import {
  CALIBRATION_BPM,
  CalibrationSession,
  COUNT_IN_BARS,
  MAX_USABLE_SPREAD_MS,
  MIN_SAMPLES,
  TOTAL_BARS,
  type CalibrationState,
} from "../game/calibration.js";
import { offBeatMs, TimingDeltaLog } from "../game/timing-log.js";
import type { GuitarInputEvent, GuitarInputProvider, GuitarInputStatus } from "../input/guitar-input.js";
import { TestGuitarInputProvider } from "../input/test-provider.js";
import { TuninatorGuitarInputProvider } from "../input/tuninator-provider.js";
import { fingeringsForKey, STRING_NAMES, type Fingering } from "../music/fingering.js";
import { keyDisplayName, keyShortName, parseKeyName, type RunKey } from "../music/keys.js";
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
import { DebugPanel } from "../ui/debug-panel.js";
import { EnergyLayer } from "../ui/energy-layer.js";
import { FrameMeter } from "../ui/frame-meter.js";
import { renderFingeringDiagram } from "../ui/fingering-diagram.js";
import { ScenarioBackdropView, type BackdropPanel } from "../ui/scenario-backdrop.js";
import { trophyLabel, trophySvg } from "../ui/trophy.js";
import type { ActorSprites } from "../ui/timeline/actor-layer.js";
import { requireMinigame } from "../minigame/registry.js";
import type { RepeatVisualState } from "../scenario/minigames/repeat-minigame.js";
import type { TimelineActorState } from "../scenario/minigames/timeline-actor.js";
import { NO_REPEAT_SPRITES } from "../ui/timeline/repeat-layer.js";
import { TimelineModel } from "../ui/timeline/timeline-model.js";
import { OVERLAY_BAND_FRACTION, TimelineView } from "../ui/timeline/timeline-view.js";


type Screen = "start" | "calibrate" | "pregame" | "game" | "results";

type Setup = {
  key: RunKey;
  tempoId: TempoId;
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

/**
 * What the timing check says about what it found.
 *
 * The two numbers answer different questions and the copy has to keep them
 * apart, because the player's real question — "is that me or is that the
 * game?" — is exactly the confusion this screen exists to resolve. The offset
 * is their rig and their feel together; the spread is only them, and it is what
 * decides whether the offset can be trusted at all.
 */
function calibrationVerdict(state: CalibrationState): string {
  if (state.phase !== "done") {
    return "The offset is your rig and your feel together. The consistency is just you — it says whether the offset can be trusted.";
  }
  if (state.samples < MIN_SAMPLES) {
    return `Only ${state.samples} notes came through. Play one on every click — and check the guitar is actually being heard.`;
  }
  if (!state.usable) {
    return `Your notes were spread ±${Math.round(state.spreadMs ?? 0)} ms, which is too loose for the middle of them to mean anything yet. Nothing is wrong with your playing — this needs an even run to measure against, so try once more and aim for steady rather than right.`;
  }
  if (!state.worthApplying) {
    return "You are already inside 10 ms of the beat. Nothing to change — if the game still feels off, it is not this.";
  }
  const late = (state.offsetMs ?? 0) >= 0;
  return (
    `You play ${Math.abs(Math.round(state.offsetMs ?? 0))} ms ${late ? "after" : "before"} the click, ` +
    `steadily to within ±${Math.round(state.spreadMs ?? 0)} ms. Applying it moves judgment ` +
    `${late ? "later" : "earlier"} by that much, so the notes you feel are on time are scored that way.`
  );
}

/**
 * Writes text only when it changed.
 *
 * The check's readouts are repainted every frame while its screen is up, and
 * almost every frame they are identical. Assigning `textContent` regardless
 * dirties the node and buys a style recalculation for nothing.
 */
function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element instanceof HTMLElement && element.textContent !== value) {
    element.textContent = value;
  }
}

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
  /**
   * How far the backing has stepped out of the player's way. See
   * `game/backing-duck.ts`: it is reset per attempt, so one object outlives
   * every attempt rather than being rebuilt with each.
   */
  readonly #duck = new BackingDuck();
  /**
   * What the player's rig actually sounds like. Fed from every pitch frame,
   * including the ones Tuninator gated — which is the whole point, because a
   * player whose notes are all being rejected is exactly who needs this.
   */
  readonly #inputGate = new InputGateMeasurement();
  #inputRmsGate: number | null = readInputRmsGate();
  /**
   * Whether automatic calibration has had its go this session.
   *
   * Set by the automatic pass itself and by either button, so a player who
   * takes the wheel keeps it. See `#maybeAutoCalibrateInput`.
   */
  #autoGateDone = false;
  /** The gate this session set on its own, for the readout to own up to. */
  #autoGateApplied: number | null = null;
  #drums: DrumPlayer | null = null;
  #bassLine: BassLine | null = null;
  /** Which beat the kit is currently playing. See `#refreshDrumBeat`. */
  #drumPatternId = "";

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
  /** How many recognizers this session has stood up. See `#switchProvider`. */
  #providerBuilds = 0;
  #unsubscribeInput: (() => void)[] = [];
  #inputStatus: GuitarInputStatus | null = null;
  /**
   * The player's own latency compensation, on top of what the browser reports.
   * Seeded from a previous session's calibration; `EXTRA_INPUT_LATENCY_MS` is
   * the default for a rig that has never been measured.
   */
  #latencyTrimMs = readLatencyTrimMs() ?? EXTRA_INPUT_LATENCY_MS;
  readonly #timing = new TimingDeltaLog();
  /** The timing check in progress, or null when that screen is idle. */
  #calibration: CalibrationSession | null = null;

  /* Game state ------------------------------------------------------- */
  #screen: Screen = "start";
  #setup: Setup = {
    key: pickWeightedKey(),
    tempoId: DEFAULT_TEMPO_ID,
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
  readonly #frameMeter = new FrameMeter();
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
  #devLevel: number | null = null;
  #devScenarioId: string | null = null;
  /** `?dev=1&calibrateOffsetMs=N`. See `#scheduleCalibrationAutoplay`. */
  #devCalibrateOffsetMs: number | null = null;
  /**
   * `?dev=1&playOffsetMs=N`: autoplay plays the whole run N ms out of time.
   *
   * A player whose rig is uncompensated is off by the *same* amount on every
   * note, and to them they are dead on the beat. That is a completely different
   * input from the autoplay tiers, which model a player who is on time and
   * fumbles a share of their notes — and it is the input nothing in this
   * repository could produce, which is why judgment collapsing under a
   * systematic offset (DECISION-038) shipped without a single test going red.
   */
  #devPlayOffsetMs = 0;
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
    // The timeline is drawn over the scenario rather than beside it.
    // `?overlay=0` gives the two-pane layout back, which is what the A/B was
    // run on before the overlay became the default.
    this.#overlayTimeline = params.get("overlay") !== "0";
    this.#applySetupParams(params);

    this.#pregameView = new TimelineView(
      must("pregame-canvas", HTMLCanvasElement),
      this.#setup.key,
      this.#overlayTimeline
    );
    this.#gameView = new TimelineView(
      must("game-canvas", HTMLCanvasElement),
      this.#setup.key,
      this.#overlayTimeline
    );
    /*
     * The note-art seam, and the last thing the host decides about a look.
     *
     * Placement stays here — the view computes every rect and the minigame is
     * handed them read-only — so a skin can dress a note but never move, resize
     * or hide one. Which attempt is asked is decided by its timeline key rather
     * than by "the current one": two are on the timeline at once across a
     * transition, and each must be skinned by the minigame that owns it.
     *
     * Pregame gets no source at all. There is no attempt yet, so there is
     * nothing whose look a scenario could own.
     */
    this.#gameView.setStageSource(this.#assets, (attemptKey, view) => {
      const attempt = [this.#current, this.#next, this.#previous].find(
        (entry) => entry?.timelineKey === attemptKey
      );
      return attempt?.runtime.minigame.render(view) ?? null;
    });

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
    for (const id of ["start", "calibrate", "pregame", "game", "results"] as const) {
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

    // A nudge, not a gate. A player whose rig is fine should not be made to sit
    // through a check to reach the game, but a player whose rig is 200ms out
    // will otherwise spend a run blaming their hands.
    const state = document.getElementById("start-calibration-state");
    if (state instanceof HTMLElement) {
      const stored = readLatencyTrimMs();
      state.textContent =
        stored === null
          ? "Timing not measured yet — the check takes about 20 seconds."
          : `Timing measured: ${stored >= 0 ? "+" : "−"}${Math.abs(stored)} ms of your own.`;
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
    must("start-calibrate", HTMLButtonElement).addEventListener("click", () => {
      void this.#enterCalibration();
    });
    must("calibrate-start", HTMLButtonElement).addEventListener("click", () =>
      this.#startCalibrationRun()
    );
    must("calibrate-apply", HTMLButtonElement).addEventListener("click", () =>
      this.#applyCalibrationResult()
    );
    must("calibrate-back", HTMLButtonElement).addEventListener("click", () =>
      this.#leaveCalibration()
    );
    must("pregame-reroll", HTMLButtonElement).addEventListener("click", () => this.#reroll());
    // Both handlers end automatic calibration for the session: once the player
    // has said what they want, this stops having opinions.
    must("pregame-input-apply", HTMLButtonElement).addEventListener("click", () => {
      const recommended = this.#inputGate.state.recommended;
      if (recommended === null) return;
      this.#autoGateDone = true;
      this.#autoGateApplied = null;
      this.#applyInputGate(recommended);
    });
    must("pregame-input-reset", HTMLButtonElement).addEventListener("click", () => {
      this.#autoGateDone = true;
      this.#autoGateApplied = null;
      this.#applyInputGate(null);
    });
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
      onLatencyChange: (ms) => this.#setLatencyTrim(ms),
      onAutoplay: (mode) => {
        void this.#setAutoplayMode(mode);
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

    // `?calibrateOffsetMs=N` fakes a player N ms off the click on the timing
    // check. Dev-only, and separate from the autoplay tiers on purpose — see
    // `#scheduleCalibrationAutoplay`.
    const calibrateOffset = Number(params.get("calibrateOffsetMs"));
    if (this.#devMode && params.has("calibrateOffsetMs") && Number.isFinite(calibrateOffset)) {
      this.#devCalibrateOffsetMs = calibrateOffset;
    }

    // `?playOffsetMs=N` shifts every autoplayed note by N ms, so a rig with
    // uncompensated latency can be played back without a rig. Positive is late.
    const playOffset = Number(params.get("playOffsetMs"));
    if (this.#devMode && params.has("playOffsetMs") && Number.isFinite(playOffset)) {
      this.#devPlayOffsetMs = playOffset;
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

    // First thing after the unlock, because it is the only thing here the
    // player is actually waiting on. Opening the mic means `getUserMedia` and
    // then fetching a worklet, and nothing can be measured about their level
    // until frames start arriving — so it is started now and awaited at the
    // end, overlapping with building the backing rather than queueing behind
    // it. This is the earliest a browser will let a microphone open at all:
    // everything before it is the same user gesture.
    const inputReady = this.#queueProviderSwitch(this.#initialInputKind);

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
    // Pregame has no attempt, so this lands on the bare pulse — which is what a
    // fresh `DrumPlayer` plays anyway. Stated rather than left implicit so the
    // recorded pattern id matches what is actually sounding: the id is the
    // guard `#refreshDrumBeat` uses, and one that disagrees with the kit would
    // skip the first real beat change of a run.
    this.#refreshDrumBeat();
    this.#regenerateBass();
    this.#bass?.start();
    this.#drums?.start();

    this.#pregameView?.setShowFingeringLabels(true);
    this.#gameView?.setShowFingeringLabels(false);
    this.#updateKeyReadouts();

    await inputReady;
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
    if (this.#transport.running) this.#setBpm(tempoById(tempoId).bpm);
  }

  /**
   * Changes tempo without stopping the beat.
   *
   * Phase-preserving: the loop keeps its place, only the rate changes — and
   * everything already queued against the old rate has to be dealt with. The
   * players re-time their tails; autoplay's gestures cannot be re-timed at all,
   * because `setBpm` re-anchors the transport and every audio-clock time they
   * were given now points at the wrong beat, so they are dropped and replanned.
   *
   * One place, because forgetting any of the three is a bug you hear rather
   * than see.
   */
  #setBpm(bpm: number): void {
    this.#transport.setBpm(bpm);
    this.#bass?.retime();
    this.#drums?.retime();
    this.#cancelAutoplay();
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
  #queueProviderSwitch(
    kind: "tuninator" | "test" | "synth",
    options: { force?: boolean } = {}
  ): Promise<void> {
    this.#providerSwitch = this.#providerSwitch.then(() =>
      this.#switchProvider(kind, options.force ?? false)
    );
    return this.#providerSwitch;
  }

  /**
   * `force` rebuilds a recognizer that is already the right kind and healthy.
   *
   * Only one caller needs it, and it is the reason this parameter exists: the
   * amplitude gate is a *construction-time* option, so changing it means
   * standing a new recognizer up. Without this the guard below saw "already on
   * tuninator, still listening" and returned, and a measured gate was stored,
   * displayed, and never handed to Tuninator until the next page load.
   */
  async #switchProvider(kind: "tuninator" | "test" | "synth", force = false): Promise<void> {
    if (kind !== "tuninator" && !this.#devMode) {
      // Belt and braces: neither dev source must be reachable in normal play,
      // whatever calls this.
      console.warn(`[goaterizer] refusing to use ${kind} input outside dev mode`);
      return;
    }

    // Already on it and working: do not tear down a healthy recognizer just to
    // build the same one again. A provider that errored is retried.
    if (
      !force &&
      kind === this.#sourceKind &&
      this.#provider &&
      this.#provider.getStatus().state !== "error"
    ) {
      return;
    }

    // Anything queued was timed against the provider that is about to go away.
    this.#cancelAutoplay();
    // Levels measured through one source say nothing about another: a dev sine
    // and a real guitar must never end up averaged into the same rig. A forced
    // rebuild of the *same* source keeps its measurement, because it is still
    // the same input — `#applyInputGate` clears it deliberately instead.
    if (kind !== this.#sourceKind) this.#inputGate.reset();

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
    // Counted because a rebuild is otherwise invisible: on a second open the
    // mic permission and the worklet module are both already cached, so the
    // recognizer can go from `starting` back to `listening` inside a single
    // animation frame and no readout ever shows the transition. A gate only
    // takes effect by construction, so "did it get built again" is the
    // question, and a transient state is the wrong place to ask it.
    this.#providerBuilds += 1;
    this.#provider =
      kind === "test"
        ? new TestGuitarInputProvider()
        : new TuninatorGuitarInputProvider({
            audioContext: context as AudioContext,
            // Undefined unless the player has measured their rig, in which case
            // Tuninator's own default stands.
            ...(this.#inputRmsGate !== null ? { rmsGate: this.#inputRmsGate } : {}),
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
    if (status.frame) this.#inputGate.observe(status.frame.rms);
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
        else if (this.#screen === "calibrate") this.#calibration?.note(beat);
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
  /* The timing check                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Opens the timing check: audio, a click, a microphone, and nothing else.
   *
   * Deliberately *not* the pregame calibration's environment. Pregame has a
   * bass loop over the click and tells the player to noodle, so a note played
   * there is as likely to be aimed at the music as at the beat. Here the
   * backing is the bare quarter pulse — the same accented pulse a run plays
   * over, so what is calibrated is what will be played against — and the only
   * instruction is one note per click.
   */
  async #enterCalibration(): Promise<void> {
    this.#showScreen("calibrate");
    const unlocked = await this.#audio.unlock();
    if (!unlocked) {
      this.#setCalibrationPhase(this.#audio.failure ?? "Audio could not start.");
      return;
    }

    // The check pins its own tempo, whatever the player picked for their run:
    // a fixed reference keeps the number comparable between sessions, and the
    // fold-over headroom becomes a known quantity rather than a setting.
    if (!this.#transport.running) this.#transport.start(CALIBRATION_BPM);
    else this.#setBpm(CALIBRATION_BPM);

    const context = this.#audio.context;
    const master = this.#audio.master;
    if (context && master && !this.#drums) {
      this.#drums = new DrumPlayer(context, this.#transport, master);
    }
    // No bass. It is a musical loop, and a player will phrase against it.
    this.#bass?.stop();
    this.#refreshDrumBeat();
    this.#drums?.start();

    this.#calibration = null;
    this.#renderCalibration();
    // Through the queue, like every other caller: the switch disposes and
    // reopens the recognizer, and the check is now a third way to reach it.
    await this.#queueProviderSwitch(this.#initialInputKind);
  }

  /** Leaves the check and restores the tempo the player actually chose. */
  #leaveCalibration(): void {
    this.#calibration = null;
    if (this.#transport.running) this.#setBpm(tempoById(this.#setup.tempoId).bpm);
    this.#showScreen("start");
    this.#buildStartScreen();
  }

  /** Begins a run of the check on the next bar line, so the count-in counts. */
  #startCalibrationRun(): void {
    if (!this.#transport.running) return;
    const startBeat = this.#transport.nextMeasureBoundary(this.#heardBeat);
    this.#calibration = new CalibrationSession(startBeat, this.#transport.secondsPerBeat);
    this.#scheduleCalibrationAutoplay(startBeat);
    this.#renderCalibration();
  }

  /**
   * Dev-only: plays the check for you, one note per beat, a known amount off.
   *
   * `?dev=1&calibrateOffsetMs=N` simulates a player whose notes land N ms from
   * the click. It deliberately does **not** reuse the autoplay tiers: those
   * describe what share of the *targets* a fake guitarist takes, and the check
   * has no targets — it has a beat grid and a question about timing. Reading
   * "25%" as "12ms late" would be inventing a meaning the mode does not have.
   *
   * This is how the check is testable at all without a guitar in the room, and
   * it makes the round trip assertable in both directions: at an offset of 0
   * the check must find nothing to change, and at 40 it must find 40. If it
   * reported something else for a player who is off by construction, the
   * measurement is wrong.
   */
  #scheduleCalibrationAutoplay(startBeat: number): void {
    const offsetMs = this.#devCalibrateOffsetMs;
    if (offsetMs === null) return;
    const testProvider =
      this.#provider instanceof TestGuitarInputProvider ? this.#provider : null;
    const synth = this.#micMocked ? this.#synth : null;
    if (!testProvider && !synth) return;

    const secondsPerBeat = this.#transport.secondsPerBeat;
    // The same quantity `#toBeat` subtracts from a detected event, added back,
    // so an offset of zero really is a player who is dead on.
    const latency = this.#latencySeconds;
    const sounding = Math.max(0.12, secondsPerBeat * 0.6);
    const midi = 40; // Open low E: one string, no left hand, like the instructions.

    for (
      let beat = COUNT_IN_BARS * BEATS_PER_MEASURE;
      beat < TOTAL_BARS * BEATS_PER_MEASURE;
      beat += 1
    ) {
      const at =
        this.#transport.contextTimeAt(startBeat + beat) + offsetMs / 1000 + latency;
      if (testProvider) {
        // With a release, like every other injected note: without one the bar
        // grows from its attack to the playhead until it prunes.
        const id = `cal-${beat}`;
        testProvider.schedule([
          { at, kind: "attack", midi, id },
          { at: at + sounding, kind: "release", id },
        ]);
      } else {
        synth?.pluck(midi, at, sounding);
      }
    }
  }

  /** Adopts the measured offset. The check itself never applies silently. */
  #applyCalibrationResult(): void {
    const state = this.#calibration?.state;
    if (!state?.usable || state.offsetMs === null) return;
    const next = this.#latencyTrimMs + state.offsetMs;
    this.#setLatencyTrim(Math.max(-MAX_LATENCY_TRIM_MS, Math.min(MAX_LATENCY_TRIM_MS, next)));
    // The session described the rig as it was before this change, so it is now
    // stale by exactly the amount just applied. Clearing it makes "Start" mean
    // "measure again against the new setting", which is the verification pass.
    this.#calibration = null;
    this.#renderCalibration();
  }

  #setCalibrationPhase(text: string): void {
    setText("calibrate-phase", text);
  }

  /**
   * Paints the check.
   *
   * Everything here changes at most once per bar. Nothing on this screen may
   * move on the beat: a visual pulse is a second cue, and a player given two
   * cues splits the difference between them — which would make the measurement
   * a blend of their audio offset and their visual one rather than the audio
   * offset the judge actually compensates.
   */
  #renderCalibration(): void {
    const state = this.#calibration?.state ?? null;
    const offset = document.getElementById("calibrate-offset");
    const spread = document.getElementById("calibrate-spread");
    const apply = document.getElementById("calibrate-apply");
    const start = document.getElementById("calibrate-start");

    const reported = Math.round(this.#audio.outputLatencySeconds * 1000);
    setText(
      "calibrate-current",
      `Currently compensating ${reported + this.#latencyTrimMs} ms ` +
        `(${reported} reported by the browser, ${this.#latencyTrimMs} yours).`
    );

    if (!state) {
      this.#setCalibrationPhase("Ready when you are.");
      setText("calibrate-progress", "\u00a0");
      setText("calibrate-offset", "—");
      setText("calibrate-spread", "—");
      if (apply instanceof HTMLButtonElement) apply.disabled = true;
      if (start instanceof HTMLButtonElement) start.textContent = "Start";
      return;
    }

    // Bars as dots: one glyph per bar, filled as it passes. It updates once
    // every 2.7 seconds, which is far too coarse to play to.
    setText(
      "calibrate-progress",
      "●".repeat(state.bar) + "○".repeat(Math.max(0, TOTAL_BARS - state.bar))
    );

    switch (state.phase) {
      case "countIn":
        this.#setCalibrationPhase("Listen…");
        break;
      case "warmUp":
        this.#setCalibrationPhase("Play along — this bar is a warm-up");
        break;
      case "measuring":
        this.#setCalibrationPhase(`Keep going — ${state.samples} notes`);
        break;
      case "done":
        this.#setCalibrationPhase(state.usable ? "Done" : "Not enough to go on");
        break;
    }

    setText(
      "calibrate-offset",
      state.offsetMs === null
        ? "—"
        : `${state.offsetMs >= 0 ? "+" : "−"}${Math.abs(Math.round(state.offsetMs))} ms`
    );
    setText(
      "calibrate-spread",
      state.spreadMs === null ? "—" : `±${Math.round(state.spreadMs)} ms`
    );
    if (offset instanceof HTMLElement) offset.dataset["state"] = state.usable ? "good" : "";
    if (spread instanceof HTMLElement) {
      spread.dataset["state"] = state.spreadMs === null ? "" : state.usable ? "good" : "warn";
    }

    setText("calibrate-verdict", calibrationVerdict(state));
    if (apply instanceof HTMLButtonElement) {
      apply.disabled = !(state.phase === "done" && state.worthApplying);
    }
    if (start instanceof HTMLButtonElement) {
      start.textContent = state.phase === "done" ? "Again" : "Restart";
    }
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
    // Without this, a replay inherits the previous run's queued plucks.
    this.#cancelAutoplay();
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
    this.#resetDuck();
    this.#refreshDrumBeat();
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
      return;
    }
    this.#next = this.#createAttempt(run.nextSlot, current.runtime.endBeat + TRANSITION_BEATS);
  }

  /**
   * Points the kit at the beat of the minigame being played.
   *
   * One beat per minigame, chosen from its difficulty and the feel of its own
   * notes (`audio/drum-pattern.ts`). Deliberately *only* the current attempt:
   * this used to mark the union of the current and next attempt's grids so a
   * sixteenth run announced itself a minigame early, and that look-ahead is
   * gone — the beat now describes the exercise in hand rather than trailing the
   * next one, which is also why this is called where `#current` changes and no
   * longer from `#queueNextAttempt`.
   *
   * With no attempt — pregame, the timing check, the end of a run — the bare
   * pulse plays, which is the same four-beat skeleton every rung is built on.
   *
   * Guarded on the pattern's id: `setPattern` throws away and re-schedules the
   * queued tail, so calling it when the beat has not actually changed would
   * restate the kit at every transition.
   */
  #refreshDrumBeat(): void {
    const attempt = this.#current;
    const pattern = attempt
      ? drumPatternForAttempt(attempt.runtime.difficulty, attempt.runtime.level.prompt)
      : BACKBEAT_PATTERN;
    if (pattern.id === this.#drumPatternId) return;

    this.#drumPatternId = pattern.id;
    this.#drums?.setPattern(pattern);
  }

  #onAttemptEvent(attempt: ActiveAttempt, event: AttemptEvent): void {
    switch (event.type) {
      case "judgment": {
        const judgment = event.judgment;
        // The backing bass steps back when the player is missing and comes
        // back as they recover. Applied for every judgment rather than only
        // the ones that move the ladder: `apply` returns the gain in force
        // either way, and `setDuck` ignores a value it is already at, so this
        // needs no branching and cannot drift out of step with the ladder.
        this.#bass?.setDuck(this.#duck.apply(judgment));
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
    // A new minigame starts on a full band. Carrying the previous attempt's
    // duck across would tell the player something untrue about the notes in
    // front of them.
    this.#resetDuck();
    this.#refreshDrumBeat();
    this.#timeline.removeTargets(attempt.timelineKey);
    if (!this.#current) {
      this.#finishRun("content-limit");
      return;
    }
    this.#queueNextAttempt();
  }

  /** Full band again: the ladder and the gain it drives, together. */
  #resetDuck(): void {
    this.#duck.reset();
    this.#bass?.setDuck(1);
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
    // The run is over; anything still queued belongs to an attempt that will
    // never be judged, and would play over the results screen.
    this.#cancelAutoplay();
    // Back to the bare pulse: there is no upcoming phrase to warn about.
    this.#refreshDrumBeat();

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

  /**
   * One frame, on `requestAnimationFrame` and nothing else.
   *
   * Uncapped on purpose: rAF fires at the display's refresh rate, so a 120Hz or
   * 144Hz panel gets 120 or 144 frames a second rather than a self-imposed 60.
   * Nothing here throttles, and nothing may — a rhythm game's read-ahead is a
   * moving object, and the smoothness of that motion is what the player judges
   * their own timing against.
   *
   * The frame is also free to be *skipped*: every position is derived from the
   * transport (`#heardBeat`), never accumulated, so a dropped frame moves
   * nothing and a slow machine plays the same game more coarsely rather than a
   * different one.
   */
  #frame(): void {
    this.#frameMeter.begin(performance.now());
    try {
      this.#tick();
    } catch (error) {
      console.error("[goaterizer] frame failed", error);
    }
    this.#frameMeter.end(performance.now());
    requestAnimationFrame(() => this.#frame());
  }

  #tick(): void {
    if (!this.#transport.running) return;
    // Everything below runs on the beat the player is hearing, never the beat
    // being scheduled. See `#heardBeat`.
    const beat = this.#heardBeat;

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

    if (this.#screen === "calibrate") {
      this.#calibration?.update(beat);
      this.#renderCalibration();
    } else if (this.#screen === "pregame") {
      this.#pregameView?.render(this.#timeline, beat);
      this.#updatePregameReadouts();
    } else if (this.#screen === "game") {
      // The attempt's own minigame says what its layer needs; the host does not
      // look at scenario data to find out. `prototypeLayer` is the last place a
      // family is named here and goes when the actors move into `Stage`.
      const attempt = this.#current?.runtime;
      const layer = attempt?.minigame.prototypeLayer?.() ?? null;
      const images = (layer?.sprites ?? [])
        .map((id) => this.#assets.get(id))
        .filter((image): image is HTMLImageElement => image !== null);

      this.#gameView?.setActor(
        layer?.kind === "actor" ? (layer.state as TimelineActorState) : null,
        attempt ? attempt.toAttemptBeat(beat) : 0
      );
      this.#gameView?.setActorSprites(layer?.kind === "actor" ? { poses: images } : EMPTY_SPRITES);
      this.#gameView?.setRepeat(
        layer?.kind === "repeat" ? (layer.state as RepeatVisualState) : null
      );
      this.#gameView?.setRepeatSprites(
        layer?.kind === "repeat"
          ? { can: images[0] ?? null, crushed: images[1] ?? null }
          : NO_REPEAT_SPRITES
      );
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
    // Before the readout, so the frame that decides also shows the decision.
    this.#maybeAutoCalibrateInput();
    this.#updateInputLevelReadouts();
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
  /**
   * What the rig sounds like, and whether the detector is listening below it.
   *
   * Levels are shown as a *ratio* rather than as raw RMS, because the ratio is
   * the thing that decides whether a note can be found and the raw number means
   * nothing to a guitarist. The channel line only appears when there is more
   * than one, and it is there because an instrument in input 2 lands entirely
   * on channel 1 — a case that otherwise looks exactly like a dead detector.
   */
  #updateInputLevelReadouts(): void {
    const state = this.#inputGate.state;
    // Against the gate actually in force, not against Tuninator's default:
    // after a gate has been applied, `worthApplying` stays true forever and
    // would leave the button offering to set the value it already set.
    const changes = gateChangesAnything(state.recommended, this.#inputRmsGate);

    const level = document.getElementById("pregame-input-level");
    if (level instanceof HTMLElement) {
      const frame = this.#inputStatus?.frame;
      const channels =
        frame?.channelRms && frame.channelRms.length > 1
          ? ` — channels ${frame.channelRms.map((v) => v.toFixed(3)).join(" / ")}` +
            `, reading ${frame.selectedChannel === null || frame.selectedChannel === undefined ? "both" : frame.selectedChannel + 1}`
          : "";
      level.textContent =
        state.playingLevel === null
          ? `Listening — ${state.floorFrames} frames of your input so far${channels}`
          : state.headroom === null
            ? `Well clear of a silent input${channels}`
            : `${Math.round(state.headroom)}x your background noise${channels}`;
    }

    const verdict = document.getElementById("pregame-input-verdict");
    if (verdict instanceof HTMLElement) {
      // A gate that is in force and that this measurement does not want to move
      // is a settled state, and saying what it is beats re-running the advice
      // that produced it. Otherwise the measurement speaks for itself.
      verdict.textContent =
        this.#inputRmsGate !== null && !changes
          ? this.#autoGateApplied !== null
            ? `Set to your playing automatically — the detector now listens down to ${this.#inputRmsGate.toFixed(4)}. Reset puts it back.`
            : `Using your measured level (${this.#inputRmsGate.toFixed(4)}).`
          : inputGateVerdict(state);
    }

    const apply = document.getElementById("pregame-input-apply");
    if (apply instanceof HTMLButtonElement) apply.disabled = !changes;
  }

  /** Stores a measured gate and restarts the recognizer so it takes effect. */
  #applyInputGate(gate: number | null): void {
    this.#inputRmsGate = gate;
    writeInputRmsGate(gate);
    // The old numbers were measured through the old gate. They are still true
    // about the rig, but the readout beside them is about to describe a
    // different recognizer, so the honest thing is to measure again.
    this.#inputGate.reset();
    this.#updateInputLevelReadouts();
    // The gate is a construction-time option, so the recognizer has to be
    // rebuilt. Routed through the same switch the dev panel uses, which already
    // knows how to tear one down and stand another up without stopping the beat
    // — forced, because it is the same source and the guard would otherwise
    // keep the recognizer that still has the old gate. `#sourceKind`, not
    // `#providerKind`: the latter reports "tuninator" for the synthetic mic and
    // would silently swap a dev source for a real one.
    this.#queueProviderSwitch(this.#sourceKind, { force: true });
  }

  /**
   * Sets the gate from the player's own playing, without being asked once.
   *
   * The request was for the level to calibrate itself, so a button the player
   * has to find is a fallback rather than the feature. This runs on the pregame
   * frame — the only screen where rebuilding the recognizer costs nothing,
   * because no attempt is in flight — and at most once per session.
   *
   * Any manual use of either button ends it for the session. That is what makes
   * Reset mean something: without it, putting the gate back would be undone by
   * this on the very next frame.
   */
  #maybeAutoCalibrateInput(): void {
    if (this.#autoGateDone || this.#inputRmsGate !== null) return;
    const state = this.#inputGate.state;
    if (!shouldAutoApply(state) || state.recommended === null) return;
    this.#autoGateDone = true;
    this.#autoGateApplied = state.recommended;
    this.#applyInputGate(state.recommended);
  }

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
    // that it describes a rig rather than a player still warming up.
    //
    // The threshold is absolute, not a ratio against the offset: "spread
    // smaller than the offset" sounds reasonable and is wrong at the one place
    // it matters, because a perfectly compensated rig has an offset near zero
    // and would be told to keep playing forever.
    const usable =
      this.#timing.count >= MIN_SAMPLES &&
      median !== null &&
      spread !== null &&
      spread <= MAX_USABLE_SPREAD_MS;

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
      // The player's own rig, in the numbers that decide whether a note can be
      // found at all: their noise, their notes, and where the gate sits.
      "input floor/level": (() => {
        const g = this.#inputGate.state;
        return g.playingLevel === null
          ? `${g.noiseFloor?.toFixed(5) ?? "—"} / —`
          : `${g.noiseFloor!.toFixed(5)} / ${g.playingLevel.toFixed(5)} (${g.headroom === null ? "clean" : Math.round(g.headroom) + "x"})`;
      })(),
      "input gate": `${this.#inputRmsGate?.toFixed(5) ?? "default"}${
        this.#inputGate.state.recommended !== null
          ? ` → ${this.#inputGate.state.recommended.toFixed(5)}`
          : ""
      }${this.#autoGateApplied !== null ? " (auto)" : ""}`,
      // Total frames, not the window's occupancy: this is the row that answers
      // "has it been listening since the mic opened", which is a different
      // question from "what is it measuring right now".
      "input frames": String(this.#inputGate.frames),
      "input builds": String(this.#providerBuilds),
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
      // Which beat is playing and how far the bass has stepped back: both are
      // things you can hear but not see, so the panel is where you check that
      // what you are hearing is what the code thinks it is playing.
      "drum beat": this.#drumPatternId || "—",
      "bass duck": `${this.#duck.gain.toFixed(2)} (${this.#duck.misses} missed)`,
      // Whatever the family playing right now thinks is worth watching. The
      // panel does not know a can from a streak; the module says.
      ...(attempt?.debugRows ?? {}),
      // Frame rate and *our share of it*, separately: a low rate beside a tiny
      // work figure is the paint, not the JavaScript, and they are fixed in
      // different places. See `ui/frame-meter.ts`.
      fps: this.#frameMeter.fps?.toFixed(0) ?? "—",
      "frame work ms": this.#frameMeter.workMs?.toFixed(2) ?? "—",
      "worst frame ms": this.#frameMeter.worstIntervalMs?.toFixed(1) ?? "—",
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
      // Three facts that together say whether the scenario art can possibly be
      // seen. They disagree only when something is wrong, and each failure mode
      // looks identical from the outside: a black timeline with grey lane bands.
      overlay: `view ${this.#gameView?.overlay ?? "?"} / dom ${
        document.getElementById("screen-game")?.dataset["overlay"] ?? "?"
      }`,
      backdrop: (() => {
        const scenario = this.#current?.runtime.scenario;
        const id = scenario
          ? requireMinigame(scenario.minigameId, "debug").backgroundId(scenario.config)
          : null;
        if (!id) return "—";
        return `${id} ${this.#assets.get(id) ? "loaded" : "MISSING"}`;
      })(),
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
        this.#transport.contextTimeAt(attempt.runtime.startBeat + gesture.beat) +
        latency +
        this.#devPlayOffsetMs / 1000;
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
