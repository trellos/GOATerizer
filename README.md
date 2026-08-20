# GOATerizer

> **You really suck and this is your best shot.**

A browser guitar game where the guitar is the controller. Real notes, played on a
real instrument, detected by [Tuninator](https://github.com/trellos/Tuninator),
make a stupid pixel goat climb a mountain.

This repository currently contains the **Rocky Ascent vertical slice**: one full
run shell with one scenario playable at difficulties 1–4, live guitar input, a
continuous musical clock, pregame, timeline, judgment, scoring, stars and
results. `docs/game-design/` is the design authority; `AGENTS.md` is the
repository's working agreement.

---

## The one thing that will trip you up first

**GOATerizer does not build without a sibling checkout of Tuninator.**

`package.json` declares `"tuninator": "file:../Tuninator"`, and `vite.config.ts`
and `tsconfig.json` resolve the import at the library's public entry point. The
library is not published to npm, and `src/input/tuninator-provider.ts` imports
`createRecognizer` and `RecognizerError` as *values* — so no URL parameter and no
dev flag rescues a missing library. Vite fails to resolve the module first.

```
parent/
├── Tuninator/     <- the library, MUST be named exactly this
└── GOATerizer/    <- this repo
```

One command sets it up:

```bash
npm run setup:tuninator   # clone/checkout the sibling, install it, build its worklet
npm install
npm run dev               # http://localhost:5173
```

`scripts/setup-tuninator.mjs` is idempotent — pass `--update` to re-fetch. It
pins a library ref, deliberately:

> GOATerizer targets Tuninator's **0.2 streaming recognizer** API
> (`createRecognizer`, the `Note` lifecycle, `SourceTimeMs` + `Timebase`). That
> API is not on the library's `main` yet; `main` still exports the 0.1
> `createTuninator` / `MusicEvent` surface. The pin is in
> `scripts/setup-tuninator.mjs` as `TUNINATOR_REF`, and Tuninator-Example pins
> the same ref for the same reason. When 0.2 lands on `main`, change it to
> `main`.

### Why 0.2 and not `main`

Two things in 0.2 are not conveniences, they are what makes honest rhythm-game
timing possible at all:

- `RecognizerOptions.audioContext` lets the game share **one** `AudioContext`
  between the musical transport, the bass and the detector.
- `Timebase.originContextTime` relates the recognizer's `SourceTimeMs` to that
  context's clock **exactly**, so a detected attack converts into transport-beat
  space with no wall-clock estimation anywhere:

  ```ts
  contextTime = originContextTime + sourceMs / 1000;
  ```

A detected attack therefore carries the audio-sample time of the *attack*, not
the time the answer was delivered.

---

## Commands

```bash
npm run setup:tuninator   # prerequisite: sibling library checkout + worklet build
npm run dev               # vite dev server
npm test                  # vitest — the rules, headless, no microphone
npm run typecheck         # tsc --noEmit
npm run build             # typecheck + production build
npm run validate:browser  # build, serve, drive real Chromium through a whole run
npm run art               # regenerate the placeholder pixel art
```

`node scripts/author-rocky-ascent.mjs` re-derives the authored scenario JSON
(prompts, star thresholds, waypoint coordinates) when a designer changes the
curve parameters at the top of that script.

---

## Playing it

1. **Start** → Play. This is the user gesture that opens the AudioContext and
   the microphone; nothing before it touches a protected API.
2. **Pregame** is a live sandbox. The bass is already looping, Tuninator is
   already listening, and the timeline shows what you play. Reroll the key,
   pick a tempo, pick Key View or Tablature View, pick a fingering. None of it
   stops the beat.
3. **Play** starts the run on the next measure boundary plus a lead-in. Targets
   slide in from the right, cross the strike line on their beat, and leave to
   the left. Hit them and a streak of good energy flies up into the scenario and
   the goat takes one foothold. Miss, or play the wrong note, and it wobbles and
   stays put.
4. Four measures, 0–3 stars. Zero stars ends the run and tells you what kind of
   lamb you are.

### Developer flags

Dev tooling is gated behind `?dev=1` and never reachable from normal play.

| Parameter | Effect |
|---|---|
| `?dev=1` | Show the developer panel (transport, detection, judgment, latency, scenario progress) |
| `?dev=1&input=test` | Drive the game from the **deterministic test provider** instead of a guitar. The UI says so, loudly, the whole time |
| `?dev=1&level=N` | Play Rocky Ascent L*N* in every slot, for tuning one level without grinding up to it |

---

## Architecture

Data flows one way. Views never mutate gameplay; the analyzer never touches a
sprite.

```
AudioEngine ── one AudioContext ──┬── Transport ─────── BassPlayer
                                  └── TuninatorGuitarInputProvider
                                              │  normalised guitar events
                                              ▼
                                     AttemptRuntime
                            (TargetJudge, AttemptScore, StarMeter, ClimbMinigame)
                                              │  judgment + energy
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
              TimelineModel              EnergyLayer            ScenarioStripView
              (Key + Tab views)
```

| Path | What lives there |
|---|---|
| `src/audio/` | `Transport` (the one clock), the bass generator and its lookahead scheduler, the shared `AudioContext` |
| `src/music/` | Degrees, keys, transposition, guitar fingerings, pitch maths |
| `src/input/` | The `GuitarInputProvider` boundary, the Tuninator adapter, the deterministic test provider |
| `src/game/` | Target resolution, judgment, score, stars, the attempt, the 16-slot run, ranks |
| `src/scenario/` | Scenario schema and loader, the registry, `ClimbMinigame` |
| `src/ui/` | Timeline model and views, scenario strip, energy streaks, dev panel |
| `src/config/` | **Every provisional tuning number**, in one place |
| `docs/scenarios/` | Authored scenario data — the runtime imports it directly |

### The boundaries that matter

- **Tuninator owns guitar analysis. GOATerizer owns what it means.** The adapter
  in `src/input/tuninator-provider.ts` normalises the library's `Note` lifecycle
  into attack / retune / sustain / release events in audio-clock time. Nothing
  downstream knows Tuninator exists; nothing in the adapter knows what a scale
  degree is. GOATerizer implements no pitch detection of its own.
- **`ClimbMinigame` contains no scenario-specific asset names.** It is handed a
  route, class asset *slots* and class parameters. Rocky Ascent decides those
  slots hold goats and boulders.
- **The timeline has one model and two views.** Key View and Tablature View
  render the same `TimelineModel`; there is no second scoring engine.
- **Timing is derived, never accumulated.** One anchor plus a linear map, so a
  tempo change is exact and a dropped frame moves nothing.
- **Scenario data drives content.** Adding another `ClimbMinigame` scenario means
  a JSON file, art, and one line in `src/scenario/registry.ts`.

### Adding a scenario

1. Author `docs/scenarios/<id>/<id>.scenario.json` — supported levels, prompts
   in scale-degree tokens, star thresholds, waypoints, asset bindings.
2. Drop art in `public/assets/scenarios/<id>/`, and record its provenance in
   `docs/assets/ASSET_SOURCES.md`.
3. Add one entry to `src/scenario/registry.ts`.

No gameplay code changes. `src/scenario/load.ts` validates the file and throws
loudly rather than repairing it.

---

## Provisional tuning

The design deliberately leaves several values open (GDD §23). Every one of them
is config, labelled provisional, and documented where it lives — not a guess
presented as design.

| Decision | Where | Current value |
|---|---|---|
| Key weighting | `src/config/key-weighting.ts` | All 24 keys, weighted toward guitar-friendly ones, nothing at zero |
| Timing windows | `src/config/tuning.ts` | Per subdivision, in beats; Good clamped to half the gap to the nearest neighbour |
| Score values | `src/config/tuning.ts` | Perfect 100, Good 40, Miss 0 |
| Star thresholds | each level's `stars` block in the scenario JSON | 45% / 80% / 100% of the all-Perfect maximum |
| Bass grammar | `src/audio/bass-line.ts` | One diatonic chord per measure, one note per beat |
| Latency trim | `src/config/tuning.ts`, live in the dev panel | 0ms on top of the measured `outputLatency + baseLatency` |

---

## Known limits of this slice

- **One scenario.** Rocky Ascent authors L1–4. Slots needing L5–7 are left
  explicitly unfilled and the run ends there as a *content limit*, rather than
  fabricating exercise data the designer has not written.
- **One minigame class.** `ClimbMinigame` is complete; the other five are
  named in the model and not implemented.
- **Placeholder art is original CC0 work**, not the third-party packs the
  scenario file names — see `docs/assets/ASSET_SOURCES.md` for why and for how
  to swap them in.
- **No physical guitar has been played against this build.** Browser validation
  drives the deterministic provider and separately asserts that the production
  path reaches `listening` through Tuninator against a fake capture device.
