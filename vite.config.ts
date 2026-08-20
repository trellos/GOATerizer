import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The sibling checkout of Tuninator. Declared in package.json as
 * `file:../Tuninator`; created by `npm run setup:tuninator`.
 *
 * The directory name is load-bearing, exactly as it is in the Tuninator-Example
 * repo, which uses the same mechanism.
 */
const LIB_ROOT = path.resolve(here, "..", "Tuninator");

/**
 * Tuninator's PUBLIC entry point, in source form.
 *
 * Aliasing at `src/index.ts` rather than resolving the package through its
 * `exports` map means GOATerizer builds before the library's `dist/` exists and
 * gets live reload when the library changes. It is still the public entry
 * point: this alias is the only path into the library, and GOATerizer never
 * imports `tuninator/src/**`.
 */
const LIB_ENTRY = path.join(LIB_ROOT, "src", "index.ts");

/** Built worklet asset produced by `npm run build` inside the library. */
const WORKLET_SRC = path.join(LIB_ROOT, "dist", "tuninator-worklet.js");
const WORKLET_DEST_DIR = path.join(here, "public", "assets");
const WORKLET_DEST = path.join(WORKLET_DEST_DIR, "tuninator-worklet.js");

/**
 * Copies `../Tuninator/dist/tuninator-worklet.js` into `public/assets/` so the
 * game can hand the recognizer a `workletUrl` it can actually fetch.
 *
 * `AudioWorklet.addModule()` needs a URL the dev/preview server serves, and
 * bundlers do not copy that file because it is loaded by URL rather than
 * imported. A missing worklet is a warning, never a build failure: the game
 * still runs the deterministic dev input path, and the live path surfaces
 * `worklet-load-failed` in the input status UI rather than failing silently.
 */
function copyWorkletPlugin(): Plugin {
  let lastCopiedMtimeMs = -1;

  const copy = (logger: { info: (m: string) => void; warn: (m: string) => void }): void => {
    if (!existsSync(WORKLET_SRC)) {
      logger.warn(
        `[goaterizer] Tuninator worklet not found at ${path.relative(here, WORKLET_SRC)} — ` +
          `run \`npm run setup:tuninator\`. Live guitar input will report ` +
          `\`worklet-load-failed\` until it exists.`
      );
      return;
    }
    const mtimeMs = statSync(WORKLET_SRC).mtimeMs;
    if (mtimeMs === lastCopiedMtimeMs) return;
    mkdirSync(WORKLET_DEST_DIR, { recursive: true });
    copyFileSync(WORKLET_SRC, WORKLET_DEST);
    lastCopiedMtimeMs = mtimeMs;
    logger.info("[goaterizer] copied Tuninator worklet -> public/assets/tuninator-worklet.js");
  };

  return {
    name: "goaterizer-copy-tuninator-worklet",
    buildStart() {
      copy({ info: (m) => this.info(m), warn: (m) => this.warn(m) });
    },
    configureServer(server) {
      const logger = {
        info: (m: string) => server.config.logger.info(m),
        warn: (m: string) => server.config.logger.warn(m),
      };
      copy(logger);
      server.watcher.add(WORKLET_SRC);
      server.watcher.on("add", (file) => {
        if (path.resolve(file) === WORKLET_SRC) copy(logger);
      });
      server.watcher.on("change", (file) => {
        if (path.resolve(file) === WORKLET_SRC) copy(logger);
      });
    },
  };
}

export default defineConfig({
  base: process.env["BASE_PATH"] || "/",
  plugins: [copyWorkletPlugin()],
  resolve: {
    alias: [{ find: /^tuninator$/, replacement: LIB_ENTRY }],
  },
  server: {
    fs: {
      // The alias points outside this project root; let the dev server serve it.
      allow: [here, LIB_ROOT],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
