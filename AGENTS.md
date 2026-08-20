# AGENTS.md

# GOATerizer Repository Instructions

GOATerizer is a browser-based guitar video game controlled by real guitar input.

The repository is design-driven. Before changing gameplay, scenario behavior, music representation, scoring, timing, or UI flow, read the relevant design documents and preserve their terminology and ownership boundaries.

Do not simplify or reinterpret product behavior merely because another implementation would be easier.

---

## 1. Source of Truth

Read these documents before implementing related systems.

### Overall Game Design

`docs/game-design/GAME_DESIGN.md`

Authoritative for:

- game flow
- run structure
- pregame
- scoring concepts
- stars
- timeline behavior
- key and tempo behavior
- results / game over
- overall terminology

### Minigame Family Structure

`docs/game-design/MINIGAME_STRUCTURE.md`

Authoritative for:

- the six permanent minigame families
- musical identity of each family
- level ranges
- visual verbs

The six families are:

- Scale → `ClimbMinigame`
- Blues Lick → `PerformMinigame`
- Scale Run → `TraverseMinigame`
- Triplets → `ThreeStepMinigame`
- Straight Sixteenths → `RepeatMinigame`
- Sixteenth Phrases → `BattleMinigame`

### Visual Asset System

`docs/game-design/VISUAL_ASSET_SYSTEM.md`

Authoritative for:

- static billboard sprite constraints
- transform / show / hide behavior
- pose reuse
- effect reuse
- visual production limits

Core production rule:

> Lots of authored gameplay events, very few authored art assets.

### Minigame Behavior Specification

`docs/game-design/MINIGAME_BEHAVIOR_SPEC.md`

Authoritative for:

- reusable minigame-class behavior
- class asset slots
- gameplay-to-asset behavior
- measure-span / visual-cycle behavior
- reset vs persistent scenario state

### Scenario Asset Slot Bindings

`docs/game-design/SCENARIO_ASSET_SLOT_BINDINGS.md`

Authoritative for:

- which scenario belongs to which minigame class
- which assets bind to which class slots

### Theme / Scenario Catalog

`docs/game-design/THEME_APPLICATIONS.md`

Reference for:

- scenario concepts
- theme applications
- supported difficulty ranges
- visual escalation ideas

### Individual Scenario Data

Scenario-specific authored content lives under:

`docs/scenarios/`

For example:

`docs/scenarios/rocky-ascent/rocky_ascent.scenario.json`

Scenario data is authoritative for:

- supported levels
- authored target notes
- note durations
- scale degrees
- star thresholds
- measure plans
- class parameters
- waypoint/path data
- asset bindings

If a scenario file disagrees with a generic example elsewhere, prefer the explicit current scenario data unless a newer design document clearly overrides it.

---

## 2. Terminology

Use these terms consistently.

### Minigame Class

A reusable gameplay / visual behavior family.

Do not call individual scenarios "classes."

### Scenario

An authored content instance belonging to exactly one minigame class.

A scenario supplies:

- supported difficulty levels
- authored musical prompts
- scenario parameters
- star thresholds
- asset bindings
- route / target / staging data
- measure behavior

### Scenario Level Data

Hand-authored data for one supported difficulty level.

Do not procedurally infer the musical exercise from the numeric difficulty level.

### Attempt

One play of one minigame.

A normal attempt is four measures.

### Run

A complete GOATerizer game.

A successful run contains 16 minigames. The player can fail earlier.

### Note Opportunity

A target note or guitar gesture expected at an authored musical time.

---

## 3. Architecture Principles

Keep these boundaries strong.

### Game-Level Systems Own

- musical transport
- run state
- key
- tempo
- scenario selection
- timeline state
- guitar-input normalization
- target judgment
- score
- stars
- high scores
- screen / flow transitions

### Tuninator Owns

- guitar audio analysis
- pitch detection
- note hypotheses
- continuous pitch information
- guitar gesture information that Tuninator exposes

### GOATerizer Owns

- interpretation of detected guitar input relative to the current target
- scale-degree resolution
- timing judgment
- Perfect / Good / Miss
- wrong-note behavior
- scoring
- stars
- scenario gameplay consequences

### Minigame Classes Own

Reusable gameplay-to-visual behavior.

Examples:

- `ClimbMinigame` advances one waypoint per successful note.
- `RepeatMinigame` applies one repeated action per successful note.
- `BattleMinigame` changes dominance / threat based on performance.

A minigame class must not contain scenario-specific asset names.

### Scenarios Own

Data.

Avoid code such as:

```text
if (scenarioId === "rocky_ascent") { ... }
```

when the behavior can be represented by scenario data or class parameters.

Adding another scenario in an existing class should primarily require:

- scenario data
- assets
- authored positions / waypoints
- class parameters

not new gameplay code.

---

## 4. Tuninator Integration

GOATerizer uses Tuninator for real guitar detection.

### Required Rules

- Inspect and use the actual Tuninator API.
- Do not invent a Tuninator interface based on assumptions.
- Do not replace Tuninator with a homemade FFT, autocorrelation, YIN, or other pitch detector.
- Do not silently fall back to fake note input in production.
- Keep Tuninator behind a narrow game-facing adapter.

A reasonable conceptual boundary is:

```text
GuitarInputProvider
    TuninatorGuitarInputProvider
    TestGuitarInputProvider
```

Names may differ based on repository conventions.

### Test Input

A deterministic fake / injected input provider is encouraged for:

- automated tests
- developer tools
- reproducible judgment testing

It must remain clearly separated from production guitar input.

### Future Gesture Support

Do not collapse guitar input into only discrete note-on events if doing so would discard useful continuous pitch information.

Future gameplay requires continuous gestures such as bends.

---

## 5. Musical Time

Musical timing must have one authoritative transport.

Do not drive gameplay timing with chained `setTimeout` calls or accumulated visual-frame deltas.

Transport should drive:

- beat
- measure
- bass playback
- target-note position
- strike-line timing
- judgment windows
- minigame completion
- scenario transitions

Authored scenario timing should use musical units such as:

- measures
- beats
- subdivisions
- duration

Convert to seconds / milliseconds from BPM at runtime.

The beat should remain continuous between minigames unless a newer design explicitly says otherwise.

---

## 6. Musical Data

Scenario exercises are hand-authored.

Do not procedurally create or "improve" target phrases unless explicitly requested.

The run chooses one musical key.

Scenario targets are authored in transposable musical relationships such as scale degrees and are resolved into actual pitches at runtime.

Do not conflate:

- scale-degree accidental notation such as `b3`
- scenario-specific octave-band token conventions

Normalize ambiguous authored tokens into an explicit internal representation.

---

## 7. Judgment

Keep guitar detection separate from gameplay judgment.

Gameplay judgment should be testable without a microphone.

Conceptually support events such as:

- `PerfectNote`
- `GoodNote`
- `WrongNote`
- `MissedNote`
- `TargetResolved`

A wrong note should not automatically consume the current target unless the design explicitly says so.

Do not emit repeated wrong-note gameplay events every analyzer frame for one sustained wrong pitch.

Timing windows should be data-driven and duration-aware.

---

## 8. Stars and Score

Stars and numeric score are related but separate systems.

Current semantics:

- 1 star = pass
- 2 stars = strong
- 3 stars = perfect

Stars lock once earned during an attempt.

Do not remove already-earned stars because of later mistakes unless the design is explicitly changed.

Score rewards quality of note execution.

Keep score constants and star thresholds in tuning / scenario data rather than scattering magic numbers throughout code.

---

## 9. Scenario Measure Behavior

A normal attempt is four measures.

A scenario may use those measures differently.

Examples:

- one visual arc across all four measures
- one visual round per measure
- two-measure visual cycles

Do not assume every scenario resets at measure boundaries.

Keep distinct:

### Attempt-Global State

Examples:

- total successful notes
- total score
- earned star tier
- persistent spectacle
- crowd escalation
- drunkenness

### Visual-Cycle-Local State

Examples:

- local target index
- beer row
- local battle dominance
- local waypoint index
- temporary effects

Reset only what the scenario's measure plan says to reset.

---

## 10. Visual System

GOATerizer visuals are deliberately constrained.

Prefer:

- static pixel-art billboards
- show / hide
- translate
- scale
- rotate
- short tweens
- pose swaps
- duplicated reusable sprites
- authored positions

Avoid requiring:

- skeletal animation
- procedural character animation
- 3D models
- frame-heavy traditional animation
- expensive shaders
- bespoke art for every note opportunity

One reusable asset may be instantiated many times.

---

## 11. Assets and Licensing

Placeholder art should be locally stored, not hotlinked at runtime.

For external placeholder assets:

- verify the source page
- verify the license
- prefer CC0 / public domain
- record source URL
- record author
- record license
- preserve provenance in an attribution / asset-source file

Do not introduce copyrighted commercial game assets as placeholders.

Do not create many near-identical assets when runtime transforms or duplication can produce the result.

---

## 12. UI Principles

Gameplay readability wins over decoration.

The timeline must clearly communicate:

- what to play
- when to play it
- note duration
- pitch / lane
- articulation where relevant
- what the player actually played
- judgment result
- recent history

Do not make a gameplay challenge harder because target information is visually ambiguous.

Keep one underlying timeline / judgment model even when multiple views exist, such as:

- Key View
- Tablature View

Do not build separate scoring engines for different timeline presentations.

---

## 13. Web / Audio Lifecycle

GOATerizer is initially a browser game.

Handle browser audio and microphone lifecycle deliberately.

Account for:

- user-gesture requirements
- microphone permission
- denied permission
- missing input
- audio-context suspension
- replay
- teardown
- duplicate subscriptions
- duplicate bass playback
- cleanup on navigation / unmount

Never silently claim live guitar input is active when it is not.

---

## 14. Developer Tools

Use existing project conventions for dev-only tooling.

Useful debug information includes:

- key
- BPM
- transport beat / measure
- Tuninator status
- raw detected pitch
- normalized note
- current target
- timing delta
- judgment window
- last judgment
- score
- star tier
- streak
- scenario progress
- latency compensation

Developer tools must not leak into production accidentally.

---

## 15. Testing Expectations

Before considering a gameplay task complete, run the repository's relevant:

- unit tests
- integration tests
- typecheck
- lint
- production build

Add tests for new deterministic gameplay behavior.

For timing / guitar systems, favor tests around domain inputs and outputs rather than fragile visual timing.

Important categories include:

- scenario-data validation
- transposition
- musical transport
- target timing
- judgment
- star thresholds
- minigame-class progress
- measure resets
- scenario completion
- run flow

For browser-facing features, also run the application and inspect it in the browser.

Do not claim physical guitar validation unless a real guitar was actually used.

---

## 16. Implementation Workflow

For substantial changes:

1. Read the relevant design docs.
2. Inspect existing implementation before proposing new architecture.
3. Run the current test/build baseline when practical.
4. Write a concise implementation plan.
5. Implement the smallest coherent vertical slice.
6. Add or update tests.
7. Run tests/typecheck/lint/build.
8. Run the app and validate the user-facing behavior.
9. Clean up dead code and temporary hacks.
10. Update documentation when behavior or architecture changes.

Do not stop at scaffolding when the task asks for working functionality.

---

## 17. Design Gaps

If the design does not specify a value:

- do not silently present your guess as canonical design;
- prefer making it explicit tuning/config data;
- label it provisional;
- document the choice.

Examples:

- timing windows
- score constants
- star thresholds
- key weighting
- bass-line generation rules

If a missing decision is not blocking implementation, choose a reversible default and keep moving.

If it is genuinely product-defining and cannot be safely inferred, ask the user.

---

## 18. Do Not Invent or Rewrite Product Requirements

Do not "clean up" deliberate weirdness.

Preserve:

- insulting humor
- unusual scenario concepts
- explicit difficulty sequences
- authored exercises
- intentionally simple asset mechanics
- design-specific terminology

Do not replace the game's tone with generic motivational copy.

Do not add:

- currencies
- unlock systems
- accounts
- adaptive difficulty
- multiplayer
- progression trees
- procedural exercise generation

unless explicitly requested.

---

## 19. File Placement

Keep repository-level agent governance at the repository root:

```text
AGENTS.md
CLAUDE.md
```

Canonical design documents belong under:

```text
docs/game-design/
```

Scenario-specific content belongs under:

```text
docs/scenarios/<scenario-id>/
```

Implementation prompts, if retained, belong under:

```text
docs/prompts/
```

Prompts are not authoritative design documents.

---

## 20. Priority Rule

When instructions conflict, use this order unless a newer explicit user instruction says otherwise:

1. current explicit user request
2. repository `AGENTS.md`
3. current canonical game-design documents
4. current scenario data
5. implementation conventions already established in the codebase
6. old prompts / examples / historical notes

When unsure whether two documents conflict, do not silently merge them. Identify the conflict and use the most recent authoritative source.

# Decision Logging Protocol (Mandatory)

You must track all architectural, technical, and critical project decisions. Every time a significant choice is agreed upon, updated, or abandoned, you must log it immediately.

### 1. Trigger Criteria
Log a decision if it involves:
* Choosing a tool, language, or framework over alternatives.
* Modifying project architecture, folder structures, or workflows.
* Approving a critical API design or data schema choice.
* Accepting a specific technical debt or security trade-off.

### 2. File Location & Naming
* Maintain a centralized file named `DECISION_LOG.md`.

### 3. Required Metadata Structure
Every logged decision must use this exact schema:

#### [DECISION-ID]: [Short, Descriptive Title]
* **Date:** YYYY-MM-DD
* **Status:** [Proposed | Accepted | Rejected | Superseded by ID]
* **Owner:** [Name/Role]
* **Context:** What problem are we solving? What constraints exist?
* **Decision:** What specific path are we taking?
* **Alternatives Considered:** What else did we look at, and why did we reject it?
* **Consequences:** What are the positive and negative trade-offs of this choice?

### 4. Agent Execution Flow
1. **Identify:** Detect when a user conversation or a task output results in a baseline choice.
2. **Draft:** Propose the log entry to the user before finalizing if the context is ambiguous.
3. **Write:** Append the new entry to the top of the decision file or create the next sequential ADR markdown file.
4. **Link:** If this decision supersedes a previous one, immediately update the status of the older decision to "Superseded by [New ID]".
