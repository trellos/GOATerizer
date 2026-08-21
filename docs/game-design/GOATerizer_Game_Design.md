# GOATerizer
## Game Design Document

**Guitar Video Game**

> **You really suck and this is your best shot.**

GOATerizer is a browser-based guitar game about the unreasonable hope that if you play the absolute shit out of a dumb indie game, somebody—possibly history itself—will finally recognize that you were meant to be a guitar hero.

The game is affectionate toward that fantasy and mocks it at the same time.

The player plugs in or mics a real guitar, chooses a tempo, gets a key and bass line, and attempts a run of 16 short guitar minigames. Each minigame is a hand-authored guitar exercise attached to a ridiculous visual scenario. Good playing makes the scenario go well. Bad playing makes it go badly, stall, or empower the opposition.

Survive all 16 and you have done something genuinely difficult.

---

# 1. Design Pillars

## 1.1 Real Guitar, Immediate Consequence

Every prompted note should have a clear relationship between:

1. what the player sees on the timeline,
2. what the player plays on the guitar,
3. how accurately Tuninator recognizes it,
4. the energy that leaves the timeline,
5. and what immediately happens in the scenario.

The visual joke is not decoration added after scoring. It is the player's performance made visible.

## 1.2 Six Learnable Minigame Verbs

GOATerizer uses six permanent minigame classes. The player should learn them almost like WarioWare verbs: art and exercises change, but the underlying visual/gameplay grammar stays recognizable.

| Minigame Class | Guitar Family | Player Fantasy | Visual Verb |
|---|---|---|---|
| `ClimbMinigame` | Scale | Control | **CLIMB** |
| `PerformMinigame` | Blues Lick | Expression | **PERFORM** |
| `TraverseMinigame` | Scale Run | Agility | **TRAVERSE** |
| `ThreeStepMinigame` | Triplets | Groove | **THREE-STEP** |
| `RepeatMinigame` | Straight Sixteenths | Chops | **REPEAT** |
| `BattleMinigame` | Sixteenth Phrases | Mastery under pressure | **BATTLE / SURVIVE** |

A **Scenario** is an authored content instance belonging to exactly one minigame class.

For example:

```text
MinigameClass
    PerformMinigame

Scenario
    Courtship Strut
        SupportedLevels
        AssetBindings
        LevelData[]
```

The class owns reusable behavior. The scenario supplies the joke, art, note prompts, thresholds, and parameters.

## 1.3 Lots of Authored Events, Very Few Art Assets

Scenario visuals use static pixel-art billboards, reusable poses, transforms, visibility changes, and short tweens.

The performance should feel animated because the guitar controls when authored visual events occur—not because every scenario needs frame-heavy animation.

## 1.4 Difficulty Comes From Playing, Not Obscurity

Prompts should be visually legible. Difficulty comes from:

- faster tempo,
- denser rhythms,
- harder navigation,
- articulation,
- bends,
- sustained clean execution,
- and increasingly demanding hand-authored exercises.

The game should not become difficult because the player cannot read the UI.

## 1.5 Mean, Funny, Earnest

The game is allowed to insult the player.

The joke is that guitar players can maintain a frankly unreasonable belief that enough chops might somehow make destiny notice them. GOATerizer both recognizes that fantasy and gives the player a real skill challenge worthy of it.

The tone should be abrasive, weird, celebratory, and affectionate—not corporate encouragement.

---

# 2. Core Terminology

## Minigame Class

One of the six reusable behavior families.

A class defines how performance events operate on generic scenario asset slots.

Detailed behavior belongs in the companion minigame-class specification.

## Scenario

An authored minigame content package.

A scenario contains:

```text
Scenario
    MinigameClass
    SupportedLevels
    AssetBindings
    LevelData[]
```

A scenario may support all seven levels or only a subset appropriate to its concept.

## Scenario Level Data

For every supported difficulty level, the designer hand-authors the actual prompt and level-specific scenario data.

Conceptually:

```text
ScenarioLevelData
    DifficultyLevel
    PromptNotes[]
    StarThresholds
    ScenarioParameters
    MeasurePlan
```

The exact target phrase is not procedurally generated.

Target prompts are authored in diatonic / scale-degree terms so the same level can be transposed into the run's chosen key.

## Attempt

One play of one minigame.

An attempt is normally four measures of four beats.

## Run

One game of GOATerizer.

A full successful run contains exactly 16 minigames. A player can fail and end the run before reaching all 16.

## Note Opportunity

A target note or guitar gesture the game expects at a particular musical time.

## Star Tier

Each minigame has three stars:

- ★ = pass
- ★★ = strong
- ★★★ = perfect

Once earned during an attempt, a star cannot be lost.

At least one star is required to continue.

---

# 3. Run Structure

A GOATerizer run contains 16 minigame slots.

The initial difficulty sequence is:

```text
1 2 3 4 2 3 4 5 3 4 5 6 4 5 6 7
```

This deliberately introduces a harder level and then backs off before climbing again.

The current sequence is fixed. Future game modes may use different difficulty curves.

## 3.1 Scenario Selection

At the beginning of a run, fill all 16 slots.

For each ordinal slot:

1. Read its required difficulty.
2. Find every available scenario that supports that difficulty.
3. Pick one randomly.
4. Avoid reusing a scenario if unused eligible scenarios remain.
5. If the content pool is too small, repeats are allowed.

There is currently **no class-balancing rule**. Pure random selection is intentional. A future version may reduce repeated classes or otherwise shape the sequence.

The full 16-slot sequence is determined at run start because the player can see part of the upcoming scenario before the current one ends.

## 3.2 Key

One musical key is chosen for the entire run.

The pool contains:

- all 12 chromatic roots,
- major and minor.

Random selection should be weighted toward guitar-friendly/common keys while retaining a nonzero chance of unusual keys.

The exact weighting table is a tuning decision and is not yet specified.

Every scenario's authored note prompt is transposed into this run key.

Gameplay targets are diatonic to the run key unless a future scenario explicitly changes this rule. In the current game, a non-diatonic played note is a mistake.

## 3.3 Bass Line

> **Percussion, added 2026-08-21.** The design does not specify drums; the
> implementation adds them because the bass alone did not read as a pulse. The
> kit plays quarter notes and nothing else by default, and adds one layer per
> subdivision present in the current *or upcoming* attempt — hats on the ands
> for eighths, a bright tick for sixteenths, a pitched click for triplets — so a
> hard rhythm announces itself an attempt before it arrives and keeps being
> marked while it is played. Provisional tuning; see `DECISION_LOG.md`
> (DECISION-016) and `src/audio/drum-pattern.ts`.

One four-measure bass line is generated in the selected key during pregame.

That same bass line loops throughout the entire run.

Its purpose is:

- musical backing,
- tonal orientation,
- and ear training.

The player should gradually learn to hear the relationship between the prompted scale degrees and the bass.

The bass line is **not normally part of scoring**.

Future scenarios may intentionally ask the player to interact harmonically with the bass—for example, identify or hit the bass note, fifth, or another relationship—but this is scenario content rather than a core run rule.

## 3.4 Tempo

The player selects one tempo before the run.

The tempo remains fixed throughout the run.

Initial options:

| Name | BPM |
|---|---:|
| **Baby Lamb** | 60 |
| **Billy Goat** | 90 |
| **Cashmere** | 106 |
| **Ibex** | 120 |
| **Markhor GOAT** | 140 |

Tempo is a global difficulty multiplier, but it does **not** change the scenario difficulty level.

A Level 7 exercise at 60 BPM is expected to be far easier than the same Level 7 exercise at 140 BPM.

High scores are tracked separately for each tempo.

---

# 4. Guitar Minigame

## 4.1 Basic Structure

A typical minigame is:

```text
4 measures
× 4 beats
= 16 beats
```

The note count varies dramatically.

Examples:

- a sparse exercise may have roughly 10 note opportunities,
- quarter-note material might have 16,
- eighth-note material might have 32,
- uninterrupted sixteenths can have 64.

The player attempts the prompted notes in musical time.

Tuninator supplies real-time pitch / note / gesture information to GOATerizer.

The implementation of Tuninator itself is outside this GDD.

## 4.2 Difficulty Levels

Difficulty is hand-authored at the scenario level.

There is no global algorithm that automatically converts Level 3 content into Level 4 content.

The broad intent is:

- **L1:** extremely gentle warm-up material,
- **L2–4:** growing rhythmic and navigational demand,
- **L5:** meaningfully advanced playing begins to appear,
- **L6:** sustained advanced control,
- **L7:** genuinely difficult guitar playing.

What this means musically depends on the minigame class and scenario.

A bend may be important in a high-level `PerformMinigame`; sustained sixteenth execution may define a high-level `RepeatMinigame`; a `BattleMinigame` may combine rhythm, navigation, memory, and technique.

The authored `PromptNotes[]` are the authority.

---

# 5. Note and Gesture Judgment

## 5.1 Outcome Types

A target note opportunity has three player-facing judgment outcomes:

### Perfect

Correct pitch or gesture with strong timing / execution.

- highest base score,
- produces good energy,
- visually displayed as the best result.

### Good / Understandable

Correct pitch or gesture, but noticeably loose.

Examples may include:

- early attack,
- late attack,
- early release,
- late release,
- imperfect but acceptable execution.

- earns less score than Perfect,
- still produces good energy,
- still counts as a successful note.

The exact player-facing word can be tuned later. The important distinction is **successful but scruffy**.

### Miss

The expected note or gesture was not completed acceptably within its opportunity window.

- no success score,
- produces bad energy,
- breaks relevant streaks.

## 5.2 Wrong Notes

A wrong played note is visible immediately as a bad played note.

Wrong notes include:

- incorrect diatonic pitches,
- non-diatonic pitches,
- unrelated note attacks during an active prompt.

A wrong note does **not** immediately consume the target opportunity.

The game continues listening for the correct pitch until that target's valid timing window expires.

Wrong-note events may emit bad energy while the target remains recoverable.

## 5.3 Timing Windows

Timing tolerance depends on note duration and musical density.

Long notes can be forgiving.

For example, a quarter note may still qualify as Good if its attack and/or release is as much as roughly half a beat away from the ideal timing.

Dense sixteenth-note passages require substantially tighter windows because allowing half-beat timing errors would make individual target notes ambiguous.

Exact timing constants are tuning data, not yet fixed by this GDD.

The intended rule is:

> Make Good as forgiving as possible without making the musical sequence ambiguous.

## 5.4 Sustained Notes

A sustained target has visible duration on the timeline.

Judgment may care about:

- attack time,
- correct sustained pitch,
- duration,
- and release time.

A loose start or stop may downgrade Perfect to Good rather than automatically failing the note.

## 5.5 Bends and Continuous Gestures

Bends are not treated as two disconnected pitch events.

They are continuous guitar gestures.

The target describes the intended pitch trajectory and Tuninator evaluates the gesture over time.

The timeline should visually represent this as a note bending toward another pitch lane rather than simply showing two independent notes.

Slurs and other expressive gestures may also have special notation.

---

# 6. Energy and Scenario Feedback

Every judged guitar event can create visual energy.

## Good Energy

Produced by:

- Perfect notes,
- Good / understandable notes,
- successfully completed gestures.

Perfect may generate a stronger or cleaner presentation than Good.

## Bad Energy

Produced by:

- wrong played notes,
- missed target opportunities.

A short visual streak travels from the judged note on the timeline into the scenario.

This is a simple authored visual effect, not a requirement for a general particle system.

## Scenario Response

The current minigame class decides what it means to care about good or bad energy.

Examples:

- `ClimbMinigame`: good energy advances; bad energy may simply stall.
- `PerformMinigame`: good energy improves the act; bad energy can cause embarrassment.
- `BattleMinigame`: good energy increases dominance; bad energy may benefit the threat.
- `RepeatMinigame`: a miss may simply fail to complete the next repeated action.

The game-level system generates the performance event and energy. The class decides the scenario consequence.

Detailed class behavior is defined in:

- `GOATerizer_Parameterized_Minigame_Behavior_and_Scenario_Bindings.md`
- `GOATerizer_Scenario_Asset_Slot_Bindings.md`

---

# 7. Stars and Minigame Progress

Every minigame begins with three empty stars over the scenario.

Scenario level data defines three cumulative performance thresholds:

```text
PassThreshold
Star2Threshold
Star3Threshold
```

Their meanings are:

- ★ — enough successful performance to survive the minigame,
- ★★ — strong performance,
- ★★★ — perfect performance.

Stars lock once earned.

A player cannot fall from ★★ back to ★ because of later misses.

The star meter fills during play so the player can see current achievement immediately.

At the end of the fourth measure:

- 0 stars → the run ends,
- 1–3 stars → the player continues.

There is no requirement for special scenario-specific failure artwork. Failing to earn a star is punishment enough; the Game Over rank will handle the humiliation.

---

# 8. Measure Scope Inside Scenarios

Every normal attempt lasts four measures, but how a scenario uses those four measures belongs to the **scenario/class design**, not the global game loop.

Examples:

- an easy battle may resolve once per measure for four rounds,
- a difficult battle may unfold continuously across all four measures,
- OPEN THE BEERS may refresh a new row of beers each measure while the protagonist becomes progressively more wasted,
- Beach-Ball Tap may remain one continuous scene so 64 successful taps can accumulate into an enormous crowd.

The game-level system only guarantees:

```text
AttemptLength = 4 measures
```

The scenario's `MeasurePlan` controls:

- whether visual state resets,
- which local state resets,
- what persists,
- whether musical content repeats,
- and whether a measure gets its own local victory / resolution.

Scenario-specific measure behavior is defined in the companion class/scenario specification.

---

# 9. Score and Streaks

## 9.1 Base Score

Numeric score comes from note success.

Relative value:

```text
Perfect > Good > Miss
```

A Good note is successful but earns the lowest successful-note score.

Perfect timing and correct execution earn more.

The exact point values are not fixed yet.

## 9.2 Streaks

Streaks reward sustained execution of difficult dense passages, especially:

- triplets,
- sixteenth-note runs,
- other explicitly streak-eligible sequences.

The system should track consecutive successful notes in these passages.

A miss breaks the streak.

Wrong-note behavior with respect to streak termination should be tuned with the final judgment system; the default expectation is that a clearly wrong played note breaks a clean streak.

Perfect notes should be worth more than Good notes even when both preserve the streak.

The exact bonus curve / multiplier is TBD.

## 9.3 High Scores

High scores are stored independently for the five tempo categories.

The Game Screen shows current score, not high score.

The Start Screen may show the five tempo high scores.

---

# 10. Continuous Musical Flow

The backing beat does not stop between minigames.

There is no musical break after measure four.

The next scenario arrives while the underlying tempo and bass loop continue in time.

This is important: stopping the beat would throw the player off and make a run feel like disconnected exercises rather than one continuous musical session.

Scenario transitions are synchronized to the beat.

The standard scenario slide transition lasts exactly **one beat**:

```text
transitionSeconds = 60 / BPM
```

---

# 11. Main Game Screen

The screen is vertically organized:

1. **Run UI / history**
2. **Scenario strip**
3. **Timeline**

## 11.1 Top UI Bar

### Left

Show:

- total stars earned in the run,
- current musical key.

### Center

Show a horizontal history of **16 elements**, one for each minigame slot.

Each history element begins inactive / greyed out.

After its minigame completes, it displays:

- zero,
- one,
- two,
- or three stars.

No numeric labels are necessary.

### Right

Show:

- current numeric score.

Do not show high score here.

## 11.2 Scenario Strip

The scenario area is wider than one scenario panel.

At any time it shows:

- half of the previous scenario on the left,
- the full current scenario in the center,
- half of the upcoming scenario on the right.

The next scenario is intentionally visible before the player knows whether they will survive the current one.

Its identity is already known because the full 16-minigame run sequence is generated before play starts.

The current scenario contains its own:

- background,
- characters,
- props,
- effects,
- class-controlled behavior,
- and three-star meter.

## 11.3 Scenario Completion Transition

After the fourth measure:

1. determine final stars,
2. fly the earned star(s) into the corresponding history element,
3. if zero stars, end the run,
4. otherwise slide the scenario strip left over exactly one beat,
5. the previous current scenario becomes the half-visible left panel,
6. the upcoming scenario becomes current,
7. a newly upcoming scenario becomes visible on the right.

The beat and bass line continue uninterrupted.

---

# 12. Timeline

The timeline is the primary play-reading interface.

Its job is to communicate:

- what must be played,
- exactly when it must be played,
- note duration,
- articulation / bend information,
- bass-line harmony,
- what the player actually played,
- and how each played note was judged.

The design should favor musical understanding without sacrificing immediate playability.

## 12.1 Time Axis

Time scrolls from right to left.

An incoming target note:

- appears on the right,
- takes **four beats** to travel to the center,
- reaches the center exactly when it should be played,
- continues into history,
- reaches the left edge **four beats later**.

The visible timeline therefore represents roughly:

```text
4 beats of future
+
current strike line
+
4 beats of history
```

> **Revised from two beats.** At two beats a sixteenth-note run arrives too fast
> to read as pitch: the note only becomes legible once it is nearly on the strike
> line, which is too late to be deciding which fret to be on. Four beats trades
> on-screen note density for reading time. The span is one number in
> `src/config/tuning.ts` (`TIMELINE_FUTURE_BEATS` / `TIMELINE_HISTORY_BEATS`);
> the play area is a fixed width, so the span *is* the scroll speed.

A strong vertical marker at the center defines the exact intended performance time.

## 12.2 Note Duration

Notes are horizontal shapes whose width corresponds to musical duration.

Examples:

- half note,
- quarter note,
- eighth note,
- sixteenth note.

Sustained notes remain visibly extended through their expected hold duration.

## 12.3 Judgment Display

After recognition, the target and/or played-note overlay visibly communicates:

- Perfect,
- Good / understandable,
- Miss.

Wrong notes are also drawn into timeline history as bad played notes.

The player should be able to glance left and understand what actually happened.

## 12.4 Bass Line

The bass line is drawn in the same timeline as darker / visually subordinate note shapes.

It provides harmonic context without competing with target prompts.

Played notes render over the bass line.

The bass line is backing information, not a second target track.

---

# 13. Timeline View A — Key View

Key View prioritizes the relationship of each pitch to the current musical key.

## 13.1 Pitch Lanes

There are **8 ordered lanes** representing a one-octave diatonic span, root to root:

```text
root
2
3
4
5
6
7
root
```

Minor keys use their appropriate scale-degree labels, such as `b3`.

The two endpoint roots are one octave apart.

The layout direction on screen may be chosen for readability; the important invariant is an ordered one-octave diatonic pitch space.

A note fills its lane — from halfway to the lane above to halfway to the lane below — so a step between adjacent degrees reads as two blocks whose corners meet, and the contour of a phrase is legible as a silhouette before any label is read.

> **Revised 2026-08-21.** This was a two-octave, fifteen-lane space. Two octaves
> is more than a player can hold in their head and answer on a guitar in real
> time: fifteen thin lanes are hard to read at a glance, and the exercise makes
> the fretting hand travel. One octave is eight tall lanes, one hand position,
> and a shape the player can actually internalise. See `DECISION_LOG.md`
> (DECISION-012) and `src/music/degrees.ts`.

## 13.2 In-Game Lane Labels

During the run, labels prioritize scale degree while retaining the absolute note name.

Example in G minor:

```text
1 (G)
2 (A)
b3 (Bb)
4 (C)
5 (D)
b6 (Eb)
b7 (F)
...
```

This is intentionally educational.

The player can immediately see the note name but is encouraged to internalize its harmonic role.

## 13.3 Pregame Fingering Labels

During pregame, the same 8 pitch lanes can instead display the selected suggested guitar fingering.

Examples:

```text
E3
A5
A6
D3
...
```

The notation means:

```text
<string><fret>
```

For example `E3` means low-E string, third fret.

The entire one-octave selected scale shape should be visible so the player can orient physically before starting.

## 13.4 Non-Diatonic Notes

Target prompts are currently diatonic.

If the player produces a non-diatonic note:

- it is a mistake,
- it should still appear in timeline history,
- it should be visually shown between / outside the clean diatonic lanes with an intentionally bad or fuzzy treatment,
- the expected target remains recoverable until its timing window expires.

---

# 14. Timeline View B — Tablature View

Tablature View prioritizes immediate fingering readability.

## 14.1 String Lanes

There are six rows:

```text
E
A
D
G
B
e
```

## 14.2 Target Notes

Target notes use conventional tablature-like fret numbers and rhythmic notation sufficient to distinguish:

- half notes,
- quarter notes,
- eighth notes,
- sixteenth notes,
- sustained notes,
- bends / expressive gestures.

A bend should visibly communicate movement toward the destination pitch rather than looking like two unrelated plucks.

Each string row draws a thin string line; a target or played note is a filled bar spanning that row, from halfway to the string above to halfway to the string below, with the fret number set on the bar itself. This is the same bar geometry Key View uses (§13.1), so the two views differ only in what the vertical axis means.

## 14.3 Fingering Selection

During pregame, the player can choose from several suggested one-octave fingerings for the selected key in different fretboard regions.

Each is shown as a five-fret neck diagram, because the choice being made is *where on the neck to practise this* and that is a picture rather than a sentence. Every offered shape fits inside one five-fret hand position; a shape that would make the hand travel is not offered.

The selected fingering determines how target pitches are mapped onto strings and frets in Tablature View.

The fingering is a **visual convenience**, not a physical-input requirement.

Tuninator judges the produced pitch / gesture. If the player reaches the correct pitch using another physically valid fingering, it still counts.

## 14.4 Bass Line

The bass line may be shown as darker fret positions without full rhythmic tab notation.

This presentation should be tested for clarity.

## 14.5 Wrong-Note Display

Played notes that do not match the current target must still appear as bad input.

The exact visual representation of a non-diatonic or otherwise unmappable played note in Tablature View is still a UI design detail to resolve.

It must not silently disappear.

---

# 15. Pregame

Pregame is a live musical sandbox, not a static setup menu.

The bass line is playing.

Tuninator is listening.

The timeline is active.

The player can noodle, play the displayed scale, hear how notes relate to the bass, and watch their guitar appear on the timeline.

Nothing is scored yet.

## 15.1 Pregame Controls

Show:

### Key

Display:

- root,
- major/minor.

Provide:

- **Reroll Key + Bass Line**

Reroll chooses a new weighted-random key and generates a new bass line.

Reroll does **not** force the transport back to beat 1.

The musical clock keeps its current position in the four-measure loop and the new backing adopts that current phase.

### Tempo

Choose:

- Baby Lamb — 60
- Billy Goat — 90
- Cashmere — 106
- Ibex — 120
- Markhor GOAT — 140

Changing tempo should update smoothly rather than hard-resetting playback.

### Timeline View

Choose before the run:

- **Key View**
- **Tablature View**

This selection is fixed for the run in the initial version.

### Fingering

Choose one suggested one-octave scale fingering from several fretboard regions.

The same selection:

- provides the pregame physical reference in Key View,
- determines target fret/string mapping in Tablature View.

### Play

Starts the 16-minigame run without breaking the underlying beat.

The run begins at Level 1, intentionally providing a very gentle first warm-up.

---

# 16. Start Screen

Keep it simple.

The player should be able to get to playing quickly.

Show:

- GOATerizer title,
- tagline,
- **Play**,
- high scores by tempo.

The screen should invite immediate guitar input rather than bury the player in configuration.

---

# 17. Game Over

Game Over occurs immediately after a minigame finishes with zero stars.

There is no requirement for a unique failure animation in every scenario.

The Game Over screen provides the punishment.

Show:

- final numeric score,
- total stars,
- the full 16-slot run history,
- a ridiculous rank title based on total stars,
- high-score information for the selected tempo.

Provide at least:

- **Replay Same Setup** — same key, bass line, tempo, and other pregame selections,
- **New Game** — return to a fresh pregame setup / reroll path.

A completed 16-minigame run also reaches this results screen, but with considerably more dignity.

---

# 18. GOAT Rank Titles

A run can earn from **0 to 48 stars**.

Every possible star total has a rank.

The titles should get progressively more grandiose, but even strong ranks should retain some stupidity.

| Stars | Rank |
|---:|---|
| 0 | **Hairless Baby Lamb** |
| 1 | **Wet Hairless Baby Lamb** |
| 2 | **Baby Lamb With a Guitar** |
| 3 | **Lamb Who Has Heard Music** |
| 4 | **Lamb With Delusions** |
| 5 | **Petting-Zoo Liability** |
| 6 | **Almost Technically Caprine** |
| 7 | **Goat Intern** |
| 8 | **Probationary Goat** |
| 9 | **Discount Goat** |
| 10 | **Yard Goat** |
| 11 | **Tin-Can Amateur** |
| 12 | **Fence-Licker** |
| 13 | **Bell With Legs** |
| 14 | **Junior Headbutter** |
| 15 | **Goat, Unfortunately** |
| 16 | **Serviceable Goat** |
| 17 | **Adequate Billy** |
| 18 | **Headbutt Trainee** |
| 19 | **Junior Mountain Nuisance** |
| 20 | **Rock-Hopper** |
| 21 | **Salt-Lick Specialist** |
| 22 | **Goat With a Van** |
| 23 | **Goat With Chops** |
| 24 | **Certified Billy Goat** |
| 25 | **Swagger Goat** |
| 26 | **Mean Little Bastard Goat** |
| 27 | **Cliff Idiot** |
| 28 | **Mountain Goat** |
| 29 | **Mountain Goat With Receipts** |
| 30 | **Unreasonably Competent Goat** |
| 31 | **Ibex Intern** |
| 32 | **Ibex** |
| 33 | **Ibex With Swagger** |
| 34 | **Peak Ibex** |
| 35 | **Horn Technician** |
| 36 | **Alpine Menace** |
| 37 | **Markhor Apprentice** |
| 38 | **Markhor Adjacent** |
| 39 | **Discount Markhor** |
| 40 | **Proper Markhor** |
| 41 | **Battle Markhor** |
| 42 | **Shred Markhor** |
| 43 | **War Markhor** |
| 44 | **GOAT Candidate** |
| 45 | **Suspiciously GOATed** |
| 46 | **GOATed** |
| 47 | **Transcendent Markhor** |
| 48 | **GOAT Markhor** |

These are content, not mechanics, and can be rewritten freely while preserving the one-title-per-star-total structure.

---

# 19. Scenario Content Architecture

The GDD does not enumerate all scenarios.

Scenario content lives in companion specifications.

A scenario belongs to exactly one minigame class and binds its art to that class's runtime slots.

Conceptually:

```text
Scenario
    Id
    DisplayName
    MinigameClass
    SupportedLevels[]
    AssetBindings
    LevelData[]
```

For each supported level:

```text
ScenarioLevelData
    PromptNotes[]
    PassThreshold
    Star2Threshold
    Star3Threshold
    MeasurePlan
    ClassParameters
```

The scenario designer decides:

- actual scale degrees / octave positions,
- rhythm,
- note durations,
- articulations,
- bends,
- which measures repeat or change,
- visual span,
- local reset behavior,
- threshold presentation.

The overall game does not attempt to infer those things from the numeric difficulty level.

## Companion Documents

The detailed content/runtime architecture is defined by:

- `GOATerizer_MinGame_Structure(1).md`
- `GOATerizer_Visual_Asset_System(1).md`
- `GOATerizer_Theme_Applications.md`
- `GOATerizer_Parameterized_Minigame_Behavior_and_Scenario_Bindings.md`
- `GOATerizer_Scenario_Asset_Slot_Bindings.md`

If this GDD conflicts with those documents on **game-level flow**, this GDD should be treated as the newer authority.

For minigame-class visual behavior and scenario asset bindings, the companion specifications remain authoritative.

---

# 20. Browser / Audio Architecture Boundary

GOATerizer is initially a **web game**.

It uses **Tuninator** as the pitch / guitar-gesture detection system.

This GDD intentionally does not define Tuninator's detection algorithm.

The gameplay layer needs timely information sufficient to judge:

- played pitch,
- attack timing,
- sustained pitch,
- release / duration where relevant,
- continuous bend trajectory,
- and other supported articulated gestures.

The browser implementation must prioritize low-latency audio-to-visual response because the core fantasy depends on the scenario reacting directly to the player's guitar.

The specific web framework, rendering library, audio transport architecture, and Tuninator API contract are implementation decisions outside this document unless later specified.

---

# 21. Persistence

Persist at minimum:

- high score for Baby Lamb 60 BPM,
- high score for Billy Goat 90 BPM,
- high score for Cashmere 106 BPM,
- high score for Ibex 120 BPM,
- high score for Markhor GOAT 140 BPM.

The initial design does not require accounts, cloud saves, progression economies, unlock trees, or currencies.

---

# 22. Explicit Non-Goals for the Initial Design

Do not assume the game needs:

- adaptive difficulty,
- procedural guitar-exercise generation,
- class-balanced run generation,
- unique failure animation for every scenario,
- enforced physical guitar fingering,
- online multiplayer,
- progression currency,
- unlock trees,
- user accounts,
- a large mandatory launch scenario count,
- frame-heavy character animation,
- a separate musical break between minigames.

These may be reconsidered later.

---

# 23. Open Tuning Decisions

These are intentionally unresolved rather than silently invented.

## Key Weighting

All 24 major/minor keys are available, but the exact probability distribution favoring guitar-friendly keys is TBD.

## Judgment Windows

Exact Perfect / Good timing, duration, and gesture tolerances are TBD and should be tuned against Tuninator behavior.

## Score Values

Exact point values for:

- Perfect,
- Good,
- streak continuation,
- streak length,
- difficulty,
- and any tempo weighting

remain TBD.

High scores are already separated by tempo, so a tempo multiplier is not strictly required.

## Streak Rules

The exact definition of which passages are streak-eligible and whether every stray wrong note breaks a streak should be tuned during playtesting.

## Bass-Line Generator

The harmonic/rhythmic grammar used to generate the persistent four-measure backing line is not yet specified.

## Tablature Wrong-Note Rendering

A bad played pitch that does not map naturally into the selected one-octave fingering must still appear in history. The exact Tablature View presentation remains to be designed.

---

# 24. Core Game Loop Summary

```text
START
    ↓
Pregame
    choose / reroll key + bass line
    choose tempo
    choose Key View or Tablature View
    choose suggested fingering
    play guitar freely against live bass loop
    ↓
Generate 16-scenario run
    difficulty = 1234234534564567
    ↓
Minigame 1
    4 measures
    play prompted guitar exercise
    Tuninator judges performance
    timeline emits good/bad energy
    scenario responds
    earn 0–3 stars
    ↓
0 stars? ── YES ──→ GAME OVER
    │
    NO
    ↓
stars fly to history
scenario strip slides left over 1 beat
music never stops
    ↓
next minigame
    ↓
repeat through slot 16
    ↓
RESULTS / GAME OVER
    score
    total stars
    16-slot history
    goat rank
    tempo high score
    replay same setup / new game
```

---

# 25. The Player Experience in One Paragraph

The player starts a bass groove, sees a one-octave map of the current key, noodles until their hands and ears understand where they are, then presses Play. Sixteen ridiculous guitar challenges arrive without the beat ever stopping. Notes slide toward the center of the timeline; the player hits them, bends them, mangles them, or misses them. Good energy shoots upward and makes goats climb cliffs, kaiju flatten cities, beer cans explode open, or petty fantasy arguments become apocalyptic. Every minigame asks for at least one star. The exercises become increasingly brutal. The player either dies somewhere in the sequence and is informed that they are a damp defective lamb, or somehow reaches the end and earns the right to call themselves a **GOAT Markhor**.
