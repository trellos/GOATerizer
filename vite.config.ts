import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/* -------------------------------------------------------------------------- */
/* The minigame editor's file API                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where the editor's Save button lands. `src/editor/api-client.ts` is the only
 * caller; the path is shared by hand rather than through an import, because one
 * side of it is Node and the other is the browser.
 */
const SCENARIO_API = "/__goaterizer/scenario/";
const SCENARIOS_DIR = path.join(here, "docs", "scenarios");
/** A scenario id, as every authored file spells one. Also the file name. */
const SCENARIO_ID = /^[a-z][a-z0-9_]{0,63}$/;
/** Generous for a scenario file — the largest in the repo is ~85 kB. */
const MAX_SCENARIO_BYTES = 4 * 1024 * 1024;

/**
 * Lets the minigame editor write scenario files to disk.
 *
 * **Dev server only**, and that is the whole design: the editor is a local
 * authoring tool whose output is committed to git (`README.md`), and a browser
 * page cannot write to a repository any other way. `configureServer` is not
 * called for `vite build` or `vite preview`, so nothing here reaches a deployed
 * site — the built game has no route that writes a file, and the editor's own
 * save reports that plainly when the route is not there.
 *
 * The id is validated against the same shape every authored file uses and the
 * path is rebuilt from it rather than taken from the URL, so there is no
 * traversal to defend against: `..` is not a scenario id.
 */
function scenarioFilesPlugin(): Plugin {
  return {
    name: "goaterizer-scenario-files",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        if (!url.startsWith(SCENARIO_API)) return next();

        const reply = (status: number, body: Record<string, unknown>): void => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(body));
        };

        const id = decodeURIComponent(url.slice(SCENARIO_API.length).split("?")[0] ?? "");
        if (!SCENARIO_ID.test(id)) {
          return reply(400, { error: `${JSON.stringify(id)} is not a scenario id` });
        }
        const file = path.join(SCENARIOS_DIR, `${id}.scenario.json`);

        if (request.method === "DELETE") {
          if (!existsSync(file)) return reply(404, { error: `no scenario ${id} on disk` });
          rmSync(file);
          server.config.logger.info(`[goaterizer] editor deleted docs/scenarios/${id}.scenario.json`);
          return reply(200, { deleted: id });
        }

        if (request.method !== "PUT") {
          response.statusCode = 405;
          return response.end();
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        let aborted = false;
        request.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_SCENARIO_BYTES) {
            aborted = true;
            reply(413, { error: "scenario too large" });
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        request.on("end", () => {
          if (aborted) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch (error) {
            return reply(400, { error: `not JSON: ${(error as Error).message}` });
          }
          // The file is named after the id it declares. Anything else would put
          // a scenario on disk that the library discovers under another name.
          const declared = (parsed as { id?: unknown })?.id;
          if (declared !== id) {
            return reply(400, {
              error: `body declares id ${JSON.stringify(declared)} but the URL says ${id}`,
            });
          }
          mkdirSync(SCENARIOS_DIR, { recursive: true });
          writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
          server.config.logger.info(`[goaterizer] editor wrote docs/scenarios/${id}.scenario.json`);
          reply(200, { saved: id, path: `docs/scenarios/${id}.scenario.json` });
        });
        return undefined;
      });
    },
  };
}

export default defineConfig({
  base: process.env["BASE_PATH"] || "/",
  plugins: [copyWorkletPlugin(), scenarioFilesPlugin()],
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
