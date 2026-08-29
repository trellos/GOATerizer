# GOATerizer

> **You really suck and this is your best shot.**

A browser guitar game where the guitar is the controller. Real notes, played on a
real instrument, detected by [Tuninator](https://github.com/trellos/Tuninator),
make a stupid pixel goat climb a mountain.

This repository currently contains a **vertical slice**: a full run shell, five
scenarios across two minigame classes covering difficulties 1–6, live guitar
input, a continuous musical clock, pregame, a timing check, timeline, judgment,
scoring, stars and results. `docs/game-design/` is the design authority;
`AGENTS.md` is the repository's working agreement; `docs/IDEAS.md` is the
running backlog of things noticed while playing, and of the content gaps sitting
behind finished systems.

The characters now live **on the timeline itself** rather than in a scenario
panel beside it — the goat stands on the note bars and climbs them, the can
crusher stands at one lane and catches what you throw at him. That work is
drafted and documented in `docs/game-design/PROPOSED_Timeline_Actors.md`.

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

An existing `../Tuninator` is left where it is — you may be working on the
library — but it is not taken on trust. Setup checks that the library's own
`../Tuninator/src/index.ts` exports `createRecognizer`, and if it does not (a checkout on `main` is still 0.1), it
exits naming the revision it found and how to move it. Without that check the
wrong ref surfaces much later as a Vite import resolution error that mentions
neither this script nor refs.

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

`node scripts/author-rocky-scenarios.mjs` re-derives the authored musical
content of all four Rocky-family scenario files (phrases, star thresholds, and
Rocky Ascent's waypoint coordinates) when a designer changes the phrase or curve
tables at the top of that script.

---

## Playing it

1. **Start** → Play. This is the user gesture that opens the AudioContext and
   the microphone; nothing before it touches a protected API.
2. **Pregame** is a live sandbox. The bass is already looping, Tuninator is
   already listening, and the timeline shows what you play. Reroll the key,
   pick a tempo, pick Key View or Tablature View, and pick a fingering from the
   five-fret neck diagrams — that is where on the neck you want to practise this
   octave. Pregame and the run are the same layout, so the timeline you warm up
   on is the same rectangle you play on. None of it stops the beat.
3. **Play** starts the run on the next measure boundary plus a lead-in. Targets
   slide in from the right, cross the strike line on their beat, and leave to
   the left. The goat stands on the bar you just hit and jumps to the next one,
   growing with the streak; a miss drops it to the floor and the next good note
   spawns a new one. The scenario behind it all is a backdrop.
   The kit changes with the minigame: the difficulty picks one of seven
   intensity rungs, from a half-time skeleton to the whole drum kit, and the
   feel of the authored notes picks the grid the bar subdivides on. The bass
   listens too — miss notes and it steps out of the way, a rung quieter each
   time, until after four it is barely there and the drums are holding the floor
   alone. Land them, or let a note go at the right moment, and it comes back.
4. **Eight measures** — the scenario's four-measure phrase, played twice, so the
   first pass is the read and the second is the performance. 0–3 stars. Zero
   stars ends the run and tells you what kind of lamb you are. Each passed
   minigame puts a trophy on the shelf in the top bar — bare at one star, horns
   at two, a crown at three.

**Timing check** (from the start screen) measures how far your notes land from
the beat, so "the game feels late" can be told apart from "I am playing late".
It reports two numbers: your offset, which is your rig and your feel together,
and your consistency, which is only you and decides whether the offset can be
trusted at all. See `DECISION_LOG.md` (DECISION-026) for why quarter notes at
90bpm, and why nothing on that screen moves on the beat.

### Developer flags

Dev tooling is gated behind `?dev=1` and never reachable from normal play.

| Parameter | Effect |
|---|---|
| `?dev=1` | Show the developer panel (transport, detection, judgment, latency, scenario progress) |
| `?dev=1&input=test` | Drive the game from the **deterministic test provider** instead of a guitar. Bypasses Tuninator entirely — injects already-judged note events. The UI says so, loudly, the whole time |
| `?dev=1&input=synth` | Drive the game from a **synthetic sine-wave microphone**, through the real Tuninator recognizer. For environments that cannot grant microphone access (this repo was built and calibrated partly in one) but still need the actual detection/latency pipeline exercised, not bypassed. Autoplay schedules real sine plucks instead of injected events. The UI says so, loudly, the whole time |
| `?dev=1&autoplay=perfect\|75\|50\|25` | **Play the game for you**, so you can watch what playing looks like without a guitar. `perfect` takes every note dead on. `75`, `50` and `25` take that share of the note opportunities and fumble the rest: most fumbles are played as an audible wrong pitch — which never consumes the target, so it costs you a red bar *and* a miss — some are simply not played, and the occasional extra wrong note gets noodled into a gap. Picking a tier switches the input source to `synth` if a live microphone is selected, since a microphone cannot play anything; `input=test` is left alone, because it can. With no `input=` at all, the link implies `input=synth` |
| `?dev=1&seed=N` | Picks a different seeded autoplay performance. The same `N` fumbles the same notes in the same places every time, so a screenshot or a bug report reproduces |
| `?dev=1&level=N` | Force every slot to difficulty *N*, for tuning one level without grinding up to it. Which scenario fills it is still whatever the registry's difficulty pool picks — no longer always Rocky Ascent now that companion scenarios share levels with it |
| `?dev=1&scenario=<id>` | Pin every slot that scenario authors to it, so one scenario can be looked at without rerolling the run. Slots it does not author fall back to normal random selection. Unknown ids are refused with a console warning rather than silently ignored |
| `?dev=1&calibrateOffsetMs=N` | On the timing check only: fake a player whose notes land *N* ms from the click, which is how that screen is testable without a guitar. Deliberately not one of the autoplay tiers — those describe what share of the *targets* a fake guitarist takes, and the check has no targets |

---

## Architecture

Data flows one way. Views never mutate gameplay; the analyzer never touches a
sprite.

```
AudioEngine ── one AudioContext ──┬── Transport ──────┬── BassPlayer
                                  │                   └── DrumPlayer
                                  └── TuninatorGuitarInputProvider
                                              │  normalised guitar events
                                              ▼
                                     AttemptRuntime
                    (TargetJudge, AttemptScore, StarMeter, TimelineActor)
                                              │  judgment
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                               ▼                               ▼
       TimelineModel ──▶ TimelineView   BackingDuck ──▶ BassPlayer   ScenarioBackdropView
       (Key + Tab)     (notes + actor)  (how loud the backing         (background only)
                                         is allowed to be)
```

`EnergyLayer` hangs off the run rather than the attempt: it flies the stars
earned by a finished attempt into the trophy shelf, and nothing else.

Everything the player sees or is judged on runs on the beat they are **hearing**
— `beatAt(now − outputLatency − trim)` — while audio is scheduled in raw
transport time. One clock each, named, because mixing them made the timeline lead
the drums and the judge expire targets early: `DECISION_LOG.md` (DECISION-025).

| Path | What lives there |
|---|---|
| `src/audio/` | `Transport` (the one clock), the bass generator and its lookahead scheduler, the drum kit and its intensity ladder, the shared `AudioContext` |
| `src/music/` | Degrees, keys, transposition, guitar fingerings, pitch maths |
| `src/input/` | The `GuitarInputProvider` boundary, the Tuninator adapter, the deterministic test provider |
| `src/game/` | Target resolution, judgment, score, stars, the attempt, the 16-slot run, ranks |
| `src/scenario/` | Scenario schema and loader, the registry, the minigame classes (`RepeatMinigame`, `TimelineActor`) |
| `src/ui/` | Timeline model and views, the actor and performer layers, the scenario backdrop, trophies, dev panel |
| `src/config/` | **Every provisional tuning number**, in one place |
| `docs/scenarios/` | Authored scenario data — the runtime imports it directly |

### The boundaries that matter

- **Tuninator owns guitar analysis. GOATerizer owns what it means.** The adapter
  in `src/input/tuninator-provider.ts` normalises the library's `Note` lifecycle
  into attack / retune / sustain / release events in audio-clock time. Nothing
  downstream knows Tuninator exists; nothing in the adapter knows what a scale
  degree is. GOATerizer implements no pitch detection of its own.
- **A minigame class contains no scenario-specific asset names.** It is handed
  class asset *slots* and class parameters. Rocky Ascent decides its slots hold
  goats; Can Crushing decides its `repeatTarget` is a beer can.
- **Authored pitch places terrain; played pitch places projectiles.** The goat
  lands on the lane of the note it was *asked* for, so one flub can never strand
  it somewhere the next note is unreachable from. A can appears at the lane you
  *actually played*, so a wrong note says how you were wrong — see
  `DECISION_LOG.md` (DECISION-021).
- **The timeline has one model and two views.** Key View and Tablature View
  render the same `TimelineModel`; there is no second scoring engine.
- **The pitch space is one octave, root to root.** Eight lanes, authored as
  `1..7` plus `b1`. Two octaves was more than a player can hold in their head
  and answer on a guitar in real time — see `DECISION_LOG.md` (DECISION-012).
- **Timing is derived, never accumulated.** One anchor plus a linear map, so a
  tempo change is exact and a dropped frame moves nothing.
- **Scenario data drives content.** Adding another scenario of a class that
  already exists means a JSON file, art, and one line in
  `src/scenario/registry.ts`.

### Adding a scenario

1. Author `docs/scenarios/<id>/<id>.scenario.json` — supported levels, prompts
   in scale-degree tokens, star thresholds, asset bindings, and whatever else
   the declared `minigameClass` requires (a climb authors a route; a repeat
   scenario authors none, and the loader refuses one).
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
| Star thresholds | each level's `stars` block in the scenario JSON | Pass is 45% of a **single clean pass**, deliberately not scaled with the repeat, so a good second pass rescues a bad first read; two and three stars are 80% and 100% of the **whole attempt** |
| Attempt length | `src/config/tuning.ts` | A four-measure authored phrase, played `ATTEMPT_REPEATS` = 2 times |
| Drum intensity | `src/audio/drum-pattern.ts` | Seven rungs by difficulty, three rhythm variants each, one measure per loop |
| Backing duck | `src/game/backing-duck.ts` | Five rungs, −5 dB per missed note, bottoming at −20 dB rather than silence |
| Bass grammar | `src/audio/bass-line.ts` | One diatonic chord per measure, one note per beat |
| Latency trim | measured by the timing check, kept in `localStorage`; `src/config/tuning.ts` holds the un-measured default | 0ms on top of the browser's `outputLatency + baseLatency` |
| Streak bonus toward the second star | `src/config/tuning.ts` | 1 point per unbroken note against 10 for a Perfect — 10% of any attempt's own maximum |

---

## Known limits of this slice

- **Nothing authors L7.** The run's difficulty sequence ends on it, so a run
  that gets that far ends as a *content limit* rather than fabricating exercise
  data the designer has not written. The ladder is also not monotonic in note
  count: the `_high` scenarios sit two levels above the normal ones and reuse
  their phrase tables, so the densest material in the game is an L4.
- **Two minigame classes.** `RepeatMinigame` and the shared `TimelineActor` are
  built; TRAVERSE, THREE-STEP, PERFORM and BATTLE are named in the model and not
  implemented. `ClimbMinigame`'s runtime was deleted when the actors moved onto
  the timeline — its scenarios still declare the class, and their route data is
  still authored and validated, but nothing reads it (DECISION-023).
- **The actors are a draft.** They are drawn from the scenarios' own placeholder
  art where it exists (the goat) and from canvas primitives where it does not
  yet (the can crusher).
- **Placeholder art is original CC0 work**, not the third-party packs the
  scenario file names — see `docs/assets/ASSET_SOURCES.md` for why and for how
  to swap them in.
- **Nothing selects a drum rhythm variant.** Every intensity rung has straight,
  sixteenth and triplet versions, chosen from the authored notes — but all 20
  authored levels resolve to `straight`, because the material tops out at
  eighths. Two thirds of the drum work is unheard in play until a scenario is
  authored in sixteenths or triplets.
- **The G string offers one hand position, and cannot offer more.** The low root
  has exactly one possible fret per string, and the register the game is written
  in puts that below the nut on the G string in 20 of 24 keys — see
  `DECISION_LOG.md` (DECISION-032). Not a fingering bug.
- **No physical guitar has been played against this build.** Browser validation
  drives the deterministic provider and separately asserts that the production
  path reaches `listening` through Tuninator against a fake capture device.
  Everything about *feel* — the latency trim, the timing windows, whether the
  backing duck reads as supportive or as nagging — is unverified against an
  actual instrument.
