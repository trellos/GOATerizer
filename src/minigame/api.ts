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
 * **There is one surface: the timeline.** The player reads it to know what to
 * play, and the minigame is what happens on it in response — a goat hopping from
 * note bar to note bar, a tin can crushed against a forehead when its note
 * lands. There is no separate scenario panel (GDD §11.2).
 *
 * The host owns musical time, judgment, score, stars, run flow and every pixel
 * of note geometry. The minigame owns what a judged note *means*, and answers
 * one question each frame: what should be drawn right now. It is handed events
 * and returns values; it never calls the host, never reads a clock, and cannot
 * award itself anything — every lifecycle method returns `void`, which is what
 * makes a third-party minigame safe to run.
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
 * Where a sprite sits relative to the host's own furniture.
 *
 * The host draws the note bars, and above everything it draws the played-note
 * row and the current-time bar — a minigame composes around the player's own
 * note, never over it.
 */
export type Layer =
  /** Behind the note bars, in front of the background. Terrain, scenery. */
  | "under"
  /** In front of the note bars. Actors standing on them, effects, debris. */
  | "over";

/**
 * One drawn sprite, in **normalised timeline space**.
 *
 * `x` runs rightwards across the visible playfield — the area right of the
 * gutter — with 0 at its left edge and 1 at its right. `y` runs downwards
 * across the **lane band**, 0 at the top lane and 1 below the bottom one.
 *
 * Both may go outside 0..1 and that is normal and useful: `y < 0` is above the
 * lanes and `y > 1` below them, in the play area the background fills, which is
 * where a goat stands when it hops onto a bar and where a knocked can falls.
 * `x` outside 0..1 is simply off-screen, which is where a minigame's own notes
 * are before they scroll in. Everything is clipped to the play area.
 *
 * To put an actor on a note, read that note's {@link PlacedNote.rect} from
 * {@link StageView.notes} — its rect is in exactly this space.
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

/**
 * Everything a minigame puts on the timeline this frame, rebuilt each frame.
 *
 * Nothing else of it reaches the screen. All three parts are optional: a
 * minigame that returns `{}` is invisible and the timeline renders exactly as
 * the host would draw it alone.
 */
export type Stage = {
  /**
   * The background behind **this minigame's own measures**, not the whole
   * timeline. The host clips it to {@link StageView.span}, so around a handover
   * the outgoing minigame's background scrolls off to the left while the
   * incoming one's arrives from the right, meeting on a measure line.
   */
  readonly background?: string;
  /** Actors, scenery and effects. Drawn in layer, then z, then array order. */
  readonly sprites?: readonly Sprite[];
  /** Note id -> art. Any note absent gets the host's default bar. */
  readonly notes?: ReadonlyMap<string, NoteArt>;
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

/**
 * The surface, as it stands this frame.
 *
 * Everything here is host-computed and read-only. A minigame cannot move a note
 * in time or pitch, resize one, or change where a measure falls; it is told
 * where they are and decides what is drawn around them.
 */
export type StageView = {
  /**
   * Attempt-relative beat — the same clock every other lifecycle method is
   * given. Negative before this minigame's first measure, past
   * {@link AttemptContext.plan.totalBeats} while its last measure scrolls away.
   */
  readonly beat: number;

  /**
   * **Every** note of this attempt, in order, whether or not it is on screen.
   *
   * Off-screen notes carry rects outside 0..1 rather than being omitted, so an
   * actor anchored to a note always has a coordinate — a climber standing on
   * note 3 does not lose its footing when note 3 scrolls off the left edge.
   */
  readonly notes: readonly PlacedNote[];

  /** Lanes in the pitch band, root to root. */
  readonly laneCount: number;

  /**
   * Normalised x of the current-time bar — where a note is played.
   *
   * The other anchor besides a note. Some minigames put their actor *here* and
   * let the notes come to it: a REPEAT scenario's forehead waits at the strike
   * line and each tin can is crushed as it arrives; a BATTLE threat closes in
   * from the right across successive measures. Both read better than chasing a
   * scrolling bar.
   */
  readonly strikeX: number;

  /**
   * Normalised x span this minigame's own measures occupy, which the host clips
   * the background to. Two minigames share the timeline around a handover.
   */
  readonly span: { readonly from: number; readonly to: number };

  /**
   * Measure geometry. A measure is a golden rectangle (GDD §11.3), so its width
   * is a consequence of the lane band's height rather than a free choice — a
   * minigame that wants to place something "a beat ahead" should use
   * `beatWidth` rather than assuming a scroll speed.
   */
  readonly measure: {
    /** Normalised width of one four-beat measure. */
    readonly width: number;
    /** Normalised width of one beat. */
    readonly beatWidth: number;
  };
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

  /**
   * What this minigame puts on the timeline right now.
   *
   * The single render method: there is one surface, so this is the whole of a
   * minigame's visible output. Called once per frame while its attempt is on
   * screen, including before its first measure arrives and while its last one
   * scrolls away — `view.beat` says which.
   *
   * Must be pure with respect to the host: it may read the minigame's own state
   * and `view`, and must not mutate anything the host owns.
   */
  render(view: StageView): Stage;
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
