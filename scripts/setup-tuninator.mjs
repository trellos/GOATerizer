#!/usr/bin/env node
/**
 * Points GOATerizer at a local Tuninator checkout and builds its worklet asset.
 *
 * GOATerizer consumes Tuninator's real public API. Tuninator is not published
 * to npm, so `package.json` declares it as `file:../Tuninator` and
 * `vite.config.ts` / `tsconfig.json` resolve the import at the library's public
 * entry point. That means the sibling directory has to exist, be named exactly
 * `Tuninator`, and have been built at least once:
 *
 *   parent/
 *   ├── Tuninator/    <- the library, MUST be named exactly this
 *   └── GOATerizer/   <- this repo
 *
 * Run this before `npm install`:
 *
 *   node scripts/setup-tuninator.mjs
 *
 * It is idempotent: an existing checkout is left alone unless --update is
 * passed, and the build is skipped when `dist/tuninator-worklet.js` is newer
 * than every file in `src/`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const LIB_ROOT = path.resolve(REPO_ROOT, "..", "Tuninator");

const REMOTE = process.env["TUNINATOR_REMOTE"] ?? "https://github.com/trellos/Tuninator";

/**
 * The library ref GOATerizer is written against.
 *
 * GOATerizer targets Tuninator's **0.2 streaming recognizer** API
 * (`createRecognizer`, `Note` lifecycle, `SourceTimeMs` + `Timebase`), which is
 * what `src/input/tuninator-provider.ts` wraps. That API is not on the
 * library's `main` yet — `main` still exports the 0.1 `createTuninator` /
 * `MusicEvent` surface — so this pin is deliberate, not stale. Tuninator-Example
 * pins the same ref for the same reason.
 *
 * Two things make 0.2 the right target rather than a preference:
 *   - `RecognizerOptions.audioContext` lets the game share ONE AudioContext
 *     between the musical transport, the bass and the detector;
 *   - `Timebase.originContextTime` relates `SourceTimeMs` to that context's
 *     clock exactly, so a detected attack lands in transport-beat space without
 *     any wall-clock estimation. A rhythm game cannot judge timing honestly
 *     without that.
 *
 * When 0.2 lands on `main`, change this to `main` and delete this paragraph.
 */
const REF = process.env["TUNINATOR_REF"] ?? "claude/guitar-event-recognizer-refactor-t5g5yr";

const update = process.argv.includes("--update");

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function newestMtimeIn(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtimeIn(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

if (!existsSync(LIB_ROOT)) {
  console.log(`[setup] cloning ${REMOTE} @ ${REF} -> ${LIB_ROOT}`);
  run("git", ["clone", "--depth", "1", "--branch", REF, REMOTE, LIB_ROOT], REPO_ROOT);
} else if (update) {
  console.log(`[setup] updating ${LIB_ROOT} to ${REF}`);
  run("git", ["fetch", "--depth", "1", "origin", REF], LIB_ROOT);
  run("git", ["checkout", "--detach", "FETCH_HEAD"], LIB_ROOT);
} else {
  console.log(`[setup] using existing checkout at ${LIB_ROOT} (pass --update to re-fetch ${REF})`);
}

if (!existsSync(path.join(LIB_ROOT, "node_modules"))) {
  console.log("[setup] installing library dependencies");
  run("npm", ["ci"], LIB_ROOT);
}

const worklet = path.join(LIB_ROOT, "dist", "tuninator-worklet.js");
const needsBuild =
  !existsSync(worklet) || statSync(worklet).mtimeMs < newestMtimeIn(path.join(LIB_ROOT, "src"));

if (needsBuild) {
  console.log("[setup] building library (emits dist/tuninator-worklet.js)");
  run("npm", ["run", "build"], LIB_ROOT);
} else {
  console.log("[setup] library worklet is up to date");
}

console.log("[setup] done. Now run `npm install` in GOATerizer.");
