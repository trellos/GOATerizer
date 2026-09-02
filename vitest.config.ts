import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The unit/integration suite never touches the microphone, the AudioContext or
 * the DOM: everything under `src/music`, `src/game` and `src/scenario` is pure.
 *
 * The Tuninator alias is DEFENSIVE, not required. No file under `tests/` imports
 * the adapter or reaches the library transitively today -- `src/input/guitar-input.ts`,
 * the port the suite does depend on, has no imports at all. The alias is kept so
 * that a future test which does import the adapter fails on its own assertions
 * rather than on a module-resolution error.
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
