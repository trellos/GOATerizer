#!/usr/bin/env node
/**
 * Designer tool: rewrites the authored parts of
 * `docs/scenarios/rocky-ascent/rocky_ascent.scenario.json`.
 *
 * The JSON is the runtime authority — the game imports it directly, and nothing
 * regenerates it at play time. This script exists so a designer can re-derive
 * the two things that are painful to hand-edit (82 waypoint coordinates, and
 * four prompt arrays whose beat maths has to add to exactly 16) and then read
 * the diff. Re-running it with different curve parameters is how the route gets
 * tuned; the committed JSON is what ships.
 *
 *   node scripts/author-rocky-ascent.mjs
 *
 * What it writes:
 *   - `prompt[]` for L1–L4, from the phrase tables below;
 *   - `stars` thresholds, provisional, in judgment points;
 *   - `visual.route` — start pose position, waypoints, destination.
 *
 * Everything else in the file (premise, asset bindings, placeholder sources,
 * production notes) is preserved untouched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_PATH = path.resolve(
  here,
  "..",
  "docs",
  "scenarios",
  "rocky-ascent",
  "rocky_ascent.scenario.json"
);

const BEATS_PER_MEASURE = 4;
const ATTEMPT_BEATS = 16;

/** Judgment points per outcome. Mirrors src/config/tuning.ts JUDGMENT_POINTS. */
const POINTS_PERFECT = 10;
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

/**
 * `[duration, token]`, where `token` is an authored octave-band token or `null`
 * for a rest. These are transcribed from the Rocky Ascent level specification;
 * do not "improve" them.
 *
 * L1 and L2 already matched the previous scenario file. L3 and L4 replace the
 * earlier drafts, which totalled 12 and 8 beats and were flagged as blocking
 * issues in `designerReview` — L3 was missing its second eighth-note run, and
 * L4 used an undefined token `8` for a phrase that plays twice.
 */
const PHRASES = {
  1: [
    ["quarter", "1"],
    ["quarter", "2"],
    ["quarter", "3"],
    ["quarter", "4"],
    ["quarter", "5"],
    ["quarter", "6"],
    ["quarter", "7"],
    ["quarter", "b1"],
    ["quarter", "b2"],
    ["quarter", "b3"],
    ["quarter", "b4"],
    ["quarter", "b5"],
    ["quarter", "b6"],
    ["quarter", "b7"],
    ["quarter", "c1"],
    ["quarter", null],
  ],
  2: [
    ["quarter", "1"],
    ["quarter", "2"],
    ["quarter", "3"],
    ["quarter", "4"],
    ["quarter", "5"],
    ["quarter", "6"],
    ["half", "7"],
    ["quarter", "b1"],
    ["quarter", "b2"],
    ["quarter", "b3"],
    ["quarter", "b4"],
    ["quarter", "b5"],
    ["quarter", "b6"],
    ["half", "b7"],
  ],
  3: [
    ["quarter", "1"],
    ["quarter", "2"],
    ["quarter", "3"],
    ["quarter", "4"],
    ["quarter", "5"],
    ["quarter", "6"],
    ["half", "7"],
    ...["b1", "b2", "b3", "b4", "b5", "b6", "b7", "c1"].map((t) => ["eighth", t]),
    ...["b1", "b2", "b3", "b4", "b5", "b6", "b7", "c1"].map((t) => ["eighth", t]),
  ],
  4: [
    ...["1", "2", "3", "4", "5", "6", "7", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "c1"].map(
      (t) => ["eighth", t]
    ),
    ["eighth", null],
    ...["1", "2", "3", "4", "5", "6", "7", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "c1"].map(
      (t) => ["eighth", t]
    ),
    ["eighth", null],
  ],
};

function buildPrompt(phrase) {
  let beat = 0;
  const events = phrase.map(([duration, token], index) => {
    const durationBeats = DURATION_BEATS[duration];
    if (durationBeats === undefined) throw new Error(`unknown duration ${duration}`);
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
 * Route shape per level, in normalised scenario space: x rightwards 0..1, y
 * downwards 0..1 (0 = top of frame).
 *
 * `progress` is a per-waypoint easing over 0..1 — this is what makes L3's upper
 * eighth-note run read as a burst of speed while its opening quarter notes
 * crawl. `zigzag` is the horizontal wobble amplitude around the straight line,
 * which is what keeps a 30-step near-vertical climb from looking like a ladder.
 */
const ROUTES = {
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
    character: "steep and exposed; the repeated eighth-note phrase sprints up the top",
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
};

function buildRoute(level, waypointCount) {
  const spec = ROUTES[level];
  if (!spec) throw new Error(`no route spec for level ${level}`);

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

const scenario = JSON.parse(readFileSync(SCENARIO_PATH, "utf8"));

for (const level of [1, 2, 3, 4]) {
  const levelData = scenario.levels[String(level)];
  if (!levelData) throw new Error(`scenario file has no level ${level}`);

  const prompt = buildPrompt(PHRASES[level]);
  const noteCount = prompt.filter((event) => event.type === "note").length;
  const maxPoints = noteCount * POINTS_PERFECT;

  levelData.prompt = prompt;
  levelData.noteOpportunityCount = noteCount;
  levelData.authoredBeatCount = ATTEMPT_BEATS;

  levelData.stars = {
    metric: "judgmentPoints",
    metricNote:
      "Cumulative judgment points during the attempt: Perfect 10, Good 6, Miss 0 " +
      "(src/config/tuning.ts JUDGMENT_POINTS). Thresholds are cumulative and lock once earned.",
    passThreshold: Math.round(maxPoints * PASS_FRACTION),
    star2Threshold: Math.round(maxPoints * STAR2_FRACTION),
    star3Threshold: maxPoints,
    provisional: true,
    note:
      `PROVISIONAL. The design left thresholds TBD. Pass is ${PASS_FRACTION * 100}% and ` +
      `two stars ${STAR2_FRACTION * 100}% of the all-Perfect maximum (${maxPoints}); three ` +
      "stars is the maximum itself, so ★★★ requires every note opportunity taken at Perfect.",
  };

  levelData.scoring = {
    streakBonusEligible: false,
    note:
      "Scale material is not streak-eligible content (GDD §9.2 points streaks at triplets and " +
      "sixteenth runs). The streak is still tracked and shown in the debug panel.",
  };

  levelData.visual = {
    ...levelData.visual,
    waypointCount: noteCount,
    route: buildRoute(level, noteCount),
  };

  levelData.validation = { status: "ok", issues: [] };
}

scenario.designerReview = {
  blockingIssues: [],
  resolved: [
    {
      level: 3,
      issue: "The supplied durations totalled 12 beats, not 16.",
      resolution:
        "Authored as six quarter notes, a half note on 7, then the eight-note ascending " +
        "eighth-note phrase b1..c1 played twice. 23 note opportunities, 16 beats.",
    },
    {
      level: 4,
      issue: "The supplied durations totalled 8 beats and used an undefined token `8`.",
      resolution:
        "Authored as the full two-octave eighth-note run 1..c1 plus an eighth rest, played " +
        "twice. 30 note opportunities, 16 beats. No `8` token; the octave root is `b1`.",
    },
  ],
  nonBlockingTBD: [
    "Star thresholds are now authored but PROVISIONAL — see each level's `stars.note`.",
    "Waypoint coordinates are authored here and regenerable via scripts/author-rocky-ascent.mjs.",
  ],
};

writeFileSync(SCENARIO_PATH, `${JSON.stringify(scenario, null, 2)}\n`);

for (const level of [1, 2, 3, 4]) {
  const data = scenario.levels[String(level)];
  console.log(
    `L${level}: ${data.noteOpportunityCount} notes, ${data.authoredBeatCount} beats, ` +
      `stars ${data.stars.passThreshold}/${data.stars.star2Threshold}/${data.stars.star3Threshold}, ` +
      `${data.visual.route.waypoints.length} waypoints`
  );
}
