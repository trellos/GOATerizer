#!/usr/bin/env node
/**
 * Designer tool: rewrites the authored musical content of the four Rocky-family
 * scenario files under `docs/scenarios/`.
 *
 * The JSON is the runtime authority — the game imports it directly, and nothing
 * regenerates it at play time. This script exists so a designer can re-derive
 * the parts that are painful to hand-edit (phrase arrays whose beat maths has to
 * add to exactly 16, star thresholds, and Rocky Ascent's waypoint coordinates)
 * and then read the diff. The committed JSON is what ships.
 *
 *   node scripts/author-rocky-scenarios.mjs
 *
 * What it writes, per scenario:
 *   - `scenarioPremise` and `productionNotes`;
 *   - `runTransposition` — the authored degree vocabulary;
 *   - per level: `prompt[]`, `noteOpportunityCount`, `authoredBeatCount`,
 *     `stars` (provisional, in judgment points), `scoring`, and the
 *     `routeCharacter` prose;
 *   - `visual.route` — but only for scenarios with a ROUTES spec below
 *     (currently Rocky Ascent). For the rest the existing hand-tuned route is
 *     preserved and only checked: one waypoint per note opportunity.
 *
 * Everything else in each file (asset bindings, placeholder sources, waypoint
 * coordinates outside Rocky Ascent) is preserved untouched.
 *
 * THE PITCH SPACE IS ONE OCTAVE. The timeline is eight lanes, root to root, so
 * the authored vocabulary is `1..7` plus `b1`, the root above. The tokens
 * `b2..b7` and `c1` belonged to the retired two-octave timeline and are now
 * parse errors, not silently folded notes (`src/music/degrees.ts`).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarioPath = (dir, file) =>
  path.resolve(here, "..", "docs", "scenarios", dir, `${file}.scenario.json`);

const BEATS_PER_MEASURE = 4;
const ATTEMPT_BEATS = 16;

/** Judgment points per outcome. Mirrors src/config/tuning.ts JUDGMENT_POINTS. */
const POINTS_PERFECT = 10;
/**
 * Mirrors src/config/tuning.ts ATTEMPT_REPEATS: an attempt plays the authored
 * phrase this many times, so the points available in one are this multiple of
 * the phrase's own maximum. Kept in step by tests/scenario-registry.test.ts.
 */
const ATTEMPT_REPEATS = 2;

/**
 * Provisional star fractions of the all-Perfect maximum. ★★★ is the maximum.
 *
 * The ladder these produce, and why:
 *   ★   45% — hitting roughly three quarters of the notes, loosely, survives.
 *              An attempt that takes every note at Good scores 60% and clears
 *              this comfortably, which is what "Good is successful but
 *              scruffy" has to mean if a star is to be winnable at L1.
 *   ★★  80% — out of reach on Good alone; needs real accuracy.
 *   ★★★ 100% — every note opportunity taken at Perfect.
 */
const PASS_FRACTION = 0.45;
const STAR2_FRACTION = 0.8;

const DURATION_BEATS = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
};

/* -------------------------------------------------------------------------- */
/* Authored phrases                                                            */
/* -------------------------------------------------------------------------- */

/** The octave, root to root, and back down again. */
const ASC = ["1", "2", "3", "4", "5", "6", "7", "b1"];
const DESC = ["b1", "7", "6", "5", "4", "3", "2", "1"];

/**
 * The same octave, sequenced in threes: `1 2 3 | 2 3 4 | 3 4 5 | 4 5 6` and
 * then a straight run `5 6 7 b1` to the top.
 *
 * This is what the `_high` scenarios are for now that there is no second octave
 * to be higher *in*. A sequence is the standard next step after a straight run
 * in any scale practice: the notes are the ones the player already knows, but
 * the hand pattern shifts every three notes instead of running in one
 * direction, which is a genuinely harder exercise at the same tempo. Sixteen
 * notes, so it lands exactly on the four-measure grid.
 */
const SEQ_ASC = [
  "1", "2", "3",
  "2", "3", "4",
  "3", "4", "5",
  "4", "5", "6",
  "5", "6", "7", "b1",
];
const SEQ_DESC = [
  "b1", "7", "6",
  "7", "6", "5",
  "6", "5", "4",
  "5", "4", "3",
  "4", "3", "2", "1",
];

const q = (tokens) => tokens.map((token) => ["quarter", token]);
const e = (tokens) => tokens.map((token) => ["eighth", token]);

/**
 * `[duration, token]`, where `token` is an authored octave-band token or `null`
 * for a rest. Every phrase totals exactly {@link ATTEMPT_BEATS}.
 *
 * Rocky Ascent's rhythms are unchanged from the two-octave originals: the same
 * quarter/half/eighth ladder, with the two-octave runs replaced by repeated
 * one-octave runs. That keeps every level's note count — and therefore its
 * waypoint route and star thresholds — exactly as authored.
 */
const SCENARIOS = [
  {
    dir: "rocky-ascent",
    file: "rocky_ascent",
    levels: [1, 2, 3, 4],
    premise:
      "A goat climbs an orderly sequence of alpine boulders. Higher levels reuse the same small " +
      "art library but author increasingly steep, exposed, and ridiculous waypoint paths.",
    productionNotes: [
      "Placeholder sources do not need to match perfectly in palette or pixel density; normalize nearest-neighbor scale and color treatment in the prototype.",
      "Do not animate the source strips/GIFs as traditional animation. Extract individual frames and treat them as independent static billboards.",
      "Rocky Ascent remains a precision/progress scene, not a danger scene; even L4 should read as absurd commitment rather than chase/survival.",
      "One successful note opportunity advances exactly one waypoint.",
      "The exercise is one octave, root to root. Higher levels climb it more times, faster — they do not climb higher.",
    ],
    routeCharacter: {
      1: "pleasant boulder staircase",
      2: "longer, clearly ascending boulder route",
      3: "steeper exposed route with tighter boulders",
      4: "absurd near-vertical boulder climb",
    },
    phrases: {
      // One full octave, then as much of a second climb as the bar allows.
      1: [...q([...ASC, ...ASC.slice(0, 7)]), ["quarter", null]],
      // Each climb stops on the leading tone and leans on it, which the next
      // climb's root resolves.
      2: [
        ...q(ASC.slice(0, 6)),
        ["half", ASC[6]],
        ...q(ASC.slice(0, 6)),
        ["half", ASC[6]],
      ],
      // A slow climb, then the same octave twice at double speed.
      3: [...q(ASC.slice(0, 6)), ["half", ASC[6]], ...e([...ASC, ...ASC])],
      // Four climbs in eighths, each pair of bars catching one eighth of breath.
      4: [
        ...e([...ASC, ...ASC.slice(0, 7)]),
        ["eighth", null],
        ...e([...ASC, ...ASC.slice(0, 7)]),
        ["eighth", null],
      ],
    },
  },
  {
    dir: "rocky-descent",
    file: "rocky_descent",
    levels: [1, 2, 3, 4],
    premise:
      "A goat starts high on an alpine rock face and works its way downward one deliberate " +
      "foothold at a time. The musical prompt mirrors Rocky Ascent in reverse: every scale " +
      "fragment descends from the octave root b1 toward 1. Higher levels make the route steeper, " +
      "tighter, faster, and more absurdly exposed.",
    productionNotes: [
      "Reuse the Rocky Ascent art conventions; only the route direction and framing change.",
      "Do not animate the source strips/GIFs as traditional animation. Extract individual frames and treat them as independent static billboards.",
      "Rocky Descent is a control scene, not a falling scene: even L4 should read as absurd deliberate footwork rather than a tumble.",
      "One successful note opportunity advances exactly one waypoint.",
      "The exercise is one octave, root to root.",
    ],
    routeCharacter: {
      1: "broad, calm downhill boulder staircase",
      2: "longer and more obviously descending rocky route",
      3: "steep exposed descent with tighter boulders and faster lower sections",
      4: "absurd near-vertical goat descent on tiny footholds",
    },
    phrases: {
      1: q([...DESC, ...DESC]),
      2: [...q(DESC), ...e([...DESC, ...DESC])],
      3: [...q(DESC.slice(0, 4)), ...e(DESC), ...q(DESC.slice(0, 4)), ...e(DESC)],
      4: e([...DESC, ...DESC, ...DESC, ...DESC]),
    },
  },
  {
    dir: "rocky-ascent-high",
    file: "rocky_ascent_high",
    levels: [3, 4, 5, 6],
    premise:
      "The harder companion to Rocky Ascent, on the same one-octave route. Where the normal " +
      "version runs the octave straight, this one sequences it in threes, so the hand has to " +
      "reset every third note while the beat does not. Authored difficulty labels are two " +
      "levels above the normal version: L3–6 instead of L1–4.",
    productionNotes: [
      "This is the hard companion to Rocky Ascent, not a transposition of it.",
      "The pitch content is the same one octave as the normal version; the difficulty comes from sequencing the octave in threes rather than running it straight.",
      "Supported difficulties are exactly two levels above the normal version: L3–6 instead of L1–4.",
      "One successful note opportunity advances exactly one waypoint.",
      "Placeholder source families may be reused from the normal version; final art can distinguish this version later.",
    ],
    routeCharacter: {
      3: "sequenced ascent: the route doubles back on itself every third foothold",
      4: "one clean climb, then the same face taken again in sequenced threes at double speed",
      5: "sequenced ascent with gear changes: deliberate footholds, a sprint, then a clean run out",
      6: "the sequenced ascent twice over, at full speed, on tiny footholds",
    },
    phrases: {
      3: q(SEQ_ASC),
      4: [...q(ASC), ...e(SEQ_ASC)],
      5: [
        ...q(SEQ_ASC.slice(0, 4)),
        ...e(SEQ_ASC.slice(4, 12)),
        ...q(SEQ_ASC.slice(12)),
        ...e(ASC),
      ],
      6: e([...SEQ_ASC, ...SEQ_ASC]),
    },
  },
  {
    dir: "rocky-descent-high",
    file: "rocky_descent_high",
    levels: [3, 4, 5, 6],
    premise:
      "The harder companion to Rocky Descent, on the same one-octave route. Where the normal " +
      "version falls straight down the octave, this one sequences it in threes, so the goat " +
      "steps back up for every three it comes down. Authored difficulty labels are two levels " +
      "above the normal version: L3–6 instead of L1–4.",
    productionNotes: [
      "This is the hard companion to Rocky Descent, not a transposition of it.",
      "The pitch content is the same one octave as the normal version; the difficulty comes from sequencing the octave in threes rather than running it straight.",
      "Supported difficulties are exactly two levels above the normal version: L3–6 instead of L1–4.",
      "One successful note opportunity advances exactly one waypoint.",
      "Placeholder source families may be reused from the normal version; final art can distinguish this version later.",
    ],
    routeCharacter: {
      3: "sequenced descent: the route steps back up every third foothold",
      4: "one clean descent, then the same face taken again in sequenced threes at double speed",
      5: "sequenced descent with gear changes: deliberate footholds, a sprint, then a clean run out",
      6: "the sequenced descent twice over, at full speed, on tiny footholds",
    },
    phrases: {
      3: q(SEQ_DESC),
      4: [...q(DESC), ...e(SEQ_DESC)],
      5: [
        ...q(SEQ_DESC.slice(0, 4)),
        ...e(SEQ_DESC.slice(4, 12)),
        ...q(SEQ_DESC.slice(12)),
        ...e(DESC),
      ],
      6: e([...SEQ_DESC, ...SEQ_DESC]),
    },
  },
];

/** The one-octave authored vocabulary every scenario now writes in. */
const DEGREE_VOCABULARY = ["1", "2", "3", "4", "5", "6", "7", "b1"];

function buildPrompt(phrase) {
  let beat = 0;
  const events = phrase.map(([duration, token], index) => {
    const durationBeats = DURATION_BEATS[duration];
    if (durationBeats === undefined) throw new Error(`unknown duration ${duration}`);
    if (token !== null && !DEGREE_VOCABULARY.includes(token)) {
      throw new Error(`token ${JSON.stringify(token)} is outside the one-octave vocabulary`);
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

/* -------------------------------------------------------------------------- */
/* Route authoring                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Route shape per Rocky Ascent level, in normalised scenario space: x
 * rightwards 0..1, y downwards 0..1 (0 = top of frame).
 *
 * `progress` is a per-waypoint easing over 0..1 — this is what makes L3's upper
 * eighth-note run read as a burst of speed while its opening quarter notes
 * crawl. `zigzag` is the horizontal wobble amplitude around the straight line,
 * which is what keeps a 30-step near-vertical climb from looking like a ladder.
 *
 * Only Rocky Ascent has a spec here. The other three scenarios' waypoints were
 * tuned by hand and are left alone; this script only checks that each still has
 * one waypoint per note opportunity.
 */
const ROUTES = {
  rocky_ascent: {
    1: {
      start: { x: 0.1, y: 0.88 },
      end: { x: 0.8, y: 0.3 },
      zigzag: 0.035,
      zigzagPeriod: 3,
      scale: [1.0, 1.15],
      ease: (t) => t,
      character: "broad, calm, readable steps",
    },
    2: {
      start: { x: 0.1, y: 0.92 },
      end: { x: 0.82, y: 0.2 },
      zigzag: 0.03,
      zigzagPeriod: 3,
      scale: [0.9, 1.05],
      ease: (t) => t ** 1.08,
      character: "longer and more obviously ascending; each step covers more ground",
    },
    3: {
      start: { x: 0.14, y: 0.93 },
      end: { x: 0.78, y: 0.12 },
      zigzag: 0.026,
      zigzagPeriod: 4,
      scale: [0.72, 0.9],
      // Seven quarter-note steps crawl through the lower third; the sixteen
      // eighth-note steps take the whole upper two thirds.
      ease: (t) => (t < 7 / 23 ? (t / (7 / 23)) * 0.34 : 0.34 + ((t - 7 / 23) / (16 / 23)) * 0.66),
      character: "steep and exposed; the repeated eighth-note run sprints up the top",
    },
    4: {
      start: { x: 0.3, y: 0.95 },
      end: { x: 0.6, y: 0.06 },
      zigzag: 0.045,
      zigzagPeriod: 2,
      scale: [0.52, 0.68],
      ease: (t) => t,
      character: "absurd near-vertical summit climb on tiny footholds",
    },
  },
};

function buildRoute(spec, waypointCount) {
  const round = (n) => Math.round(n * 1e4) / 1e4;
  const waypoints = [];

  for (let i = 0; i < waypointCount; i += 1) {
    // i+1 so the first successful note lands on a step above the start pose.
    const t = spec.ease((i + 1) / waypointCount);
    const wobble = Math.sin(((i + 1) / spec.zigzagPeriod) * Math.PI) * spec.zigzag;
    const scaleSpan = spec.scale[1] - spec.scale[0];
    waypoints.push({
      x: round(spec.start.x + (spec.end.x - spec.start.x) * t + wobble),
      y: round(spec.start.y + (spec.end.y - spec.start.y) * t),
      scale: round(spec.scale[0] + scaleSpan * ((i * 7) % 5) * 0.25),
      rotationDeg: [0, -4, 3, -2, 5][i % 5],
    });
  }

  const last = waypoints[waypoints.length - 1];
  return {
    space: "normalised scenario space: x rightwards 0..1, y downwards 0..1 (0 = top of frame)",
    character: spec.character,
    startPosition: { x: round(spec.start.x), y: round(spec.start.y) },
    // Just above the final foothold, but never so high that a bottom-anchored
    // cairn sprite runs off the top of the frame.
    destination: { x: round(last.x), y: round(Math.max(0.04, last.y - 0.06)) },
    waypoints,
  };
}

/* -------------------------------------------------------------------------- */
/* Rewrite                                                                     */
/* -------------------------------------------------------------------------- */

for (const definition of SCENARIOS) {
  const filePath = scenarioPath(definition.dir, definition.file);
  const scenario = JSON.parse(readFileSync(filePath, "utf8"));
  const routes = ROUTES[definition.file];

  scenario.scenarioPremise = definition.premise;
  scenario.productionNotes = definition.productionNotes;
  scenario.runTransposition = {
    promptRepresentation: "diatonic_scale_degree",
    degreeVocabulary: DEGREE_VOCABULARY,
    transposeToRunKey: true,
    nonDiatonicTargetsAllowed: false,
    note: "One octave, root to root. `b1` is the octave root above `1`; there is no second band.",
  };

  for (const level of definition.levels) {
    const levelData = scenario.levels[String(level)];
    if (!levelData) throw new Error(`${definition.file} has no level ${level}`);

    const prompt = buildPrompt(definition.phrases[level]);
    const noteCount = prompt.filter((event) => event.type === "note").length;
    const maxPoints = noteCount * POINTS_PERFECT;
    const attemptMax = maxPoints * ATTEMPT_REPEATS;

    levelData.prompt = prompt;
    levelData.noteOpportunityCount = noteCount;
    levelData.authoredBeatCount = ATTEMPT_BEATS;

    levelData.stars = {
      metric: "judgmentPoints",
      metricNote:
        "Cumulative judgment points during the attempt: Perfect 10, Good 6, Miss 0 " +
        "(src/config/tuning.ts JUDGMENT_POINTS). Thresholds are cumulative and lock once earned.",
      passThreshold: Math.round(maxPoints * PASS_FRACTION),
      star2Threshold: Math.round(attemptMax * STAR2_FRACTION),
      star3Threshold: attemptMax,
      provisional: true,
      note:
        `PROVISIONAL. The design left thresholds TBD. An attempt plays this four-measure ` +
        `phrase ${ATTEMPT_REPEATS} times, so ${attemptMax} points are available. Pass is the ` +
        `${PASS_FRACTION * 100}% of a single pass (${maxPoints}) that it always was — ` +
        "deliberately NOT scaled, so getting the phrase right the second time round redeems " +
        `a bad first read, which is the whole reason for the repeat. Two stars is ` +
        `${STAR2_FRACTION * 100}% and three stars 100% of the full attempt, so ★★★ still ` +
        "requires every note opportunity taken at Perfect.",
    };

    levelData.scoring = {
      streakBonusEligible: false,
      note:
        "Scale material is not streak-eligible content (GDD §9.2 points streaks at triplets and " +
        "sixteenth runs). The streak is still tracked and shown in the debug panel.",
    };

    const character = definition.routeCharacter[level];
    const route = routes?.[level]
      ? buildRoute(routes[level], noteCount)
      : { ...levelData.visual.route, character };

    if (route.waypoints.length !== noteCount) {
      throw new Error(
        `${definition.file} L${level}: ${route.waypoints.length} waypoints for ${noteCount} ` +
          "note opportunities — one successful note must advance exactly one waypoint"
      );
    }

    levelData.visual = {
      ...levelData.visual,
      routeCharacter: character,
      waypointCount: noteCount,
      route,
    };

    levelData.validation = { status: "ok", issues: [] };
  }

  scenario.designerReview = {
    blockingIssues: [],
    nonBlockingTBD: [
      "Star thresholds are authored but PROVISIONAL — see each level's `stars.note`.",
      "Phrases and (for Rocky Ascent) waypoint coordinates are regenerable via scripts/author-rocky-scenarios.mjs.",
    ],
  };

  writeFileSync(filePath, `${JSON.stringify(scenario, null, 2)}\n`);

  for (const level of definition.levels) {
    const data = scenario.levels[String(level)];
    const tokens = data.prompt
      .map((event) => event.scaleDegree ?? "-")
      .join(" ");
    console.log(
      `${definition.file} L${level}: ${data.noteOpportunityCount} notes, ` +
        `${data.authoredBeatCount} beats, stars ${data.stars.passThreshold}/` +
        `${data.stars.star2Threshold}/${data.stars.star3Threshold}\n    ${tokens}`
    );
  }
}
