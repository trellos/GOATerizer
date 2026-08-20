# Decision Log

Maintained per `AGENTS.md`'s Decision Logging Protocol. Newest entries first.

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
