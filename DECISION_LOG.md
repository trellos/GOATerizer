# Decision Log

Maintained per `AGENTS.md`'s Decision Logging Protocol. Newest entries first.

---

#### DECISION-024: Pentatonic material is authored as pentatonic, resolved by the run's mode, and its low octave is folded up for now
* **Date:** 2026-09-02
* **Status:** Accepted (the fold is PROVISIONAL)
* **Owner:** Trevor (agent-assisted)
* **Note:** Numbered against this branch's log, which was renumbered when the minigame-API branch met `main`; `main` already carries DECISION-024 and above, so renumber this one at the merge, as DECISION-039 was.
* **Context:** The Goat Frontman brief (the first `PerformMinigame` scenario) was written by the designer in **pentatonic** degrees — `5Q 6Q 7Q 6QF` — with an explicit reason: the same Blues Lick is `6 1 2 1` in a major key and `b7 1 b3 1` in a minor one, so no roman numeral can be written down before the run's mode is rolled. The existing authored vocabulary (`1..7`, `b1`, DECISION-012) is diatonic and is parsed into a lane at load time, which is exactly the moment the mode is not known. The brief also counts eleven degrees across two octaves — five below a *middle* root, the root, four above it and the root above that — and the timeline is one octave, root to root (DECISION-012), with nothing below the tonic.
* **Decision:** A second authored vocabulary, `p1..p11`, parsed into a `PentatonicDegreeRef` (a step 1..5 and a *written* octave -1/0/1) that keeps the designer's numbering exactly; the scenario file says what was written. It becomes a diatonic `ScaleDegreeRef` in one function, `resolveDegree(ref, mode)`, called from `game/targets.ts` — already the one place a degree becomes a pitch — using major `1 2 3 5 6` / minor `1 b3 4 5 b7`, both subsets of the run key's own scale so every target stays diatonic and the lane labels stay right. The written low octave is **folded up** into the timeline's octave (`PENTATONIC_LOW_OCTAVE_FOLDS_UP = true`): every pitch class is exactly as authored, every note is on a lane the player can see, and only the contour of the one note that crosses the root in variants 1 and 2 changes (`la do re do` becomes `la' do re do`). When the timeline grows a second octave the constant flips and no scenario file changes.
* **Alternatives Considered:** (a) Transcribing the brief into diatonic tokens by hand, twice (one file per mode). Rejected: the run picks the mode, a scenario is one file, and the transcription would be a lie in one of the two modes. (b) Widening the timeline to two octaves for this scenario. Rejected here, not forever: it reverses DECISION-012, touches the lane model, the fingering picker, the played-note row and every renderer, and all of that is in the middle of the minigame-API refactor on the branch this is built on. It is the real answer to the contour loss and is recorded as such. (c) Shifting the authored notes so each variant fits an octave from the bottom root. Rejected: it changes the designer's notes rather than their display, and the middle-root framing (`6` appears in every variant as the tonal centre) is the point of the material.
* **Consequences:** Positive — the notation the designer actually writes in is the notation the file is in; the fold is one boolean with one test pinning what it does; `scenario-registry.test.ts` now checks every authored target is a real lane in *both* modes. Negative — the low-octave fold is a display compromise the tests call provisional and the scenario file's `designerReview` calls out; the timeline cannot currently show the phrase's true shape for the notes below the root, and that is a loss of exactly the kind GDD §13.1 says the silhouette exists to carry.

---

#### DECISION-025: A PERFORM scenario's flourishes are authored per note, and the crowd is spectacle that only grows
* **Date:** 2026-09-02
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted)
* **Context:** The Goat Frontman brief: on the notes marked `F` the goat hits a flourish pose; as it does, a crowd of other goats comes to watch; the higher the difficulty, the more goats. L1 repeats one of four variants; L2 picks two L1 variants and plays each twice, in any order; L3 is four harder variants; L4 picks two L3 variants and plays them twice. Two questions the brief leaves open: whether "pick" happens per attempt or once, and what a bad note does to a crowd that has already arrived.
* **Decision:** `PerformMinigame` (`src/scenario/minigames/perform-minigame.ts`) is a `MinigameModule` against DECISION-023's API and touches nothing else in the host: one `registerMinigame` line, one scenario entry. The flourish is authored **per note** in the prompt (`flourish: true`, a designer-readable mirror of the `F`) and per level in `visual.flourishBeats`, which is what the runtime reads; a test keeps them equal, and `create` throws if a flourish beat is not the start of a note. Flourish notes carry a star `overlay` on the timeline so the pose is visible before it arrives (GDD §1.4: difficulty from playing, not obscurity). The per-level ladder is one number, `goatsPerFlourish` (1 / 2 / 3 / 6, so the crowd a full phrase draws is 4 / 8 / 12 / 12 — L4 has half the flourishes of L3 and summons twice as many each rather than finishing with a thinner crowd). Perfect draws the full count, Good half. **"Pick" happens once, in `scripts/author-goat-frontman.mjs`** (L2 = variants 2,2,3,3; L4 = variants 2,3,2,3, alternating every bar because that is the one extra difficulty the pick order can carry); the unpicked variants stay in the file's `variantLibrary`. **Bad notes cost nothing that was earned:** the performer flinches, the crowd drops to its unimpressed state and slumps for a beat, and no goat ever leaves — the crowd is the attempt-global record, the same rule as the Rocky climb's "earned progress is never taken away". The crowd is impressed from ★★ and the payoff burst fires at ★★★.
* **Alternatives Considered:** (a) Rolling a variant per attempt so "in any order" is literal. Rejected: `AGENTS.md` §6/§18 — scenario exercises are hand-authored, and a per-attempt roll is procedural selection by another name; it is worth a class parameter later if the designer asks. (b) A goat walking off on a miss, as the mirror of one arriving on a flourish. Rejected: that charges twice for one mistake (the miss already cost the score and the flourish it was on) and puts the only interesting thing on screen behind the player's worst moments. (c) Deriving the flourish from the note (e.g. the last note of each measure). Rejected: L4's flourish is an off-beat eighth after a rest; the designer marks it, the data carries it. (d) Authoring L2–6 as the canonical catalogue lists Goat Frontman. Rejected in favour of the brief's L1–4 (`AGENTS.md` §20: the current explicit request wins); the deviation is recorded in the scenario file's `productionNotes`.
* **Consequences:** Positive — the class contains no scenario names, and the second PERFORM scenario is data and art; 41 headless tests cover the brief's behaviour as `Stage` output, including that a Good flourish draws half a crowd, a missed one draws nobody and a wrong note takes nobody away. Negative — the crowd stands on the floor below the lane band and the performer straddles its bottom edge, which was placed from the normalised geometry and one browser look rather than tuned; and the Good-window floor from `main` (DECISION-038) is not on this branch, so an eighth-note flourish at 0.25 beats of lateness is a miss here and a Good there — the tests use 0.18 so they hold on both.

---

#### DECISION-023: A minigame is an API a package implements, not a type the engine knows
* **Date:** 2026-09-02
* **Status:** Accepted (supersedes the `MinigameClassId` union in `scenario/types.ts`)
* **Owner:** Trevor (agent-assisted)
* **Context:** The design calls for six permanent minigame families and the asset catalog specifies ~48 scenarios across them, but the code shipped one — and was shaped so a second could not arrive. `AttemptRuntime` imported `ClimbMinigame` by name and constructed it unconditionally without ever reading `scenario.minigameClass`; `ScenarioDefinition` was *typed* to `ClimbAssetBindings` and `ClimbClassParameters`; `load.ts` ran the climb parsers whatever the file said; `ScenarioStripView` drew waypoints and a climber inline and read the class's asset slots straight out of scenario data. A `BattleMinigame` scenario could not have loaded, and had it loaded it would have been played as a climb. The goal was that nothing general references climb, that a minigame is an interface each family implements rather than an enum the engine enumerates, and that each minigame defines whatever data it wants.
* **Decision:** `src/minigame/api.ts` is the whole boundary and imports nothing, so a package needs that one file. The minigame is code and its output is data: it receives judged notes, measure boundaries, earned stars and completion, and returns a `Scene` of billboards in normalised 0..1 space, plus an optional `TimelineSkin` for its own target notes. Every lifecycle method returns `void`, so a minigame structurally cannot award score or stars, end an attempt, or move a note; it never calls the host, holds no callbacks, and gets no clock. `MinigameId` is an open string resolved through `minigame/registry.ts`, which refuses unregistered ids, mismatched `apiVersion`s and duplicate ids; registration happens at the composition root (`scenario/registry.ts`) so the generic registry never imports a minigame. `config` and `data` on the scenario model are `unknown`, validated by the minigame's own `parseConfig`/`parseLevel`, and `assetIds()` replaces the host's asset-naming convention. Motion belongs to the minigame; the host ships `slide`/`arc`/`decay` so consistency is free without the host guessing. On the timeline the host owns geometry absolutely and the minigame owns paint, in three slots — `underlay` and `overlay` bleed freely outside the note's rect, `body` stretches to it exactly so duration stays honest — with the played-note row and strike line always drawn on top.
* **Alternatives Considered:** (a) Handing the minigame a canvas context. Rejected: it makes `AGENTS.md` §10's static-billboard rule a convention nobody enforces, needs a canvas to test, and hands a downloadable package raw pixel access. The scene shape costs nothing in expressiveness — reduced to drawing operations, all six families in the catalog are a background, an actor pose swap, an instanced prop, optional state swaps and decaying effects. (b) A retained entity table the minigame mutates. Rejected: it reopens host-inbound calls and moves the state that makes minigames testable into the host. (c) Host-side tweening of keyed sprites. Rejected: a host can only interpolate straight lines and disagrees with the minigame mid-tween — THREE-STEP is "two little hops and a larger leap", and a knocked-over REPEAT target flies off with no destination to tween toward. (d) A discriminated union on `minigameClass` instead of opaque `config`/`data`. Rejected: type-safe across the repo, but every new family edits a shared file, so it is not extensible by anyone outside it. (e) Skinning played notes and bass too. Rejected: played notes are the player's own feedback and should never need relearning between scenarios, and the bass belongs to the run rather than any attempt.
* **Consequences:** Positive — `grep -ri climb src/game src/ui src/scenario/types.ts src/scenario/load.ts` returns nothing but prose, and adding a family is a `registerMinigame` line plus a module. Scenes are values, so the picture is unit-testable with no canvas. Pressure-testing Tin-Can Knockdown and Hop-Hop-LEAP on paper against this API required no change to it. Negative — the timeline skin is the one place a third-party minigame can still hurt readability, since "legible" is a judgement no type enforces; that is mitigated by host-owned geometry, a colour wash that survives any art, a clip that keeps ornament off the gutter, and a dev toggle, but not eliminated. Every new scene primitive is a host change by design. And the pressure test surfaced a blocker this API does not solve: the content model cannot express a triplet at all (`NoteDuration` has no member for one, `load.ts` demands exact duration matching, and `TIMING_WINDOWS_BEATS` has no row), so `ThreeStepMinigame` needs a separate content-model fix before it can be written.

---

#### DECISION-022: Constants mirroring a Tuninator internal carry a `MIRRORS` marker
* **Date:** 2026-09-02
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted)
* **Context:** `src/config/tuning.ts` declares itself "every provisional tuning number in one file", and `AGENTS.md` §17 is why: where the design leaves a gap, make it config and label it provisional. But a handful of values in that file are not free choices at all — `MIN_ATTACK_CONFIDENCE` sits deliberately just under Tuninator's own 0.35 confidence gate, and the synthetic-pluck envelope is set against `tracking.releaseGraceMs: 90` and `tracking.minStableMs: 55`. They were thoroughly documented in prose, but indistinguishable at a glance from the numbers around them that we are free to retune. If the library changes a threshold, these degrade silently and nothing points at why.
* **Decision:** A value that mirrors an upstream Tuninator internal carries a `MIRRORS Tuninator <path> = <value>` line in its doc comment, and the file header explains the convention. `grep -rn "MIRRORS Tuninator"` lists everything to re-check when the library moves. The constants stay in `tuning.ts`; only their labelling changes.
* **Alternatives Considered:** (a) Moving them to a `src/input/tuninator-constants.ts` beside the adapter. Rejected: it would split the "every provisional number in one file" contract into two conventions, and the autoplay envelope values are read by `src/dev/`, not by the adapter. (b) Leaving the prose as-is. Rejected: the information was present but not greppable, which is the difference between documentation and a checklist. (c) Asserting the values against the library at runtime. Rejected: they are not exported as a public API, and reaching into `tuninator/src/**` to read them is exactly what `AGENTS.md` §4 forbids.
* **Consequences:** Positive — a Tuninator version bump now has a mechanical audit step, and the distinction between "we chose this" and "the library chose this" is visible at the call site. Negative — the marker is a convention with nothing enforcing it, so a future mirrored constant added without one is invisible again; and it records the upstream value at a moment in time, which is itself a thing that can go stale without anyone noticing.

---

#### DECISION-021: Tablature View is removed; Key View is the only timeline presentation
* **Date:** 2026-09-02
* **Status:** Accepted (supersedes `GOATerizer_Game_Design.md` §14)
* **Owner:** Trevor (agent-assisted)
* **Context:** GDD §14 specified a second timeline presentation — six string rows, fret numbers on the note bars, a tab bass rendering, and an explicitly unresolved wrong-note presentation for pitches the chosen fingering cannot express. It was implemented and switchable in pregame. In play it earned its keep less than Key View: the vertical axis the game is actually teaching is harmonic role, and the neck position it offered instead is already answered by the pregame fingering diagram. Separately, the minigame API now being designed gives each minigame a visual skin over the target notes, and a skin built for eight diatonic lanes is nonsense on six string rows — so keeping both views would have meant either per-view skins or a fallback path for every minigame.
* **Decision:** Tablature View is removed at explicit user request (`AGENTS.md` §18, §20.1). `TimelineViewMode` and the mode branching go from `ui/timeline/timeline-view.ts` (`#drawTabFret`, `#drawPlayedTab`, `#tabPositionFor`, `#tabFontPx`, and the branches in `#rowCount`, `#gutterWidth`, `#rowAccent`, `#drawGutter`, `#drawTarget`, `#drawPlayed`); `#rowForLane` collapses to identity and is deleted. The pregame view picker goes from `index.html` and `game-app.ts`. GDD §14 becomes "Fingering Selection", keeping its §14.3 content.
* **Alternatives Considered:** (a) Keeping Tab View and giving skins a per-view fallback. Rejected: it doubles the art surface for every one of six minigame families to preserve a view the player was not choosing. (b) Keeping it unskinned while Key View is skinnable. Rejected: two views that diverge in polish is worse than one, and it leaves the mode branching in the exact file the skin seam is about to be cut into. (c) Deleting `music/fingering.ts` along with it. Rejected and specifically guarded against — fingering still drives the pregame neck diagrams (DECISION-014) and the Key View gutter labels; only its *timeline-placement* role goes.
* **Consequences:** Positive — `timeline-view.ts` drops ~27% (22.7 kB → 16.5 kB) before the timeline-skin seam is cut into it, one row model means a skin needs no per-view variant, and the vertical axis now means exactly one thing everywhere. No test changed: nothing under `tests/` rendered a timeline, so the 234 existing tests passed untouched — which is also the evidence that Tab View had no direct test coverage to lose. Negative — a real design feature is gone, and players who read tablature more fluently than scale degrees lose the presentation that suited them; GDD §14.2's bend-notation thinking is withdrawn with it and would need redoing if a fretboard view ever returns.

---

#### DECISION-020: `?key=` and `?tempo=` are setup links, not developer flags
* **Date:** 2026-08-28
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** The run key is rolled from a weighted table (`config/key-weighting.ts`) and the tempo starts on Billy Goat, so practising one particular key — Eb major, weight 3 out of ~132 — means rerolling until it comes up. Every existing URL parameter in the game is gated behind `?dev=1`, which raised whether pre-setting the key and tempo belongs behind that gate too.
* **Decision:** `?key=` and `?tempo=` are ungated. Both name a choice the pregame already offers by hand (Reroll, the tempo chips), so a pre-set link is a shortcut into normal play rather than a way around it. They set the *starting point* only: Reroll still rolls a fresh weighted-random key, the chips still switch tempo, and nothing pins the setup for the rest of the run. Parsing lives with the thing being parsed — `parseKeyName` in `music/keys.ts`, `parseTempo` in `config/tempos.ts` — and `game-app.ts` only reads the params and applies them. Key names are read as a guitarist writes them (`Eb`, `ebm`, `Eb minor`, `F#`), major when no mode is given; enharmonics are accepted and then spelled by the existing `usesFlats` convention (DECISION-018), so `?key=D#` shows `Eb`. A bpm that is not one of the five tempo choices snaps to the nearest choice. Unreadable values warn to the console and are ignored.
* **Alternatives Considered:** (a) Gating both behind `?dev=1`. Rejected: dev flags exist for things unreachable from normal play (injected input, forced difficulty, autoplay); a key and a tempo the player can already pick are not that. (b) Honouring an arbitrary `?tempo=100` literally. Rejected: the five tempos are design (GDD §3.4) and high scores are tracked per tempo, so a sixth bpm would invent a tempo the scoreboard has no column for — snapping keeps the request meaningful without doing that. (c) Treating the params as a pin that Reroll respects. Rejected: Reroll is an explicit player action with one meaning, and a Reroll button that re-rolls the same key would be broken; the link is the starting point, the pregame is still in charge. (d) Rejecting a spelling like `D#` in a flat key. Rejected: the pitch class is unambiguous, and refusing to start over a spelling preference would be hostile to a hand-written link.
* **Consequences:** Positive — "the Eb one again" is a shareable link, the awkward keys become practisable without grinding the reroll button, and the two parsers are unit-tested (round-tripping every key in the weight table through `keyShortName`/`keyDisplayName`) rather than living as inline string handling in the app shell. Negative — a key reached by link bypasses the weighting the distribution was tuned around, so a player who links their way to one key sees none of the variety the table exists to produce; and the enharmonic acceptance means the URL and the on-screen readout can legitimately disagree (`?key=D#` → `Eb`), which is correct notation but reads as the game ignoring the link.

---

#### DECISION-019: One seeded performance planner, two sinks; a tier picks its own input source
* **Date:** 2026-08-28
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** Autoplay was a loop inside `game-app.ts` with two hardcoded timing offsets and a "drop every fifth note" rule. It could not express "half correct", never played a wrong note, did nothing at all when a live microphone was the source, scheduled only one beat ahead, and — on the injected path — emitted no `release`, so every played bar grew from its attack to the playhead until it pruned. A demo mode needs a repeatable *imperfect* performance, and "imperfect" means fumbles that are provably fumbles under a judge that matches whole pitch classes across every open target.
* **Decision:** A pure `src/dev/auto-performance.ts` turns `(targets, mode, seed, attemptIndex)` into attempt-relative gestures and never reads a clock; `game-app.ts` keeps only the two sinks and the schedule lifecycle. Tiers are `perfect` / `50` / `25` / `off`. Wrong pitches are chosen against the union of every target's *clamped* Good window, by pitch class, so octave equivalence cannot turn a fumble into a hit, and never repeat inside the wrong-note debounce, which would otherwise swallow the event and draw the bar as an ordinary played note. Picking a tier switches the source to `synth` **only when the current source cannot be a sink** — a live microphone cannot, the deterministic test provider can. Both sinks emit a real note-off.
* **Alternatives Considered:** (a) Auto-switching away from `input=test` as well. Rejected: `scripts/browser-validate.mjs` drives its whole first run on the test provider and asserts exact outcomes ("three stars for a flawless attempt"); moving it onto real detection would trade a deterministic suite for a flaky one, and the test provider is a perfectly good sink. (b) Capping an unreleased played note's drawn length in `TimelineModel`. Rejected: a genuinely sustained note *should* grow, and a cap would hide the producer bug rather than fix it — so the producers were fixed and an `unreleased played` counter was added to the dev panel instead, which also surfaces real Tuninator dropping a `noteEnded`. (c) Seeding from `Date.now()`. Rejected: the point is a link that replays.
* **Consequences:** Positive — the fake guitarist is unit-testable against the real `TargetJudge` with no microphone, intent and outcome agree exactly on the deterministic sink (asserted), `?dev=1&autoplay=50&seed=7` is a shareable demo, and every attempt is now scheduled a whole attempt ahead instead of one beat. Negative — up to ~64 oscillators can be scheduled at once on the synthetic path, so cancellation is mandatory rather than optional (`SyntheticGuitarSource.cancelFrom`); the synthetic path's *achieved* rate runs under the intended one, because real detection drops the odd onset, so the panel shows both; and `?seed=N` seeds the performance only — the run's key and scenario picks still come from `Math.random`, so two loads of the same link play the same fumbles against a different scenario in a different key.

---

#### DECISION-018: The key is spelled conventionally, not forced to sharps
* **Date:** 2026-08-21
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** The run key needed a short form to be readable at a glance mid-run — `Bbm`, not `Bb minor` — and that raised whether the header should always spell with sharps rather than following each key's conventional accidental.
* **Decision:** Keep the existing `usesFlats` convention. `keyShortName` gives `Bb`, `Bbm`, `F#`, `F#m`: major unmarked, minor lowercase `m`, spelled the way a chord chart would. The long name (`Bb minor`) moves to the element's tooltip.
* **Alternatives Considered:** Always sharps. Rejected: the pitch lanes are already labelled by the same convention, so a header reading `A#` above lanes labelled `Bb` would be the UI disagreeing with itself about what note the player is looking at — and the game is explicitly teaching note names alongside degrees (GDD §13.2). A test pins the header's spelling to lane 0's, so the two cannot drift apart.
* **Consequences:** Positive — one spelling authority for the whole UI, and the short name is what a guitarist already reads on a chart. Negative — enharmonic keys still look unrelated at a glance (`A#m` never appears; it is `Bbm`), which is correct notation but occasionally surprising.

---

#### DECISION-017: Note bars fill their row, in both timeline views
* **Date:** 2026-08-21
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** Targets were drawn at roughly half a row's height, so a step from one scale degree to the next left a visible gutter between the two bars and the shape of a phrase did not read as a contour. Tablature had a different problem and the same cause: it drew a fret number and a thin duration line, so a row's note had no body at all.
* **Decision:** One bar geometry for both views — `rowHeight - 2`, from halfway to the row above to halfway to the row below, with a 2px corner radius. Adjacent notes' corners meet within a hairline. Tablature draws its fret number *on* that bar (dark ink while it fits, alongside in the note's colour when the bar is too short), and the played-note overlay is an inset bar in both views rather than a second number.
* **Alternatives Considered:** Bars that touch exactly, with no gap. Rejected: two consecutive notes on adjacent rows would merge into one block, losing the note boundary that the rhythm is read from.
* **Consequences:** Positive — the phrase's contour is the silhouette, before any label is read, and the two views now differ only in what the vertical axis means. Negative — a sustained wrong note is now a large block rather than a thin line, so mistakes are considerably louder visually; that is arguably correct but it is a real change in emphasis.

---

#### DECISION-016: The drums mark the pulse, and signal the grid one attempt ahead
* **Date:** 2026-08-21
* **Status:** Accepted (extends the provisional percussion of `src/audio/drum-pattern.ts`)
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** The backbeat was a fixed one-measure pattern with eighth-note hats always on. Two problems: the constant eighths blurred the quarter-note pulse the player actually needs to find beat 1, and nothing anywhere told the player that the *next* four measures were sixteenths. By the time the first sixteenth arrives it is far too late to start counting it.
* **Decision:** Split the kit's two jobs. The pulse is quarter notes only — kick on 1 and 3, snare on 2 and 4, **and a hat on every beat with them** — unchanging. Over it, one layer per subdivision present in the current **or next** attempt: hats on the ands for eighths, a bright tick on the `e` and `a` for sixteenths, a pitched woodblock click for triplets. `game/subdivisions.ts` reads the grid off note *positions* rather than duration names, so it stays true for any phrase and works for triplets, which have no `NoteDuration` of their own.
* **The on-beat hat is load-bearing, not decoration.** The first cut of this dropped every hat, on the reasoning that a hat is an eighth-note sound. Playtesting reported "don't hear drums" — and measuring the real output showed why: the beat was firing correctly (one transient per beat, exactly on time), but the peak above 800 Hz, roughly where a laptop or phone speaker begins reproducing, was 0.14 against 0.41 full-band. Two thirds of the kit's energy was sub-bass the player never hears. Restoring an accented hat on each beat and lifting the bus took the audible-band peak to 0.49 with the full-band peak still under 0.75. The suite now taps the master output and asserts all three — no clipping, an audible-band floor, and one transient per beat — because "loud by the numbers, inaudible in the room" is not a failure any unit test can see.
* **Alternatives Considered:** (a) Signalling only the upcoming attempt. Rejected: the marking would stop at the moment it is most needed. Taking the union of current and next means a grid announced early keeps being marked through the phrase that needs it. (b) One voice at different velocities for all three grids. Rejected: sixteenths and triplets can be signalled in the same bar, and telling them apart is the entire point — they are separated by timbre, not volume.
* **Consequences:** Positive — the pulse is unambiguous again, and a hard rhythm announces itself a full attempt before it arrives. The triplet channel is implemented and unit-tested but dormant: no shipped scenario authors a triplet, pinned by a test so the first one that does shows up as a deliberate change. Negative — `setPattern` re-schedules the queued tail on every grid change, so the kit restates itself at some attempt transitions; guarded on a set key so it only happens when the grid actually changes.

---

#### DECISION-015: The pregame and game screens are one geometry, not two layouts
* **Date:** 2026-08-21
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** Pregame was a two-column layout (a control sidebar next to the timeline) and the run was three stacked bands. The timeline the player warmed up on was therefore a different rectangle from the one they played on, and it changed size and aspect at the exact moment notes started counting.
* **Decision:** Both screens are the same three bands — a fixed-height top bar, a stage, and the timeline — expressed by one shared `.play-screen` grid rule with `grid-template-rows: var(--topbar-height) minmax(0, 58fr) minmax(0, 42fr)`. Everything the player sets up (key, tempo, view mode, fingering, input) lives in the stage, the band the scenario art occupies once the run begins.
* **Alternatives Considered:** (a) Keeping the two layouts and merely matching the timeline's flex share. Rejected: the shares already matched and the panes still differed, because a flex line's leftover space resolves against whatever else is in it. (b) A flexbox version of the shared three-band layout. Rejected on measurement: it came out 0.5–0.7px apart across viewports, since flex distributes the remainder against each item's own base size; `fr` tracks do the same arithmetic whatever the bands contain. Verified pixel-identical at 1024x640, 1280x800 and 1600x1000, and pinned by a check in `scripts/browser-validate.mjs`.
* **Consequences:** Positive — the timeline never moves under the player, and the setup controls get the full width the fingering diagrams need. Negative — the top bar's fixed height is a magic number (`--topbar-height`); content taller than it will clip rather than push, which is why it is a token and why both bars keep their contents small.

---

#### DECISION-014: Suggested fingerings are one-octave shapes inside a five-fret window, picked from neck diagrams
* **Date:** 2026-08-21
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** The three-notes-per-string shapes that a two-octave scale needs span up to eight frets — D major wanted the fifth through the ninth fret — so the fretting hand had to travel mid-exercise. The pregame picker also offered them as text chips, which do not answer the question the player is actually asking.
* **Decision:** `fingeringsForKey` builds one-octave shapes over three adjacent strings in two note-splits (`3 3 2`, "reaching up", and `2 3 3`, the compact box), rooted on the low E, A, D or G string, and offers only those that fit on the neck **and inside a five-fret window**. Each offer renders as a five-fret SVG neck diagram (`src/ui/fingering-diagram.ts`), sorted low position first so the row reads as a map of the neck.
* **Alternatives Considered:** Keeping a single canonical shape per key. Rejected: the pregame choice exists so the player can pick where to practise, and one shape is not a choice. Which of the two splits is tighter depends on the mode (major favours the box, minor favours reaching up), so both are generated and the five-fret filter decides.
* **Consequences:** Positive — every one of the 24 keys now offers at least two shapes in genuinely different neck regions (most offer four or five), and none makes the hand move. Negative — up to six diagram cards in the picker; they are small, but a key with many offers is a busier row than a key with two.

---

#### DECISION-013: The `_high` scenarios become sequenced exercises, not transposed ones
* **Date:** 2026-08-21
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** Rocky Ascent High and Rocky Descent High existed for exactly one reason: they were their normal counterparts shifted up an octave, which is what justified their L3–6 difficulty band. Collapsing the timeline to one octave (DECISION-012) removes the second octave and with it their entire reason to exist — folded down, each level would have become a note-for-note copy of a normal-version level sitting two difficulty levels *lower*, which would make the ladder a lie.
* **Decision:** Keep both scenarios, their art, and their L3–6 band, and give them a different musical axis: they sequence the octave in threes (`1 2 3 | 2 3 4 | 3 4 5 | 4 5 6 | 5 6 7 b1`, and its descending mirror) where the normal versions run it straight. Rhythms, note counts, waypoint routes and star thresholds are unchanged, so only the authored tokens moved.
* **Alternatives Considered:** (a) Deleting the `_high` scenarios. Rejected: nothing else authors L5 or L6, so every run would hit the content limit at slot 12. (b) Folding their tokens down an octave and leaving them otherwise identical. Rejected: it produces duplicate content at mismatched difficulties, as above. (c) Asking the user first. Judged not worth blocking the other four parts of the request on, since sequencing is the standard next step after straight runs in any scale-practice regimen and the phrase tables are a two-line change in `scripts/author-rocky-scenarios.mjs` if the call is wrong.
* **Consequences:** Positive — four scenarios stay musically distinct, L1–6 stays covered, and the difficulty ladder means something again; pinned by a registry test that fails if a `_high` level ever becomes a copy of its normal counterpart. Negative — "High" now names the route's position on the mountain rather than the register, which is a small lie in the scenario's *name* that the premise and production notes have to carry.

---

#### DECISION-012: Collapse the timeline to one octave, root to root
* **Date:** 2026-08-21
* **Status:** Accepted (supersedes the two-octave pitch space in `GOATerizer_Game_Design.md` §13.1)
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** The design specified fifteen lanes over two octaves. In play that is too much to hold in your head and answer on a guitar in real time: fifteen lanes are thin enough that the labels had to be set at 11px, and the exercise spans more neck than one hand position covers.
* **Decision:** The pitch space is eight lanes, one octave root to root. The authored token vocabulary is `1..7` plus `b1` (the octave root); `b2..b7` and `c1` are now `DegreeTokenError`s rather than silently folded notes, so a scenario file written against the old vocabulary fails its validation test instead of transposing an exercise at runtime. Every Rocky-family scenario was re-authored inside the octave, preserving each level's rhythm, note count, route and star thresholds.
* **Alternatives Considered:** Keeping fifteen lanes and only enlarging the labels. Rejected: the user's objection is about what a player can respond to in real time, not about type size, and the tablature stretch (DECISION-014) has the same root cause.
* **Consequences:** Positive — rows are nearly twice as tall, so labels scale with them and nothing has to be hidden for being small; one octave is one hand position. `LOWEST_TONIC_MIDI` moves from E2 (40) to A2 (45), documented as provisional tuning: a one-octave span anchored at the open low E pins every key to first position, where only low-E-rooted shapes are reachable, and A2 puts every key where shapes on three strings fit. Negative — the game's register shifts up for every key, so existing high scores were set against a slightly different exercise; and the two-octave scale, which is a real thing guitarists practise, is no longer expressible until a future design adds a second-octave mode.

---

#### DECISION-011: Mock the browser's microphone API, not Tuninator's, for synthetic guitar input
* **Date:** 2026-08-20
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** The environment this game is developed and calibrated in cannot grant microphone access, so `TuninatorGuitarInputProvider` — the real detection path calibration depends on — never receives a sample there. The existing `?input=test` deterministic provider bypasses Tuninator entirely and cannot exercise onset detection, confidence gating, or the latency chain.
* **Decision:** Add `?dev=1&input=synth`, which monkey-patches `navigator.mediaDevices.getUserMedia` (a standard browser API) to return a `MediaStream` backed by a synthesized sine oscillator with a guitar-ish attack envelope. `TuninatorGuitarInputProvider` and Tuninator itself are untouched and unaware of the substitution.
* **Alternatives Considered:** Extending `RecognizerOptions` with a caller-supplied `MediaStream`/`stream` field. Rejected: Tuninator's actual `RecognizerOptions.input` type has no such field, and `AGENTS.md` §4 explicitly forbids inventing a Tuninator API GOATerizer does not verify exists.
* **Consequences:** Positive — exercises the real recognizer end-to-end (verified: 261.6 Hz detected, confidence 1.00, 12/0/0 Perfect judged) without touching or assuming anything about Tuninator's surface. Negative — global monkey-patching is inherently fragile if Tuninator ever calls `getUserMedia` through a captured/bound reference instead of a live property lookup; mitigated by dev-only gating and an `uninstall()` path that restores the real API on any switch away from `synth`.

---

#### DECISION-010: Robust statistics (median/MAD), not a running mean, for the latency-calibration instrument
* **Date:** 2026-08-20
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** `EXTRA_INPUT_LATENCY_MS` calibration requires aggregating per-note timing deltas from a human playing live, but a player calibrating will fumble a note or two.
* **Decision:** `TimingDeltaLog` reports the median and median-absolute-deviation of a rolling 64-sample window, not a mean. Samples are cleared whenever the latency trim changes, and autoplay-sourced samples (discrete or synthetic) are excluded entirely, since both would trivially confirm whatever trim is already set.
* **Alternatives Considered:** A simple running mean. Rejected: one badly-mistimed note drags a mean far enough to make the suggested trim actively wrong, with no signal that this happened.
* **Consequences:** Positive — a single outlier does not corrupt the suggested correction, and `spread` (MAD) gives an honest signal for "not enough samples yet" versus "found a real bias." Negative — median is a coarser statistic than a confidence-weighted estimate would be; acceptable given the sample sizes calibration sessions actually produce.

---

#### DECISION-009: Preload every registered scenario's assets, not one hardcoded scenario
* **Date:** 2026-08-20
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** `game-app.ts` preloaded only `ROCKY_ASCENT.assetUrls` at boot. Once more than one scenario could be drawn into a run slot (`scenariosForDifficulty`), any slot landing on a different scenario would render nothing — its art was never fetched.
* **Decision:** Preload the merged `assetUrls` of every scenario in the `SCENARIOS` registry array, generically, rather than naming one scenario.
* **Alternatives Considered:** Lazy-loading a scenario's assets when a slot resolves to it. Rejected as unnecessary complexity: asset ids are already namespaced per scenario, so there is no collision cost to loading all of them up front, and total art volume is small.
* **Consequences:** Positive — closes a real, previously invisible bug (only exposed once multiple scenarios existed); no per-scenario special-casing (`AGENTS.md` §3). Negative — boot-time asset load grows linearly with registered scenarios; acceptable at the current scale (4 scenarios, 40 small placeholder images).

---

#### DECISION-008: Extract Rocky-family placeholder art into one shared generator module
* **Date:** 2026-08-20
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** Three new companion scenarios (Rocky Ascent High, Rocky Descent, Rocky Descent High) needed placeholder art. Each scenario file's own production notes state that placeholder source families may be reused from the normal version.
* **Decision:** Extract the existing Rocky Ascent drawing functions (goat pose, foothold, cairn, dust, tick, mountain backdrop) into `scripts/lib/rocky-art.mjs`, parameterized by palette and RNG seed, and generate all four scenarios' art from one script.
* **Alternatives Considered:** Hand-authoring or duplicating separate drawing code per scenario. Rejected: the scenario files explicitly authorize reuse, and duplicating ~350 lines four times violates `AGENTS.md` §11 ("do not create many near-identical assets when runtime transforms or duplication can produce the result").
* **Consequences:** Positive — one editable source of truth for the whole family; verified byte-for-byte identical output for the previously-shipped Rocky Ascent files before trusting the refactor. Negative — the four scenarios' art is visually near-identical (by design, per the scenario files); real visual distinction is deferred to a future asset swap, same as Rocky Ascent's own placeholder status.

---

#### DECISION-007: Generalize `browser-validate.mjs` assertions to scenario-pool patterns, not one hardcoded scenario
* **Date:** 2026-08-20
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** With four Rocky-family scenarios now sharing difficulty levels, `scenariosForDifficulty` picks among them at random by design — variety across a run is the intended outcome of adding companion scenarios. The validation suite hardcoded "Rocky Ascent L1"/"L2" and exact foothold counts (15/30) derived from Rocky Ascent specifically.
* **Decision:** Replace exact-name and exact-count assertions with family/level regex patterns (`/^Rocky (Ascent|Descent)( High)? L\d+$/`) and sane ranges derived from the actual authored data across all eligible scenarios at that difficulty.
* **Alternatives Considered:** Seeding `RunState`'s random source for deterministic test runs. Rejected: would test a fixed pick, not the pooling behavior itself, and normal play is never seeded — the test would diverge from what ships.
* **Consequences:** Positive — the suite now actually asserts the pooling invariant (any Rocky-family scenario at the right level) rather than one scenario's incidental numbers; confirmed stable across repeated runs with different random picks. Negative — slightly looser bounds on foothold counts (a range instead of one number) trade some precision for correctness against real randomness.

---

#### DECISION-006: Backfill a missing required scenario field from sibling data, not invented prose
* **Date:** 2026-08-20
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** `rocky_ascent_high.scenario.json` and `rocky_descent_high.scenario.json` failed real validation: `visual.route.character` is required by the loader but was omitted, present only one level up as `visual.routeCharacter`. `AGENTS.md` and `load.ts`'s own docstring forbid the loader — or an agent editing scenario data — from inventing scenario content.
* **Decision:** Copy the existing `visual.routeCharacter` string for that level into the missing `visual.route.character` field, for all 8 affected levels across the two files, rather than authoring new descriptive text.
* **Alternatives Considered:** Blocking on the user to supply the correct text. Rejected as disproportionate: the field is unused outside being carried as data (verified via grep — no runtime code reads `route.character`), and the exact author-provided text for that purpose already existed one level up.
* **Consequences:** Positive — unblocks registration without fabricating scenario content; the substitution is exactly traceable (git diff shows precisely what was copied from where). Negative — `route.character` and `routeCharacter` are not always identical in the original Rocky Ascent file (verified: related but independently-phrased), so the backfilled value is a reasonable stand-in, not necessarily what the original author would have written by hand.

---

#### DECISION-005: Fix bass audibility by changing timbre, not register; add synthesized percussion
* **Date:** 2026-08-20
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** The backing bass was inaudible in practice (measured: signal present at peak 0.21, but all energy concentrated at 47-53 Hz, a band most small speakers do not reproduce). The bass is deliberately voiced at 40-75 Hz to sit under the guitar target register — a stated design constraint, not a bug.
* **Decision:** Change the bass oscillator from triangle to sawtooth and raise the lowpass cutoff from 420 Hz to 1200 Hz, preserving harmonics a small speaker can reproduce while leaving the fundamental register untouched. Separately, add a synthesized drum backbeat (kick/snare/hi-hat) as new, explicitly provisional tuning data (`AGENTS.md` §17), since the design specifies no percussion at all and the bass alone did not read as a rhythmic pulse in the audible band.
* **Alternatives Considered:** Voicing the bass higher, into an audible register directly. Rejected: the low register is a stated design decision (documented twice in `bass-line.ts`), and moving it would be the easy fix and the wrong one.
* **Consequences:** Positive — measured through a simulated small-speaker filter: transient rate matches the expected eighth-note pulse (3.86/sec against 4/sec predicted at 120 BPM), where before nothing survived the filter. Negative — percussion is new, unspecified-by-design content; explicitly labeled provisional so it reads as tuning data rather than canonical design if the actual GDD is later extended to cover it.

---

#### DECISION-004: Depart from GDD §12.1's 2-beat timeline span at explicit user request
* **Date:** 2026-08-19
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** GDD §12.1 specifies a target note travels from the right edge to the strike line in 2 beats. At that span, a sixteenth-note run arrives too fast to read as pitch before it is nearly on the strike line — too late to be deciding which fret to be on.
* **Decision:** Change `TIMELINE_FUTURE_BEATS`/`TIMELINE_HISTORY_BEATS` from 2 to 4, halving the scroll speed, and update GDD §12.1 itself to record the change and the reason rather than leave the design doc silently contradicting the code.
* **Alternatives Considered:** None weighed independently — this was a direct, explicit user instruction (`AGENTS.md` §20 places current explicit user request above canonical design documents).
* **Consequences:** Positive — verified in the running app that note width and scroll speed match the new constant exactly; the design doc and code no longer disagree. Negative — trades on-screen note density for reading time; the played-note history-retention window (previously an independent literal) now derives from the span so it cannot silently fall out of sync with a future span change.

---

#### DECISION-003: Windows process spawning — shell for npm, bypass npx entirely for vite
* **Date:** 2026-08-19
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** `scripts/setup-tuninator.mjs` and `scripts/browser-validate.mjs` failed on Windows. Naming `npm`/`npx` directly fails with `ENOENT` (`CreateProcess` ignores `PATHEXT`); naming `npm.cmd`/`npx.cmd` then fails with `EINVAL` (Node ≥20.12 refuses to spawn `.cmd`/`.bat` without `shell: true`, per the CVE-2024-27980 hardening).
* **Decision:** For `setup-tuninator.mjs`, which must invoke whatever npm is on `PATH`, enable `shell: true` on win32 only, passing the full command as a single string (every argument is a bare word; the only path involved travels via `cwd`). For `browser-validate.mjs`, which only needs the project's own already-installed Vite, bypass `npx`/shell entirely and invoke `node_modules/vite/bin/vite.js` directly via `process.execPath`.
* **Alternatives Considered:** Using `shell: true` for both scripts uniformly. Rejected for `browser-validate.mjs`: unnecessary risk (submitting a path to `cmd.exe`'s quoting rules) when the target script is already known and on disk.
* **Consequences:** Positive — both scripts now run on Windows; verified `npm run validate:browser` reaches 35/35 driving installed Chrome. Negative — `shell: true` is a real attack surface if arguments ever stop being bare words; scoped narrowly (`WIN32 && command === NPM` only) to keep that risk contained and visible at the call site.

---

#### DECISION-002: Detect a wrong Tuninator checkout by its exported symbol, not its git ref
* **Date:** 2026-08-19
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** `setup-tuninator.mjs` left an existing `../Tuninator` checkout alone even when it was on the wrong ref (e.g. `main`, which is still the 0.1 `createTuninator` API). The mismatch previously surfaced only much later, as an opaque Vite import-resolution failure with no mention of refs or this script.
* **Decision:** Check that `../Tuninator/src/index.ts` actually exports `createRecognizer` (a `grep`-style string check on the file), and exit 1 naming the revision found and how to move it, rather than trusting the checkout's git ref/branch name.
* **Alternatives Considered:** Comparing the checkout's current ref/branch name against `TUNINATOR_REF`. Rejected: a checkout can legitimately be on a detached `HEAD` or a differently-named local branch pointing at the right commit; the thing that actually matters is whether the code GOATerizer imports exists, not what the ref is called.
* **Consequences:** Positive — the failure now surfaces at the moment the ref is still the subject, with an actionable fix (`--update`) named directly. Negative — a symbol-string check is coarser than a real API-shape check; acceptable given this exists to catch an entire-API-generation mismatch (0.1 vs 0.2), not subtle signature drift within 0.2.

---

#### DECISION-001: Repo-local (not global) git identity correction
* **Date:** 2026-08-19
* **Status:** Accepted
* **Owner:** Trevor (agent-assisted, Claude Opus 5)
* **Context:** Pushes to `origin` were silently failing. Root cause: the active `gh` CLI account was `mighty-trevor`, while the remote URL and intended authorship were `trellos` — two distinct, both-authenticated GitHub accounts on the same machine.
* **Decision:** Switch the active `gh` account to `trellos`, run `gh auth setup-git` so HTTPS operations use that token, and set `user.name`/`user.email` for this repository only (`git config` without `--global`).
* **Alternatives Considered:** Setting the identity globally. Rejected: the machine has at least one other account (`mighty-trevor`) in active use; a global change would silently reattribute commits in unrelated repositories that may intentionally use the other identity.
* **Consequences:** Positive — pushes now succeed as the correct, intended account; verified the commit identity, `gh` active account, and remote URL all agree. Negative — the fix is local to this checkout; a fresh clone of this repo on another machine (or a different working copy) needs the same correction applied independently.
