#!/usr/bin/env node
/**
 * Browser validation.
 *
 * Unit tests prove the rules; this proves the game. It builds, serves, drives a
 * real Chromium through start → pregame → a whole Rocky Ascent attempt →
 * results, and asserts on what is actually on screen and in the DOM.
 *
 *   npm run validate:browser
 *   npm run validate:browser -- --keep   # leave the screenshots behind
 *
 * ## About the input it uses
 *
 * There is no guitar in CI and no microphone in a headless browser, so the run
 * drives the game through the **deterministic test provider** (`?dev=1&input=test`).
 * That path is dev-gated and the UI says so on screen throughout.
 *
 * The live path is not assumed to work because this passes. It is checked
 * separately and specifically: the page is loaded *without* the dev flag, the
 * real `TuninatorGuitarInputProvider` is allowed to start against Chromium's
 * fake capture device, and the run asserts that it reached `listening` through
 * Tuninator rather than silently falling back to anything.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
const SHOTS = path.join(REPO, "validation-screenshots");
const PORT = Number(process.env["PORT"] ?? 4319);
const BASE = `http://127.0.0.1:${PORT}`;
const keep = process.argv.includes("--keep");

/**
 * Where to find a Chromium to drive, best first.
 *
 * This script was written inside a Linux container and knew only that
 * container's two Playwright paths, so it could not run on a developer machine
 * at all — and a validation script nobody can run locally validates nothing.
 *
 * `playwright-core` deliberately downloads no browsers, so there is usually no
 * bundled one; it can, however, launch an already-installed Chrome or Edge by
 * channel. Prefer an explicit path, then Playwright's own build if someone ran
 * `npx playwright install chromium`, then whatever the machine already has.
 * Channel launches are the fallback rather than the default because a stable
 * Chrome auto-updates underneath the suite.
 */
const BROWSER_CANDIDATES = [
  ...[
    process.env["CHROMIUM_PATH"],
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ]
    .filter((candidate) => candidate && existsSync(candidate))
    .map((executablePath) => ({ label: executablePath, options: { executablePath } })),
  { label: "playwright's bundled chromium", options: {} },
  ...["chrome", "msedge", "chromium"].map((channel) => ({
    label: `installed ${channel}`,
    options: { channel },
  })),
];

const checks = [];
let failures = 0;

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures += 1;
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function note(message) {
  console.log(`NOTE  ${message}`);
}

/*
 * Run Vite's own entry point on this Node, rather than going through `npx`.
 *
 * `npx` on Windows is `npx.cmd`, and there is no good way to spawn it: the bare
 * name fails with ENOENT because CreateProcess ignores PATHEXT, and naming
 * `npx.cmd` fails with EINVAL because Node ≥20.12 refuses to spawn `.cmd` and
 * `.bat` without `shell: true` (the CVE-2024-27980 hardening). Turning the
 * shell on to launch a script we already have on disk would mean submitting a
 * path to cmd.exe's quoting rules for no benefit.
 *
 * `process.execPath` is the Node already running this file, so the preview
 * server also cannot end up on a different Node than the caller's.
 */
const VITE_BIN = path.join(REPO, "node_modules", "vite", "bin", "vite.js");

/**
 * Builds first, then serves the build.
 *
 * `vite preview` serves whatever is in `dist/`, so without this the suite
 * cheerfully validates the last build somebody happened to make — which is how
 * a green run can be reporting on code that is no longer in the tree.
 */
async function build() {
  if (!existsSync(VITE_BIN)) {
    throw new Error(`vite is not installed at ${VITE_BIN} — run \`npm install\` first`);
  }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [VITE_BIN, "build"], { cwd: REPO, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`))
    );
  });
  note("built dist/ from the current tree");
}

async function serve() {
  if (!existsSync(VITE_BIN)) {
    throw new Error(`vite is not installed at ${VITE_BIN} — run \`npm install\` first`);
  }
  const child = spawn(
    process.execPath,
    [VITE_BIN, "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: REPO, stdio: "ignore" }
  );
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`preview server did not come up on ${BASE}`);
}

/** Launches the first candidate browser that actually starts. */
async function launchBrowser(args) {
  const rejections = [];
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      const browser = await chromium.launch({ ...candidate.options, args });
      note(`driving ${candidate.label}`);
      return browser;
    } catch (error) {
      rejections.push(`  ${candidate.label} — ${String(error?.message ?? error).split("\n")[0]}`);
    }
  }
  throw new Error(
    `no usable Chromium. Tried:\n${rejections.join("\n")}\n\n` +
      `Install one with \`npx playwright install chromium\`, or point CHROMIUM_PATH at a build.`
  );
}

/**
 * Screenshots with the dev panel out of the way, then puts it back — the panel
 * covers the right-hand third of the frame, and its buttons are still needed
 * after the shot.
 */
async function shotWithoutDevPanel(page, file) {
  const panel = page.locator("#dev-panel");
  await panel.evaluate((element) => element.setAttribute("hidden", ""));
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SHOTS, file) });
  await panel.evaluate((element) => element.removeAttribute("hidden"));
}

/** Reads a value out of the dev panel by its label. */
async function dev(page, label) {
  return page.evaluate((wanted) => {
    const list = document.getElementById("dev-readouts");
    if (!list) return null;
    const terms = [...list.querySelectorAll("dt")];
    const term = terms.find((dt) => dt.textContent === wanted);
    return term?.nextElementSibling?.textContent ?? null;
  }, label);
}

/**
 * Polls a dev readout until it satisfies `predicate`.
 *
 * Sleeping for a fixed number of seconds and hoping is how a timing suite
 * becomes flaky: an attempt starts on the next measure boundary plus a lead-in,
 * so when it ends depends on where the transport happened to be.
 */
async function waitForDev(page, label, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await dev(page, label);
    if (predicate(last)) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

/**
 * Replaces `AudioContext.destination` with a tap, so the suite can measure what
 * the game actually puts out rather than trusting that scheduling a hit means
 * hearing one.
 *
 * Two meters. The full-band peak catches clipping. The second is high-passed at
 * 800 Hz, because that is roughly where a laptop or phone speaker starts
 * reproducing: a kick's fundamental is real energy that most players never
 * hear, and a mix can measure loud while sounding like nothing.
 */
const MASTER_TAP = () => {
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(...args) {
      super(...args);
      const realDestination = super.destination;
      const tap = this.createGain();
      const full = this.createAnalyser();
      const highpass = this.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 800;
      const small = this.createAnalyser();
      tap.connect(realDestination);
      tap.connect(full);
      tap.connect(highpass);
      highpass.connect(small);
      Object.defineProperty(this, "destination", { get: () => tap });
      window.__masterTap = { full, small };
    }
  };
};

/** Samples the tap for `ms`, returning peak levels and transients per second. */
async function measureOutput(page, ms) {
  return page.evaluate(async (windowMs) => {
    const taps = window.__masterTap;
    if (!taps) return null;
    const bufFull = new Float32Array(taps.full.fftSize);
    const bufSmall = new Float32Array(taps.small.fftSize);
    const peaks = { full: 0, small: 0 };
    const series = [];
    const started = performance.now();
    while (performance.now() - started < windowMs) {
      taps.full.getFloatTimeDomainData(bufFull);
      taps.small.getFloatTimeDomainData(bufSmall);
      let pf = 0;
      let ps = 0;
      for (let i = 0; i < bufFull.length; i += 1) {
        pf = Math.max(pf, Math.abs(bufFull[i]));
        ps = Math.max(ps, Math.abs(bufSmall[i]));
      }
      peaks.full = Math.max(peaks.full, pf);
      peaks.small = Math.max(peaks.small, ps);
      series.push(ps);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const onsets = series.filter((v, i) => i > 0 && v > 0.05 && series[i - 1] <= 0.05).length;
    return {
      peakFull: peaks.full,
      peakAudible: peaks.small,
      onsetsPerSecond: onsets / (windowMs / 1000),
    };
  }, ms);
}

/** A canvas's on-screen rectangle, in CSS pixels. */
async function canvasBox(page, id) {
  return page.evaluate((canvasId) => {
    const box = document.getElementById(canvasId)?.getBoundingClientRect();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  }, id);
}

/** True when the canvas has drawn anything other than its ground colour. */
async function canvasHasInk(page, id) {
  return page.evaluate((canvasId) => {
    const canvas = document.getElementById(canvasId);
    if (!(canvas instanceof HTMLCanvasElement)) return 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const first = [data[0], data[1], data[2]];
    let different = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (
        Math.abs(data[i] - first[0]) > 6 ||
        Math.abs(data[i + 1] - first[1]) > 6 ||
        Math.abs(data[i + 2] - first[2]) > 6
      ) {
        different += 1;
      }
    }
    return different;
  }, id);
}

await build();
const server = await serve();
const browser = await launchBrowser([
  "--no-sandbox",
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]);

try {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  /* ==================================================================== */
  /* Part 1 — a whole run, on deterministic input                         */
  /* ==================================================================== */

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  await page.addInitScript(MASTER_TAP);

  // The main walkthrough is a walkthrough of the *climb* path — waypoints, the
  // goat, one foothold per note — so it pins a climb scenario rather than
  // taking whatever `scenariosForDifficulty` rolls. The library now holds two
  // minigame classes at L1-4, and asserting climb behaviour against a scenario
  // that might be Can Crushing would be asserting nothing. Can Crushing gets
  // its own pinned section further down.
  await page.goto(`${BASE}/?dev=1&input=test&scenario=rocky_ascent`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS, "01-start.png") });
  check("start screen renders", await page.isVisible("#start-play"));
  check(
    "start screen lists a high score per tempo",
    (await page.locator("#start-high-scores li").count()) === 5
  );

  await page.click("#start-play");
  await page.waitForTimeout(2000);

  check("pregame is shown after the user gesture", await page.isVisible("#pregame-play"));
  check(
    "audio is running (transport has a beat)",
    Number(await dev(page, "beat")) > 0,
    `beat ${await dev(page, "beat")}`
  );
  check(
    "input source is visible and honest about being test input",
    (await page.textContent("#pregame-input-state")).includes("NOT a guitar")
  );

  const keyBefore = await page.textContent("#pregame-key");
  const beatBeforeReroll = Number(await dev(page, "beat"));
  await page.click("#pregame-reroll");
  await page.waitForTimeout(400);
  const beatAfterReroll = Number(await dev(page, "beat"));
  check(
    "reroll does not restart the transport",
    beatAfterReroll > beatBeforeReroll,
    `${beatBeforeReroll} → ${beatAfterReroll}`
  );
  note(`key ${keyBefore} → ${await page.textContent("#pregame-key")}`);

  const beatBeforeTempo = Number(await dev(page, "beat"));
  await page.click('#pregame-tempos button[data-tempo="markhor-goat"]');
  await page.waitForTimeout(300);
  check(
    "tempo change is applied without stopping the beat",
    (await dev(page, "bpm")) === "140" && Number(await dev(page, "beat")) > beatBeforeTempo
  );
  await page.click('#pregame-tempos button[data-tempo="ibex"]');
  await page.waitForTimeout(200);

  check("pregame timeline is drawing", (await canvasHasInk(page, "pregame-canvas")) > 40);
  await page.screenshot({ path: path.join(SHOTS, "02-pregame.png") });

  // The pulse, measured rather than assumed. `onsetsPerSecond` should match the
  // tempo — 120bpm here after the tempo change above — and the audible-band
  // peak has to clear a floor, or the beat is only loud on paper.
  const output = await measureOutput(page, 3000);
  check("the master output is not clipping", output !== null && output.peakFull < 1, `peak ${output?.peakFull.toFixed(3)}`);
  check(
    "the drum pulse is audible on a small speaker, not just in the sub-bass",
    output !== null && output.peakAudible > 0.25,
    `peak above 800Hz ${output?.peakAudible.toFixed(3)}`
  );
  check(
    "one transient per beat at the selected tempo",
    output !== null && Math.abs(output.onsetsPerSecond - 2) < 0.5,
    `${output?.onsetsPerSecond.toFixed(2)}/s at 120bpm`
  );

  check(
    "the fingering picker offers more than one place on the neck, with diagrams",
    await page.evaluate(() => {
      const options = [...document.querySelectorAll("#pregame-fingerings button")];
      return options.length >= 2 && options.every((node) => node.querySelector("svg.fret-diagram"));
    })
  );

  // Captured here and compared after the run starts: the timeline must be the
  // same rectangle on both screens, or it jumps under the player at exactly the
  // moment the notes start counting.
  const pregameTimelineBox = await canvasBox(page, "pregame-canvas");

  await page.click('#pregame-views button[data-view="tab"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, "03-pregame-tab.png") });
  check("tablature view draws", (await canvasHasInk(page, "pregame-canvas")) > 20);
  check(
    "tablature shows the selected shape as a physical reference",
    await page.evaluate(() => {
      const canvas = document.getElementById("pregame-canvas");
      const ctx = canvas instanceof HTMLCanvasElement ? canvas.getContext("2d") : null;
      if (!ctx || !(canvas instanceof HTMLCanvasElement)) return false;
      // The gutter carries `E 2 4 5`-style rows; look for ink in it.
      const { data } = ctx.getImageData(0, 0, 96 * 2, canvas.height);
      return data.some((value, i) => i % 4 === 0 && value > 90);
    })
  );
  await page.click('#pregame-views button[data-view="key"]');
  await page.waitForTimeout(200);

  /* --- the run ------------------------------------------------------- */

  await page.click("#pregame-play");
  await page.waitForTimeout(300);
  check("game screen is shown", await page.isVisible("#scenario-canvas"));

  const gameTimelineBox = await canvasBox(page, "game-canvas");
  check(
    "the timeline is the same rectangle in pregame and in the run",
    ["x", "y", "width", "height"].every(
      (side) => Math.abs(pregameTimelineBox[side] - gameTimelineBox[side]) < 0.5
    ),
    `${JSON.stringify(pregameTimelineBox)} → ${JSON.stringify(gameTimelineBox)}`
  );

  // Pinned above, so this is really two assertions: the pin took effect, and
  // the run put an L1 in the first slot.
  const scenarioL1 = await dev(page, "scenario");
  check(
    "the pinned climb scenario fills the first slot",
    scenarioL1 === "Rocky Ascent L1",
    scenarioL1 ?? ""
  );

  await page.click("#dev-autoplay-perfect");

  // Wait for the goat to be a few footholds up rather than for a wall-clock
  // guess: the attempt starts on the next measure boundary plus a lead-in.
  const waypointMid = await waitForDev(
    page,
    "waypoint",
    (value) => Number((value ?? "0/0").split("/")[0]) >= 3
  );
  await page.screenshot({ path: path.join(SHOTS, "04-playing.png") });

  check(
    "the goat advances while notes are being hit",
    Number((waypointMid ?? "0/0").split("/")[0]) >= 3,
    `waypoint ${waypointMid}`
  );
  check(
    "one successful note is exactly one waypoint",
    (await dev(page, "perfect/good/miss"))?.split("/")[0] ===
      (waypointMid ?? "0/0").split("/")[0],
    `${await dev(page, "perfect/good/miss")} judged, waypoint ${waypointMid}`
  );
  check("scenario strip is drawing", (await canvasHasInk(page, "scenario-canvas")) > 200);
  check(
    "score is climbing",
    Number(await page.textContent("#hud-score")) > 0,
    `score ${await page.textContent("#hud-score")}`
  );

  const ROCKY_L2 = /^Rocky Ascent L2$/;
  await waitForDev(page, "scenario", (value) => ROCKY_L2.test(value ?? ""));
  const afterFirst = {
    waypoint: await dev(page, "waypoint"),
    scenario: await dev(page, "scenario"),
    stars: await page.textContent("#hud-stars"),
  };
  await page.screenshot({ path: path.join(SHOTS, "05-after-first-attempt.png") });

  check(
    "the first attempt completed and the run moved on",
    ROCKY_L2.test(afterFirst.scenario ?? ""),
    `now ${afterFirst.scenario}`
  );
  check(
    "stars were earned and shown in the HUD",
    Number((afterFirst.stars ?? "★ 0").replace(/\D/g, "")) >= 1,
    afterFirst.stars ?? ""
  );
  const filledSlots = await page.locator('#hud-history .history-slot[data-state="done"]').count();
  check("history records the finished slot", filledSlots >= 1, `${filledSlots} filled`);

  // The stars physically fly into the slot and *build* the trophy as they land,
  // so the crowned tier arrives a moment after the attempt ends. Wait for the
  // tier rather than assuming it is instant.
  const trophy = page.locator('#hud-history .history-slot[data-ordinal="0"] .slot-trophy svg');
  await trophy.waitFor({ timeout: 5000 }).catch(() => {});
  await page
    .locator('#hud-history .history-slot[data-ordinal="0"] svg[data-tier="3"]')
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  check(
    "a flawless attempt earns a crowned trophy",
    (await trophy.getAttribute("data-tier")) === "3",
    `tier ${await trophy.getAttribute("data-tier")}`
  );

  /* --- a failing attempt --------------------------------------------- */

  await page.click("#dev-autoplay-off");
  await page.waitForSelector("#screen-results[data-active='true']", { timeout: 30000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, "06-results.png") });

  check("a zero-star attempt ends the run", await page.isVisible("#results-rank"));
  const rank = await page.textContent("#results-rank");
  check("results show a GOAT rank", (rank ?? "").length > 3, rank ?? "");
  check(
    "results show the tempo high score",
    (await page.textContent("#results-best"))?.includes("Ibex") ?? false
  );

  await page.click("#results-replay");
  await page.waitForTimeout(1200);
  check("replay same setup starts another run", await page.isVisible("#scenario-canvas"));
  check(
    "replay does not duplicate the transport or the bass",
    (await page.evaluate(() => document.querySelectorAll("canvas").length)) === 4
  );

  const ignorableFailures = failedRequests.filter((entry) => !entry.includes("favicon"));
  check("no failed requests", ignorableFailures.length === 0, ignorableFailures.join("; "));
  const realErrors = consoleErrors.filter((entry) => !entry.includes("favicon"));
  check("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  await page.close();

  /* ==================================================================== */
  /* Part 1b — the second minigame class actually runs                    */
  /* ==================================================================== */

  // Everything above exercises `ClimbMinigame`. Can Crushing is the only other
  // class with a built scenario, and the whole point of it is a rule the climb
  // does not have: the can lands where the player *played*, not where they were
  // asked to play. Both halves are asserted here, in a browser, because both
  // are load-bearing for whether the mechanic reads at all.
  {
    const crush = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await crush.goto(`${BASE}/?dev=1&input=test&level=2&scenario=can_crushing`, {
      waitUntil: "networkidle",
    });
    await crush.click("#start-play");
    await crush.waitForTimeout(1500);
    await crush.click("#pregame-play");

    check("the repeat scenario fills a slot", (await dev(crush, "scenario")) === "Can Crushing L2");
    check(
      "a repeat scenario reports no waypoint, because it has no route",
      (await dev(crush, "waypoint")) === "0/0",
      (await dev(crush, "waypoint")) ?? ""
    );

    await crush.click("#dev-autoplay-perfect");
    const crushed = await waitForDev(
      crush,
      "cans crushed/missed",
      (value) => Number((value ?? "0/0").split("/")[0]) >= 4
    );
    await shotWithoutDevPanel(crush, "07-can-crushing.png");
    check(
      "playing the asked-for note crushes the can",
      Number((crushed ?? "0/0").split("/")[0]) >= 4 &&
        Number((crushed ?? "0/0").split("/")[1]) === 0,
      `crushed/missed ${crushed}`
    );

    // Same material, in time, on the wrong string. The cans have to miss him.
    await crush.click("#dev-autoplay-fumbled");
    const fumbled = await waitForDev(
      crush,
      "cans crushed/missed",
      (value) => Number((value ?? "0/0").split("/")[1]) >= 2
    );
    await shotWithoutDevPanel(crush, "08-can-crushing-fumbled.png");
    check(
      "a wrong note puts the can somewhere he cannot reach",
      Number((fumbled ?? "0/0").split("/")[1]) >= 2,
      `crushed/missed ${fumbled}`
    );
    check("the timeline is still drawing the performer", (await canvasHasInk(crush, "game-canvas")) > 200);
    await crush.close();
  }

  /* ==================================================================== */
  /* Part 2 — L4 looks much more ridiculous than L1                       */
  /* ==================================================================== */

  // `?dev=1&level=N` forces every slot to difficulty N, and `?scenario=` pins
  // which scenario fills it. Both are needed here: the point of this part is a
  // side-by-side of the *same* route authored easy and authored absurd, so the
  // two screenshots have to be the same scenario at two difficulties rather
  // than whatever `scenariosForDifficulty` rolled that run. The other three
  // Rocky routes are checked in `tests/scenario-data.test.ts`, which asserts
  // one waypoint per note opportunity for every level of every climb scenario.
  const routeSteps = {};
  const routeScenario = {};
  for (const [level, file] of [
    [1, "09-route-l1.png"],
    [4, "10-route-l4.png"],
  ]) {
    const shot = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await shot.goto(`${BASE}/?dev=1&input=test&scenario=rocky_ascent&level=${level}`, {
      waitUntil: "networkidle",
    });
    await shot.click("#start-play");
    await shot.waitForTimeout(1500);
    await shot.click("#pregame-play");
    await shot.click("#dev-autoplay-perfect");
    // Part way up, so the route and the goat's place on it are both visible.
    const waypoint = await waitForDev(shot, "waypoint", (value) => {
      const [at, of] = (value ?? "0/0").split("/").map(Number);
      return of > 0 && at >= Math.ceil(of * 0.55);
    });
    routeSteps[level] = Number((waypoint ?? "0/0").split("/")[1]);
    routeScenario[level] = await dev(shot, "scenario");
    // Hide the dev panel so it does not cover the right-hand panel.
    await shot.evaluate(() => document.getElementById("dev-panel")?.setAttribute("hidden", ""));
    await shot.waitForTimeout(150);
    await shot.screenshot({ path: path.join(SHOTS, file) });
    await shot.close();
  }

  note(`L1 route: ${routeScenario[1]} (${routeSteps[1]} footholds)`);
  note(`L4 route: ${routeScenario[4]} (${routeSteps[4]} footholds)`);
  check("L1 authors Rocky Ascent's 15 footholds", routeSteps[1] === 15, String(routeSteps[1]));
  check("L4 authors Rocky Ascent's 30 footholds", routeSteps[4] === 30, String(routeSteps[4]));
  check(
    "L4's climb is denser than L1's",
    routeSteps[4] > routeSteps[1],
    `${routeSteps[1]} → ${routeSteps[4]}`
  );
  note("compare 09-route-l1.png and 10-route-l4.png for the visual escalation");

  /* ==================================================================== */
  /* Part 3 — the production path really is Tuninator                     */
  /* ==================================================================== */

  const live = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const liveErrors = [];
  live.on("pageerror", (error) => liveErrors.push(String(error)));
  await live.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await live.click("#start-play");
  await live.waitForTimeout(3500);

  const liveStatus = await live.textContent("#pregame-input-state");
  const providerKind = await live.evaluate(() => {
    const warning = document.getElementById("game-input-warning");
    return warning?.hidden === false ? warning.textContent : "live";
  });

  check(
    "the default path opens the microphone through Tuninator",
    (liveStatus ?? "").includes("Listening to your guitar"),
    liveStatus ?? ""
  );
  check(
    "no test-input banner on the production path",
    !(providerKind ?? "").includes("DEV"),
    providerKind ?? ""
  );
  check(
    "the worklet asset is served",
    (await (await fetch(`${BASE}/assets/tuninator-worklet.js`)).text()).includes(
      "registerProcessor"
    )
  );
  check(
    "the dev panel is hidden without the flag",
    await live.locator("#dev-panel").isHidden()
  );
  check("no page errors on the live path", liveErrors.length === 0, liveErrors.join(" | "));
  await live.screenshot({ path: path.join(SHOTS, "11-live-input.png") });

  note(
    "Chromium's fake capture device is silence, so no note is detected here. " +
      "This asserts the live wiring reaches `listening` through Tuninator, not that a guitar was played."
  );
  await live.close();

  /* ==================================================================== */
  /* Part 4 — the synthetic mic actually drives real Tuninator detection   */
  /* ==================================================================== */

  const synth = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const synthErrors = [];
  synth.on("pageerror", (error) => synthErrors.push(String(error)));
  await synth.goto(`${BASE}/?dev=1&input=synth`, { waitUntil: "networkidle" });
  await synth.click("#start-play");
  await synth.waitForTimeout(1200);

  check(
    "the synthetic mic reaches listening through the real recognizer",
    (await synth.textContent("#pregame-input-state"))?.includes("Listening to your guitar") ?? false
  );
  check(
    "the synthetic path stays honest about not being a real guitar",
    (await synth.textContent("#game-input-warning"))?.includes("synthetic") ?? false
  );

  await synth.click("#pregame-play");
  await synth.waitForTimeout(300);
  await synth.click("#dev-autoplay-perfect");

  // `?input=synth` schedules real sine plucks through a mocked microphone, not
  // injected note events -- Tuninator's real onset/pitch detection has to find
  // them. `waitForDev` polls rather than sleeping a guess, because detection
  // happens on Tuninator's own analysis cadence, not the test's.
  const synthJudged = await waitForDev(
    synth,
    "perfect/good/miss",
    (value) => Number((value ?? "0/0/0").split("/")[0]) >= 3,
    15000
  );
  check(
    "the real recognizer detects and judges the synthetic plucks",
    Number((synthJudged ?? "0/0/0").split("/")[0]) >= 3,
    `judged ${synthJudged}`
  );
  check("no page errors on the synthetic path", synthErrors.length === 0, synthErrors.join(" | "));
  await synth.close();
} finally {
  await browser.close();
  server.kill();
}

console.log(
  `\n${checks.length - failures}/${checks.length} checks passed. Screenshots in ${path.relative(
    process.cwd(),
    SHOTS
  )}`
);
if (!keep) note("pass --keep to stop screenshots being overwritten next run");
process.exit(failures === 0 ? 0 : 1);
