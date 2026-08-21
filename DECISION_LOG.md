# Decision Log

Maintained per `AGENTS.md`'s Decision Logging Protocol. Newest entries first.

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
