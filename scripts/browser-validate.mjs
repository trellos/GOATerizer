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
/**
 * Is the scenario backdrop actually on screen, or merely painted?
 *
 * `canvasHasInk` reads the bitmap, so it passes just as happily when the
 * backdrop is drawn and then covered by something opaque -- which is a real,
 * reachable state: the whole overlay layout rests on
 * `#screen-game[data-overlay="true"]` making `.timeline-pane` transparent,
 * while `.timeline-pane`'s own rule paints it `var(--panel)`. Lose either and
 * the backdrop is drawn perfectly and seen by nobody.
 *
 * The computed background is what binds this. `elementFromPoint` alone does
 * not: the pane carries `pointer-events: none` in overlay mode, so hit testing
 * passes straight through an opaque pane to the canvas underneath. The point
 * sampling is the second half, for a covering element that thinking about one
 * CSS rule would not anticipate.
 */
async function backdropIsVisible(page) {
  return page.evaluate(() => {
    const screen = document.getElementById("screen-game");
    const pane = document.querySelector("#screen-game .timeline-pane");
    const canvas = document.getElementById("scenario-canvas");
    if (!screen || !pane || !(canvas instanceof HTMLCanvasElement)) return false;
    if (screen.dataset["overlay"] !== "true") return false;

    const background = getComputedStyle(pane).backgroundColor;
    if (!/^(transparent$|rgba\(0, 0, 0, 0\)$)/.test(background)) return false;

    // The dev panel legitimately covers the right-hand edge, so sample the left
    // two thirds.
    const box = canvas.getBoundingClientRect();
    for (let fy = 0.2; fy < 0.9; fy += 0.15) {
      for (let fx = 0.1; fx < 0.65; fx += 0.15) {
        const top = document.elementFromPoint(box.x + box.width * fx, box.y + box.height * fy);
        if (!top || top.id !== "scenario-canvas") return false;
      }
    }
    return true;
  });
}

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
      // A third meter, band-limited to roughly 1-5 kHz.
      //
      // The 800 Hz high-pass above passes everything up to Nyquist, which turns
      // out not to be the question: a hi-hat living entirely above 7 kHz reads
      // as strong energy there and is still barely audible on a laptop, because
      // small speakers roll off at the *top* as well as the bottom. This is the
      // band they are honest in, and it is what "the kit is audible" has to
      // mean if the check is going to catch a thin one.
      const band = this.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2200;
      band.Q.value = 0.5;
      const midAnalyser = this.createAnalyser();
      tap.connect(realDestination);
      tap.connect(full);
      tap.connect(highpass);
      highpass.connect(small);
      tap.connect(band);
      band.connect(midAnalyser);
      Object.defineProperty(this, "destination", { get: () => tap });
      window.__masterTap = { full, small, mid: midAnalyser };
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
    const bufMid = new Float32Array(taps.mid.fftSize);
    const peaks = { full: 0, small: 0, mid: 0 };
    const series = [];
    const seriesMid = [];
    const started = performance.now();
    while (performance.now() - started < windowMs) {
      taps.full.getFloatTimeDomainData(bufFull);
      taps.small.getFloatTimeDomainData(bufSmall);
      taps.mid.getFloatTimeDomainData(bufMid);
      let pf = 0;
      let ps = 0;
      let pm = 0;
      for (let i = 0; i < bufMid.length; i += 1) pm = Math.max(pm, Math.abs(bufMid[i]));
      peaks.mid = Math.max(peaks.mid, pm);
      for (let i = 0; i < bufFull.length; i += 1) {
        pf = Math.max(pf, Math.abs(bufFull[i]));
        ps = Math.max(ps, Math.abs(bufSmall[i]));
      }
      peaks.full = Math.max(peaks.full, pf);
      peaks.small = Math.max(peaks.small, ps);
      series.push(ps);
      seriesMid.push(pm);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const count = (arr, threshold) =>
      arr.filter((v, i) => i > 0 && v > threshold && arr[i - 1] <= threshold).length;
    const onsets = count(series, 0.05);
    // Counted in the band a small speaker reproduces, not in everything above
    // 800 Hz. This is what makes "the eighths are marked" an audibility claim
    // as well as a timing one: a subdivision hit that exists only above 7 kHz
    // is scheduled, sounds, and never crosses this line.
    const onsetsSmallSpeaker = count(seriesMid, 0.05);
    return {
      peakFull: peaks.full,
      peakAudible: peaks.small,
      peakSmallSpeaker: peaks.mid,
      onsetsPerSecond: onsets / (windowMs / 1000),
      onsetsPerSecondSmallSpeaker: onsetsSmallSpeaker / (windowMs / 1000),
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

/**
 * How many pixels of a scenario's note art reached the timeline canvas.
 *
 * The probe is the moss green in Rocky's crag sprite. Nothing else on this
 * timeline is green: the note colours are cyan and gold, the bass and grid are
 * blue-grey, and the labels are neutral. It tests *greenness* rather than
 * nearness to one RGB triple, because an antialiased grey label pixel lands
 * close to the moss triple by distance while never being green at all. The
 * Good-note colour is a light grey and a flawless autoplay never produces one
 * anyway; the gleam on a Perfect note is gold and white, not green.
 *
 * Counting a colour says exactly where the art did and did not reach, and
 * unlike hashing a strip of pixels it does not care that the timeline is
 * scrolling the whole time.
 *
 * `region` is "gutter" for the labels down the left, or "notes" for everything
 * right of them.
 */
async function countNoteArt(page, region) {
  return page.evaluate((where) => {
    const canvas = document.getElementById("game-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return -1;
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
}

/**
 * Ink in the top-right corner of the timeline canvas, above the lane band —
 * where the "NEXT → …" notice is pinned during a minigame's final measure and
 * nowhere else draws anything. Counted against the corner's own most common
 * colour, so a scrim or a backdrop showing through does not read as ink.
 */
async function foreshadowInk(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("game-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return -1;
    const w = Math.round(canvas.width * 0.3);
    const h = Math.round(canvas.height * 0.22);
    const { data } = ctx.getImageData(canvas.width - w, 0, w, h);
    // The notice is a gold plate on whatever is behind it: count gold pixels.
    let gold = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 200 && g > 160 && b < 120 && data[i + 3] > 0) gold += 1;
    }
    return gold;
  });
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

  // The main walkthrough pins one scenario rather than taking whatever
  // `scenariosForDifficulty` rolls, so its assertions are about a known
  // exercise with a known note count. Can Crushing and Goat Frontman — the
  // other minigame classes — get their own pinned sections further down.
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

  // The player's latency readout. The exact number is a property of whatever
  // audio device this machine has, so what is asserted is that it is reported
  // at all and adds up — a blank or NaN here means the player has no way to
  // find out why the beat feels late.
  const latencyText = (await page.textContent("#pregame-latency")) ?? "";
  check(
    "the pregame reports the rig's latency, split into reported and calibrated",
    /^\d+ ms total — \d+ reported by the browser, -?\d+ yours$/.test(latencyText),
    latencyText
  );
  check(
    "calibration cannot be applied before there are notes to measure",
    await page.evaluate(() => {
      const apply = document.getElementById("pregame-calibrate-apply");
      return apply instanceof HTMLButtonElement && apply.disabled;
    })
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

  // Key View is the only presentation, so what used to check that tablature
  // drew its shape now checks the gutter it left behind: the lane labels are
  // gameplay information, and a blank gutter is a timeline nobody can read.
  check(
    "the lane gutter is labelled, not blank",
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
    "the pinned scenario fills the first slot",
    scenarioL1 === "Rocky Ascent L1",
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

  // Wait for the goat to be a few bars up rather than for a wall-clock guess:
  // the attempt starts on the next measure boundary plus a lead-in.
  const actorMid = await waitForDev(
    page,
    "actor lane/streak",
    (value) => Number((value ?? "—/0").split("/")[1]) >= 3
  );
  await page.screenshot({ path: path.join(SHOTS, "04-playing.png") });

  check(
    "the goat rides the note bars while notes are being hit",
    Number((actorMid ?? "—/0").split("/")[1]) >= 3,
    `lane/streak ${actorMid}`
  );
  check(
    "one successful note is exactly one step of the streak",
    (await dev(page, "perfect/good/miss"))?.split("/")[0] === (actorMid ?? "—/0").split("/")[1],
    `${await dev(page, "perfect/good/miss")} judged, lane/streak ${actorMid}`
  );
  check("the scenario backdrop is drawing", (await canvasHasInk(page, "scenario-canvas")) > 200);
  /*
   * ...and that it actually reaches the screen.
   *
   * `canvasHasInk` reads the bitmap, so it passes just as happily when the
   * backdrop is painted and then covered by something opaque -- which is a
   * real, reachable state: the whole overlay layout rests on
   * `#screen-game[data-overlay="true"]` making `.timeline-pane` transparent,
   * and `.timeline-pane`'s own rule paints it `var(--panel)`. Lose the
   * attribute and the backdrop is drawn perfectly and seen by nobody, with
   * every existing check still green.
   *
   * The computed background is what binds this. `elementFromPoint` alone does
   * not: the pane carries `pointer-events: none` in overlay mode, so hit
   * testing passes straight through an opaque pane to the canvas underneath.
   * It is kept as the second half because it catches a covering element that
   * the first half would not think to look at.
   */
  check("the backdrop is visible, not merely painted", await backdropIsVisible(page));

  /*
   * The scenario's note art, and the two properties that make skinning safe.
   *
   * Deliberately not `canvasHasInk`: the host inks this canvas — grid, lanes,
   * notes, gutter — whether or not a minigame draws a single pixel, so that
   * would pass over a dead seam. It did: the contract sat in the tree for
   * fifteen commits with nothing calling `render()` and every check still
   * green.
   *
   * The control is Can Crushing, below, which returns no note art at all and
   * must therefore count zero. Two families, one product difference — a
   * stronger differential than a debug toggle, because it is the shipped
   * behaviour being compared.
   */
  const artOnNotes = await countNoteArt(page, "notes");
  const artInGutter = await countNoteArt(page, "gutter");
  check(
    "the scenario's note art actually reaches the timeline",
    artOnNotes > 0,
    `${artOnNotes} px of scenario art`
  );
  check(
    "note art never reaches the gutter, however far it bleeds past a note",
    artInGutter === 0,
    `${artInGutter} px in the gutter`
  );
  /*
   * The lane geometry the canvas drew and the layout the stylesheet applied,
   * agreeing.
   *
   * They come from one value now, but they are consumed by two systems that
   * cannot see each other, and disagreement is silent and total: the
   * non-overlay path fills the whole timeline canvas with an opaque ground
   * colour, so a backdrop drawn perfectly behind it is never seen. From the
   * outside that is indistinguishable from art that failed to load, which is
   * why it is asserted rather than trusted.
   */
  check(
    "the canvas and the stylesheet agree about the overlay",
    (await dev(page, "overlay")) === "view true / dom true",
    `overlay ${await dev(page, "overlay")}`
  );
  check(
    "score is climbing",
    Number(await page.textContent("#hud-score")) > 0,
    `score ${await page.textContent("#hud-score")}`
  );

  // The next minigame is foreshadowed in the final measure and nowhere
  // earlier: a "NEXT → …" plate in the top-right, gold on a dark plate.
  const inkEarly = await foreshadowInk(page);
  check("nothing foreshadows the next minigame in the opening measures", inkEarly === 0, `${inkEarly} gold px`);
  await waitForDev(page, "attempt beat", (value) => Number(value) >= 29);
  const inkLate = await foreshadowInk(page);
  check("the final measure foreshadows the next minigame's rhythm", inkLate > 40, `${inkLate} gold px`);
  await page.screenshot({ path: path.join(SHOTS, "04b-foreshadow.png") });

  const ROCKY_L2 = /^Rocky Ascent L2$/;
  await waitForDev(page, "scenario", (value) => ROCKY_L2.test(value ?? ""));
  const afterFirst = {
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
  check("replay same setup starts another run", await page.isVisible("#scenario-canvas"));
  // Counted by id rather than by number: the claim is that a replay does not
  // build a second set of views, and a bare count also fails the day an
  // unrelated screen gains a canvas of its own (the minigame editor did).
  const canvasIds = await page.evaluate(() =>
    [...document.querySelectorAll("canvas")].map((canvas) => canvas.id).sort()
  );
  check(
    "replay does not duplicate the transport or the bass",
    canvasIds.length === new Set(canvasIds).size &&
      ["energy-canvas", "game-canvas", "pregame-canvas", "scenario-canvas"].every((id) =>
        canvasIds.includes(id)
      ),
    canvasIds.join(", ")
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
    // The readout is written on the next frame, so reading it in the same turn
    // as the click is a race — one that stayed hidden until the suite grew
    // enough pages to be slower than it.
    await crush.waitForTimeout(300);

    check("the repeat scenario fills a slot", (await dev(crush, "scenario")) === "Can Crushing L2");
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

    /*
     * The control for Rocky's note art, and it has to be measured HERE.
     *
     * This family returns no note art — the can IS the note, and it is a sprite
     * knocked off the bar rather than paint on it — so its bars are the host's
     * default and the green probe finds nothing. A skin leaking across families
     * would show up here and nowhere else.
     *
     * Measured under the flawless tier, exactly as Rocky's is. The Good-note
     * colour is green; at full strength it is too bright for the probe, but
     * dimmed by the judgment wash it lands squarely inside it. Reading this
     * after the 25% tier below therefore counts a handful of Good notes as
     * scenario art — which it did, at five pixels, until this moved up here.
     */
    const crusherArt = await countNoteArt(crush, "notes");
    check(
      "a family that skins nothing gets the host's default bars",
      crusherArt === 0,
      `${crusherArt} px of note art on a scenario that asks for none`
    );

    // The 25% tier fumbles most of its notes as audible wrong pitches, which
    // is exactly the input this needs: a can placed somewhere he cannot reach.
    await crush.click("#dev-autoplay-25");
    const wrong = await waitForDev(
      crush,
      "cans crushed/missed",
      (value) => Number((value ?? "0/0").split("/")[1]) >= 2
    );
    await shotWithoutDevPanel(crush, "08-can-crushing-wrong.png");
    check(
      "a wrong note puts the can somewhere he cannot reach",
      Number((wrong ?? "0/0").split("/")[1]) >= 2,
      `crushed/missed ${wrong}`
    );
    check("the timeline is still drawing the performer", (await canvasHasInk(crush, "game-canvas")) > 200);
    check("the beach backdrop is drawing", (await canvasHasInk(crush, "scenario-canvas")) > 200);
    // Asserted per family, not once: the overlay layout is shared, but a
    // screenshot of one scenario is no evidence about another, and mistaking a
    // stale render of this screen for a real regression cost an hour.
    check("the beach backdrop is visible, not merely painted", await backdropIsVisible(crush));
    await crush.close();
  }

  /* ==================================================================== */
  /* Part 1b2 — a player whose whole rig is late is still playing the game */
  /* ==================================================================== */

  // The bug this guards, reported from an actual guitar: "I only see the goat
  // appear briefly then disappear. It's saying my timing is bad... but it
  // isn't." A rig with uncompensated latency is off by the *same* amount on
  // every note, and past a quarter of a beat on eighth material the old window
  // clamp turned each one into a miss AND a wrong note at once — the note
  // arrived after its own target expired and was offered to the next one,
  // which is a different pitch. The actor falls on either, so it never
  // survived two notes.
  //
  // Nothing in the suite could produce that input: every existing check plays
  // on time and fumbles a share of notes, which is a different failure. Hence
  // `?playOffsetMs=`.
  {
    const late = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // 200ms. The default tempo is 90bpm, so that is 0.3 of a beat: past the
    // 0.25 where the old clamp broke on eighth material, and well inside the
    // 0.4 the floor now covers. An earlier version of this used 150ms, which is
    // 0.225 of a beat — *short* of the cliff — and so passed happily with the
    // bug reintroduced. A regression test that does not fail on the regression
    // is worse than none, because it is credited as coverage.
    await late.goto(`${BASE}/?dev=1&input=test&level=4&scenario=rocky_ascent&playOffsetMs=200`, {
      waitUntil: "networkidle",
    });
    await late.click("#start-play");
    await late.waitForTimeout(1200);
    await late.click("#pregame-play");
    await late.waitForTimeout(300);
    await late.click("#dev-autoplay-perfect");

    const judged = await waitForDev(
      late,
      "perfect/good/miss",
      (value) => Number((value ?? "0/0/0").split("/")[1]) >= 6,
      20000
    );
    const [, good, miss] = (judged ?? "0/0/0").split("/").map(Number);
    check(
      "a consistently late player is still judged as playing the notes",
      good >= 6 && miss <= good / 4,
      `perfect/good/miss ${judged}`
    );

    // The symptom as the player described it. The actor falls on any miss or
    // wrong note, so a surviving streak is the end-to-end proof.
    const streak = await waitForDev(
      late,
      "actor lane/streak",
      (value) => Number((value ?? "—/0").split("/")[1]) >= 5,
      15000
    );
    check(
      "and the goat stays on the bars instead of appearing and vanishing",
      Number((streak ?? "—/0").split("/")[1]) >= 5,
      `lane/streak ${streak}`
    );
    await late.close();
  }

  /* ==================================================================== */
  /* Part 1c — the timing check measures what it claims to                */
  /* ==================================================================== */

  // The check exists to tell a player whether the beat feeling late is their
  // rig or their hands, so the number it reports has to be right — a screen
  // that confidently reports noise is worse than no screen, because the player
  // will apply it.
  //
  // `?calibrateOffsetMs=N` fakes a player exactly N ms off the click, offset
  // included in the schedule *after* the current compensation, so the check is
  // asserted in both directions: at 0 it must find nothing to change, at 40 it
  // must find 40 and offer to apply it. Not the autoplay tiers — those describe
  // what share of the targets a fake guitarist takes, and this screen has no
  // targets.
  for (const [offsetMs, wantsApply] of [
    [0, false],
    [40, true],
  ]) {
    const cal = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await cal.goto(`${BASE}/?dev=1&input=test&calibrateOffsetMs=${offsetMs}`, {
      waitUntil: "networkidle",
    });
    await cal.click("#start-calibrate");
    await cal.waitForTimeout(1500);
    await cal.click("#calibrate-start");

    // Seven bars at 90bpm is under 19s, plus up to a bar waiting for the line
    // the count-in starts on.
    const phase = cal.locator("#calibrate-phase");
    await phase.filter({ hasText: "Done" }).waitFor({ timeout: 40000 }).catch(() => {});

    const offset = Number((await cal.textContent("#calibrate-offset"))?.replace(/[^\d-]/g, "") ?? NaN);
    const disabled = await cal.evaluate(
      () => document.getElementById("calibrate-apply").disabled
    );
    check(
      `the check finds ${offsetMs}ms for a player who is ${offsetMs}ms late`,
      Math.abs(offset - offsetMs) <= 8,
      `reported ${await cal.textContent("#calibrate-offset")}`
    );
    check(
      wantsApply
        ? "an offset worth applying enables Apply"
        : "an already-accurate rig is told there is nothing to change",
      disabled === !wantsApply
    );
    if (wantsApply) await shotWithoutDevPanel(cal, "09-timing-check.png");
    await cal.close();
  }

  /* ==================================================================== */
  /* Part 1d — the beat states the feel of the minigame being played      */
  /* ==================================================================== */

  // The gap this closes. The pulse measurement above happens in *pregame*,
  // which always plays the bare quarter-note pattern, so it reported "one
  // transient per beat" no matter what the kit did once a run started. The
  // subdivision layer was scheduled, sounded, and never measured — and when it
  // turned out to be inaudible on a real speaker, nothing failed.
  //
  // So this measures a minigame. Rocky Ascent L1 is quarter notes and L4 has
  // eighths in it, and the kit is supposed to say so: one transient per beat
  // under the first, two under the second.
  {
    for (const [level, perBeat, what] of [
      [1, 1, "quarter-note material gets a quarter-note beat"],
      [4, 2, "material with eighths in it gets the eighths marked"],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.addInitScript(MASTER_TAP);
      await page.goto(`${BASE}/?dev=1&input=test&scenario=rocky_ascent&level=${level}`, {
        waitUntil: "networkidle",
      });
      await page.click("#start-play");
      await page.waitForTimeout(1200);
      await page.click("#pregame-play");
      await page.waitForTimeout(2500);

      const bpm = Number(await dev(page, "bpm"));
      const beatsPerSecond = bpm / 60;
      const heard = await measureOutput(page, 4000);
      const expected = beatsPerSecond * perBeat;
      check(
        `L${level}: ${what}`,
        heard !== null &&
          Math.abs(heard.onsetsPerSecondSmallSpeaker - expected) < expected * 0.3,
        `${heard?.onsetsPerSecondSmallSpeaker.toFixed(2)}/s in the 1-5kHz band ` +
          `against ${expected.toFixed(2)} expected at ${bpm}bpm`
      );
      check(
        `L${level}: and the kit is audible on a small speaker while it does it`,
        heard !== null && heard.peakSmallSpeaker > 0.2,
        `peak in the 1-5kHz band ${heard?.peakSmallSpeaker.toFixed(3)}`
      );
      check(
        `L${level}: without the mix clipping`,
        heard !== null && heard.peakFull < 1,
        `peak ${heard?.peakFull.toFixed(3)}`
      );
      await page.close();
    }
  }

  /* ==================================================================== */
  /* Part 2 — L6 is visibly denser than L1                                */
  /* ==================================================================== */

  // This used to compare two authored climb routes side by side, because the
  // route was what escalated with difficulty on screen. The scenario is a
  // backdrop now and the exercise happens on the timeline, so what escalates is
  // note density — and that is what is measured here.
  //
  // Both runs are pinned to the same scenario at two difficulties, so the only
  // difference between the two screenshots is the authored rhythm.
  //
  // L1 against L6, not L4: the Scale content redo moved Rocky Ascent's
  // eighth-note material up the ladder (L4 is quarters and a half now, L6 is
  // thirty eighths), and this comparison had been asserting the old content
  // ever since. The claim is about escalation, so it names the two ends of the
  // ladder rather than a level that happens to be dense today.
  const beatsToEightNotes = {};
  for (const [level, file] of [
    [1, "10-timeline-l1.png"],
    [6, "11-timeline-l6.png"],
  ]) {
    const shot = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await shot.goto(`${BASE}/?dev=1&input=test&scenario=rocky_ascent&level=${level}`, {
      waitUntil: "networkidle",
    });
    await shot.click("#start-play");
    await shot.waitForTimeout(1500);
    await shot.click("#pregame-play");
    await shot.click("#dev-autoplay-perfect");
    // How long the same eight notes take to arrive is the density, measured
    // rather than counted: L1's are quarters, L4's are eighths.
    await waitForDev(shot, "perfect/good/miss", (value) => Number((value ?? "0").split("/")[0]) >= 8);
    beatsToEightNotes[level] = Number(await dev(shot, "attempt beat"));
    await shot.evaluate(() => document.getElementById("dev-panel")?.setAttribute("hidden", ""));
    await shot.waitForTimeout(150);
    await shot.screenshot({ path: path.join(SHOTS, file) });
    await shot.close();
  }

  note(`eight notes took ${beatsToEightNotes[1]} beats at L1, ${beatsToEightNotes[6]} at L6`);
  check(
    "L1's eight quarter notes take about eight beats",
    beatsToEightNotes[1] >= 6.5 && beatsToEightNotes[1] <= 9,
    String(beatsToEightNotes[1])
  );
  check(
    "L6's eight eighth notes take about four",
    beatsToEightNotes[6] >= 3 && beatsToEightNotes[6] <= 5.5,
    String(beatsToEightNotes[6])
  );
  check(
    "L6 is denser than L1",
    beatsToEightNotes[6] < beatsToEightNotes[1],
    `${beatsToEightNotes[1]} → ${beatsToEightNotes[6]} beats`
  );
  note("compare 10-timeline-l1.png and 11-timeline-l6.png for the visual escalation");

  /* ==================================================================== */
  /* Part 2b — the frame loop is uncapped and cheap                       */
  /* ==================================================================== */

  // The requirement is that a fast machine gets more than 60fps, not exactly
  // 60. Two separate things have to hold for that, and they fail differently:
  //
  //   1. Nothing throttles the loop. `requestAnimationFrame` is normally
  //      clamped to the display's refresh, so a browser told to ignore vsync
  //      should run far past 60 — if it does not, something in the app is
  //      pacing itself.
  //   2. Our own per-frame work leaves room for the paint. This is the only
  //      half a codebase can guarantee across machines: the achieved rate in a
  //      container with no GPU (this one rasterises on the CPU through
  //      SwiftShader) says nothing about a real one.
  //
  // A second browser, because these flags would change the timing of every
  // other measurement in this suite.
  {
    const fast = await launchBrowser([
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-frame-rate-limit",
      "--disable-gpu-vsync",
    ]);
    // The same viewport the rest of the suite uses: the dev panel is fixed to
    // the top right, and on a narrower one it covers the button this needs.
    const page = await fast.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__frames = [];
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          const started = performance.now();
          cb(t);
          window.__frames.push([started, performance.now() - started]);
        });
    });
    await page.goto(`${BASE}/?dev=1&input=test&scenario=rocky_ascent&level=4`, {
      waitUntil: "networkidle",
    });
    await page.click("#start-play");
    await page.waitForTimeout(1500);
    await page.click("#pregame-play");
    await page.waitForTimeout(300);
    await page.click("#dev-autoplay-perfect");
    await page.waitForTimeout(2500);
    await page.evaluate(() => void (window.__frames.length = 0));
    await page.waitForTimeout(4000);

    const perf = await page.evaluate(() => {
      const frames = window.__frames;
      const work = frames.map((f) => f[1]).sort((a, b) => a - b);
      const span = (frames.at(-1)?.[0] ?? 0) - (frames[0]?.[0] ?? 0);
      return {
        fps: span > 0 ? ((frames.length - 1) / span) * 1000 : 0,
        workP95: work[Math.floor(work.length * 0.95)] ?? 0,
        workMax: work.at(-1) ?? 0,
      };
    });
    note(
      `${perf.fps.toFixed(0)} fps unthrottled, frame work p95 ${perf.workP95.toFixed(2)}ms ` +
        `max ${perf.workMax.toFixed(2)}ms (CPU rasterisation — a real GPU is faster)`
    );
    check(
      "the frame loop is not capped at 60fps",
      perf.fps > 90,
      `${perf.fps.toFixed(0)} fps with vsync disabled`
    );
    // 4ms is a quarter of a 60Hz budget and an eighth of a 120Hz one, against a
    // measured 0.4ms — a wide regression guard, not a tight target.
    check(
      "per-frame JavaScript leaves the budget to the paint",
      perf.workP95 < 4,
      `p95 ${perf.workP95.toFixed(2)}ms`
    );
    await page.close();
    await fast.close();
  }

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
  await live.screenshot({ path: path.join(SHOTS, "12-live-input.png") });

  note(
    "Chromium's fake capture device is a pulsing tone, not a guitar. It is enough " +
      "signal to measure a level from, which is what the input-gate checks below use, " +
      "but nothing here asserts that a guitar was played."
  );
  await live.close();

  /* ==================================================================== */
  /* Part 3b — the input gate measures early and actually takes effect     */
  /* ==================================================================== */

  // The same live recognizer as Part 3, with the dev panel available so the
  // measurement can be read. The fake capture device supplies a real level.
  const gatePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await gatePage.goto(`${BASE}/?dev=1`, { waitUntil: "networkidle" });
  await gatePage.click("#start-play");

  // Before anything is played *in a run*: the measurement has to be running on
  // the pregame screen, because that is where a player warms up. The complaint
  // this guards is "it should start as early as possible".
  const firstFrames = await waitForDev(gatePage, "input frames", (v) => Number(v) > 0, 10000);
  check(
    "the level measurement runs in pregame, before any run starts",
    Number(firstFrames) > 0 && (await dev(gatePage, "screen")) === "pregame",
    `${firstFrames} frames on the ${await dev(gatePage, "screen")} screen`
  );

  // A gate is a construction-time option, so it takes effect only by standing a
  // new recognizer up. The bug this guards stored the gate, displayed it, and
  // left the old recognizer running until the next page load — the switch saw
  // "already on tuninator, still listening" and returned.
  //
  // Counted builds rather than a glimpse of the `starting` state: on a rebuild
  // the mic permission and the worklet are already cached, so the recognizer
  // can be back in `listening` before the next frame renders.
  const buildsBefore = Number(await dev(gatePage, "input builds"));
  const autoGate = await waitForDev(
    gatePage,
    "input gate",
    (value) => (value ?? "").includes("(auto)"),
    20000
  );
  const buildsAfter = await waitForDev(
    gatePage,
    "input builds",
    (value) => Number(value) > buildsBefore,
    5000
  );

  check(
    "the gate calibrates itself, without the player having to find a button",
    (autoGate ?? "").includes("(auto)"),
    autoGate ?? "never"
  );
  check(
    "applying a gate rebuilds the recognizer, so it actually takes effect",
    Number(buildsAfter) > buildsBefore,
    `recognizers built: ${buildsBefore} → ${buildsAfter}`
  );
  check(
    "the applied gate is stored for the next session",
    Number(
      await gatePage.evaluate(() => localStorage.getItem("goaterizer.inputRmsGate.v1"))
    ) > 0
  );
  check(
    "a gate already in force is not offered again",
    await gatePage.evaluate(
      () => document.getElementById("pregame-input-apply")?.disabled === true
    )
  );
  check(
    "the readout owns up to having set the gate itself",
    (await gatePage.textContent("#pregame-input-verdict"))?.includes("automatically") ?? false
  );

  // Reset has to mean something: automatic calibration gets one go per session,
  // so putting the gate back is not undone on the next frame.
  await gatePage.evaluate(() => document.getElementById("pregame-input-reset")?.click());
  await gatePage.waitForTimeout(3000);
  check(
    "Reset puts the default back and automatic calibration does not undo it",
    (await gatePage.evaluate(() =>
      localStorage.getItem("goaterizer.inputRmsGate.v1")
    )) === null,
    (await dev(gatePage, "input gate")) ?? ""
  );
  await gatePage.close();

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
  await tiers.goto(`${BASE}/?dev=1&input=test&autoplay=25&seed=7&level=3&scenario=rocky_ascent`, {
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
  await tiers.screenshot({ path: path.join(SHOTS, "13-autoplay-25.png") });
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

  /* ==================================================================== */
  /* Part 7 — Goat Frontman: a flourish draws a crowd, and more of one at  */
  /*          a higher level                                                */
  /* ==================================================================== */

  const crowdAt = {};
  for (const [level, file] of [
    [1, "10-frontman-l1.png"],
    [4, "11-frontman-l4.png"],
  ]) {
    const stage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const stageErrors = [];
    stage.on("pageerror", (error) => stageErrors.push(String(error)));
    await stage.goto(`${BASE}/?dev=1&input=test&level=${level}&scenario=goat_frontman`, {
      waitUntil: "networkidle",
    });
    await stage.click("#start-play");
    await stage.waitForTimeout(1500);
    await stage.click("#pregame-play");
    await stage.click("#dev-autoplay-perfect");

    const scenarioName = await waitForDev(stage, "scenario", (value) => /^Goat Frontman L\d$/.test(value ?? ""));
    check(`L${level} run is Goat Frontman when asked for it`, scenarioName === `Goat Frontman L${level}`, scenarioName ?? "");

    // Two flourishes in: the crowd has started arriving and the phrase is
    // still ahead of the performer.
    const crowd = await waitForDev(stage, "crowd", (value) => Number(value ?? 0) >= 2, 30000);
    crowdAt[level] = Number(crowd ?? 0);
    check(`L${level}: flourishes draw a crowd`, crowdAt[level] >= 2, `crowd ${crowd}`);
    await stage.evaluate(() => document.getElementById("dev-panel")?.setAttribute("hidden", ""));
    await stage.waitForTimeout(150);
    await stage.screenshot({ path: path.join(SHOTS, file) });
    check(`no page errors on Goat Frontman L${level}`, stageErrors.length === 0, stageErrors.join(" | "));
    await stage.close();
  }
  note("compare 10-frontman-l1.png and 11-frontman-l4.png: the L4 crowd arrives six goats a flourish");
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
