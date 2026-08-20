import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The unit/integration suite never touches the microphone, the AudioContext or
 * the DOM: everything under `src/music`, `src/game` and `src/scenario` is pure.
 *
 * The Tuninator alias is still declared because `src/input/guitar-input.ts` and
 * the adapter import the library's *types*, and one test imports the adapter's
 * pure normalisation helpers.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^tuninator$/,
        replacement: path.resolve(here, "..", "Tuninator", "src", "index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
