/**
 * CLIMB — the Scale family, as a registered minigame module.
 *
 * Owns everything about this family that the host used to know: which asset
 * slots it binds, what its level data means, what a judged note does to it, and
 * what is painted on its measures. `AttemptRuntime` and `load.ts` no longer
 * mention a climber, a foothold or a route.
 *
 * The actor's motion is still `TimelineActor`, unchanged — it is main's, it is
 * tuned, and the point of this change is to own it rather than rewrite it.
 * What moves here is the *decision* logic: which lane it lands on, and when it
 * falls. That used to be `AttemptRuntime.#driveActor`.
 *
 * Pure. It parses data, keeps state and answers with a {@link Stage} of asset
 * ids; it never touches a canvas, a clock or an asset store.
 */

import {
  MINIGAME_API_VERSION,
  type AttemptContext,
  type Judged,
  type Minigame,
  type MinigameModule,
  type NoteArt,
  type Stage,
  type StageView,
} from "../../minigame/api.js";
import { arr, num, obj, ScenarioDataError, str, strings } from "../parse.js";
import { TimelineActor, type TimelineActorState } from "./timeline-actor.js";

/** Wider than the bar it sits under, so a run of footholds reads as one face. */
const CRAG_SCALE = 1.55;
/** Ahead of the climber the ridge is implied; behind it, solid. */
const CRAG_FADED = 0.4;
const CRAG_SOLID = 1;

export type ClimbConfig = {
  background: string;
  climberPoses: readonly string[];
  finishPose: string;
  waypointVisuals: readonly string[];
  destinationVisual: string;
  stepEffects: readonly string[];
  /** The two ids this family paints its note bars with. */
  footholdArt: { body: string; crag: string };
  badNotePolicy: "Wobble" | "Stall";
};

export type ClimbLevel = {
  visualSpanMeasures: number;
  resetBetweenMeasures: boolean;
};

/**
 * The note-bar art ids, derived from the scenario id rather than authored.
 *
 * The same convention the other ten slots follow. It lives here because which
 * art a family needs is the family's answer — that is what
 * {@link MinigameModule.assetIds} exists to say — and deriving it means a new
 * Rocky scenario binds nothing extra to get its ledges.
 */
export function climbNoteArtIds(scenarioId: string): { body: string; crag: string } {
  return { body: `note_${scenarioId}_ledge`, crag: `note_${scenarioId}_crag` };
}

class ClimbMinigame implements Minigame {
  readonly #config: ClimbConfig;
  readonly #actor = new TimelineActor();
  /** Attempt-relative start beat per opportunity, for the actor's own clock. */
  readonly #opportunities: AttemptContext["opportunities"];
  /** How far along the phrase the climb has got, for the ridge's fill-in. */
  #reached = -1;

  constructor(config: ClimbConfig, context: AttemptContext) {
    this.#config = config;
    this.#opportunities = context.opportunities;
  }

  /** The actor's state, for the layer that still draws it. */
  get actor(): TimelineActorState {
    return this.#actor.state;
  }

  /**
   * Lands on the **target's** lane, never the played pitch.
   *
   * `timeline-actor.ts` explains why that distinction keeps a single mistake
   * from ending a run. A wrong note kills the actor without moving it anywhere.
   * This was `AttemptRuntime.#driveActor`.
   */
  onJudged(judged: Judged): void {
    const target =
      judged.opportunityIndex === null ? null : this.#opportunities[judged.opportunityIndex];
    switch (judged.outcome) {
      case "perfect":
      case "good":
        if (!target) return;
        this.#reached = Math.max(this.#reached, target.index);
        this.#actor.land(target.lane, target.startBeat);
        break;
      case "miss":
        if (target) this.#actor.fall(target.startBeat);
        break;
      case "wrong":
        this.#actor.fall(judged.beat);
        break;
    }
  }

  /** Where the climb is aiming, so the actor can lean toward the next bar. */
  aimAt(lane: number | null): void {
    this.#actor.aimAt(lane);
  }

  /** TRANSITIONAL — see {@link Minigame.prototypeLayer}. */
  prototypeLayer(): { kind: "actor"; state: unknown; sprites: readonly string[] } {
    return { kind: "actor", state: this.#actor.state, sprites: this.#config.climberPoses };
  }

  update(): void {}
  onMeasure(): void {}
  onStarEarned(): void {}
  onComplete(): void {}

  render(view: StageView): Stage {
    const art = this.#config.footholdArt;
    const notes = new Map<string, NoteArt>();
    for (const note of view.notes) {
      notes.set(note.id, {
        // Behind the bar and wider than it, so the ridge fills in as the phrase
        // is climbed and leaves a trace of how far the player got.
        underlay: {
          assetId: art.crag,
          scale: CRAG_SCALE,
          opacity: note.opportunityIndex <= this.#reached ? CRAG_SOLID : CRAG_FADED,
        },
        body: { assetId: art.body },
      });
    }
    return { background: this.#config.background, notes };
  }
}

/* -------------------------------------------------------------------------- */

function parseFootholdArt(raw: unknown, where: string): { body: string; crag: string } | null {
  if (raw === undefined) return null;
  const art = obj(raw, where);
  return {
    body: str(strings(art["body"], `${where}.body`)[0], `${where}.body`),
    crag: str(strings(art["crag"], `${where}.crag`)[0], `${where}.crag`),
  };
}

/**
 * The route, validated and then discarded.
 *
 * Nothing has drawn these coordinates since the actors moved onto the note
 * bars, and this module does not read them either. The check they carry is
 * still worth running: one waypoint per note opportunity is an invariant about
 * the *musical* content, and an authored route that disagrees with the phrase
 * is a scenario whose two halves were edited apart.
 */
function checkRoute(raw: unknown, where: string, opportunities: number): void {
  const route = obj(raw, where);
  const waypoints = arr(route["waypoints"], `${where}.waypoints`);
  if (waypoints.length !== opportunities) {
    throw new ScenarioDataError(
      `${where}.waypoints`,
      `${waypoints.length} waypoints for ${opportunities} note opportunities — ` +
        "one successful note must advance exactly one waypoint"
    );
  }
}

export const CLIMB_MINIGAME: MinigameModule = {
  id: "ClimbMinigame",
  displayName: "Climb",
  apiVersion: MINIGAME_API_VERSION,

  parseConfig(raw: unknown): ClimbConfig {
    const { classParameters, assetBindings, scenarioId } = obj(raw, "scenario") as {
      classParameters: unknown;
      assetBindings: unknown;
      scenarioId: string;
    };
    const bindings = obj(assetBindings, "scenario.assetBindings");
    const params = obj(classParameters, "scenario.classParameters");
    const one = (slot: string): string => {
      const values = strings(bindings[slot], `scenario.assetBindings.${slot}`);
      const first = values[0];
      if (values.length !== 1 || first === undefined) {
        throw new ScenarioDataError(`scenario.assetBindings.${slot}`, "expected exactly one asset id");
      }
      return first;
    };
    const many = (slot: string, min: number): readonly string[] => {
      const values = strings(bindings[slot], `scenario.assetBindings.${slot}`);
      if (values.length < min) {
        throw new ScenarioDataError(
          `scenario.assetBindings.${slot}`,
          `expected at least ${min} asset ids`
        );
      }
      return values;
    };

    const policy = str(params["badNotePolicy"], "scenario.classParameters.badNotePolicy");
    if (policy !== "Wobble" && policy !== "Stall") {
      throw new ScenarioDataError(
        "scenario.classParameters.badNotePolicy",
        'expected "Wobble" or "Stall"'
      );
    }

    return {
      background: one("background"),
      climberPoses: many("climberPoses", 1),
      finishPose: one("finishPose"),
      waypointVisuals: many("waypointVisuals", 1),
      destinationVisual: one("destinationVisual"),
      // Slot ordering is part of the family's contract: [0] is the contact
      // effect where the climber lands, [1] the clean-progress accent.
      stepEffects: many("stepEffects", 2),
      footholdArt: parseFootholdArt(bindings["footholdArt"], "scenario.assetBindings.footholdArt")
        ?? climbNoteArtIds(scenarioId),
      badNotePolicy: policy,
    };
  },

  parseLevel(raw: unknown, shape): ClimbLevel {
    const level = obj(raw, "level");
    const plan = obj(level["measurePlan"], "level.measurePlan");
    const visual = obj(level["visual"], "level.visual");
    checkRoute(visual["route"], "level.visual.route", shape.noteOpportunityCount);
    return {
      visualSpanMeasures: num(plan["visualSpanMeasures"], "level.measurePlan.visualSpanMeasures"),
      resetBetweenMeasures: plan["resetBetweenMeasures"] === true,
    };
  },

  backgroundId(config: unknown): string {
    return (config as ClimbConfig).background;
  },

  assetIds(config: unknown): readonly string[] {
    const climb = config as ClimbConfig;
    return [
      climb.background,
      ...climb.climberPoses,
      climb.finishPose,
      ...climb.waypointVisuals,
      climb.destinationVisual,
      ...climb.stepEffects,
      climb.footholdArt.body,
      climb.footholdArt.crag,
    ];
  },

  create(context: AttemptContext): Minigame {
    return new ClimbMinigame(context.config as ClimbConfig, context);
  },

  /**
   * What a climb is worth watching for, and nothing about a can.
   *
   * The panel used to carry one row per family and print "—" for whichever was
   * not playing, which meant adding a third family meant editing the panel.
   * Each family now answers for itself and the rows it does not own simply are
   * not there.
   */
  debug(instance: Minigame): Readonly<Record<string, string>> {
    const state = climbActor(instance);
    return {
      "actor lane/streak": `${state.lane ?? "—"}/${state.streak}`,
      // How heavy the actor currently is. `streak` alone does not answer that:
      // size is its square root against a cap, so the first few notes move it
      // far more than the last few, and it is size that drives how the landing
      // reads (`ui/timeline/actor-layer.ts`).
      "actor size": state.size.toFixed(2),
    };
  },
};

export { ClimbMinigame };

/**
 * Narrowing helpers, for tests and tools.
 *
 * `config` and `data` are `unknown` on the scenario model — the host carries
 * them and only this family knows their shape — so a test asserting on a
 * foothold or a bad-note policy is a climb test and has to say so.
 */
export function climbConfig(config: unknown): ClimbConfig {
  return config as ClimbConfig;
}

export function climbLevel(data: unknown): ClimbLevel {
  return data as ClimbLevel;
}

/** The actor state of a running climb. Throws if handed another family. */
export function climbActor(minigame: Minigame): TimelineActorState {
  if (!(minigame instanceof ClimbMinigame)) throw new Error("not a ClimbMinigame");
  return minigame.actor;
}
