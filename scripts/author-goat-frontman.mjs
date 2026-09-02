#!/usr/bin/env node
/**
 * Designer tool: writes `docs/scenarios/goat-frontman/goat_frontman.scenario.json`.
 *
 * Emits the whole file, like `author-can-crushing.mjs`: Goat Frontman is new
 * and the committed JSON has no hand edits to preserve yet. The committed JSON
 * is what the game imports; nothing regenerates it at play time.
 *
 *   node scripts/author-goat-frontman.mjs
 *
 * ## The notation
 *
 * The designer wrote this scenario in **pentatonic** degrees, because the
 * Blues Lick family lives in the pentatonic scale and the same lick is a
 * different set of roman numerals in a major key and a minor one. The
 * vocabulary counts eleven degrees across two octaves:
 *
 *     1 2 3 4 5   6   7 8 9 10   11
 *     low octave  mid root        high root
 *
 * `5Q 6Q 7Q 6QF` is: the fifth pentatonic step below the middle root for a
 * quarter, the root, the step above it, the root again — with `F` marking the
 * note on which the goat hits a **flourish pose**. `RE` is an eighth rest.
 *
 * In the scenario file those become `p5 p6 p7 p6` (`src/music/degrees.ts`),
 * kept exactly as written; the resolution to a diatonic lane happens at run
 * time, when the mode is known. Note that the timeline is one octave and the
 * low octave (`p1..p5`) is currently *folded up* into it — provisional, see
 * `PENTATONIC_LOW_OCTAVE_FOLDS_UP` and `DECISION_LOG.md`.
 *
 * ## The ladder
 *
 * The designer's rules, verbatim:
 *
 *   L1: repeat a single variant 4 times.
 *   L2: pick two variants from L1; the four measures are two repeats of each
 *       picked variant, in any order.
 *   L3: tougher timing; a new set of four variants (repeated 4 times, as L1).
 *   L4: pick two variants from L3; play the two variants twice, in any order.
 *
 * "Pick" is done here, once, by hand — the scenario is hand-authored data and
 * the game does not roll a variant per attempt (`AGENTS.md` §6, §18). The full
 * variant libraries are kept below so a designer can re-pick by editing
 * `PICKS` and re-running; the unpicked variants are authored content waiting
 * for a use, not a leftover.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "docs", "scenarios", "goat-frontman");
const OUT_FILE = path.join(OUT_DIR, "goat_frontman.scenario.json");

const BEATS_PER_MEASURE = 4;
const PHRASE_MEASURES = 4;
const ATTEMPT_BEATS = BEATS_PER_MEASURE * PHRASE_MEASURES;

/** Mirrors src/config/tuning.ts JUDGMENT_POINTS.perfect. */
const POINTS_PERFECT = 10;
/**
 * Mirrors how many times an attempt plays the authored phrase. This branch's
 * game loop plays it once; `main` plays it `ATTEMPT_REPEATS` (2) times and its
 * registry test asserts every authored ceiling against that constant. When
 * these meet, set this to 2 and re-run.
 */
const ATTEMPT_REPEATS = 1;

/** The same provisional ladder every scenario uses — see author-rocky-scenarios.mjs. */
const PASS_FRACTION = 0.45;
const STAR2_FRACTION = 0.8;

const DURATION = { Q: "quarter", E: "eighth", H: "half" };
const DURATION_BEATS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

/* -------------------------------------------------------------------------- */
/* The designer's variants, verbatim                                           */
/* -------------------------------------------------------------------------- */

const VARIANTS = {
  1: {
    1: "5Q 6Q 7Q 6QF",
    2: "5E 5E 6Q 7Q 6QF",
    3: "8Q 6Q 9Q 6QF",
    4: "3Q 4Q 5Q 4Q",
  },
  3: {
    1: "5E 6E 7Q 6HF",
    2: "5E 5E 6E 7E 6Q RE 7EF",
    3: "8E 6E 9E 6Q RE 11Q",
    4: "2E 3E 4Q 3E 2E 1Q",
  },
};

/**
 * Which variants each level plays, measure by measure.
 *
 * L1 and L3 repeat one variant; L2 and L4 pick two. L2 plays them AABB so the
 * switch happens once, L4 plays them ABAB so the player changes lick every
 * bar — that is the extra difficulty the pick order can carry, and the only
 * thing "in any order" is allowed to mean once it is written down.
 */
const PICKS = {
  1: { library: 1, order: [1, 1, 1, 1] },
  2: { library: 1, order: [2, 2, 3, 3] },
  3: { library: 3, order: [1, 1, 1, 1] },
  4: { library: 3, order: [2, 3, 2, 3] },
};

/**
 * How many crowd goats one flourish summons. The designer's rule is "the
 * higher the difficulty level, the more goats"; this is the per-flourish
 * count, and the totals it produces over a phrase are 4 / 8 / 12 / 12. L4 has
 * half as many flourishes as L3, so it summons twice as many per flourish
 * rather than ending with a thinner crowd than the level below it.
 */
const GOATS_PER_FLOURISH = { 1: 1, 2: 2, 3: 3, 4: 6 };

/** How many goats fit in the wings. Drawn from one sprite, transform-varied. */
const CROWD_CAPACITY = 24;

const LEVEL_CHARACTER = {
  1: "one lick, four times over; a flourish on every downbeat-to-be, and one goat wanders in for each",
  2: "two licks, each twice — eighths first, then the wide leap to the fourth",
  3: "the lick in eighths with a held flourish at the end of every bar",
  4: "the two hardest licks alternating every bar, with a rest and an off-beat flourish to land",
};

/* -------------------------------------------------------------------------- */

/**
 * Reads `5Q`, `6QF`, `RE`, `11Q` into `[duration, token, flourish]`, with
 * `token` null for a rest.
 */
function parseToken(word) {
  const match = /^(R|[1-9]|1[01])([QEH])(F?)$/.exec(word);
  if (!match) throw new Error(`cannot read ${JSON.stringify(word)}`);
  const [, degree, letter, flourish] = match;
  const duration = DURATION[letter];
  if (degree === "R" && flourish) throw new Error(`${word}: a rest cannot carry a flourish`);
  return [duration, degree === "R" ? null : `p${degree}`, flourish === "F"];
}

function parseVariant(text) {
  const events = text.split(/\s+/).map(parseToken);
  const beats = events.reduce((sum, [duration]) => sum + DURATION_BEATS[duration], 0);
  if (beats !== BEATS_PER_MEASURE) {
    throw new Error(`variant ${JSON.stringify(text)} totals ${beats} beats, expected ${BEATS_PER_MEASURE}`);
  }
  return events;
}

function buildPrompt(difficulty) {
  const pick = PICKS[difficulty];
  const phrase = pick.order.flatMap((variant) => parseVariant(VARIANTS[pick.library][variant]));

  let beat = 0;
  const events = phrase.map(([duration, token, flourish], index) => {
    const durationBeats = DURATION_BEATS[duration];
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
    // Human-readable marker for the designer's `F`. The host ignores it; the
    // runtime reads `visual.flourishBeats` below, and a test keeps them equal.
    if (flourish) event.flourish = true;
    return event;
  });
  if (beat !== ATTEMPT_BEATS) throw new Error(`phrase totals ${beat} beats, expected ${ATTEMPT_BEATS}`);
  return events;
}

function buildLevel(difficulty) {
  const prompt = buildPrompt(difficulty);
  const notes = prompt.filter((event) => event.type === "note");
  const maxPoints = notes.length * POINTS_PERFECT;
  const attemptMax = maxPoints * ATTEMPT_REPEATS;
  const flourishBeats = prompt.filter((event) => event.flourish).map((event) => event.startBeat);
  const pick = PICKS[difficulty];

  return {
    difficulty,
    supported: true,
    measurePlan: {
      attemptMeasures: PHRASE_MEASURES,
      beatsPerMeasure: BEATS_PER_MEASURE,
      // Canonical for every PERFORM scenario: 4m continuous.
      visualSpanMeasures: 4,
      resetBetweenMeasures: false,
    },
    prompt,
    noteOpportunityCount: notes.length,
    authoredBeatCount: ATTEMPT_BEATS,
    visual: {
      levelCharacter: LEVEL_CHARACTER[difficulty],
      variants: pick.order.map((variant) => `L${pick.library} variant ${variant}: ${VARIANTS[pick.library][variant]}`),
      visualSpanMeasures: 4,
      resetBetweenMeasures: false,
      flourishBeats,
      goatsPerFlourish: GOATS_PER_FLOURISH[difficulty],
      expectedCrowd: Math.min(CROWD_CAPACITY, flourishBeats.length * GOATS_PER_FLOURISH[difficulty] * ATTEMPT_REPEATS),
      progressTrigger: "successful_note_on_a_flourish_opportunity",
    },
    stars: {
      metric: "judgmentPoints",
      metricNote:
        "Cumulative judgment points during the attempt: Perfect 10, Good 6, Miss 0 " +
        "(src/config/tuning.ts JUDGMENT_POINTS). Thresholds are cumulative and lock once earned.",
      passThreshold: Math.round(maxPoints * PASS_FRACTION),
      star2Threshold: Math.round(attemptMax * STAR2_FRACTION),
      star3Threshold: attemptMax,
      provisional: true,
      note:
        `PROVISIONAL. ${attemptMax} points are available across the attempt. Pass is ` +
        `${PASS_FRACTION * 100}% of a single pass (${maxPoints}), two stars ${STAR2_FRACTION * 100}% ` +
        "and three stars 100% of the full attempt, so ★★★ requires every note opportunity taken at Perfect.",
    },
    validation: { status: "ok", issues: [] },
    scoring: {
      streakBonusEligible: false,
      note:
        "Blues Lick material is quarters, eighths and a held half, not the sixteenth material " +
        "GDD §9.2 makes streak-eligible. The streak is still tracked.",
    },
  };
}

const scenario = {
  $schema: "https://goaterizer.local/schema/scenario-v1.json",
  id: "goat_frontman",
  displayName: "Goat Frontman",
  theme: "GOATS",
  minigameClass: "PerformMinigame",
  family: "Blues Lick",
  visualVerb: "PERFORM",
  supportedLevels: [1, 2, 3, 4],
  scenarioPremise:
    "A goat performs for a herd. Every note works the crowd; on the flourish notes the goat rears " +
    "back like a stadium-rock singer, and each flourish it lands brings more goats wandering in " +
    "from the wings to watch. The higher the level, the bigger the crowd a flourish draws.",
  runTransposition: {
    promptRepresentation: "pentatonic_scale_degree",
    degreeVocabulary: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"],
    transposeToRunKey: true,
    nonDiatonicTargetsAllowed: false,
    note:
      "Eleven pentatonic degrees over two octaves, p6 the middle root. Resolved to diatonic degrees " +
      "by the run's mode at run time (major 1 2 3 5 6, minor 1 b3 4 5 b7). The timeline is one octave, " +
      "so p1..p5 are currently shown an octave up (src/music/degrees.ts PENTATONIC_LOW_OCTAVE_FOLDS_UP).",
  },
  classParameters: {
    visualSpanMeasures: 4,
    badNotePolicy: "Embarrass",
    crowdCapacity: CROWD_CAPACITY,
    goodNoteBehavior: [
      "cycle the performer pose",
      "show fx_goat_frontman_sparkle at the note, stronger for Perfect",
      "on a flourish note: swap to a flourishPoses[] entry for the note's length, show fx_goat_frontman_swoosh",
      "on a flourish note: summon goatsPerFlourish crowd goats, who walk in from the wings (Good summons half)",
    ],
    badNoteBehavior: [
      "the performer flinches — a brief tilt and dip — and returns to the same pose",
      "the crowd loses interest for a beat: every goat drops to react_goat_frontman_neutral and slumps",
      "no goat ever leaves; earned crowd is attempt-global spectacle",
    ],
    starBehavior: [
      "★★: the crowd swaps to react_goat_frontman_impressed and starts bouncing",
      "★★★: fx_goat_frontman_burst over the performer and the whole crowd jumps",
    ],
    minigameCompleteBehavior: [
      "if passed, hold goat_goat_frontman_finish",
      "otherwise freeze on the current performer pose in front of whatever crowd was earned",
    ],
  },
  assetBindings: {
    background: ["bg_goat_frontman"],
    performerPoses: [
      "goat_goat_frontman_perform_01",
      "goat_goat_frontman_perform_02",
      "goat_goat_frontman_perform_03",
      "goat_goat_frontman_perform_04",
    ],
    flourishPoses: ["goat_goat_frontman_bend", "goat_goat_frontman_slur"],
    finishPose: ["goat_goat_frontman_finish"],
    signatureProps: ["prop_goat_frontman_signature"],
    audienceStates: ["react_goat_frontman_neutral", "react_goat_frontman_impressed"],
    flourishEffects: ["fx_goat_frontman_swoosh"],
    accentEffects: ["fx_goat_frontman_sparkle"],
    payoffEffects: ["fx_goat_frontman_burst"],
    noteArt: {
      body: ["note_goat_frontman_light"],
      flourish: ["note_goat_frontman_star"],
    },
  },
  assets: [
    ["bg_goat_frontman", "background", "background", "A stadium stage: truss and bulbs along the top, two coloured beams crossing the lane band, speaker stacks in the wings, a floor strip along the bottom for the performer and the crowd.", "Opaque. Static. One background serves all four levels."],
    ["goat_goat_frontman_perform_01", "performerPoses[]", "sprite", "The Rocky goat body in a black coat with gold horns; square stance.", "Reusable normal-note pose cycle, one per successful note."],
    ["goat_goat_frontman_perform_02", "performerPoses[]", "sprite", "Same body, front hoof reaching.", "Reuse cyclically."],
    ["goat_goat_frontman_perform_03", "performerPoses[]", "sprite", "Same body, pushing off.", "Reuse cyclically."],
    ["goat_goat_frontman_perform_04", "performerPoses[]", "sprite", "Same body, legs gathered.", "Reuse cyclically."],
    ["goat_goat_frontman_bend", "flourishPoses[]", "sprite", "Reared backward like a stadium-rock singer, head thrown back, one hoof up.", "Held for the flourish note's length. Flourishes alternate between the two poses."],
    ["goat_goat_frontman_slur", "flourishPoses[]", "sprite", "The headbang: head down between the front legs, horns forward.", "Held for the flourish note's length."],
    ["goat_goat_frontman_finish", "finishPose", "sprite", "Reared up, chin insufferably high.", "Held from completion if the attempt passed."],
    ["prop_goat_frontman_signature", "signatureProps[]", "sprite", "A mic stand.", "Placed beside the performer. Static."],
    ["react_goat_frontman_neutral", "audienceStates[]", "sprite", "One small white goat, standing, facing the stage.", "Instantiated once per crowd goat, transform-varied. Never animated."],
    ["react_goat_frontman_impressed", "audienceStates[]", "sprite", "The same goat up on its hind legs, mouth open.", "Swapped in at ★★ for every goat at once."],
    ["fx_goat_frontman_swoosh", "flourishEffects[]", "effect", "An arc of stage light.", "One frame at the performer on a flourish."],
    ["fx_goat_frontman_sparkle", "accentEffects[]", "effect", "A four-point glint.", "At the note that was hit; smaller for Good."],
    ["fx_goat_frontman_burst", "payoffEffects[]", "effect", "A starburst.", "Once, over the performer, at ★★★."],
    ["note_goat_frontman_light", "noteArt.body", "sprite", "A bar of stage light, banded horizontally.", "Stretched to every note's rect."],
    ["note_goat_frontman_star", "noteArt.flourish", "sprite", "A gold star.", "Overlaid on every flourish note so the pose is visible before it arrives."],
  ].map(([id, slot, type, sourceSelection, runtimeNotes]) => ({
    id,
    slot,
    type,
    placeholderSourceId: "goaterizer_generated_frontman",
    sourceSelection,
    runtimeNotes,
  })),
  placeholderSources: [
    {
      id: "goaterizer_generated_frontman",
      title: "GOATerizer generated placeholder art — Goat Frontman",
      author: "original work for this repository",
      licence: "CC0 / public domain",
      url: "scripts/lib/frontman-art.mjs",
      note:
        "Generated by scripts/generate-placeholder-art.mjs. No third-party rights are involved. " +
        "Provenance and the intended third-party swap-ins are recorded in docs/assets/ASSET_SOURCES.md.",
    },
  ],
  variantLibrary: Object.fromEntries(
    Object.entries(VARIANTS).map(([library, variants]) => [
      `L${library}`,
      Object.fromEntries(Object.entries(variants).map(([n, text]) => [`variant ${n}`, text])),
    ])
  ),
  productionNotes: [
    "Authored from the designer's pentatonic notation; see scripts/author-goat-frontman.mjs for the notation and the level rules.",
    "The canonical catalogue lists Goat Frontman at L2–6. The designer's authoring brief for this scenario specifies L1–4, which wins (AGENTS.md §20); L5–7 are unauthored.",
    "L2 and L4 pick two variants each from the previous library. The picks are fixed here, not rolled per attempt: the game does not procedurally choose exercises. The unpicked variants stay in `variantLibrary`.",
    "The flourish `F` is authored per note (`prompt[].flourish`) and mirrored into `visual.flourishBeats`, which is what the runtime reads. A test keeps the two equal.",
    "Every note in the low octave (p1..p5) is displayed an octave up while the timeline is one octave. Provisional; the authored file is already correct for a two-octave timeline.",
    "The phrase tables and star thresholds are regenerable via scripts/author-goat-frontman.mjs.",
  ],
  designerReview: {
    blockingIssues: [],
    nonBlockingTBD: [
      "Star thresholds are authored but PROVISIONAL — see each level's `stars.note`.",
      "L1 variant 4 and L3 variant 4 (the low-octave scale figures) are authored but unpicked.",
      "The low-octave fold changes the contour of the one note below the root in variants 1 and 2. Reverts to the written contour when the timeline shows two octaves.",
      "Timing windows are the global per-subdivision ones; 'harder timing at higher levels' is carried by the material (eighths, a rest, an off-beat flourish), not by scenario-specific windows.",
    ],
  },
  levels: Object.fromEntries([1, 2, 3, 4].map((level) => [String(level), buildLevel(level)])),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(scenario, null, 2)}\n`);

for (const level of scenario.supportedLevels) {
  const data = scenario.levels[String(level)];
  const tokens = data.prompt
    .map((event) => `${event.scaleDegree ?? "R"}${event.duration[0].toUpperCase()}${event.flourish ? "F" : ""}`)
    .join(" ");
  console.log(
    `goat_frontman L${level}: ${data.noteOpportunityCount} notes, ${data.visual.flourishBeats.length} flourishes, ` +
      `${data.visual.goatsPerFlourish} goats each, stars ${data.stars.passThreshold}/` +
      `${data.stars.star2Threshold}/${data.stars.star3Threshold}\n    ${tokens}`
  );
}
console.log(`\nWrote ${path.relative(process.cwd(), OUT_FILE)}`);
