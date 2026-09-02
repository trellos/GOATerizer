#!/usr/bin/env node
/**
 * Close-ups and animation strips of the timeline actors.
 *
 *   node scripts/shoot-actors.mjs [--out DIR] [--label before]
 *
 * The browser suite screenshots whole frames, which is the right scale for
 * "does the game still draw" and the wrong one for "does this character read".
 * A goat forty pixels tall in a 1440-wide frame is a smudge in a document, and
 * the two things this exists to judge — how big the actor is, and what it does
 * in the fifth of a second after it lands — are invisible at that size.
 *
 * So this does two things the suite does not:
 *
 *   1. **Crops to the actor.** The strike line is the centre of the play area
 *      and both characters stand just left of it, so a fixed window around it
 *      catches them at whatever viewport.
 *   2. **Samples on the page's own animation frames.** A crush lasts about a
 *      fifth of a beat — at 90bpm that is 150ms, and a Playwright screenshot
 *      costs more than that. Frames are grabbed inside the page with
 *      `drawImage` off the live canvas, so a strip is consecutive *rendered*
 *      frames rather than a series of independent screenshots that happen to
 *      land where the sampling interval put them.
 *
 * That second point is not a micro-optimisation. An earlier pass sampled at a
 * fixed interval against a loop that is phase-locked to the beat and got a
 * strip of identical poses -- stroboscopic aliasing, indistinguishable from a
 * frozen animation, and it cost a debugging session before the sampler rather
 * than the animation turned out to be the problem.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
const PORT = Number(process.env["PORT"] ?? 4331);
const BASE = `http://127.0.0.1:${PORT}`;
const VITE_BIN = path.join(REPO, "node_modules", "vite", "bin", "vite.js");

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const OUT = path.resolve(REPO, readFlag("out", "actor-screenshots"));
const LABEL = readFlag("label", "");
const prefix = LABEL ? `${LABEL}-` : "";

const BROWSER_CANDIDATES = [
  process.env["CHROMIUM_PATH"],
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
].filter((candidate) => candidate && existsSync(candidate));

async function serve() {
  const child = spawn(
    process.execPath,
    [VITE_BIN, "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: REPO, stdio: "ignore" }
  );
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`preview server did not come up on ${BASE}`);
}

/**
 * Grabs `count` consecutive rendered frames of a window around the strike line
 * and lays them out as a strip.
 *
 * `every` skips rendered frames rather than sleeping between grabs: at 60fps a
 * crush is nine frames, and a strip wants the shape of the whole gesture, not
 * nine near-identical ones.
 */
async function strip(page, { count, every = 1, width, height, offsetX = 0, offsetY = 0, scale = 3, columns = 0, find }) {
  return page.evaluate(
    ({ count, every, width, height, offsetX, offsetY, scale, columns, find }) =>
      new Promise((resolve) => {
        const source = document.getElementById("game-canvas");
        const dpr = source.width / source.getBoundingClientRect().width;
        // The strike line is the centre of the play area; both actors stand
        // just left of it. Read off the live canvas so this follows a viewport
        // change instead of pinning a magic number.
        const cx = source.width / 2 + offsetX * dpr;

        /**
         * Find the character's height in the frame by its own colours.
         *
         * The goat stands on whichever lane the music put it on, so a fixed
         * vertical crop catches it on one phrase and misses it on the next —
         * which is how the first pass produced a strip of empty note bars. Its
         * palette is nothing like the timeline's, so scanning a narrow column
         * around where it stands for its own cream (or the crusher's vest red)
         * locates it without production code having to expose anything.
         */
        const centreY = () => {
          if (!find) return source.height / 2 + offsetY * dpr;
          const scan = source
            .getContext("2d")
            .getImageData(Math.max(0, cx - 40 * dpr), 0, Math.min(80 * dpr, source.width), source.height);
          const hits = [];
          for (let y = 0; y < scan.height; y += 1) {
            for (let x = 0; x < scan.width; x += 1) {
              const i = (y * scan.width + x) * 4;
              const [r, g, b] = [scan.data[i], scan.data[i + 1], scan.data[i + 2]];
              if (find === "goat" ? r > 200 && g > 190 && b > 165 : r > 195 && g < 130 && b < 130) {
                hits.push(y);
              }
            }
          }
          if (hits.length < 8) return source.height / 2 + offsetY * dpr;
          hits.sort((a, b) => a - b);
          return hits[Math.floor(hits.length / 2)];
        };

        const cy = centreY();
        const sw = width * dpr;
        const sh = height * dpr;

        const frames = [];
        let seen = 0;
        const grab = () => {
          if (seen % every === 0) {
            const cell = document.createElement("canvas");
            cell.width = width * scale;
            cell.height = height * scale;
            const cellCtx = cell.getContext("2d");
            cellCtx.imageSmoothingEnabled = false;
            cellCtx.drawImage(source, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, cell.width, cell.height);
            frames.push(cell);
          }
          seen += 1;
          if (frames.length < count) requestAnimationFrame(grab);
          else finish();
        };

        const finish = () => {
          const cols = columns || frames.length;
          const rows = Math.ceil(frames.length / cols);
          const sheet = document.createElement("canvas");
          const gap = 4;
          sheet.width = cols * (width * scale) + (cols + 1) * gap;
          sheet.height = rows * (height * scale) + (rows + 1) * gap;
          const ctx = sheet.getContext("2d");
          ctx.imageSmoothingEnabled = false;
          ctx.fillStyle = "#11141a";
          ctx.fillRect(0, 0, sheet.width, sheet.height);
          frames.forEach((cell, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            ctx.drawImage(cell, gap + col * (cell.width + gap), gap + row * (cell.height + gap));
          });
          resolve(sheet.toDataURL("image/png"));
        };

        requestAnimationFrame(grab);
      }),
    { count, every, width, height, offsetX, offsetY, scale, columns, find: find ?? null }
  );
}

/** Reads a value out of the dev panel by its label. */
async function dev(page, label) {
  return page.evaluate((wanted) => {
    const terms = [...(document.getElementById("dev-readouts")?.querySelectorAll("dt") ?? [])];
    return terms.find((dt) => dt.textContent === wanted)?.nextElementSibling?.textContent ?? null;
  }, label);
}

function save(name, dataUrl) {
  const file = path.join(OUT, `${prefix}${name}.png`);
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`  wrote ${path.relative(REPO, file)}`);
}

async function shoot(browser, { name, url, scenario, plan }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.click("#start-play");
  await page.waitForTimeout(1200);
  await page.click("#pregame-play");
  await page.waitForTimeout(400);
  await page.click("#dev-autoplay-perfect");

  console.log(`${name} (${scenario}):`);
  // Shots run in the order given and time only moves forward, so `wait` is
  // "how much longer than the last shot", not an absolute. That is what lets a
  // plan hold a light landing and a heavy one from the same run: under perfect
  // autoplay the streak only grows, so early and late *are* light and heavy.
  for (const shot of plan) {
    if (shot.wait) await page.waitForTimeout(shot.wait);
    if (shot.frame) {
      await page.locator("#dev-panel").evaluate((el) => el.setAttribute("hidden", ""));
      await page.screenshot({ path: path.join(OUT, `${prefix}${name}-frame.png`) });
      await page.locator("#dev-panel").evaluate((el) => el.removeAttribute("hidden"));
      console.log(`  wrote ${path.relative(REPO, path.join(OUT, `${prefix}${name}-frame.png`))}`);
      continue;
    }
    // Sampled either side of the strip, because the strip spans about eight
    // tenths of a second and the streak can grow across it. A single reading
    // taken before would have labelled a light capture with a size the frames
    // do not show.
    const before = await dev(page, "actor size");
    save(`${name}-${shot.name}`, await strip(page, shot));
    const after = await dev(page, "actor size");
    if (before && before !== "—") console.log(`    (actor size ${before} → ${after})`);
  }
  await page.close();
}

const server = await serve();
const browser = await chromium.launch({
  ...(BROWSER_CANDIDATES[0] ? { executablePath: BROWSER_CANDIDATES[0] } : {}),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

try {
  mkdirSync(OUT, { recursive: true });

  await shoot(browser, {
    name: "goat",
    scenario: "Rocky Ascent",
    // Pinned: without a scenario the run picks whichever one authors this
    // difficulty, and a Rocky shot that came back full of beer cans is how
    // that was discovered.
    url: `${BASE}/?dev=1&input=test&level=3&scenario=rocky_ascent`,
    plan: [
      // Early, while the streak is still short and the actor is light.
      // A landing, frame by frame: the hop arc and whatever lands with it.
      // Long enough to be certain of catching one — 24 samples every other
      // rendered frame is about eight tenths of a second, comfortably more than
      // a beat at any tempo the game offers, so the strip cannot come back
      // showing only the quiet part between two hops.
      { name: "hop-light", wait: 5600, count: 24, every: 2, width: 170, height: 155, offsetX: 26, offsetY: 0, scale: 1.5, columns: 8, find: "goat" },
      // ...and again once the streak has capped, which is the same landing at
      // the other end of its weight range.
      { name: "hop-heavy", wait: 7000, count: 24, every: 2, width: 170, height: 155, offsetX: 26, offsetY: 0, scale: 1.5, columns: 8, find: "goat" },
      // One still, big, to judge how much of the lane the actor occupies.
      { name: "still", count: 1, width: 190, height: 165, offsetX: 26, offsetY: 0, scale: 4, find: "goat" },
      { name: "frame", frame: true },
    ],
  });

  await shoot(browser, {
    name: "crusher",
    scenario: "Can Crushing",
    url: `${BASE}/?dev=1&input=test&level=2&scenario=can_crushing`,
    plan: [
      { name: "still", wait: 9000, count: 1, width: 250, height: 185, offsetX: -55, offsetY: 20, scale: 4, find: "crusher" },
      { name: "frame", frame: true },
      // A whole crush: cans inbound, the palm down, the flatten, the fall.
      { name: "crush", count: 16, every: 2, width: 235, height: 175, offsetX: -50, offsetY: 20, scale: 2, columns: 8, find: "crusher" },
    ],
  });

  console.log(`\nScreenshots in ${path.relative(REPO, OUT)}`);
} finally {
  await browser.close();
  server.kill();
}
