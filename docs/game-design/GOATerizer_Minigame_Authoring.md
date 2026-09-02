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
}
```

Every lifecycle method returns `void`. A minigame **cannot** award itself score
or stars, end an attempt, or move a note — not by convention, by signature. It
never calls the host, holds no callbacks, and never reads a clock: `beat` is
always a parameter, and always attempt-relative.

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

`view.measure.width` and `.beatWidth` give the golden-rectangle geometry, so
"one beat ahead" is `strikeX + view.measure.beatWidth` rather than a guess at
scroll speed.

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
| Slot | On the timeline |
|---|---|
| `background` | the minigame's measures |
| `climberPoses[]`, `finishPose` | actor, anchored to the note it stands on |
| `waypointVisuals[]` | **becomes note art.** The bars *are* the footholds |
| `destinationVisual` | a sprite at or past the final note |
| `stepEffects[]` | effects at the note that was hit |

**`route` waypoint data is deleted.** Authored `startPosition` / `destination` /
per-waypoint coordinates described positions in a panel that no longer exists.
The notes supply every coordinate. Do not author routes.

### `RepeatMinigame` — Straight Sixteenths — REPEAT
The cleanest fit of the six. `repeatTarget` and `targetCompletedState` are simply
the note's `body` before and after it is hit — the can *is* the note. Put
`performerNeutral`/`performerAction` at `strikeX` and let the row of cans scroll
into the forehead. `debrisEffects[]` fall with `y > 1`.

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

> **Blocked.** The content model cannot express a triplet at all today:
> `NoteDuration` has no member for one, the loader demands exact duration
> matching, and there is no triplet row in the timing table. Design freely, but
> this family cannot be built until that is fixed.

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

A scenario is authored JSON naming a registered minigame. The **host** owns only
identity, the prompt, the measure count, star thresholds and scoring flags.
Everything else is yours, opaque to the host and validated by your own parsers:

```ts
parseConfig(raw): unknown              // scenario-level: asset slots, parameters
parseLevel(raw, shape): unknown        // per level; shape = { noteOpportunityCount, measures }
assetIds(config, levels): string[]     // every asset id you need preloaded
create(context): Minigame
```

Both parsers must **throw** on anything they cannot map. Authored data is the
authority; a bad edit should fail a test, not transpose a note mid-run.

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
