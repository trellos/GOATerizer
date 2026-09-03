# GOATerizer Minigame Authoring

How to design and build a minigame. Read `GOATerizer_Game_Design.md` §11 and §6
first; this is the contract those sections describe.

The code contract is `src/minigame/api.ts`, which imports nothing — a minigame
package needs that one file and nothing else from the host.

---

## 1. The model

**There is one surface: the timeline.** There is no scenario panel.

The player reads the timeline to know what to play. A minigame is what happens on
that same surface in response to their playing, for the four measures it is
active. It skins the note bars and it puts things on them.

- a goat hops from note bar to note bar as each note is hit,
- a tin can rides its bar into a waiting forehead and is crushed,
- a hay bale on a bar is shredded, a fence post knocked flat.

Cause and effect are in one place: the note the player hit *is* the thing that
reacted.

---

## 2. The contract

```ts
interface Minigame {
  onJudged(judged: Judged, beat: number): void;      // one judged note
  update(beat: number): void;                        // every frame
  onMeasure(measureIndex: number, beat: number): void;
  onStarEarned(stars: number, beat: number): void;
  onComplete(passed: boolean, stars: number, beat: number): void;
  render(view: StageView): Stage;                    // the only visible output
  aimAt?(lane: number | null): void;                 // optional: what to lean at
}
```

Every lifecycle method returns `void`. A minigame **cannot** award itself score
or stars, end an attempt, or move a note — not by convention, by signature. It
never calls the host, holds no callbacks, and never reads a clock: `beat` is
always a parameter, and always attempt-relative.

`aimAt` is optional and is the one thing the host volunteers rather than
reports: the lane the *next* target sits on. At 60bpm there is most of a second
between quarter notes and an idle actor there is dead air; an actor leaning at
the next lane doubles as a pointer at the note that is coming.

`render` returns a value, rebuilt each frame:

```ts
type Stage = {
  background?: string;                        // behind THIS minigame's measures
  sprites?: readonly Sprite[];                // actors, scenery, effects
  notes?: ReadonlyMap<string, NoteArt>;       // note id -> what the bar is made of
};
```

All three are optional. A minigame returning `{}` is invisible and the timeline
renders exactly as the host draws it alone.

> **What is wired today.** `notes` is drawn (DECISION-044) and so is `sprites`
> (DECISION-050, `ui/timeline/stage-layer.ts`) — a family with no prototype
> layer of its own, which is every family from here on, is its sprites and
> nothing else. `background` is not read yet: the scenario backdrop is still its
> own canvas behind the timeline, fed by `backgroundId()`, so a background
> clipped to your `span` would be a second, disagreeing answer about where the
> art goes. Return it anyway — the contract is what a new family should be
> written against, and it is read once the backdrop folds onto the timeline
> canvas. The two prototype actors are still drawn by
> `ui/timeline/actor-layer.ts` and `repeat-layer.ts` through the transitional
> `prototypeLayer()` hook, until the crusher's solved arm is baked to a pose
> ladder.

### How big a sprite is

`scale` multiplies the sprite's **natural size**, and natural size is the size
the art was drawn at. Scenario art is small pixel art the runtime scales up, so
one art pixel needs a fixed exchange rate: the **nominal scene**, 384x216 — the
size each generator under `scripts/` composes into — whose *height* is mapped
onto the play area's. So `scale: 1` draws a sprite at the size it would be in a
scene that tall: a 47px ram stands about a fifth of it, and a 15x60 accent flash
stays tall and thin next to a 37x37 burst.

The frame is a host convention rather than a measurement of any file. Every
shipped scenario composes into it today, but a backdrop is not a statement about
the art in front of it — an art pass that briefly shipped Rocky's backdrops at
768x288 with its sprites unchanged, since reverted, would have halved every
actor in the game had the unit been read from that file. So art drawn against a
different scene wants a family-level `scale`, not a new frame. Butt-Butt-BONK
has one: its pack is drawn nearly three times larger than the generated art, and
one constant brings the ram, the wolf and their impact effects down together,
keeping the proportion they were drawn in.

Sizing is from the frame's height alone, never its width, so it does not move
with the window's aspect ratio. That is what lets a family place an actor by
arithmetic — hooves at `y = 1.27`, horns reaching `0.994` — and have it hold at
every viewport.

---

## 3. Coordinate space

`x` runs rightwards across the visible playfield (right of the gutter), 0 at its
left edge, 1 at its right. `y` runs downwards across the **lane band**, 0 at the
top lane, 1 below the bottom one.

**Going outside 0..1 is normal and useful.**

- `y < 0` is above the lanes, `y > 1` below them — the play area the background
  fills. This is where a goat stands when it hops onto a bar, and where a
  knocked can falls.
- `x` outside 0..1 is off-screen, which is where your own notes are before they
  scroll in.

Everything is clipped to the play area, never to a note.

### The two anchors

**A note.** `view.notes` carries every note of the attempt with a `rect` in this
space — including off-screen ones, whose rects fall outside 0..1. That is
deliberate: an actor standing on note 3 keeps its footing after note 3 scrolls
off the left edge.

```ts
const note = view.notes[this.#standingOn];
sprites.push({ key: "goat", assetId: pose, x: note.rect.x + note.rect.w / 2,
               y: note.rect.y, anchor: "bottom", layer: "over" });
```

**The current-time bar.** `view.strikeX` is where a note is played. Put your
actor here and let the notes come to it — a forehead waiting for cans, a threat
closing in. Often better than chasing a scrolling bar.

`view.measure.width` and `.beatWidth` give the measure geometry, so "one beat
ahead" is `strikeX + view.measure.beatWidth` rather than a guess at scroll
speed. Scroll speed is the host's and can change; never assume one.

---

## 4. Note art

The host owns note geometry absolutely: horizontal from musical time, vertical
from pitch lane, **width from duration** — a quarter note is four times the width
of a sixteenth, and that difference is how the player reads rhythm.

You decide what fills and surrounds that rect, in three slots:

| Slot | Sizing | For |
|---|---|---|
| `underlay` | natural proportions, centred on the rect, **bleeds outside it** | glow, terrain, a crag behind |
| `body` | **stretched to the rect exactly** | what the note is made of |
| `overlay` | natural proportions, centred, **bleeds outside it** | ornament, a can sitting on the bar |

Any omitted slot falls back to the host's default. The rect is an **anchor, not
a clip**.

Two things you cannot override: the host washes a skinned note with its own
colour so upcoming / Perfect / Good / Miss stay tellable apart, and it draws the
**played-note row and the current-time bar above everything you produce**. The
player's own note is never obscured.

---

## 5. The six families on the timeline

The canonical asset slots in `GOATerizer_Scenario_Asset_Slot_Bindings.md` were
written for a scenario panel. Here is what each becomes.

### `ClimbMinigame` — Scale — CLIMB
Built: `src/scenario/minigames/climb-minigame.ts`.

| Slot | On the timeline |
|---|---|
| `background` | the minigame's measures |
| `climberPoses[]`, `finishPose` | actor, anchored to the note it stands on |
| `footholdArt.{body,crag}` | **the note art.** The bars *are* the footholds |
| `destinationVisual` | a sprite at or past the final note |
| `stepEffects[]` | effects at the note that was hit |

`footholdArt` is **derived from the scenario id**, not authored:
`note_<id>_ledge` and `note_<id>_crag`, the same convention the other ten slots
follow. A new Rocky scenario binds nothing extra to get its ledges, and
`assetIds()` is where that answer belongs because which art a family needs is
the family's question. A scenario may still bind `assetBindings.footholdArt`
explicitly to override it.

The crag is the `underlay` at `scale: 1.55` — wider than the bar on purpose, so
a run of footholds overlaps into one ridge line — and it is drawn at `0.4`
opacity ahead of the climber and solid behind, so the ridge fills in as the
phrase is played and leaves a trace of how far the player got. **None of it
carries information.**

**`route` waypoint data is validated and then discarded.** Its coordinates
described positions in a scenario panel that no longer exists and nothing has
read them since. The one thing they still assert is about the *music* — one
waypoint per note opportunity — so `parseLevel` checks that and throws if the
two halves of a scenario have been edited apart. Do not author new routes.

The climb lands on the **target's** lane, never the played pitch: a wrong note
kills the actor without moving it anywhere. See the next family for why that is
the interesting half of the contrast.

### `RepeatMinigame` — Straight Sixteenths — REPEAT
Built: `src/scenario/minigames/repeat-module.ts`.

**This family returns no note art at all**, and that is the point rather than an
omission. An earlier draft of this brief had `repeatTarget` and
`targetCompletedState` as the note's `body` before and after it is hit. They are
not: the can is a *sprite* the performer knocks off the bar, and a can that were
the bar could not fly, fall, pile up or be visibly missed. The bars stay the
host's default. Put `performerNeutral`/`performerAction` at `strikeX` and let
the row of cans scroll into the forehead; `impactEffects[]` fall with `y > 1`.

The rule this family exists to demonstrate, and the reason its `onJudged` is not
the climb's: **authored pitch places terrain, played pitch places projectiles.**
A can lands where the player actually played, which is what makes a wrong note
legible as a wrong note rather than as nothing happening. `Judged` carries both
— `lane` is what was played, and the target is reachable through
`opportunityIndex` — so the host never has to choose between them.

`Judged.lane` is a **continuous** coordinate, so a bend can be drawn sliding and
an off-scale note drawn where it actually was. A can needs a *lane*: anything
that is not exactly on one has none, and wobbles. Take integers only; do not
round.

### `BattleMinigame` — Sixteenth Phrases — BATTLE
Hero at `strikeX`. The threat **closes in along the timeline** — start it at
x ≈ 1 and walk it toward `strikeX` as dominance shifts, so distance on screen
*is* threat. `arenaProps[]` sit below the band. Visual span varies per level
(1-measure rounds at L1–4, continuous at L5–7), which is your `onMeasure`
decision, not the host's.

### `TraverseMinigame` — Scale Run — TRAVERSE
Traveler moves note to note like CLIMB, faster. `waypointVisuals[]` become note
art. `hazardVisuals[]` are the interesting part: place them at beat positions
*between* notes, so the phrase's rests become the dangerous gaps.

### `ThreeStepMinigame` — Triplets — THREE-STEP
Derive the A/B/C role from the note's position within its beat, not from
`index % 3` — authored rhythm is not uniform. `arc()` is shipped for exactly this
family: two little hops and a larger leap.

Author a triplet with `duration: "eighthTriplet"` — a third of a beat, the only
`NoteDuration` that is not a binary fraction. Write `durationBeats` and
`startBeat` in the file as the decimals they nearly are (`0.333`, `1.667`); the
loader verifies them within a hair and then uses its own exact positions, so
your notes land on the beat and on the measure boundary rather than a
floating-point hair below either.

### `PerformMinigame` — Blues Lick — PERFORM
Performer near `strikeX`. `audienceStates[]` are not note-anchored — place them
below the band (`y > 1`) across your own span, and swap state at star
thresholds. `payoffEffects[]` fire from `onStarEarned(3, …)`.

Built (`src/scenario/minigames/perform-minigame.ts`, Goat Frontman). Two
things it adds to the canonical slots: `noteArt.body` (what every note is made
of) and `noteArt.flourish` (an overlay marking a **flourish note**). Flourishes
are authored per level as `visual.flourishBeats`, the phrase-relative start
beats of the notes the designer marked `F`; on one the performer strikes a
`flourishPoses[]` entry for the note's length and summons
`visual.goatsPerFlourish` crowd members from the wings. Bad notes flinch and
bore the crowd; nothing earned is taken away. Blues Lick material is written
in pentatonic degrees (`p1..p6`, `src/music/degrees.ts`) — one octave, root to
root, the same span the lanes show — resolved to lanes by the run's mode.

---

## 6. Scenario data

A scenario is authored JSON naming a registered minigame. The authored key is
`"minigameClass"` and it reaches the model as `ScenarioDefinition.minigameId` —
the old name, kept so existing content still loads, for what is now an **open
string** resolved through the registry rather than the closed six-way union it
was. The **host** owns only identity, the prompt, the measure count, star
thresholds and scoring flags. Everything else is yours, opaque to the host (`config` and `data`
are `unknown` on the scenario model) and validated by your own parsers:

```ts
interface MinigameModule {
  readonly id: MinigameId;              // an open string, not a union
  readonly displayName: string;
  readonly apiVersion: number;          // must equal MINIGAME_API_VERSION

  parseConfig(raw): unknown;            // scenario-level: asset slots, parameters
  parseLevel(raw, shape): unknown;      // shape = { noteOpportunityCount, measures }
  assetIds(config, levels): string[];   // every asset id you need preloaded
  backgroundId(config): string;         // the scenario-wide backdrop
  create(context): Minigame;
  debug?(instance): Record<string, string>;   // rows for the ?dev=1 panel
}
```

`parseLevel` is handed the **whole level object** and decides for itself which
of it means anything — a climb reads `measurePlan` and `visual.route`, a repeat
reads only `measurePlan`.

`backgroundId` is distinct from `Stage.background`: this one answers for a
scenario that is **not being played at all**, the neighbouring panels either
side of a handover, which have no live instance to ask.

`debug()` is how the dev panel stays family-free. It used to carry one row per
family printing `—` for whichever was not playing, so a third family meant
editing the panel; now each family answers for itself and the rows it does not
own are simply absent.

Both parsers must **throw** on anything they cannot map. Authored data is the
authority; a bad edit should fail a test, not transpose a note mid-run. Read
your slots in slot order, so an author fixing bindings top to bottom is told
about the first one they are missing rather than whichever the parser reached
first.

## 6a. Registration

```ts
// src/scenario/registry.ts — the composition root
registerMinigame(CLIMB_MINIGAME);
registerMinigame(REPEAT_MINIGAME);
```

Registration happens at the composition root, which is already the module that
knows which content this build ships, so `minigame/registry.ts` never imports a
minigame and the dependency runs one way. The registry refuses a module built
against a different `apiVersion` rather than letting it fail later inside a
render call, and refuses a duplicate id rather than letting one package silently
shadow another. A scenario naming an unregistered minigame throws with the ids
that *are* available.

Adding a family touches `scenario/registry.ts` and nothing else in the host:
not `types.ts`, not `load.ts`, not `attempt.ts`, not `game-app.ts`.

---

## 7. Checklist for a new family

- [ ] What is the note made of? (`NoteArt.body`)
- [ ] Where is the actor — on a note, or at `strikeX` with notes coming to it?
- [ ] What happens on Perfect / Good / Miss / wrong?
- [ ] What resets at a measure boundary, and what survives it?
- [ ] What does three stars look like?
- [ ] **What is on screen during a rest, when nothing is being played?**
- [ ] Which slots need somewhere that is not a note — above the band, below it,
      or at the edges of your own span?
- [ ] Does a judged note act on **authored** pitch or **played** pitch? Terrain
      is authored; projectiles are played. Getting this backwards makes a wrong
      note look like nothing happening.
- [ ] What does the `?dev=1` panel need to show to debug it? (`debug()`)
