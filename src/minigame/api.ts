/**
 * The game↔minigame contract.
 *
 * A **minigame** is a reusable gameplay-to-visual behaviour family — CLIMB,
 * PERFORM, TRAVERSE, THREE-STEP, REPEAT, BATTLE. A **scenario** is an authored
 * content instance belonging to exactly one of them. This module is the entire
 * surface between the two, and like `input/guitar-input.ts` it deliberately
 * **imports nothing**: a minigame package needs this file and nothing else from
 * the host.
 *
 * The shape of the boundary, in one line:
 *
 *     the minigame is code; its output is data.
 *
 * The host owns musical time, judgment, score, stars, run flow and every pixel
 * of geometry. The minigame owns what a judged note *means* for its scenario,
 * and answers one question each frame: what should be drawn right now. It is
 * handed events and returns values; it never calls the host, never reads a
 * clock, and cannot award itself anything — every lifecycle method returns
 * `void`, which is what makes a third-party minigame safe to run.
 */

/**
 * A minigame's stable identity, as written in scenario data.
 *
 * An open string, not a closed union: the six canonical families are design
 * vocabulary, and the host resolves an id through its registry rather than
 * knowing the set at compile time.
 */
export type MinigameId = string;

/**
 * The API revision a package was written against.
 *
 * Present from the first release because it is cheap now and awkward to
 * retrofit once anything ships against the contract.
 */
export const MINIGAME_API_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Musical vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/**
 * How long a note is written for.
 *
 * Part of the contract rather than the scenario schema, because a minigame
 * skinning the timeline has to be able to draw a sixteenth differently from a
 * whole note. `scenario/types.ts` re-exports this so there is one definition.
 */
export type NoteDuration = "whole" | "half" | "quarter" | "eighth" | "sixteenth";

/** One note opportunity, resolved into the run's key. Read-only. */
export type Opportunity = {
  /** Index among note opportunities only. Rests never take one. */
  readonly index: number;
  /** Beats from the start of the attempt. */
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly duration: NoteDuration;
  /** 0..7 within the run key's one-octave span, root to root. */
  readonly lane: number;
  readonly midi: number;
};

/* -------------------------------------------------------------------------- */
/* What the host tells the minigame                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything fixed for one attempt. Handed once, at construction.
 *
 * `config` and `data` are whatever the minigame's own parsers returned, so a
 * minigame defines its content shape entirely: the host stores and forwards
 * them without ever looking inside.
 */
export type AttemptContext = {
  /** Scenario-level, from {@link MinigameModule.parseConfig}. */
  readonly config: unknown;
  /** This difficulty level's, from {@link MinigameModule.parseLevel}. */
  readonly data: unknown;
  /** Asset ids this scenario declared. Already loaded; drawable by id. */
  readonly assets: readonly string[];
  /** The musical shape of the attempt. Host-owned. */
  readonly plan: {
    readonly measures: number;
    readonly beatsPerMeasure: number;
    readonly totalBeats: number;
  };
  /** The prompt, in order. Readable; never changeable. */
  readonly opportunities: readonly Opportunity[];
};

/**
 * One judged note, on its way into the scenario.
 *
 * Deliberately richer than any single minigame needs. `ClimbMinigame` reads
 * only `outcome`; a REPEAT scenario picks which target fell from
 * `opportunityIndex`, a THREE-STEP scenario derives its A/B/C role from
 * `startBeat` on the matching {@link Opportunity}, and a PERFORM scenario will
 * want the pitch. Widening this later would break every shipped package.
 */
export type Judged = {
  /** Unique within the attempt, so a minigame can ignore a repeat. */
  readonly id: number;
  readonly outcome: "perfect" | "good" | "miss" | "wrong";
  /** Null for a wrong note that matched no target. */
  readonly opportunityIndex: number | null;
  /** What the player actually played. Null for a miss — nothing was played. */
  readonly playedMidi: number | null;
  /** Continuous lane coordinate, or null when off the octave entirely. */
  readonly lane: number | null;
  /** Attempt-relative beat. */
  readonly beat: number;
};

/* -------------------------------------------------------------------------- */
/* What the minigame draws                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Coarse draw order. Within a layer, {@link Sprite.z} decides.
 *
 * `front` exists because the asset catalog calls for it: several BATTLE
 * scenarios bind an arena prop described as a foreground object used for
 * staging and scale, in front of the actor.
 */
export type Layer = "back" | "stage" | "actor" | "front";

/**
 * One drawn sprite, in normalised scenario space: x rightwards 0..1, y
 * downwards 0..1 with 0 at the top of the panel. Resolution-independent by
 * construction.
 *
 * `key` is the sprite's identity across frames. It must be stable and unique
 * within a scene: the host uses it to cross-fade a changed `assetId` and to
 * fade out a sprite that disappears. A minigame that regenerates keys every
 * frame simply loses those, and draws exactly as it asked to.
 */
export type Sprite = {
  readonly key: string;
  readonly assetId: string;
  readonly x: number;
  readonly y: number;
  /** Multiplier on the sprite's natural size. Default 1. */
  readonly scale?: number;
  /** Default 0. */
  readonly rotationDeg?: number;
  /** 0..1. Default 1. */
  readonly opacity?: number;
  /** Default `"stage"`. */
  readonly layer?: Layer;
  /** Order within a layer. Default 0. */
  readonly z?: number;
  /** Which point of the sprite sits at `(x, y)`. Default `"center"`. */
  readonly anchor?: "center" | "bottom";
  /** Registration nudge in normalised panel units. Default 0. */
  readonly offsetY?: number;
};

/** A whole scenario panel, rebuilt each frame. Nothing else reaches the screen. */
export type Scene = {
  /** Drawn cover-fit behind everything. */
  readonly background?: string;
  readonly sprites: readonly Sprite[];
};

/* -------------------------------------------------------------------------- */
/* The timeline skin                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One target note, already placed by the host.
 *
 * The host owns time and pitch geometry absolutely: a minigame decides what art
 * sits around this rect, never where the rect is. That is what keeps a skin
 * from making a challenge harder through visual ambiguity, and from making one
 * easier to cheat.
 */
export type PlacedNote = {
  readonly id: string;
  readonly opportunityIndex: number;
  readonly lane: number;
  readonly duration: NoteDuration;
  readonly outcome: "perfect" | "good" | "miss" | null;
  /** Normalised timeline space, 0..1 both axes. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Negative once past the strike line. Lets a skin react on approach. */
  readonly beatsUntilStrike: number;
};

export type TimelineContext = {
  /** Attempt-relative beat. */
  readonly beat: number;
  readonly laneCount: number;
  /**
   * Normalised x span this attempt's notes occupy, which the host clips the
   * backdrop to. Two attempts share the timeline around a transition — the
   * outgoing one's notes scroll left while the incoming one's scroll in from
   * the right — so a backdrop that ignored this would cover both.
   */
  readonly span: { readonly from: number; readonly to: number };
};

/**
 * Art for one target note.
 *
 * Three slots rather than one, because the rect is an **anchor, not a clip**:
 * `underlay` and `overlay` are drawn at their natural size centred on it and
 * may bleed freely outside it — a glow, a crag silhouette, an ornament — while
 * `body` is stretched to the rect exactly, so note duration stays honest
 * whatever is drawn around it.
 *
 * Any omitted slot falls back to the host's default for that note. The host
 * draws the played-note row and the strike line **above** all of this, so a
 * skin composes around the player's own note rather than competing with it.
 */
export type NoteArt = {
  readonly underlay?: { assetId: string; scale?: number; opacity?: number };
  readonly body?: { assetId: string; opacity?: number };
  readonly overlay?: { assetId: string; scale?: number; opacity?: number };
};

export type TimelineSkin = {
  /** Behind the notes, in front of the row lines. Clipped to the context span. */
  readonly backdrop?: readonly Sprite[];
  /** Note id → art. Any note absent gets the host default. */
  readonly notes?: ReadonlyMap<string, NoteArt>;
};

/* -------------------------------------------------------------------------- */
/* The contract                                                                */
/* -------------------------------------------------------------------------- */

export interface Minigame {
  /**
   * One judged note — the only thing that may change progress.
   *
   * Called when the energy streak **arrives**, not when judgment happened, so
   * the player reads their note as having caused the reaction rather than
   * merely preceding it. A headless caller delivers immediately.
   */
  onJudged(judged: Judged, beat: number): void;

  /**
   * Decay transient state. Called every frame for any on-screen attempt.
   *
   * `beat` may be **negative** — the next attempt is created about four
   * measures early and drawn in the flanking panel before its own beat 0 — or
   * past the attempt length while a finished panel slides away. Both are normal.
   */
  update(beat: number): void;

  /**
   * A measure boundary passed. The minigame decides what, if anything, resets.
   *
   * The host has no opinion: a CLIMB scenario spans all four measures
   * continuously, a REPEAT scenario refreshes its row of targets every measure
   * while keeping attempt-global spectacle, and a BATTLE scenario does one or
   * the other depending on its difficulty level.
   */
  onMeasure(measureIndex: number, beat: number): void;

  /**
   * A star was just earned (1, 2 or 3). Stars lock, so this never goes down.
   *
   * The host still owns the thresholds and the meter; this is the minigame's
   * chance to react — a PERFORM scenario's payoff flourish fires at ★★★.
   */
  onStarEarned(stars: number, beat: number): void;

  /** The attempt is over. `passed` is `stars >= 1`. */
  onComplete(passed: boolean, stars: number, beat: number): void;

  /** The scenario panel, now. Called once per rendered panel per frame. */
  renderScene(beat: number): Scene;

  /**
   * Optional skin for this attempt's target notes on the timeline.
   *
   * Return `null` — or omit the method — for the host's default look.
   */
  renderTimeline?(placed: readonly PlacedNote[], view: TimelineContext): TimelineSkin | null;
}

/**
 * What a minigame package exports. The host knows only this.
 *
 * The two parsers are why a minigame can define whatever data it wants: only it
 * knows the shape, so only it can validate. They must **throw** on anything
 * unmappable, matching the loud-failure contract scenario loading already has —
 * a bad edit should fail a test, not transpose a note mid-run.
 */
export interface MinigameModule {
  readonly id: MinigameId;
  readonly displayName: string;
  /** Must equal {@link MINIGAME_API_VERSION} for the host to load it. */
  readonly apiVersion: number;

  /** Scenario-level configuration. Throws on invalid input. */
  parseConfig(raw: unknown): unknown;
  /**
   * One difficulty level's data. Throws on invalid input.
   *
   * `shape` carries the host-owned facts a minigame needs to validate against
   * its own content — a REPEAT scenario checks its row holds
   * `noteOpportunityCount / measures` targets, a CLIMB scenario checks it
   * authors one waypoint per opportunity.
   */
  parseLevel(
    raw: unknown,
    shape: { readonly noteOpportunityCount: number; readonly measures: number }
  ): unknown;

  /** Every asset id this scenario needs, so the host can preload them. */
  assetIds(config: unknown, levels: readonly unknown[]): readonly string[];

  create(context: AttemptContext): Minigame;

  /** Optional rows for the developer panel. */
  debug?(instance: Minigame): Readonly<Record<string, string>>;
}

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Motion belongs to the minigame, not the host.
 *
 * A host that tweened keyed sprites for everyone would buy free consistency and
 * lose the two things that matter: it can only interpolate straight lines
 * between two points, and mid-tween its picture disagrees with what the
 * minigame believes. THREE-STEP is literally "two little hops and a larger
 * leap" — an arc, which a lerp draws as a slide — and a knocked-over REPEAT
 * target flies off with no destination to tween toward at all.
 *
 * So the host ships the easing instead. Everyone reaches for the same three
 * functions, the six verbs read as one grammar, and nothing has to guess.
 * All are pure and take `beat` as a parameter: a minigame never reads a clock.
 */

/** Progress 0..1 through a span, clamped at both ends. */
function progress(startBeat: number, durationBeats: number, beat: number): number {
  if (durationBeats <= 0) return 1;
  const t = (beat - startBeat) / durationBeats;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** Ease-in-out. Gentler than linear at both ends, which is what reads as motion. */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Eased travel from `from` to `to`. Returns `to` once the span has elapsed. */
export function slide(
  from: number,
  to: number,
  startBeat: number,
  durationBeats: number,
  beat: number
): number {
  return from + (to - from) * ease(progress(startBeat, durationBeats, beat));
}

/**
 * Eased travel with a vertical arc. `height` is the peak rise in the same units
 * as the coordinates, subtracted from y because y runs downwards.
 */
export function arc(
  from: { x: number; y: number },
  to: { x: number; y: number },
  height: number,
  startBeat: number,
  durationBeats: number,
  beat: number
): { x: number; y: number } {
  const t = progress(startBeat, durationBeats, beat);
  const eased = ease(t);
  return {
    x: from.x + (to.x - from.x) * eased,
    // A parabola peaking at the midpoint: 0 at both ends, 1 at t = 0.5.
    y: from.y + (to.y - from.y) * eased - height * 4 * t * (1 - t),
  };
}

/** 1 at `startBeat`, falling linearly to 0 after `durationBeats`. */
export function decay(startBeat: number, durationBeats: number, beat: number): number {
  return 1 - progress(startBeat, durationBeats, beat);
}
