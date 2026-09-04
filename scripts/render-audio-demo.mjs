#!/usr/bin/env node
/**
 * Renders the backing band to WAV files you can listen to.
 *
 *   npm run audio:demo
 *   npm run audio:demo -- --out ~/Desktop --bpm 110
 *
 * ## Why this exists
 *
 * Audio changes were being argued about from spectra. `npm run validate:browser`
 * measures peaks and onsets in three bands, which is the right way to catch "the
 * hat is above where a laptop reproduces anything" — and it cannot tell anybody
 * whether the kit *sounds* like it cuts through. That is a listening question,
 * and answering it needed a way to hear a candidate without building the game,
 * plugging in a guitar and playing a run per variant.
 *
 * So this renders the **shipped voice code** — `DrumKit` and `BassVoicePool`,
 * imported from `src/`, through the same master gain and soft clipper the game
 * builds in `audio-engine.ts` — into an `OfflineAudioContext`, and writes the
 * result to disk. The variants below are expressed as `KitTone` / `BassTone`
 * overrides, which is the only reason those types exist: an audition that
 * renders a *copy* of the synthesis is evidence about the copy.
 *
 * It runs in headless Chromium because Web Audio is a browser API and this is a
 * browser game. Vite's dev server transforms the TypeScript on the way in, so
 * there is no build step and no second copy of anything.
 *
 * ## What it writes
 *
 *   drums-attempts.wav     four kits, same bars: pulse, then L5 and L7 sixteenths
 *   bass-attempts.wav      four bass voices, same four-bar line
 *   band-before-after.wav  the whole backing, old against new, under a guitar
 *   band-parts.wav         the new mix built up a part at a time, so "is the
 *                          guitar still on top of this" can be listened to
 *                          rather than assumed
 *
 * Sections are separated by a short gap and announced on stdout in order.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
const VITE_BIN = path.join(REPO, "node_modules", "vite", "bin", "vite.js");
const PORT = Number(process.env["PORT"] ?? 4321);
const BASE = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const OUT = path.resolve(REPO, flag("out", "audio-demo"));
const BPM = Number(flag("bpm", 100));

/* -------------------------------------------------------------------------- */
/* The kits, as overrides of what ships                                        */
/* -------------------------------------------------------------------------- */

/**
 * The kit as it stood before this iteration, to within one detail: the kick's
 * click is 30ms in the current code and was 20ms before, and that length is not
 * one of the knobs. Everything else — the flat 0.85 bus with no drive, the
 * single-layer kick, the single-band snare — is exact.
 */
const KIT_BEFORE = {
  level: 0.85,
  drive: 1,
  knee: 1,
  kickBeater: 0,
  kickClick: 0.5,
  kickTick: 0,
  snareBody: 0.7,
  snareSnap: 0,
  snareShell: 0,
  hat: 1,
};

const DRUM_VARIANTS = [
  { label: "A — the kit as it was", tone: KIT_BEFORE },
  {
    label: "B — the same kit, simply turned up",
    // The obvious fix, rendered so it can be rejected for a reason. It is the
    // one that spends the master's headroom: the peaks move and the average
    // barely does, because a drum kit is nearly all transient.
    tone: { ...KIT_BEFORE, level: 1 },
  },
  {
    label: "C — layered kick and snare, no drive",
    // The synthesis changes on their own: the kick's beater harmonic and high
    // tick, the snare's snap and tuned shell. Louder in the bands a small
    // speaker reproduces without being louder on a meter.
    tone: { level: 1, drive: 1, knee: 1 },
  },
  { label: "D — layered, and the bus driven (ships)", tone: {} },
];

const BASS_VARIANTS = [
  {
    label: "A — the bass as it was",
    // Sawtooth plus its octave into a fixed low-pass, decaying to nothing a
    // third of the way through the beat.
    level: 0.46,
    tone: {
      wave: "sawtooth",
      sub: 0,
      octave: 0.42,
      grit: 0,
      cutoffHz: 1200,
      sweepHz: 1200,
      sustain: 0.002,
    },
  },
  {
    label: "B — and a sub sine under it (rumble)",
    level: 0.46,
    tone: {
      wave: "sawtooth",
      sub: 0.5,
      octave: 0.42,
      grit: 0,
      cutoffHz: 1200,
      sweepHz: 1200,
      sustain: 0.002,
    },
  },
  {
    label: "C — growl wave, swept filter, real sustain",
    level: 0.5,
    tone: { grit: 0 },
  },
  { label: "D — and the overdriven band on top (ships)", level: null, tone: {} },
];

/* -------------------------------------------------------------------------- */
/* What is played                                                              */
/* -------------------------------------------------------------------------- */

/** Two bars of the bare pulse, two of an L5 groove, two of the L7 rage rung. */
const DRUM_BARS = [
  { pattern: "pulse" },
  { pattern: "pulse" },
  { pattern: "L5", variant: "sixteenth" },
  { pattern: "L5", variant: "sixteenth" },
  { pattern: "L7", variant: "sixteenth" },
  { pattern: "L7", variant: "sixteenth" },
];

/** The band section: an L5 sixteenth groove for four bars. */
const BAND_BARS = [
  { pattern: "L5", variant: "sixteenth" },
  { pattern: "L5", variant: "sixteenth" },
  { pattern: "L5", variant: "sixteenth" },
  { pattern: "L5", variant: "sixteenth" },
];

/**
 * The page-side renderer.
 *
 * Everything inside runs in the browser and imports the game's own modules.
 * Returns 16-bit PCM as base64, which Node wraps in a WAV header.
 */
const RENDER = async (plan) => {
  const [drums, bassVoice, bassPlayer, patterns, line, keys, clip, pluck] = await Promise.all([
    import("/src/audio/drum-voices.ts"),
    import("/src/audio/bass-voice.ts"),
    import("/src/audio/bass-player.ts"),
    import("/src/audio/drum-pattern.ts"),
    import("/src/audio/bass-line.ts"),
    import("/src/music/keys.ts"),
    import("/src/audio/soft-clip.ts"),
    import("/src/dev/pluck-voices.ts"),
  ]);

  const SAMPLE_RATE = 44100;
  const secondsPerBeat = 60 / plan.bpm;
  const LEAD_IN = 0.25;
  const TAIL = 0.9;

  const patternFor = (bar) =>
    bar.pattern === "pulse"
      ? patterns.BACKBEAT_PATTERN
      : patterns.drumPatternAt(Number(bar.pattern.slice(1)), bar.variant);

  // One deterministic line for every bass and band section, so the variants are
  // compared on the same notes. A fixed sequence rather than Math.random: two
  // renders of "the same bar" have to be the same bar.
  const seeded = () => {
    let i = 0;
    const values = [0.17, 0.61, 0.42, 0.83, 0.29, 0.55, 0.71, 0.08];
    return () => values[i++ % values.length];
  };

  const renderSection = async (section) => {
    const bars = section.bars;
    const seconds = LEAD_IN + bars.length * 4 * secondsPerBeat + TAIL;
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);

    // The game's master chain, node for node: `audio-engine.ts`.
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const clipper = ctx.createWaveShaper();
    clipper.curve = clip.softClipCurve(0.7);
    clipper.oversample = "2x";
    master.connect(clipper);
    clipper.connect(ctx.destination);

    const at = (bar, beat) => LEAD_IN + (bar * 4 + beat) * secondsPerBeat;

    if (section.drums) {
      const kit = new drums.DrumKit(ctx, master, section.drums);
      bars.forEach((bar, index) => {
        for (const hit of patternFor(bar).hits) {
          kit.strike(hit.voice, at(index, hit.startBeat), hit.velocity);
        }
      });
    }

    if (section.bass) {
      const out = ctx.createGain();
      out.gain.value = section.bass.level ?? bassPlayer.BASE_OUTPUT_GAIN;
      out.connect(master);
      const pool = new bassVoice.BassVoicePool(ctx, out, section.bass.tone);
      const key = { tonic: 9, mode: "minor" };
      const bass = line.generateBassLine(key, seeded());
      for (let bar = 0; bar < bars.length; bar += 1) {
        for (const note of bass.notes) {
          const beat = note.startBeat - bar * 4;
          if (beat < 0 || beat >= 4) continue;
          pool.play(note.midi, at(bar, beat), note.durationBeats * secondsPerBeat);
        }
      }
    }

    if (section.guitar) {
      // The audible autoplay voice, at the level the dev monitor plays it —
      // present so the question "does the backing bury the guitar" can be asked
      // of the recording rather than guessed at.
      const out = ctx.createGain();
      out.gain.value = 0.6;
      out.connect(master);
      const voices = new pluck.PluckVoicePool(ctx, out, "pluck");
      const key = { tonic: 9, mode: "minor" };
      const shape = [1, 3, 5, 6, 5, 3, 2, 1];
      bars.forEach((_bar, index) => {
        shape.forEach((degree, step) => {
          const midi = keys.degreeToMidi({ degree, octaveBand: 0 }, key);
          voices.pluck(midi, at(index, step * 0.5), secondsPerBeat * 0.4);
        });
      });
    }

    const buffer = await ctx.startRendering();
    return buffer.getChannelData(0);
  };

  // Sections are rendered separately and butted together with a gap, so one
  // file is a playlist and a listener does not have to line up four downloads.
  const rendered = [];
  for (const section of plan.sections) rendered.push(await renderSection(section));

  const gap = Math.round(SAMPLE_RATE * 0.7);
  const total = rendered.reduce((sum, part) => sum + part.length + gap, 0);
  const pcm = new Int16Array(total);
  let cursor = 0;
  let peak = 0;
  for (const part of rendered) {
    for (let i = 0; i < part.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, part[i]));
      peak = Math.max(peak, Math.abs(sample));
      pcm[cursor + i] = Math.round(sample * 32767);
    }
    cursor += part.length + gap;
  }

  // Base64 in chunks: `String.fromCharCode(...bytes)` on a megabyte of samples
  // overflows the argument list.
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { base64: btoa(binary), sampleRate: SAMPLE_RATE, frames: total, peak };
};

/* -------------------------------------------------------------------------- */
/* Node side                                                                   */
/* -------------------------------------------------------------------------- */

/** A 16-bit mono WAV around raw PCM. */
function wav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

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

async function launchBrowser() {
  const rejections = [];
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      const browser = await chromium.launch({ ...candidate.options, args: ["--no-sandbox"] });
      console.log(`NOTE  rendering in ${candidate.label}`);
      return browser;
    } catch (error) {
      rejections.push(`  ${candidate.label} — ${String(error?.message ?? error).split("\n")[0]}`);
    }
  }
  throw new Error(`no usable Chromium. Tried:\n${rejections.join("\n")}`);
}

async function serve() {
  if (!existsSync(VITE_BIN)) {
    throw new Error(`vite is not installed at ${VITE_BIN} — run \`npm install\` first`);
  }
  const child = spawn(
    process.execPath,
    [VITE_BIN, "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
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
  throw new Error(`the dev server did not come up on ${BASE}`);
}

const server = await serve();
const browser = await launchBrowser();

try {
  mkdirSync(OUT, { recursive: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${BASE}/?dev=1&input=test`, { waitUntil: "domcontentloaded" });

  const files = [
    {
      file: "drums-attempts.wav",
      what: "the kit alone — two bars of the bare pulse, two of an L5 sixteenth groove, two of L7",
      sections: DRUM_VARIANTS.map((variant) => ({
        label: variant.label,
        bars: DRUM_BARS,
        drums: variant.tone,
      })),
    },
    {
      file: "bass-attempts.wav",
      what: "the bass alone — the same four-bar line in A minor each time",
      sections: BASS_VARIANTS.map((variant) => ({
        label: variant.label,
        bars: BAND_BARS,
        bass: { tone: variant.tone, level: variant.level },
      })),
    },
    {
      file: "band-before-after.wav",
      what: "the whole backing under the autoplay guitar: old, then new",
      sections: [
        {
          label: "before — the kit and bass as they were",
          bars: BAND_BARS,
          drums: KIT_BEFORE,
          bass: { tone: BASS_VARIANTS[0].tone, level: BASS_VARIANTS[0].level },
          guitar: true,
        },
        {
          label: "after — what ships",
          bars: BAND_BARS,
          drums: {},
          bass: { tone: {}, level: null },
          guitar: true,
        },
      ],
    },
    {
      file: "band-parts.wav",
      what: "the new mix a part at a time — guitar, then the bass under it, then the kit",
      sections: [
        { label: "the autoplay guitar alone", bars: BAND_BARS, guitar: true },
        {
          label: "with the bass under it",
          bars: BAND_BARS,
          bass: { tone: {}, level: null },
          guitar: true,
        },
        {
          label: "and the kit — the whole backing",
          bars: BAND_BARS,
          drums: {},
          bass: { tone: {}, level: null },
          guitar: true,
        },
      ],
    },
  ];

  for (const spec of files) {
    const result = await page.evaluate(RENDER, { bpm: BPM, sections: spec.sections });
    const pcm = Buffer.from(result.base64, "base64");
    const target = path.join(OUT, spec.file);
    writeFileSync(target, wav(pcm, result.sampleRate));
    const seconds = (result.frames / result.sampleRate).toFixed(1);
    console.log(`\n${spec.file} — ${spec.what}`);
    console.log(`  ${seconds}s at ${BPM}bpm, peak ${result.peak.toFixed(3)}`);
    spec.sections.forEach((section, index) => console.log(`  ${index + 1}. ${section.label}`));
  }

  if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ")}`);
  console.log(`\nwritten to ${OUT}`);
} finally {
  await browser.close();
  server.kill();
}
