/**
 * The Tuninator adapter's translation rules, driven by a fake recognizer.
 *
 * No microphone, no AudioContext, no pitch detection: the library is replaced
 * wholesale so the tests can state "these Notes arrived, in this order, at
 * these source times" and assert what the *game* was told. That is the only
 * part of the boundary GOATerizer owns.
 */

import { describe, expect, it, vi } from "vitest";

import { TEMPOS } from "../src/config/tempos.js";
import { FRAGMENT_COALESCE_MS, TIMING_WINDOWS_BEATS } from "../src/config/tuning.js";
import type { GuitarInputEvent } from "../src/input/guitar-input.js";

/** Handlers the adapter registered, plus a way to fire them. */
const lib = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    handlers,
    reset: () => handlers.clear(),
    emit: (name: string, ...args: unknown[]) => {
      for (const handler of handlers.get(name) ?? []) handler(...args);
    },
  };
});

vi.mock("tuninator", () => ({
  createRecognizer: () => ({
    start: async () => {},
    stop: async () => {},
    dispose: async () => {},
    getState: () => "listening",
    getActiveNotes: () => [],
    getNote: () => undefined,
    // Source time 0 is context time 0, so a source time in ms is a context
    // time in seconds divided by 1000 and nothing else has to be reasoned about.
    getTimebase: () => ({ sampleRate: 48000, originContextTime: 0 }),
    on: (name: string, handler: (...args: unknown[]) => void) => {
      const list = lib.handlers.get(name) ?? [];
      list.push(handler);
      lib.handlers.set(name, list);
      return () => {};
    },
  }),
  RecognizerError: class RecognizerError extends Error {
    readonly code = "unknown";
  },
}));

const { TuninatorGuitarInputProvider } = await import("../src/input/tuninator-provider.js");

/**
 * A `Note` with the fields the adapter actually reads.
 *
 * Cast rather than fully constructed: the real type carries hypothesis trails
 * and harmony that this boundary never looks at, and spelling them out would
 * make these tests a test of the library's type instead of the adapter's rules.
 */
function note(id: string, midi: number | undefined, startMs: number, confidence = 0.9) {
  return {
    id,
    startTime: startMs,
    endTime: null,
    pitch: {
      ...(midi === undefined
        ? {}
        : { current: { midi, frequencyHz: 440 }, currentFrequencyHz: 440 }),
      confidence,
    },
    confidence,
    amplitude: { rms: 0.1 },
  } as any;
}

async function startedProvider() {
  lib.reset();
  const events: GuitarInputEvent[] = [];
  const provider = new TuninatorGuitarInputProvider({
    audioContext: { currentTime: 0 } as AudioContext,
    workletUrl: "worklet.js",
  });
  provider.onEvent((event) => events.push(event));
  await provider.start();
  return { provider, events };
}

const WINDOW_MS = FRAGMENT_COALESCE_MS;

describe("one played note is announced once", () => {
  it("announces an attack when the pitch arrives", async () => {
    const { events } = await startedProvider();

    lib.emit("noteStarted", note("n1", 64, 1000));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "attack", id: "n1", midi: 64, contextTime: 1 });
  });

  it("stamps the attack with the onset, not with the frame that named it", async () => {
    const { events } = await startedProvider();

    // Evidence of something at 1000ms, but no pitch until 1060ms.
    lib.emit("noteStarted", note("n1", undefined, 1000));
    expect(events).toHaveLength(0);
    lib.emit("noteChanged", note("n1", 64, 1060), { type: "pitchCorrection", at: 1060 });

    expect(events[0]).toMatchObject({ type: "attack", contextTime: 1 });
  });

  it("folds a fragment that repeats the pitch into the attack it followed", async () => {
    const { events } = await startedProvider();

    lib.emit("noteStarted", note("n1", 64, 1000));
    lib.emit("noteEnded", { ...note("n1", 64, 1000), endTime: 1040 });
    // Tuninator sheds a second Note from the same pick. Without folding this is
    // a second attack, and the game scores one note as a hit and a mistake.
    lib.emit("noteStarted", note("n2", 64, 1040));

    expect(events.filter((event) => event.type === "attack")).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(["attack", "release"]);
  });

  it("folds a fragment that disagrees about the pitch into a retune", async () => {
    const { events } = await startedProvider();

    lib.emit("noteStarted", note("n1", 64, 1000));
    lib.emit("noteStarted", note("n2", 65, 1050));

    expect(events.map((event) => event.type)).toEqual(["attack", "retune"]);
    // The revision travels under the first attack's id: same played note.
    expect(events[1]).toMatchObject({ type: "retune", id: "n1", midi: 65 });
  });

  it("announces a genuine re-pick outside the window", async () => {
    const { events } = await startedProvider();

    lib.emit("noteStarted", note("n1", 64, 1000));
    lib.emit("noteStarted", note("n2", 64, 1000 + WINDOW_MS + 1));

    expect(events.map((event) => event.type)).toEqual(["attack", "attack"]);
    expect(events[1]).toMatchObject({ id: "n2" });
  });

  it("never swallows the fastest re-pick the game can ask for", async () => {
    // The ceiling on the window, asserted against the material rather than
    // against the window itself. The test above derives its gap from
    // `FRAGMENT_COALESCE_MS`, so widening the constant widens that test's gap
    // with it and the assertion moves out of the way — it will not fail however
    // far the window grows. This one cannot: the shortest gap the player can
    // legitimately be asked for is a sixteenth at the fastest tempo, which is a
    // fact about the tempo table and the subdivision table, not about the
    // adapter.
    const fastest = Math.max(...TEMPOS.map((tempo) => tempo.bpm));
    const sixteenthMs = 60000 / (fastest * 4);
    expect(FRAGMENT_COALESCE_MS).toBeLessThan(sixteenthMs);
    // And the subdivision table has to actually promise sixteenths, or the
    // bound above is measuring something the game never asks for.
    expect(TIMING_WINDOWS_BEATS.sixteenth).toBeDefined();

    const { events } = await startedProvider();
    lib.emit("noteStarted", note("n1", 64, 1000));
    lib.emit("noteStarted", note("n2", 64, 1000 + sixteenthMs));
    expect(events.map((event) => event.type)).toEqual(["attack", "attack"]);
  });

  it("releases once, when the last fragment stops sounding", async () => {
    const { events } = await startedProvider();

    lib.emit("noteStarted", note("n1", 64, 1000));
    lib.emit("noteStarted", note("n2", 64, 1050));
    lib.emit("noteEnded", { ...note("n1", 64, 1000), endTime: 1100 });
    // The first Note ended, but the played note is still ringing under n2.
    expect(events.filter((event) => event.type === "release")).toHaveLength(0);

    lib.emit("noteEnded", { ...note("n2", 64, 1050), endTime: 1400 });
    const releases = events.filter((event) => event.type === "release");
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ id: "n1", contextTime: 1.4 });
  });

  it("keeps folding against the revised pitch, not the one first announced", async () => {
    const { events } = await startedProvider();

    lib.emit("noteStarted", note("n1", 64, 1000));
    lib.emit("noteChanged", note("n1", 65, 1000), { type: "pitchCorrection", at: 1010 });
    // A fragment agreeing with the *revision* is not news, so it says nothing.
    lib.emit("noteStarted", note("n2", 65, 1050));

    expect(events.map((event) => event.type)).toEqual(["attack", "retune"]);
  });

  it("ignores a note below the confidence floor entirely", async () => {
    const { events } = await startedProvider();

    lib.emit("noteStarted", note("n1", 64, 1000, 0.1));

    expect(events).toHaveLength(0);
  });
});
