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
 * than every file in `src/`. A checkout that is left alone is still *checked* —
 * if it does not export `createRecognizer` this exits 1 and says so, rather
 * than letting the wrong ref resurface later as a Vite resolution error.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/**
 * npm's launcher on Windows is `npm.cmd`, not `npm`.
 *
 * `execFileSync` goes to `CreateProcess`, which — unlike a shell — does not
 * consult `PATHEXT`. So spawning `"npm"` fails with a bare `ENOENT` on Windows
 * even though `npm` works perfectly in the same terminal. Naming the real file
 * is the fix; `shell: true` would also work but would then need every argument
 * quoted against the Windows command-line parser.
 */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/** Aborts with an explanation rather than a stack trace. */
function fail(message) {
  console.error(`\n[setup] ${message}\n`);
  process.exit(1);
}

/**
 * Runs a command, streaming its output.
 *
 * Setup failures are almost always environmental — a missing binary, a network
 * refusal, a dirty checkout — and a Node stack trace describes none of that. It
 * points at this file, which is never where the problem is. So report what was
 * being attempted, where, and what to do about it, in sentences.
 */
function run(command, args, cwd) {
  const printable = `${command} ${args.join(" ")}`;
  try {
    execFileSync(command, args, { cwd, stdio: "inherit" });
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(
        `\`${command}\` is not on your PATH, so \`${printable}\` could not start.\n` +
          `        Install it and re-run this script.`
      );
    }
    const status = typeof error?.status === "number" ? ` (exit code ${error.status})` : "";
    fail(
      `\`${printable}\` failed in ${cwd}${status}.\n` +
        `        Its own output is above — that is where the reason is.`
    );
  }
}

/** Runs a command for its output, returning null instead of throwing. */
function capture(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
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

let moved = false;

if (!existsSync(LIB_ROOT)) {
  console.log(`[setup] cloning ${REMOTE} @ ${REF} -> ${LIB_ROOT}`);
  run("git", ["clone", "--depth", "1", "--branch", REF, REMOTE, LIB_ROOT], REPO_ROOT);
  moved = true;
} else if (update) {
  console.log(`[setup] updating ${LIB_ROOT} to ${REF}`);
  run("git", ["fetch", "--depth", "1", "origin", REF], LIB_ROOT);
  run("git", ["checkout", "--detach", "FETCH_HEAD"], LIB_ROOT);
  moved = true;
} else {
  console.log(`[setup] using existing checkout at ${LIB_ROOT} (pass --update to re-fetch ${REF})`);
}

/*
 * An existing checkout is left alone — including when it is on the wrong ref.
 *
 * That is the right default (you may be working on the library), but silence is
 * the wrong failure. A checkout on `main` is 0.1: it has no `createRecognizer`,
 * so the game does not compile, and the error surfaces hundreds of lines later
 * as a Vite import resolution failure that says nothing about this script or
 * about refs. Check the one symbol the whole integration rests on, here, where
 * the ref is still the subject.
 */
const entryPoint = path.join(LIB_ROOT, "src", "index.ts");
if (!existsSync(entryPoint)) {
  fail(
    `${LIB_ROOT} exists but has no src/index.ts, so it is not a Tuninator checkout.\n` +
      `        Move or remove it and re-run this script to clone ${REF}.`
  );
}
if (!/\bcreateRecognizer\b/.test(readFileSync(entryPoint, "utf8"))) {
  const head = capture("git", ["rev-parse", "--short", "HEAD"], LIB_ROOT) ?? "unknown";
  const describe =
    capture("git", ["describe", "--all", "--always", "HEAD"], LIB_ROOT) ?? "unknown revision";
  fail(
    `the Tuninator checkout at ${LIB_ROOT} does not export \`createRecognizer\`.\n` +
      `        found: ${head} (${describe})\n` +
      `        wanted: ${REF}\n\n` +
      `        GOATerizer is written against Tuninator's 0.2 recognizer API. A checkout\n` +
      `        on \`main\` is still 0.1 (\`createTuninator\`) and this game does not compile\n` +
      `        against it. Move the checkout with:\n\n` +
      `          node scripts/setup-tuninator.mjs --update\n\n` +
      `        That discards nothing tracked, but it does detach HEAD. If you have work in\n` +
      `        that checkout, commit or branch it there first.`
  );
}

/*
 * `--update` can change the dependency manifest, so a node_modules from the
 * previous ref is not evidence that dependencies are installed — it is evidence
 * that they were, for a different revision.
 */
if (moved || !existsSync(path.join(LIB_ROOT, "node_modules"))) {
  console.log("[setup] installing library dependencies");
  run(NPM, ["ci"], LIB_ROOT);
}

const worklet = path.join(LIB_ROOT, "dist", "tuninator-worklet.js");
const needsBuild =
  !existsSync(worklet) || statSync(worklet).mtimeMs < newestMtimeIn(path.join(LIB_ROOT, "src"));

if (needsBuild) {
  console.log("[setup] building library (emits dist/tuninator-worklet.js)");
  run(NPM, ["run", "build"], LIB_ROOT);
} else {
  console.log("[setup] library worklet is up to date");
}

console.log("[setup] done. Now run `npm install` in GOATerizer.");
