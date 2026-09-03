#!/usr/bin/env node
/**
 * Designer tool: writes `docs/scenarios/butt-butt-bonk/butt_butt_bonk.scenario.json`.
 *
 * Emits the whole file, like `author-goat-frontman.mjs`: the JSON is the
 * runtime authority and nothing regenerates it at play time; this script
 * exists so a designer can re-derive the parts that are painful to hand-edit
 * (the per-partial beat maths, star thresholds, opportunity counts) and read
 * the diff.
 *
 *   node scripts/author-butt-butt-bonk.mjs
 *
 * ## The notation
 *
 * The designer wrote each level as a sequence of **triplet groups** and
 * **quarter rests**, in the diatonic vocabulary this scenario already uses
 * (`1..7`, `b1` for the octave root — `src/music/degrees.ts`). A group
 * `a-b-c` is three eighth-triplet partials filling one beat: two preparatory
 * taps and the headbutt. `rq` is a one-beat rest.
 *
 * Each written line is shorter than the authored four-measure (16-beat)
 * phrase every level plays, so the builder repeats it whole until it reaches
 * 16 beats — the same "repeat what's written to fill four measures" rule
 * `author-goat-frontman.mjs` uses.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "docs", "scenarios", "butt-butt-bonk");
const OUT_FILE = path.join(OUT_DIR, "butt_butt_bonk.scenario.json");
const TUNING_FILE = path.resolve(here, "..", "src", "config", "tuning.ts");

const BEATS_PER_MEASURE = 4;
const PHRASE_MEASURES = 4;
const ATTEMPT_BEATS = BEATS_PER_MEASURE * PHRASE_MEASURES;

/** Mirrors src/config/tuning.ts JUDGMENT_POINTS.perfect. */
const POINTS_PERFECT = 10;

/** See author-goat-frontman.mjs for why this is read rather than mirrored. */
const ATTEMPT_REPEATS = (() => {
  const source = readFileSync(TUNING_FILE, "utf8");
  const match = /export const ATTEMPT_REPEATS\s*=\s*(\d+)/.exec(source);
  return match ? Number(match[1]) : 1;
})();

/** The same provisional ladder every scenario uses — see author-rocky-scenarios.mjs. */
const PASS_FRACTION = 0.45;
const STAR2_FRACTION = 0.8;

/* -------------------------------------------------------------------------- */
/* The designer's lines, verbatim                                             */
/* -------------------------------------------------------------------------- */

const LEVEL_LINES = {
  1: "1-2-3 rq 4-3-2 rq 1-2-3 rq 4-3-2 rq",
  2: "3-4-3 rq 2-1-2 rq 3-4-3 rq 2-1-2 rq",
  3: "1-2-3 4-3-2 1-2-3 4-3-2",
  4: "2-3-4 3-2-1 2-3-4 3-2-1",
  5: "1-2-3 4-3-2 1-2-3 4-5-1",
  6: "2-3-4 3-2-1 2-3-4 5-1-2",
};

const LEVEL_CHARACTER = {
  1: "a rising triplet group answered by a falling one, each followed by a full beat's rest",
  2: "a triplet group that turns back on itself (up then down) answered by one that steps up and back, each followed by a rest",
  3: "the same rising/falling pair as L1, back to back with no rest between groups",
  4: "the same shape as L3, one step higher in the run",
  5: "L3's rising/falling pair, with the last group breaking the pattern to leap up to the octave",
  6: "L4's shape, with the last group breaking the pattern to leap down and back up through the root",
};

/* -------------------------------------------------------------------------- */

/** A written diatonic degree: `1`..`7` or `b1`. */
const DEGREE = /^(?:[1-7]|b1)$/;

/**
 * Reads one written line into a flat list of `[duration, degree, ]` triplet
 * partials and one-beat rests, where `degree` is `null` for a rest.
 *
 * A token is either a triplet group `a-b-c` (three diatonic degrees) or `rq`,
 * a one-beat rest.
 */
function parseLine(text) {
  const tokens = text.trim().split(/\s+/);
  const events = [];
  for (const token of tokens) {
    if (/^rq$/i.test(token)) {
      events.push(["quarter", null]);
      continue;
    }
    const parts = token.split("-");
    if (parts.length !== 3 || !parts.every((p) => DEGREE.test(p))) {
      throw new Error(`cannot read ${JSON.stringify(token)} as a triplet group or "rq"`);
    }
    for (const degree of parts) events.push(["eighthTriplet", degree]);
  }
  return events;
}

const DURATION_BEATS = { quarter: 1, eighthTriplet: 1 / 3 };

function buildPrompt(difficulty) {
  const line = parseLine(LEVEL_LINES[difficulty]);
  const lineBeats = line.reduce((sum, [duration]) => sum + DURATION_BEATS[duration], 0);
  if (ATTEMPT_BEATS % lineBeats > 1e-9) {
    throw new Error(`L${difficulty} line totals ${lineBeats} beats, which does not divide ${ATTEMPT_BEATS}`);
  }
  const repeats = Math.round(ATTEMPT_BEATS / lineBeats);
  const phrase = Array.from({ length: repeats }, () => line).flat();

  let beat = 0;
  const events = phrase.map(([duration, degree], index) => {
    const durationBeats = DURATION_BEATS[duration];
    const startBeat = beat;
    beat += durationBeats;
    const event = {
      index,
      type: degree === null ? "rest" : "note",
      duration,
      durationBeats: Math.round(durationBeats * 1000) / 1000,
      startBeat: Math.round(startBeat * 1000) / 1000,
      startMeasure: Math.floor(startBeat / BEATS_PER_MEASURE) + 1,
      beatWithinMeasure: Math.round(((startBeat % BEATS_PER_MEASURE) + 1) * 1000) / 1000,
    };
    if (degree !== null) event.scaleDegree = degree;
    return event;
  });
  if (Math.abs(beat - ATTEMPT_BEATS) > 1e-6) throw new Error(`phrase totals ${beat} beats, expected ${ATTEMPT_BEATS}`);
  return events;
}

function buildLevel(difficulty) {
  const prompt = buildPrompt(difficulty);
  const notes = prompt.filter((event) => event.type === "note");
  const groups = notes.length / 3;
  if (!Number.isInteger(groups)) throw new Error(`L${difficulty} has ${notes.length} notes, not a multiple of 3`);
  const maxPoints = notes.length * POINTS_PERFECT;
  const attemptMax = maxPoints * ATTEMPT_REPEATS;
  const alternateAfterGroups = Math.max(1, Math.floor(groups / 2));

  return {
    difficulty,
    supported: true,
    measurePlan: {
      attemptMeasures: PHRASE_MEASURES,
      beatsPerMeasure: BEATS_PER_MEASURE,
      visualSpanMeasures: 1,
      resetBetweenMeasures: true,
    },
    prompt,
    noteOpportunityCount: notes.length,
    authoredBeatCount: ATTEMPT_BEATS,
    visual: {
      groupCharacter: LEVEL_CHARACTER[difficulty],
      alternateAfterGroups,
      targetTreatment: "one wolf at the strike line; it sits down once bonked and stands back up on the measure line",
    },
    stars: {
      metric: "judgmentPoints",
      metricNote: "Cumulative judgment points during the attempt: Perfect 10, Good 6, Miss 0. Thresholds lock once earned.",
      passThreshold: Math.round(maxPoints * PASS_FRACTION),
      star2Threshold: Math.round(attemptMax * STAR2_FRACTION),
      star3Threshold: attemptMax,
      provisional: true,
      note:
        `PROVISIONAL. An attempt plays this four-measure phrase ${ATTEMPT_REPEATS} times, so ${attemptMax} ` +
        "judgment points are available (Perfect 10 per opportunity, src/config/tuning.ts JUDGMENT_POINTS). " +
        `Pass is ${PASS_FRACTION * 100}% of a single pass, deliberately NOT scaled, so a good second read ` +
        "redeems a bad first one — the same shape Rocky Ascent uses. Two stars is 80% of the full attempt " +
        "and three stars is 100%, so a triplet exercise still has to be played clean all the way through.",
    },
    scoring: {
      streakBonusEligible: true,
      note:
        "Triplets ARE streak-eligible content (GDD 9.2 points streaks at triplets and sixteenth runs), " +
        "which is what separates this family's scoring from the Scale family's.",
    },
  };
}

const scenario = {
  $schema: "https://goaterizer.local/schema/scenario-v1.json",
  id: "butt_butt_bonk",
  displayName: "Butt-Butt-BONK",
  theme: "GOATS",
  minigameClass: "ThreeStepMinigame",
  family: "Triplets",
  visualVerb: "THREE-STEP",
  supportedLevels: [1, 2, 3, 4, 5, 6],
  scenarioPremise:
    "Two little preparatory horn taps and then a major third impact, delivered to a wolf, in moonlight. " +
    "Altered endings produce different victims or objects; this one produces a wolf that sits down and reconsiders.",
  runTransposition: {
    promptRepresentation: "diatonic_scale_degree",
    degreeVocabulary: ["1", "2", "3", "4", "5", "6", "7", "b1"],
    transposeToRunKey: true,
    nonDiatonicTargetsAllowed: false,
    note: "The two taps repeat a pitch and the third partial leaps off it, so the BONK is audible as well as visible.",
  },
  classParameters: {
    visualSpanMeasures: 1,
    stepRoleSource: "positionWithinBeat",
    stepRoleNote:
      "The A/B/C role comes from where a note sits inside its beat, never from index % 3. Authored rhythm is " +
      "not uniform and counting opportunities gets rests and mixed durations silently wrong.",
    goodNoteBehavior: [
      "show the step pose for that partial at the target's lane",
      "on the third partial, arc the ram from the previous lane to this one",
      "fire the small effect on a tap and the big one on the headbutt",
      "count the group only when both taps landed before the headbutt",
    ],
    badNoteBehavior: [
      "a miss or a wrong note breaks the group; the count resets and no group is credited",
      "the ram never moves to the played pitch — this family's actor is terrain-bound, not a projectile",
    ],
    minigameCompleteBehavior: [
      "if passed, hold goat_butt_butt_bonk_finish",
      "the wolf keeps whichever state the last measure left it in",
    ],
  },
  assetBindings: {
    background: ["bg_butt_butt_bonk"],
    stepAPoseOrEffect: ["goat_butt_butt_bonk_step_1"],
    stepBPoseOrEffect: ["goat_butt_butt_bonk_step_2"],
    stepCPoseOrEffect: ["goat_butt_butt_bonk_step_3"],
    alternateStepC: ["goat_butt_butt_bonk_step_3_alt"],
    finishPose: ["goat_butt_butt_bonk_finish"],
    targetVisuals: ["prop_butt_butt_bonk_target", "prop_butt_butt_bonk_target_hit"],
    minorStepEffects: ["fx_butt_butt_bonk_hit_small"],
    majorStepEffects: ["fx_butt_butt_bonk_hit_big"],
    groupEffects: ["fx_butt_butt_bonk_accent"],
  },
  placeholderSources: [
    {
      id: "sevarihk_mountain_goat",
      title: "Mountain Goat Sprites",
      author: "Sevarihk",
      licence: "CC-BY 4.0",
      url: "https://opengameart.org/content/mountain-goat-sprites",
      note: "The ram: two walk frames as the taps, bocksprung as the headbutt, grazing as the finish.",
    },
    {
      id: "alizard_pixel_wolf",
      title: "pixel wolf",
      author: "alizard",
      licence: "CC0",
      url: "https://opengameart.org/content/pixel-wolf",
      note: "The target. Its teal is an opaque background and is keyed out at import.",
    },
    {
      id: "dustdfg_mountains_parallax",
      title: "Pixel Art Mountains Parallax",
      author: "Yevhen Babiichuk (DustDFG)",
      licence: "CC0",
      url: "https://opengameart.org/content/pixel-art-mountains-parallax",
      note: "Eight layers flattened, recoloured to moonlight, moon drawn on top.",
    },
    {
      id: "codemanu_pixel_fx",
      title: "Free Pixel Effects Pack",
      author: "CodeManu",
      licence: "CC0",
      url: "https://opengameart.org/content/free-pixel-effects-pack",
      note: "One expanding ring caught early for a tap and late for the headbutt; a vertical flash for the group accent.",
    },
  ],
  productionNotes: [
    "The FIRST scenario in this repository built from third-party art rather than generated placeholders. Sources are vendored under art-sources/ and derived by scripts/import-scenario-art.mjs; nothing is fetched at build time or hotlinked at runtime.",
    "The first authored triplet content in the game, so it is also the first thing to select the drum kit's triplet rhythm variant, which was built and tested but had never been heard.",
    "No level contains a sixteenth. A level must test triplets OR sixteenths, never both (src/audio/drum-pattern.ts, asserted by tests/drum-intensity.test.ts).",
    "L1-6 per the catalogue. L7 is deliberately absent, matching the catalogue's supported range; the run's L7 content gap stays open.",
    "Authored from the designer's triplet-group notation (`a-b-c` for a group, `rq` for a one-beat rest); see scripts/author-butt-butt-bonk.mjs. L1/L2 write two groups separated by rests and repeat that twice; L3/L4/L6 write four groups back to back with no rest and repeat that four times; L5 does the same but breaks the pattern in its last group.",
    "The phrase tables and star thresholds are regenerable via scripts/author-butt-butt-bonk.mjs.",
  ],
  designerReview: {
    blockingIssues: [],
    nonBlockingTBD: [
      "Star thresholds are PROVISIONAL, following Rocky Ascent's shape rather than a played measurement.",
      "alternateAfterGroups is set to half of each level's authored group count and has not been playtested; nothing has confirmed where the alternate ending should start.",
      "The wolf stands at one lane offset from the strike line for the whole attempt. Letting it close in between measures is the obvious next iteration and is BattleMinigame's mechanic, not this family's.",
    ],
  },
  levels: Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [String(level), buildLevel(level)])),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(scenario, null, 2)}\n`);

for (const level of scenario.supportedLevels) {
  const data = scenario.levels[String(level)];
  const groups = data.noteOpportunityCount / 3;
  console.log(
    `butt_butt_bonk L${level}: ${data.noteOpportunityCount} notes (${groups} groups), ` +
      `alternate after ${data.visual.alternateAfterGroups}, stars ${data.stars.passThreshold}/` +
      `${data.stars.star2Threshold}/${data.stars.star3Threshold}\n    ${LEVEL_LINES[level]}`
  );
}
console.log(`\nWrote ${path.relative(process.cwd(), OUT_FILE)}`);
