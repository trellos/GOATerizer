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

  await page.goto(`${BASE}/?dev=1&input=test`, { waitUntil: "networkidle" });
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

  // Key View is the only timeline presentation (DECISION-021). The gutter is
  // what makes it readable -- `b3 (Bb)` per lane, or `b3 E7` once a fingering is
  // picked -- so an empty gutter is a broken timeline, not a cosmetic problem.
  check(
    "the gutter labels the pitch lanes",
    await page.evaluate(() => {
      const canvas = document.getElementById("pregame-canvas");
      const ctx = canvas instanceof HTMLCanvasElement ? canvas.getContext("2d") : null;
      if (!ctx || !(canvas instanceof HTMLCanvasElement)) return false;
      const { data } = ctx.getImageData(0, 0, 96 * 2, canvas.height);
      return data.some((value, i) => i % 4 === 0 && value > 90);
    })
  );

  /* --- the run ------------------------------------------------------- */

  await page.click("#pregame-play");
  await page.waitForTimeout(300);
  check("game screen is shown", await page.isVisible("#game-canvas"));

  const gameTimelineBox = await canvasBox(page, "game-canvas");
  check(
    "the timeline is the same rectangle in pregame and in the run",
    ["x", "y", "width", "height"].every(
      (side) => Math.abs(pregameTimelineBox[side] - gameTimelineBox[side]) < 0.5
    ),
    `${JSON.stringify(pregameTimelineBox)} → ${JSON.stringify(gameTimelineBox)}`
  );

  // The registry now holds more than one Rocky-family scenario at L1 (Ascent,
  // Descent), and `scenariosForDifficulty` picks among them at random — so the
  // exact scenario shown here is no longer fixed. Assert the family/level
  // pattern, not one hardcoded name.
  const ROCKY_SCENARIO = /^Rocky (Ascent|Descent)( High)? L(\d+)$/;
  const scenarioL1 = await dev(page, "scenario");
  check(
    "scenario is a Rocky-family L1 scenario",
    ROCKY_SCENARIO.test(scenarioL1 ?? ""),
    scenarioL1 ?? ""
  );

  await page.click("#dev-autoplay-perfect");

  // Picking a tier switches the input source only when the current source
  // cannot perform it — a live microphone cannot, the deterministic test
  // provider can. Everything below this point asserts exact outcomes, which is
  // only meaningful while injected events (not real detection) are driving, so
  // pin that here rather than discovering it as flakiness later.
  check(
    "choosing a tier leaves the deterministic provider alone",
    (await dev(page, "input mocked")) === "no",
    (await dev(page, "input mocked")) ?? ""
  );
  check(
    "the panel marks which tier is running",
    (await page.getAttribute("#dev-autoplay-perfect", "data-selected")) === "true"
  );

  // Wait for the goat to be a few footholds up rather than for a wall-clock
  // guess: the attempt starts on the next measure boundary plus a lead-in.
  const footholdMid = await waitForDev(page, "foothold", (value) => Number(value ?? 0) >= 3);
  await page.screenshot({ path: path.join(SHOTS, "04-playing.png") });

  check(
    "the goat advances along the note bars while notes are being hit",
    Number(footholdMid ?? 0) >= 3,
    `foothold ${footholdMid}`
  );
  check(
    "one successful note is exactly one foothold",
    (await dev(page, "perfect/good/miss"))?.split("/")[0] === String(footholdMid),
    `${await dev(page, "perfect/good/miss")} judged, foothold ${footholdMid}`
  );
  // The minigame now lives on the timeline (GDD §11.2), so "is the scenario
  // drawing" and "is the timeline drawing" are the same question.
  check("the minigame is drawing on the timeline", (await canvasHasInk(page, "game-canvas")) > 200);

  /* --- the scenario's timeline art ----------------------------------- */

  /*
   * A minigame may skin its own target notes, and it is the one place a
   * scenario can hurt readability. These check the properties that make that
   * safe rather than checking it looks nice.
   *
   * The probe is the moss green in the Rocky crag sprite. Nothing else on this
   * timeline is green: the note colours are cyan and gold, the bass and grid
   * are blue-grey, and the labels are neutral. It tests *greenness* rather than
   * nearness to one RGB triple, because an antialiased grey label pixel lands
   * close to the moss triple by distance while never being green at all. The
   * Good-note colour is green, but a flawless autoplay never produces one.
   *
   * Counting a colour says exactly where the art did and did not reach, and
   * unlike hashing a strip of pixels it does not care that the timeline is
   * scrolling the whole time.
   */
  const countMoss = (region) =>
    page.evaluate((where) => {
      const canvas = document.getElementById("game-canvas");
      const ctx = canvas instanceof HTMLCanvasElement ? canvas.getContext("2d") : null;
      if (!ctx || !(canvas instanceof HTMLCanvasElement)) return -1;
      // The gutter is at most 30% of the width; 15% is safely inside it.
      const gutter = Math.round(canvas.width * 0.15);
      const x = where === "gutter" ? 0 : gutter;
      const w = where === "gutter" ? gutter : canvas.width - gutter;
      const { data } = ctx.getImageData(x, 0, w, canvas.height);
      let moss = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (g - r > 12 && g - b > 20 && g > 95 && g < 165) moss += 1;
      }
      return moss;
    }, region);

  const skinnedNotes = await countMoss("notes");
  const skinnedGutter = await countMoss("gutter");

  await page.click("#dev-skins");
  await page.waitForTimeout(250);
  const plainNotes = await countMoss("notes");
  await page.screenshot({ path: path.join(SHOTS, "04b-notes-unskinned.png") });
  await page.click("#dev-skins");
  await page.waitForTimeout(250);
  const restored = await countMoss("notes");

  check(
    "the scenario's note art actually reaches the timeline",
    skinnedNotes > 0,
    `${skinnedNotes} px of scenario art`
  );
  check(
    "note art never reaches the gutter, however far it bleeds past a note",
    skinnedGutter === 0,
    `${skinnedGutter} px in the gutter`
  );
  check(
    "the dev toggle restores the host's default notes exactly",
    plainNotes === 0,
    `${plainNotes} px of scenario art with the toggle off`
  );
  check("and puts the scenario's art back", restored > 0, `${restored} px`);

  check(
    "score is climbing",
    Number(await page.textContent("#hud-score")) > 0,
    `score ${await page.textContent("#hud-score")}`
  );

  const ROCKY_L2 = /^Rocky (Ascent|Descent)( High)? L2$/;
  await waitForDev(page, "scenario", (value) => ROCKY_L2.test(value ?? ""));
  const afterFirst = {
    foothold: await dev(page, "foothold"),
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

  // The stars physically fly into the slot, so they land a moment after the
  // attempt ends. Wait for the glyphs rather than assuming they are instant.
  const slotStars = page.locator('#hud-history .history-slot[data-ordinal="0"] .slot-stars');
  await slotStars.filter({ hasText: "★★★" }).waitFor({ timeout: 5000 }).catch(() => {});
  check("three stars for a flawless attempt", (await slotStars.textContent()) === "★★★");

  // Autoplay schedules an explicit release for every note it plays. Without
  // one, a played bar grows from its attack to the playhead until it is pruned
  // -- which is what this counter counts, and why it must stay at zero.
  check(
    "no played note is left ringing",
    (await dev(page, "unreleased played")) === "0",
    `unreleased played ${await dev(page, "unreleased played")}`
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
  check("replay same setup starts another run", await page.isVisible("#game-canvas"));
  check(
    "replay does not duplicate the transport or the bass",
    // Three canvases, not four: the scenario panel is gone (GDD §11.2). Left
    // are the pregame timeline, the run timeline and the star overlay. A fourth
    // would mean a replay built a second one.
    (await page.evaluate(() => document.querySelectorAll("canvas").length)) === 3
  );

  const ignorableFailures = failedRequests.filter((entry) => !entry.includes("favicon"));
  check("no failed requests", ignorableFailures.length === 0, ignorableFailures.join("; "));
  const realErrors = consoleErrors.filter((entry) => !entry.includes("favicon"));
  check("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  await page.close();

  /* ==================================================================== */
  /* Part 2 — L4 looks much more ridiculous than L1                       */
  /* ==================================================================== */

  // `?dev=1&level=N` forces every slot to difficulty N, but with more than one
  // Rocky-family scenario authoring L1 and L4 now, WHICH one fills that slot is
  // still `scenariosForDifficulty`'s random pick — Ascent(15)/Descent(16) at
  // L1, and any of the four at L4 (Ascent 30, Descent 32, either High 24). The
  // exact count is no longer fixed, so these are range checks against the
  // authored data, not one hardcoded number.
  const routeSteps = {};
  const routeScenario = {};
  for (const [level, file] of [
    [1, "08-route-l1.png"],
    [4, "09-route-l4.png"],
  ]) {
    const shot = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await shot.goto(`${BASE}/?dev=1&input=test&level=${level}`, { waitUntil: "networkidle" });
    await shot.click("#start-play");
    await shot.waitForTimeout(1500);
    await shot.click("#pregame-play");
    await shot.click("#dev-autoplay-perfect");
    // Part way up, so the phrase behind the goat and the bars ahead of it are
    // both visible.
    await waitForDev(shot, "foothold", (value) => Number(value ?? 0) >= 3);
    routeSteps[level] = Number(await dev(shot, "note opportunities"));
    routeScenario[level] = await dev(shot, "scenario");
    // Hide the dev panel so it does not cover the right-hand panel.
    await shot.evaluate(() => document.getElementById("dev-panel")?.setAttribute("hidden", ""));
    await shot.waitForTimeout(150);
    await shot.screenshot({ path: path.join(SHOTS, file) });
    await shot.close();
  }

  note(`L1: ${routeScenario[1]} (${routeSteps[1]} note bars to climb)`);
  note(`L4: ${routeScenario[4]} (${routeSteps[4]} note bars to climb)`);
  check(
    "L1 climbs a full Rocky-family phrase (15-16 note bars)",
    routeSteps[1] >= 15 && routeSteps[1] <= 16,
    String(routeSteps[1])
  );
  check(
    "L4 climbs a full Rocky-family phrase (24-32 note bars)",
    routeSteps[4] >= 24 && routeSteps[4] <= 32,
    String(routeSteps[4])
  );
  check(
    "L4's climb is denser than L1's",
    routeSteps[4] > routeSteps[1],
    `${routeSteps[1]} → ${routeSteps[4]}`
  );
  note("compare 08-route-l1.png and 09-route-l4.png for the visual escalation");

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
  await live.screenshot({ path: path.join(SHOTS, "07-live-input.png") });

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
  // Perfect *or* Good. On this path the plucks are judged on Tuninator's own
  // onset estimate, so pinning Perfect specifically would make the suite a
  // detection-latency regression test -- and the pluck envelope is exactly what
  // this change reshapes. What is being asserted is that the recognizer found
  // the notes and the judge scored them, not which side of 0.18 beats they fell.
  const hits = (value) => {
    const [perfect, good] = (value ?? "0/0/0").split("/");
    return Number(perfect) + Number(good);
  };
  const synthJudged = await waitForDev(synth, "perfect/good/miss", (value) => hits(value) >= 3, 15000);
  check(
    "the real recognizer detects and judges the synthetic plucks",
    hits(synthJudged) >= 3,
    `judged ${synthJudged}`
  );

  // Nothing schedules a release on this path: the plucks decay to silence and
  // Tuninator's own `noteEnded` is what ends the bar. It already held before
  // the envelope changed, so this is a guard rather than a fix -- a non-zero
  // count means the pluck stopped giving the recognizer a note end to find.
  check(
    "the recognizer ends every synthetic note",
    (await dev(synth, "unreleased played")) === "0",
    `unreleased played ${await dev(synth, "unreleased played")}`
  );
  check("no page errors on the synthetic path", synthErrors.length === 0, synthErrors.join(" | "));
  await synth.close();

  /* ==================================================================== */
  /* Part 5 — the imperfect tiers actually fail, and the demo link works   */
  /* ==================================================================== */

  // On the deterministic sink, so "50% correct" can be asserted rather than
  // hoped for. `?autoplay=` also means no click: the mode is live from the
  // first attempt, which is the path a shared demo link takes.
  const tiers = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const tierErrors = [];
  tiers.on("pageerror", (error) => tierErrors.push(String(error)));
  await tiers.goto(`${BASE}/?dev=1&input=test&autoplay=25&seed=7&level=3`, {
    waitUntil: "networkidle",
  });
  await tiers.click("#start-play");
  await tiers.waitForTimeout(800);
  await tiers.click("#pregame-play");

  check(
    "an ?autoplay= link arrives with the tier already selected",
    (await tiers.getAttribute("#dev-autoplay-25", "data-selected")) === "true"
  );

  // Wait for the plan rather than for a wall-clock guess, then for the failures
  // it promises to actually land.
  const planned = await waitForDev(tiers, "autoplay plan", (value) => (value ?? "—") !== "—");
  check("the tier plans a mix, not just hits", /wrong/.test(planned ?? ""), planned ?? "");

  /*
   * Sample across the attempt rather than reading once.
   *
   * The three outcomes do not arrive together — at 25% the first event is
   * usually a wrong note, well before any target has had time to expire — and
   * a zero-star attempt ends the run, after which the per-attempt readouts go
   * back to "—". So watch the counters while they are live and keep the high
   * water mark, which is what the assertions are actually about.
   */
  const peak = { hit: 0, missed: 0, wrong: 0 };
  let sawLiveAttempt = false;
  for (let i = 0; i < 250; i += 1) {
    const judged = await dev(tiers, "perfect/good/miss");
    if (judged && judged !== "—") {
      sawLiveAttempt = true;
      const [perfect, good, missed] = judged.split("/").map(Number);
      peak.hit = Math.max(peak.hit, perfect + good);
      peak.missed = Math.max(peak.missed, missed);
      peak.wrong = Math.max(peak.wrong, Number(await dev(tiers, "wrong notes")) || 0);
    } else if (sawLiveAttempt) {
      // The attempt is over -- a zero-star one ends the run -- so the peaks are
      // now the whole attempt rather than a snapshot part-way through it.
      break;
    }
    await tiers.waitForTimeout(100);
  }

  const seen = `${peak.hit} hit / ${peak.missed} missed / ${peak.wrong} wrong`;
  check("25% still plays some notes right", peak.hit > 0, seen);
  check("25% misses most of them", peak.missed > peak.hit, seen);
  check("25% plays audible wrong notes", peak.wrong > 0, seen);
  check(
    "a fumbling autoplay still leaves no note ringing",
    (await dev(tiers, "unreleased played")) === "0",
    `unreleased played ${await dev(tiers, "unreleased played")}`
  );
  await tiers.screenshot({ path: path.join(SHOTS, "08-autoplay-25.png") });
  check("no page errors on the autoplay path", tierErrors.length === 0, tierErrors.join(" | "));
  await tiers.close();

  /* ==================================================================== */
  /* Part 6 — a tier chosen on the live mic switches to a source that can  */
  /*          actually perform it, instead of silently doing nothing       */
  /* ==================================================================== */

  const livePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const livePageErrors = [];
  livePage.on("pageerror", (error) => livePageErrors.push(String(error)));
  await livePage.goto(`${BASE}/?dev=1&seed=7`, { waitUntil: "networkidle" });
  await livePage.click("#start-play");
  await livePage.waitForTimeout(1500);

  check(
    "the run starts on the real microphone, not a mock",
    (await dev(livePage, "input mocked")) === "no",
    (await dev(livePage, "input mocked")) ?? ""
  );

  await livePage.click("#pregame-play");
  await livePage.waitForTimeout(500);
  await livePage.click("#dev-autoplay-perfect");

  // The switch disposes and reopens the recognizer, so it is asynchronous;
  // wait for it rather than assuming a click is instant.
  const mocked = await waitForDev(livePage, "input mocked", (value) => value === "yes (synthetic sine)");
  check("choosing a tier on a live mic switches to a source that can play", Boolean(mocked));
  check(
    "and says so, rather than quietly scoring fake input",
    ((await livePage.textContent("#game-input-warning")) ?? "").includes("synthetic")
  );

  const livePageJudged = await waitForDev(
    livePage,
    "perfect/good/miss",
    (value) => hits(value) >= 2,
    20000
  );
  check(
    "the tier then actually plays, mid-run",
    hits(livePageJudged) >= 2,
    `judged ${livePageJudged}`
  );
  check("no page errors when switching source mid-run", livePageErrors.length === 0, livePageErrors.join(" | "));
  await livePage.close();
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
