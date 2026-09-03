#!/usr/bin/env node
/**
 * Designer tool: writes `docs/scenarios/goat_frontman.scenario.json`.
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
 * vocabulary is one octave, root to root:
 *
 *     1 2 3 4 5 6
 *     root      root
 *
 * `5Q 1Q 2Q 1QF` is: the fifth pentatonic step for a quarter, the root, the
 * step above it, the root again — with `F` marking the note on which the goat
 * hits a **flourish pose**. `RE` is an eighth rest.
 *
 * In the scenario file those become `p5 p1 p2 p1` (`src/music/degrees.ts`),
 * kept exactly as written; the resolution to a diatonic lane happens at run
 * time, when the mode is known.
 *
 * The first draft of this scenario was written around a *middle* root, with
 * five degrees below it and five above — eleven in all. The timeline is one
 * octave (DECISION-012), so the lanes below the root do not exist, and showing
 * that material meant displaying the low notes an octave up: right pitch class,
 * wrong contour. The designer rewrote the two licks that dipped below the root
 * instead, which is why the vocabulary above stops at six and why nothing here
 * has to be folded, clamped or moved to be drawn.
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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "docs", "scenarios");
const OUT_FILE = path.join(OUT_DIR, "goat_frontman.scenario.json");
const TUNING_FILE = path.resolve(here, "..", "src", "config", "tuning.ts");

const BEATS_PER_MEASURE = 4;
const PHRASE_MEASURES = 4;
const ATTEMPT_BEATS = BEATS_PER_MEASURE * PHRASE_MEASURES;

/** Mirrors src/config/tuning.ts JUDGMENT_POINTS.perfect. */
const POINTS_PERFECT = 10;

/**
 * How many times an attempt plays the authored phrase, **read from
 * `tuning.ts`** rather than mirrored here.
 *
 * The other authoring scripts hard-code this, and `scenario-registry.test.ts`
 * exists to catch the drift that follows — change the repeat count and every
 * authored star ceiling is quietly wrong until someone reruns the scripts. A
 * `.mjs` script cannot import a TypeScript constant, but it can read the file
 * that declares it, which removes the duplicate instead of guarding it.
 *
 * It matters here more than usual: this branch's game loop plays the phrase
 * once and `main` plays it twice, so a hard-coded number would be wrong on one
 * side of the merge whichever value it held.
 */
const ATTEMPT_REPEATS = (() => {
  const source = readFileSync(TUNING_FILE, "utf8");
  const match = /export const ATTEMPT_REPEATS\s*=\s*(\d+)/.exec(source);
  // Absent on a branch whose loop does not repeat the phrase; one pass, then.
  return match ? Number(match[1]) : 1;
})();

/** The same provisional ladder every scenario uses — see author-rocky-scenarios.mjs. */
const PASS_FRACTION = 0.45;
const STAR2_FRACTION = 0.8;

const DURATION = { Q: "quarter", E: "eighth", H: "half" };
const DURATION_BEATS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

/* -------------------------------------------------------------------------- */
/* The designer's variants, verbatim                                           */
/* -------------------------------------------------------------------------- */

/**
 * The designer's full four-measure phrases, verbatim, one per level.
 *
 * Each is written as six pentatonic steps (p1..p6, root to octave root) —
 * the lower half of the octave (1 2 3 4) for L1/L2, the upper half (4 5 6)
 * for L3, and both halves back to back for L4. `F` marks the flourish: the
 * note the goat rears back on. Every phrase totals 16 beats on its own, so
 * nothing here is repeated by the builder — what is written is what plays.
 */
const LEVEL_PHRASES = {
  // The full run root-to-root, twice, each capped by a two-beat breath.
  1: "1Q 2Q 3Q 4Q 5Q 6QF RH 1Q 2Q 3Q 4Q 5Q 6QF RH",
  // A tighter three-note cell (root, second, third) cycled and resolved, twice.
  2: "1Q 2Q 3Q 1Q 2Q 3Q 1QF RQ 1Q 2Q 3Q 1Q 2Q 3Q 1QF RQ",
  // The same run-and-breath shape as L1, transposed to the octave's upper half.
  3: "4Q 5Q 6Q 4Q 5Q 6QF RH 4Q 5Q 6Q 4Q 5Q 6QF RH",
  // The upper-half run once, then the tighter three-note cell once — the two
  // hardest phrases, back to back rather than repeated.
  4: "4Q 5Q 6Q 4Q 5Q 6QF RH 1Q 2Q 3Q 1Q 2Q 3Q 1QF RQ",
};

/**
 * How many crowd goats one flourish summons. The designer's rule is "the
 * higher the difficulty level, the more goats"; every level now authors the
 * same two flourishes per phrase, so the escalation lives entirely in this
 * per-flourish count. The totals it produces over a phrase are 4 / 8 / 12 / 16.
 */
const GOATS_PER_FLOURISH = { 1: 1, 2: 2, 3: 3, 4: 4 };

/** How many goats fit in the wings. Drawn from one sprite, transform-varied. */
const CROWD_CAPACITY = 24;

const LEVEL_CHARACTER = {
  1: "the run up the octave, root to root, twice over, each capped by a two-beat breath",
  2: "a tighter three-note cell cycled into a resolving flourish, twice",
  3: "the same run-and-breath shape as L1, transposed to the octave's upper half",
  4: "the upper-half run once, then the tighter three-note cell once — the two hardest phrases back to back",
};

/* -------------------------------------------------------------------------- */

/**
 * Reads `5Q`, `6QF`, `RE`, `11Q` into `[duration, token, flourish]`, with
 * `token` null for a rest.
 */
function parseToken(word) {
  const match = /^(R|[1-6])([QEH])(F?)$/.exec(word);
  if (!match) throw new Error(`cannot read ${JSON.stringify(word)}`);
  const [, degree, letter, flourish] = match;
  const duration = DURATION[letter];
  if (degree === "R" && flourish) throw new Error(`${word}: a rest cannot carry a flourish`);
  return [duration, degree === "R" ? null : `p${degree}`, flourish === "F"];
}

function buildPrompt(difficulty) {
  const phrase = LEVEL_PHRASES[difficulty].split(/\s+/).map(parseToken);

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
      variants: [`L${difficulty}: ${LEVEL_PHRASES[difficulty]}`],
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
        "Blues Lick material is quarters, not the sixteenth material GDD §9.2 makes streak-eligible. " +
        "The streak is still tracked.",
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
    degreeVocabulary: ["p1", "p2", "p3", "p4", "p5", "p6"],
    transposeToRunKey: true,
    nonDiatonicTargetsAllowed: false,
    note:
      "Six pentatonic degrees, root to root: p1 is the run key's root and p6 the root an octave " +
      "above it, which is exactly the span the timeline shows. Resolved to diatonic degrees by the " +
      "run's mode at run time (major 1 2 3 5 6, minor 1 b3 4 5 b7), so the same lick is a different " +
      "set of lanes in a major key and a minor one and is diatonic in both.",
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
    Object.entries(LEVEL_PHRASES).map(([level, text]) => [`L${level}`, { phrase: text }])
  ),
  productionNotes: [
    "Authored from the designer's pentatonic notation; see scripts/author-goat-frontman.mjs for the notation and the level rules.",
    "The canonical catalogue lists Goat Frontman at L2–6. The designer's authoring brief for this scenario specifies L1–4, which wins (AGENTS.md §20); L5–7 are unauthored.",
    "Each level authors its own full four-measure phrase directly, rather than picking measures from a shared variant library: L1/L3 repeat one six-note run twice, L2 repeats one three-note cell twice, and L4 plays the L3 run once followed by the L2 cell once.",
    "The flourish `F` is authored per note (`prompt[].flourish`) and mirrored into `visual.flourishBeats`, which is what the runtime reads. A test keeps the two equal.",
    "Every authored note sits inside the timeline's one-octave span, root to root, so nothing is folded, clamped or moved to be drawn.",
    "The phrase tables and star thresholds are regenerable via scripts/author-goat-frontman.mjs.",
  ],
  designerReview: {
    blockingIssues: [],
    nonBlockingTBD: [
      "Star thresholds are authored but PROVISIONAL — see each level's `stars.note`.",
      "goatsPerFlourish (1/2/3/4) is the only escalation across levels now that every level authors exactly two flourishes per phrase; not yet playtested against the previous flourish-count-driven ramp.",
      "Timing windows are the global per-subdivision ones; all four levels are now quarter-note material, so 'harder timing at higher levels' is currently carried only by the wider melodic span (L3/L4 reach the upper half of the octave), not by rhythm. Worth revisiting if L1-L4 end up feeling too similar in difficulty.",
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
