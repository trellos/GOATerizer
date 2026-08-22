#!/usr/bin/env node
/**
 * Designer tool: writes `docs/scenarios/can-crushing/can_crushing.scenario.json`.
 *
 * Unlike `author-rocky-scenarios.mjs`, which rewrites the musical content of
 * four existing files and preserves everything else, this one emits the whole
 * file: Can Crushing is new, so there is no hand-tuned content to preserve yet.
 * Once a designer starts editing the JSON by hand this script should either be
 * narrowed the same way or retired — the committed JSON is the authority the
 * game imports, and nothing regenerates it at play time.
 *
 *   node scripts/author-can-crushing.mjs
 *
 * ## Why every note is the root
 *
 * `RepeatMinigame`'s performer stands at **one lane** for the whole attempt
 * (`docs/game-design/PROPOSED_Timeline_Actors.md` §5), and a can is crushed only
 * when it arrives at that lane. The lane is read from the material — the modal
 * lane of the authored targets — so a note authored anywhere else is a note the
 * player is asked to play *and whose can then flies past the crusher's head*.
 * That would punish correct play with the failure animation, so while the
 * performer is stationary the authored material has to sit entirely on his lane.
 *
 * That is not a compromise: REPEAT is the "do one thing over and over" family,
 * and its difficulty is rhythmic by design. The ladder below is quarters with
 * breath, quarters without, quarters into eighths, then eighths — the pitch
 * never moves. When the between-measures walk hook is built, this constraint
 * relaxes to "one lane per measure" and the material can start moving him.
 *
 * ## What the draft authors, and what it does not
 *
 * The canonical spec (`GOATerizer_Scenario_Asset_Slot_Bindings.md` §3, Can
 * Crushing) puts this scenario at L1–7 in the Straight Sixteenths family. The
 * draft authors L1–4 and no sixteenth material at all, because the point of the
 * draft is the placed-can mechanic rather than the density ladder.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "docs", "scenarios", "can-crushing");
const OUT_FILE = path.join(OUT_DIR, "can_crushing.scenario.json");

const BEATS_PER_MEASURE = 4;
const ATTEMPT_BEATS = 16;

/** Mirrors src/config/tuning.ts JUDGMENT_POINTS.perfect. */
const POINTS_PERFECT = 10;
/** The same provisional ladder every scenario uses — see author-rocky-scenarios.mjs. */
const PASS_FRACTION = 0.45;
const STAR2_FRACTION = 0.8;

const DURATION_BEATS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

/** The one pitch the crusher stands on. */
const HOME = "1";

const q = (token) => ["quarter", token];
const e = (token) => ["eighth", token];
const repeat = (n, make) => Array.from({ length: n }, () => make);

/**
 * `[duration, token]`, `null` for a rest. Every phrase totals exactly 16 beats.
 *
 * The ladder is purely rhythmic. Each level takes one thing away: L1 gives a
 * beat of breath per measure, L2 takes it back, L3 doubles the second half, L4
 * doubles the whole attempt and leaves an eighth to breathe.
 */
const PHRASES = {
  // Three crushes and a beat to reset, four times over.
  1: [0, 1, 2, 3].flatMap(() => [...repeat(3, q(HOME)), q(null)]),
  // The same tempo with the breath removed.
  2: repeat(16, q(HOME)),
  // Half an attempt to settle in, then the same bar at double speed.
  3: [...repeat(8, q(HOME)), ...repeat(16, e(HOME))],
  // Eighths throughout, each measure catching one eighth of breath.
  4: [0, 1, 2, 3].flatMap(() => [...repeat(7, e(HOME)), e(null)]),
};

const LEVEL_CHARACTER = {
  1: "a few cans, comfortably spaced; the pile is a novelty",
  2: "a steady conveyor of cans, no gaps to reset in",
  3: "a slow opening half, then the cans arrive twice as fast",
  4: "a wall of cans, one eighth of breath per bar",
};

const DEGREE_VOCABULARY = [HOME];

function buildPrompt(phrase) {
  let beat = 0;
  const events = phrase.map(([duration, token], index) => {
    const durationBeats = DURATION_BEATS[duration];
    if (durationBeats === undefined) throw new Error(`unknown duration ${duration}`);
    if (token !== null && !DEGREE_VOCABULARY.includes(token)) {
      throw new Error(
        `token ${JSON.stringify(token)} is off the crusher's lane; a stationary ` +
          "performer's material must sit entirely on his own pitch"
      );
    }
    const startBeat = beat;
    beat += durationBeats;
    const event = {
      index,
      type: token === null ? "rest" : "note",
      duration,
      durationBeats,
      startBeat,
      startMeasure: Math.floor(startBeat / BEATS_PER_MEASURE) + 1,
      beatWithinMeasure: (startBeat % BEATS_PER_MEASURE) + 1,
    };
    if (token !== null) event.scaleDegree = token;
    return event;
  });
  if (beat !== ATTEMPT_BEATS) {
    throw new Error(`phrase totals ${beat} beats, expected ${ATTEMPT_BEATS}`);
  }
  return events;
}

function buildLevel(difficulty) {
  const prompt = buildPrompt(PHRASES[difficulty]);
  const noteCount = prompt.filter((event) => event.type === "note").length;
  const maxPoints = noteCount * POINTS_PERFECT;

  return {
    difficulty,
    supported: true,
    measurePlan: {
      attemptMeasures: 4,
      beatsPerMeasure: BEATS_PER_MEASURE,
      // Canonical: "1m — refresh cans/objects; drunk/crowd tier persists".
      visualSpanMeasures: 1,
      resetBetweenMeasures: true,
    },
    prompt,
    noteOpportunityCount: noteCount,
    authoredBeatCount: ATTEMPT_BEATS,
    visual: {
      levelCharacter: LEVEL_CHARACTER[difficulty],
      targetCharacter: "beer can",
      performerStation: `fixed at the lane of scale degree ${HOME} for the whole attempt`,
      expectedCans: noteCount,
      progressTrigger: "played_pitch_arrives_on_the_performer_lane",
      sustainBehavior: "a sustained note crushes once, on the attack; holding it adds nothing",
    },
    stars: {
      metric: "judgmentPoints",
      metricNote:
        "Cumulative judgment points during the attempt: Perfect 10, Good 6, Miss 0 " +
        "(src/config/tuning.ts JUDGMENT_POINTS). Thresholds are cumulative and lock once earned.",
      passThreshold: Math.round(maxPoints * PASS_FRACTION),
      star2Threshold: Math.round(maxPoints * STAR2_FRACTION),
      star3Threshold: maxPoints,
      provisional: true,
      note:
        `PROVISIONAL. Pass is ${PASS_FRACTION * 100}% and two stars ` +
        `${STAR2_FRACTION * 100}% of the all-Perfect maximum (${maxPoints}); three stars is ` +
        "the maximum itself, so ★★★ requires every note opportunity taken at Perfect.",
    },
    validation: { status: "ok", issues: [] },
    scoring: {
      streakBonusEligible: false,
      note:
        "The draft authors quarters and eighths, not the sixteenth material GDD §9.2 makes " +
        "streak-eligible. The streak is still tracked, and still feeds the second-star " +
        "consistency comparison.",
    },
  };
}

const scenario = {
  $schema: "https://goaterizer.local/schema/scenario-v1.json",
  id: "can_crushing",
  displayName: "Can Crushing",
  theme: "80s TRAINING & PARTY MONTAGE",
  minigameClass: "RepeatMinigame",
  family: "Straight Sixteenths",
  visualVerb: "REPEAT",
  supportedLevels: [1, 2, 3, 4],
  scenarioPremise:
    "A bro on a beach crushes one beer can after another on the same beat. The exercise is " +
    "one pitch held steady against a moving rhythm: every can the player places on his lane " +
    "gets crushed and joins the pile, and every can placed anywhere else sails past his head.",
  runTransposition: {
    promptRepresentation: "diatonic_scale_degree",
    degreeVocabulary: DEGREE_VOCABULARY,
    transposeToRunKey: true,
    nonDiatonicTargetsAllowed: false,
    note:
      "One pitch: the run key's root. The performer stands at one lane for the whole attempt, " +
      "so material off that lane would ask the player to place a can he cannot reach.",
  },
  classParameters: {
    visualSpanMeasures: 1,
    repeatMode: "sequence",
    performerMovesBetweenMeasures: false,
    goodNoteBehavior: [
      "materialise prop_can_crushing_intact in the note bar at the performer's lane",
      "swap to hero80_can_crushing_action for the beat",
      "replace it with prop_can_crushing_done and add one to the pile",
      "show fx_can_crushing_impact at the contact point",
    ],
    badNoteBehavior: [
      "materialise the can at the lane the player actually played, not the authored one",
      "it sails into the performer instead of being crushed; the pile does not grow",
      "off-scale or unpitched input spawns the can wobbling rather than snapped to a lane",
    ],
    minigameCompleteBehavior: [
      "if passed, show hero80_can_crushing_finish beside the pile",
      "otherwise leave the performer neutral beside whatever pile was earned",
    ],
  },
  assetBindings: {
    background: ["bg_can_crushing"],
    performerNeutral: ["hero80_can_crushing_ready"],
    performerAction: ["hero80_can_crushing_action"],
    performerFinish: ["hero80_can_crushing_finish"],
    repeatTarget: ["prop_can_crushing_intact"],
    targetCompletedState: ["prop_can_crushing_done"],
    impactEffects: ["fx_can_crushing_impact"],
  },
  assets: [
    {
      id: "bg_can_crushing",
      slot: "background",
      type: "background",
      placeholderSourceId: "goaterizer_generated_crusher",
      sourceSelection: "Beach at golden hour; leave the middle band readable under the timeline.",
      runtimeNotes: "Opaque. Static. One background serves all four levels.",
    },
    {
      id: "hero80_can_crushing_ready",
      slot: "performerNeutral",
      type: "sprite",
      placeholderSourceId: "goaterizer_generated_crusher",
      sourceSelection: "One body, arms down.",
      runtimeNotes: "Persistent ready/reset pose. Held between crushes.",
    },
    {
      id: "hero80_can_crushing_action",
      slot: "performerAction",
      type: "sprite",
      placeholderSourceId: "goaterizer_generated_crusher",
      sourceSelection: "The same body with the crush arm block swapped in.",
      runtimeNotes: "Single repeated successful-note action pose, one beat long.",
    },
    {
      id: "hero80_can_crushing_finish",
      slot: "performerFinish",
      type: "sprite",
      placeholderSourceId: "goaterizer_generated_crusher",
      sourceSelection: "The same body, arms up.",
      runtimeNotes: "Completion pose beside the accumulated pile.",
    },
    {
      id: "prop_can_crushing_intact",
      slot: "repeatTarget",
      type: "prop",
      placeholderSourceId: "goaterizer_generated_crusher",
      sourceSelection: "One can, upright, with a label band.",
      runtimeNotes: "The reusable unit. One instance per note opportunity.",
    },
    {
      id: "prop_can_crushing_done",
      slot: "targetCompletedState",
      type: "prop",
      placeholderSourceId: "goaterizer_generated_crusher",
      sourceSelection: "The same can flattened and splayed, so it reads as the same object.",
      runtimeNotes: "Registered post-action state. Accumulates into the pile.",
    },
    {
      id: "fx_can_crushing_impact",
      slot: "impactEffects[]",
      type: "effect",
      placeholderSourceId: "goaterizer_generated_crusher",
      sourceSelection: "A one-frame spark burst.",
      runtimeNotes: "Immediate hit feedback. Static billboard, not an animation strip.",
    },
  ],
  placeholderSources: [
    {
      id: "goaterizer_generated_crusher",
      title: "GOATerizer generated placeholder art — Can Crushing",
      author: "original work for this repository",
      licence: "CC0 / public domain",
      url: "scripts/lib/crusher-art.mjs",
      note:
        "Generated by scripts/generate-placeholder-art.mjs. No third-party rights are " +
        "involved. Provenance is recorded in docs/assets/ASSET_SOURCES.md.",
    },
  ],
  productionNotes: [
    "PROTOTYPE. This scenario exists to exercise the RepeatMinigame class and the placed-can rule in docs/game-design/PROPOSED_Timeline_Actors.md §5.",
    "The canonical spec puts Can Crushing at L1–7 in the Straight Sixteenths family. The draft authors L1–4 and no sixteenth material; the density ladder is later work.",
    "Every authored note is the run key's root, because the performer is stationary and a can is only crushed on his lane. Authoring off his lane would punish correct play.",
    "The measure plan declares the canonical 1m visual span, but the draft runtime does not reset per measure: the cans are transient by their own lifetime and the pile is deliberately attempt-global spectacle.",
    "Do not animate the placeholder poses as a strip. They are three independent static billboards sharing one body.",
    "The phrase tables and star thresholds are regenerable via scripts/author-can-crushing.mjs.",
  ],
  designerReview: {
    blockingIssues: [],
    nonBlockingTBD: [
      "Star thresholds are authored but PROVISIONAL — see each level's `stars.note`.",
      "The performer does not move between measures. The hook is designed, not built.",
      "L5–7 are unauthored; the canonical spec supports them.",
    ],
  },
  levels: Object.fromEntries([1, 2, 3, 4].map((level) => [String(level), buildLevel(level)])),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(scenario, null, 2)}\n`);

for (const level of scenario.supportedLevels) {
  const data = scenario.levels[String(level)];
  const tokens = data.prompt
    .map((event) => `${event.scaleDegree ?? "-"}${event.duration === "eighth" ? "." : ""}`)
    .join(" ");
  console.log(
    `can_crushing L${level}: ${data.noteOpportunityCount} notes, ` +
      `${data.authoredBeatCount} beats, stars ${data.stars.passThreshold}/` +
      `${data.stars.star2Threshold}/${data.stars.star3Threshold}\n    ${tokens}`
  );
}
console.log(`\nWrote ${path.relative(process.cwd(), OUT_FILE)}`);
