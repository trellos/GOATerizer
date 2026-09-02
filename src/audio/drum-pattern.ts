/**
 * The backing drum pattern: one beat per minigame, chosen when it starts.
 *
 * PROVISIONAL. The GDD describes the backing as a bass line and says nothing
 * about percussion (§23 leaves the bass grammar unspecified; drums are not
 * specified at all — the "Building Drums" entries in the scenario catalogue are
 * a minigame's *visual* subject, not an audio track). This exists because the
 * bass alone did not read as a pulse: it is voiced below the guitar on purpose,
 * which on laptop speakers puts the beat somewhere the hardware barely
 * reproduces. Percussion carries the pulse in a register that any speaker can
 * actually produce, which is what a rhythm game needs its backing to do. Per
 * `AGENTS.md` §17 everything here is tuning data, labelled provisional, not
 * presented as canonical design.
 *
 * A pattern is picked from two independent questions about the minigame that is
 * starting, and nothing else:
 *
 *   1. **How hard is it?** The difficulty, 1..7, indexes an intensity ladder
 *      from {@link INTENSITY_LADDER}: restrained at 1, everything the kit has at
 *      7. The ladder is graded by *what the drummer plays*, not by turning one
 *      pattern up — the backbeat arrives, then the kick starts syncopating, then
 *      ghost notes, then cymbal accents, then a crash, then a fill. Level is
 *      part of it, but a louder version of the same bar is not a harder-feeling
 *      one.
 *   2. **What is the feel?** Whether the authored phrase sits on triplets, on
 *      sixteenths, or on neither ({@link rhythmVariantFor}). That picks the grid
 *      the whole kit subdivides on — the ornament layer, the pickup kicks, the
 *      ghost snares and the fill all move onto it — so the bar states the feel
 *      of the exercise for its whole duration rather than decorating a fixed
 *      groove with a marker track.
 *
 * That is the whole selection: `drumPatternForAttempt(difficulty, prompt)`.
 *
 * **What this replaced.** The kit used to take a live union of the current *and
 * next* attempt's grids, so a sixteenth run announced itself one minigame early.
 * That look-ahead is gone. The beat now states the feel of the minigame being
 * played, for as long as it is being played, and changes when the next one
 * starts — a signal about the exercise in hand, not a trailer for the next one.
 *
 * Two things are invariant across all 21 patterns, because they are what makes
 * the backing usable rather than merely present:
 *
 *   - **A hit on every beat, and a high transient among them.** A kick is mostly
 *     sub-bass and a laptop or phone speaker throws that away, so without a hat
 *     on each beat the pulse measures loud and sounds like nothing (DECISION-016
 *     measured this: the peak above 800 Hz fell from 0.49 to 0.14). The pulse
 *     voices therefore never scale below {@link PULSE_FLOOR}, whatever the
 *     intensity — "minimal" has to mean *sparse*, never *inaudible*, because the
 *     player still has to find beat 1.
 *   - **One measure per loop.** The pattern's job is to say where the beat is,
 *     and repeating every measure states that more often. It also divides the
 *     bass's four-measure loop exactly, and — unlike a two-measure kit loop —
 *     stays in phase with the transport's measure grid no matter what beat an
 *     attempt happens to start on.
 *
 * Pure — no audio, no DOM — so the grid is testable on its own.
 */

import { BEATS_PER_MEASURE } from "../config/tuning.js";
import { subdivisionsOf } from "../game/subdivisions.js";
import type { PromptEvent } from "../scenario/types.js";

export type DrumVoice =
  | "kick"
  | "snare"
  | "hat"
  | "tick"
  | "trip"
  | "ride"
  | "crash"
  | "tom"
  | "floor";

export type DrumHit = {
  /** Beats from the start of the loop. */
  startBeat: number;
  voice: DrumVoice;
  /** Relative level, 0..1. Accents the pulse; it is not a scoring input. */
  velocity: number;
};

export type DrumPattern = {
  /**
   * Stable identity for this pattern — `"L4/sixteenth"`, or `"pulse"`.
   *
   * The caller sets a pattern when a minigame starts, and `setPattern` throws
   * away and re-schedules the queued tail. Comparing ids is how a caller tells
   * "the beat changed" from "the next minigame happens to want the same beat"
   * without diffing hit arrays, and it is a readable thing to put in the debug
   * panel.
   */
  id: string;
  hits: readonly DrumHit[];
  loopBeats: number;
};

/**
 * Which grid the kit subdivides on for a whole minigame.
 *
 * Not a set: a level tests triplets *or* sixteenths, never both (see
 * {@link rhythmVariantFor}), so the kit commits to one feel and stays in it.
 */
export type RhythmVariant = "quarters" | "eighth" | "sixteenth" | "triplet";

export const RHYTHM_VARIANTS: readonly RhythmVariant[] = [
  "quarters",
  "eighth",
  "sixteenth",
  "triplet",
];

/** The difficulty range the ladder covers, matching `DIFFICULTY_SEQUENCE`. */
export const MIN_INTENSITY = 1;
export const MAX_INTENSITY = 7;

/* -------------------------------------------------------------------------- */
/* The rhythm variant                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The feel a phrase asks for, read off the notes.
 *
 * Delegates the actual reading to `game/subdivisions.ts`, which looks at note
 * *positions* rather than duration names — a phrase can be written in eighths
 * and still land on the sixteenth grid, and a triplet has no `NoteDuration` of
 * its own in this content model at all.
 *
 * Eighths alone do **not** select a variant. Every straight pattern already
 * subdivides in eighths, so a phrase on the eighth grid is exactly what
 * `"straight"` describes; reserving the two named variants for the two feels
 * that are genuinely hard to count is what makes hearing one informative.
 *
 * **Total by construction, and deliberately so.** A level that contained both a
 * triplet and a sixteenth would be a content bug — `tests/drum-intensity.test.ts`
 * asserts no authored level does — but this runs when a minigame starts, in the
 * middle of a run, and a thrown error there costs the player their run over a
 * drum pattern. So it picks, and it picks triplets: a triplet grid does not
 * divide a binary one, which is exactly why a player needs it stated, and
 * `subdivisionsOf` never infers `"triplet"` from anything else — its presence is
 * always a deliberate authored gesture, while `"sixteenth"` can be implied by a
 * note's length alone.
 */
export function rhythmVariantFor(prompt: readonly PromptEvent[]): RhythmVariant {
  const grids = subdivisionsOf(prompt);
  if (grids.has("triplet")) return "triplet";
  if (grids.has("sixteenth")) return "sixteenth";
  if (grids.has("eighth")) return "eighth";
  return "quarters";
}

/* -------------------------------------------------------------------------- */
/* The grid each variant subdivides on                                         */
/* -------------------------------------------------------------------------- */

type OrnamentSlot = {
  /** Offset within the beat, `0 < offset < 1`. */
  offset: number;
  voice: DrumVoice;
  /** Level relative to the intensity's ornament setting. Groups the layer. */
  level: number;
};

/**
 * Where the kit plays between the beats, per variant.
 *
 * One timbre per variant, kept from the layered version this replaced: the
 * player should be able to name the feel by ear, and three subdivisions that all
 * sound like a hi-hat are three subdivisions that all sound the same.
 *
 * The relative levels group the layer into beats. In the sixteenth grid the
 * `and` is a hat and the `e` and `a` are the brighter, quieter tick, so a bar of
 * sixteenths still audibly divides into four; in the triplet grid the second
 * partial is accented, because that is the one that leans into the next beat and
 * it is what makes a shuffle feel like a shuffle rather than a stumble.
 */
const ORNAMENT_GRIDS: Readonly<Record<RhythmVariant, readonly OrnamentSlot[]>> = {
  // Nothing between the beats. Quarter-note material gets a quarter-note kit,
  // because a subdivision the exercise does not contain is not information —
  // it is the drummer counting something the player is not playing.
  quarters: [],
  eighth: [{ offset: 0.5, voice: "hat", level: 1 }],
  sixteenth: [
    { offset: 0.25, voice: "tick", level: 0.62 },
    { offset: 0.5, voice: "hat", level: 0.95 },
    { offset: 0.75, voice: "tick", level: 0.62 },
  ],
  triplet: [
    { offset: 1 / 3, voice: "trip", level: 0.78 },
    { offset: 2 / 3, voice: "trip", level: 1 },
  ],
};

/* -------------------------------------------------------------------------- */
/* The intensity ladder                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One rung of the ladder.
 *
 * Beats are 0-based within the measure, so `[0, 2]` is "beats 1 and 3". Nothing
 * here names an absolute position between beats: the pickups, the ghosts and the
 * fill are placed on the *variant's* grid, which is what lets the same rung
 * sound like a shuffle or like a sixteenth groove without a second table.
 */
type IntensitySpec = {
  /** What the rung is, in one word. Shown in the debug panel. */
  name: string;
  /** Beats that get a kick. */
  kick: readonly number[];
  /** Beats that get a snare. */
  snare: readonly number[];
  /**
   * Beats whose *last* grid slot gets a kick — the pickup into the next beat.
   * Straight: the `and`. Sixteenth: the `a`. Triplet: the third partial.
   */
  kickPickups: readonly number[];
  /** Beats whose last grid slot gets a quiet snare, leading into the next. */
  ghostSnares: readonly number[];
  /** Beats that get a ride accent over the hat. */
  ride: readonly number[];
  /** Beats that get a crash. */
  crash: readonly number[];
  /** Beat whose ornament is replaced by a descending fill. Null for none. */
  tomFillBeat: number | null;
  /**
   * Level of the subdivision layer, before {@link IntensitySpec.gain}. Zero
   * means the kit does not subdivide at all, which is only ever the bare pulse.
   */
  ornament: number;
  /** Overall level for everything that is not the pulse. */
  gain: number;
};

/**
 * Seven rungs, indexed by difficulty 1..7.
 *
 * Each rung adds one nameable thing to the one below it, so the ladder is
 * audible as a sequence of arrivals rather than as a fader:
 *
 *   1 minimal    — half-time: one kick on 1, one snare on 3, hats marking the
 *                  beat, and the quietest subdivision on the ladder. Restrained
 *                  by being nearly empty, not by being quiet.
 *   2 steady     — the backbeat arrives: kick on 1 and 3, snare on 2 and 4.
 *   3 driving    — a pickup kick into beat 4, and the subdivision comes up.
 *   4 insistent  — pickup kicks into 2 and 4, and a ghost snare into 1.
 *   5 pounding   — an extra kick on 4, and ride accents on 1 and 3.
 *   6 relentless — four on the floor, ghost snares leading into 1 and 3, and
 *                  the first crash, on the downbeat.
 *   7 rage       — crashes on 1 and 3, rides on 2 and 4 so every beat carries a
 *                  cymbal, a kick on every beat and on every pickup slot the
 *                  fill leaves free, and a descending tom fill across beat 4.
 *
 * Nothing authors difficulty 7 today (the run's `DIFFICULTY_SEQUENCE` ends
 * there, but no scenario has L7 level data). All seven are defined anyway: the
 * ladder is a property of the difficulty scale, not of the current content, and
 * a content gap is not a reason for the top rung to be missing when it is
 * filled.
 */
const INTENSITY_LADDER: readonly IntensitySpec[] = [
  {
    name: "minimal",
    kick: [0],
    snare: [2],
    kickPickups: [],
    ghostSnares: [],
    ride: [],
    crash: [],
    tomFillBeat: null,
    ornament: 0.5,
    gain: 0.55,
  },
  {
    name: "steady",
    kick: [0, 2],
    snare: [1, 3],
    kickPickups: [],
    ghostSnares: [],
    ride: [],
    crash: [],
    tomFillBeat: null,
    ornament: 0.55,
    gain: 0.72,
  },
  {
    name: "driving",
    kick: [0, 2],
    snare: [1, 3],
    kickPickups: [2],
    ghostSnares: [],
    ride: [],
    crash: [],
    tomFillBeat: null,
    ornament: 0.6,
    gain: 0.82,
  },
  {
    name: "insistent",
    kick: [0, 2],
    snare: [1, 3],
    kickPickups: [0, 2],
    ghostSnares: [3],
    ride: [],
    crash: [],
    tomFillBeat: null,
    ornament: 0.65,
    gain: 0.88,
  },
  {
    name: "pounding",
    kick: [0, 2, 3],
    snare: [1, 3],
    kickPickups: [0, 2],
    ghostSnares: [3],
    ride: [0, 2],
    crash: [],
    tomFillBeat: null,
    ornament: 0.7,
    gain: 0.93,
  },
  {
    name: "relentless",
    kick: [0, 1, 2, 3],
    snare: [1, 3],
    kickPickups: [0, 2],
    ghostSnares: [1, 3],
    ride: [2],
    crash: [0],
    tomFillBeat: null,
    ornament: 0.75,
    gain: 0.97,
  },
  {
    name: "rage",
    kick: [0, 1, 2, 3],
    snare: [1, 3],
    kickPickups: [0, 1, 2, 3],
    ghostSnares: [],
    ride: [1, 3],
    crash: [0, 2],
    tomFillBeat: 3,
    ornament: 0.82,
    gain: 1,
  },
];

/**
 * The bare pulse, with no minigame to describe: pregame, the timing check, and
 * the results screen.
 *
 * Its own rung rather than "intensity 2 with the ornament switched off", because
 * it is not a rung — it is what the kit plays when there is no difficulty and no
 * phrase to have a feel about, and it runs at full pulse level so the player can
 * calibrate their rig against it.
 */
const PULSE_SPEC: IntensitySpec = {
  name: "pulse",
  kick: [0, 2],
  snare: [1, 3],
  kickPickups: [],
  ghostSnares: [],
  ride: [],
  crash: [],
  tomFillBeat: null,
  ornament: 0,
  gain: 1,
};

/* -------------------------------------------------------------------------- */
/* Voice levels                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Floor under the pulse voices' level multiplier.
 *
 * The kick, snare and hat that mark the four beats are the one thing the player
 * cannot afford to lose, so intensity scales the kit *around* them rather than
 * fading them out with everything else. Without this, "minimal intensity" would
 * mean "the beat is hard to hear", which is a different and much worse feature.
 */
const PULSE_FLOOR = 0.85;

/** Base levels, before the rung's gain. Relative to each other, not absolute. */
const VOICE_LEVELS = {
  kick: 1,
  snare: 0.9,
  /** The hat on the beat. Accented on the downbeat so the measure has a top. */
  hat: 0.9,
  hatDownbeat: 1,
  /** A pickup kick is a lead-in, not a downbeat; it sits under the pulse. */
  kickPickup: 0.75,
  /** A ghost snare is felt more than heard. Any louder and it is a backbeat. */
  ghostSnare: 0.35,
  ride: 0.8,
  crash: 1,
  tom: 0.75,
  floor: 0.9,
} as const;

/* -------------------------------------------------------------------------- */
/* Building a pattern                                                          */
/* -------------------------------------------------------------------------- */

/** Keeps a velocity inside the 0..1 the players and the tests both assume. */
function level(value: number): number {
  return Math.max(0.01, Math.min(1, value));
}

function buildPattern(id: string, spec: IntensitySpec, variant: RhythmVariant): DrumPattern {
  const slots = ORNAMENT_GRIDS[variant];
  // Where a pickup or a ghost lands: the last slot of the variant's own grid,
  // so the lead-in states the feel too. `quarters` ornaments nothing but still
  // needs somewhere to put one, and the `and` is the only place a pickup can
  // go in music that has no smaller division — otherwise the upper rungs would
  // silently lose their pickups on quarter-note material.
  const pickupOffset = slots[slots.length - 1]?.offset ?? 0.5;
  const pulseGain = Math.max(spec.gain, PULSE_FLOOR);
  const hits: DrumHit[] = [];

  const add = (startBeat: number, voice: DrumVoice, velocity: number): void => {
    hits.push({ startBeat, voice, velocity: level(velocity) });
  };

  for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
    // The pulse. A hit on every beat at every intensity, and a high transient
    // among them, or the backing is inaudible on the speakers this is played on.
    const downbeat = beat === 0;
    add(beat, "hat", (downbeat ? VOICE_LEVELS.hatDownbeat : VOICE_LEVELS.hat) * pulseGain);
    if (spec.kick.includes(beat)) add(beat, "kick", VOICE_LEVELS.kick * pulseGain);
    if (spec.snare.includes(beat)) add(beat, "snare", VOICE_LEVELS.snare * pulseGain);

    // Cymbal accents sit *over* the hat rather than replacing it, for the same
    // reason: the hat is the thing that survives a small speaker, and a crash
    // that swallowed it would make the loudest bar the hardest one to count.
    if (spec.ride.includes(beat)) add(beat, "ride", VOICE_LEVELS.ride * spec.gain);
    if (spec.crash.includes(beat)) add(beat, "crash", VOICE_LEVELS.crash * spec.gain);

    if (beat === spec.tomFillBeat) {
      // The fill replaces everything this beat would otherwise play between the
      // beats — the ornament, and any pickup or ghost — rather than joining it,
      // so it reads as the drummer leaving the groove rather than as a tom
      // landing on top of a kick. It is placed on the variant's own grid, which
      // means the fill states the feel of the exercise as loudly as anything
      // else in the pattern does.
      const fillSlots = slots.length > 0 ? slots : [{ offset: 0.5 }];
      fillSlots.forEach((slot, index) => {
        const last = index === fillSlots.length - 1;
        const voice: DrumVoice = last ? "floor" : "tom";
        const base = last ? VOICE_LEVELS.floor : VOICE_LEVELS.tom;
        add(beat + slot.offset, voice, base * spec.gain);
      });
      continue;
    }

    if (spec.ornament > 0) {
      for (const slot of slots) {
        add(beat + slot.offset, slot.voice, spec.ornament * slot.level * spec.gain);
      }
    }

    if (spec.kickPickups.includes(beat)) {
      add(beat + pickupOffset, "kick", VOICE_LEVELS.kickPickup * spec.gain);
    }
    if (spec.ghostSnares.includes(beat)) {
      add(beat + pickupOffset, "snare", VOICE_LEVELS.ghostSnare * spec.gain);
    }
  }

  hits.sort((a, b) => a.startBeat - b.startBeat);
  return { id, hits, loopBeats: BEATS_PER_MEASURE };
}

/* -------------------------------------------------------------------------- */
/* The public selection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Rounds and clamps a difficulty onto the ladder.
 *
 * Total on purpose. This is called at the moment a minigame starts, so a
 * difficulty outside 1..7 — a dev override, a future eighth rung, a bad
 * scenario file — must produce a beat, not an exception in the middle of a run.
 */
function clampIntensity(difficulty: number): number {
  if (!Number.isFinite(difficulty)) return MIN_INTENSITY;
  return Math.max(MIN_INTENSITY, Math.min(MAX_INTENSITY, Math.round(difficulty)));
}

/** What the rung at this difficulty is called: `"insistent"`. For debug UI. */
export function drumIntensityName(difficulty: number): string {
  return INTENSITY_LADDER[clampIntensity(difficulty) - 1]!.name;
}

/**
 * The pattern for one rung and one feel — the 21 patterns, addressed directly.
 *
 * Built on demand rather than from a cached table: a `DrumPattern` is a couple
 * of dozen plain objects, this is called once per minigame, and a table would be
 * 21 patterns built at module load for the two or three a run actually uses.
 */
export function drumPatternAt(difficulty: number, variant: RhythmVariant): DrumPattern {
  const intensity = clampIntensity(difficulty);
  return buildPattern(`L${intensity}/${variant}`, INTENSITY_LADDER[intensity - 1]!, variant);
}

/**
 * The beat for a minigame: its difficulty picks the rung, its notes pick the
 * feel.
 *
 * This is the whole game-facing API. Call it when a minigame becomes the current
 * one, and hand the result to `DrumPlayer.setPattern`.
 */
export function drumPatternForAttempt(
  difficulty: number,
  prompt: readonly PromptEvent[]
): DrumPattern {
  return drumPatternAt(difficulty, rhythmVariantFor(prompt));
}

/** The pulse on its own: pregame, the timing check, and after a run ends. */
export const BACKBEAT_PATTERN: DrumPattern = buildPattern("pulse", PULSE_SPEC, "quarters");
