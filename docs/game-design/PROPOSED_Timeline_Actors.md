# PROPOSED — Actors on the timeline

**Status: drafted on `claude/timeline-actors-draft`. Not on `main`.**

This is the design agreed in the goat-on-the-bars conversation, scoped down to a
rough draft: the existing scale runs, plus one easy REPEAT scenario.

Everything under "In" in §1 is now built on that branch and playable, and the
scenario panel has since been reduced to a backdrop — the mechanic replaced it,
so the climb's route, footholds, climber and effects are no longer drawn at all
(§6, DECISION-023).

What is built differs from the design as first written in four places, each
noted inline below and in `DECISION_LOG.md` (DECISION-020 to 022, 028):

1. **Can Crushing's material is one pitch.** §5 assumed a can could be authored
   on any lane. It cannot while the performer is stationary — see §5.
2. **The crusher stands a beat back from the strike line**, not 34px, because
   the can's flight *is* the read — see §5.
3. **The trophy is a goat-head bust.** Ornament tiers as designed; the art is
   canvas-free inline SVG rather than a sprite — see §7.
4. **The crusher never stops moving, and the can has to be lifted to him.** The
   first build of §5 was tested and did not read at all — see §5,
   DECISION-028.

The rest of the document is the design as agreed, and the open questions in §8
are still open.

The premise, in one line: **the note bar is a container, and an actor at the
strike line has a verb.** The timeline stops being notation beside a scenario
and becomes the place the scenario happens.

---

## 1. What the draft covers, and what it deliberately does not

**In:**

- The goat jumping the note bars in `ClimbMinigame`, using the four Rocky
  scenarios exactly as authored — no new scale content.
- The disposable-goat failure model: a miss kills it, the next good note spawns
  a new one, fallen goats mill on the floor.
- Goat size from streak, diminishing and capped.
- One REPEAT scenario — Can Crushing — with the played-pitch placement rule.
- The three-comparison star rule.
- A trophy per passed minigame, on a shelf in the top bar.

**Out, deliberately, and why:**

| Cut | Why |
|---|---|
| Contour-tracing locomotion at high density | No shipped scenario authors sixteenths, so the 107ms case cannot be hit yet. Discrete jumps only. |
| Live last-note ornament | Needs the star rule and trophy tiers settled in play first; it is a polish pass on top of them. |
| Background parallax run-progress | Pure art, no mechanism, and it is the easiest thing to add later. |
| Theme-specific ornaments beyond the goat | Only GOATS has art. A crown on a can-crusher is a later art decision. |
| The other four minigame classes | TRAVERSE/THREE-STEP/PERFORM/BATTLE have no built scenarios at all. |
| Deleting the waypoint routes | See §6 — they stay, unused, behind the class switch. |
| Keeping the scenario as a diorama | The mechanic replaced it; the panel is a backdrop now. See §6. |

---

## 2. The one rule everything hangs off

> **Authored pitch places terrain. Played pitch places projectiles.**

Terrain — platforms, ledges — must be deterministic and readable seconds ahead.
If a wrong note put the goat on the wrong ledge, one flub could make the next
platform unreachable and a single mistake could end a run. That death spiral is
the thing this design exists to avoid.

Projectiles resolve instantly at the strike line and leave no state behind, so
the player is safe to place them — and doing so makes wrong-note feedback
*diagnostic* rather than merely negative. A can arriving two lanes high says
"you overshot by a third", before the player can think about it.

| Class | Actor moves? | Placement | Draft status |
|---|---|---|---|
| `ClimbMinigame` | yes, lane to lane | authored | built in draft |
| `RepeatMinigame` | no, fixed lane | **played** | built in draft |
| `TraverseMinigame` | yes | authored | not in draft |
| `ThreeStepMinigame` | yes | authored | not in draft |
| `PerformMinigame` | no | played | not in draft |
| `BattleMinigame` | no | played | not in draft |

---

## 3. Actor state

New: `src/scenario/minigames/timeline-actor.ts`. A small pure class, owned by
`AttemptRuntime` and fed the judgment stream. (It was to run alongside `climb`;
`ClimbMinigame` has since been deleted — see §6.)

```
TimelineActor
  lane          number | null   // null while dead
  streak        number          // consecutive good notes
  peakStreak    number          // the trophy size input
  alive         boolean
  fallen        FallenActor[]   // {lane, size, bornBeat}, capped at 8
```

Rules:

1. **Position is deterministic.** When alive, `lane` is the lane of the target
   being judged. It never depends on how well the player is doing. It cannot
   become unreachable.
2. **A miss kills it.** `alive = false`, the actor is pushed to `fallen`,
   `streak = 0`. Nothing else changes.
3. **The next good note revives it** at that note's lane, at minimum size.
4. **Size is a function of streak only**: `size = min(1, sqrt(streak / 12))`,
   rendered between 0.45 and 1.5 lane heights. Notes 1–5 feel enormous, note 25
   still nudges, and a clean L1 (15–16 notes) can max it exactly as a clean L6
   can.
5. **Past the size cap, the streak buys decoration instead of mass.** Every
   further 4 unbroken notes adds a small star sparking off the actor, up to
   four. Size stops eating the read-ahead zone at 12, but a 28-note streak still
   visibly registers — and the decorations vanish with the actor on a break, so
   the whole streak is still one readable object.

   These are **not** the trophy's ornaments. The trophy's horns and crown come
   from the star count and are earned per attempt; these are live, transient,
   and come from the streak. They should not share art.
5. `peakStreak` is `bestStreak`, which `AttemptScore` already tracks. The actor
   does not need its own copy; this is listed for clarity.

Nothing here can end a run, gate a star, or make the next note harder. The
actor is a *display of* the streak, not a second rule system.

---

## 4. Rendering

New: `src/ui/timeline/actor-layer.ts`, drawn by `TimelineView` after the notes
and before the strike line.

- The actor sits **just left of the strike line** — landing follows input rather
  than predicting it, and it never occludes an approaching bar.
- It is drawn at `rowY(lane)`, sitting **on top of** the bar, so a scale run is
  visibly a staircase being climbed.
- Between notes it leans toward the next bar's lane rather than idling. At
  60bpm that is ~700ms of otherwise dead air, and the lean doubles as a pointer.
- Fallen actors mill on a floor strip **below the lane band**, small and
  low-contrast, capped at eight, cleared at attempt end.
- The goat is the scenario's own `climberPoses[]` art, cycled one pose per
  landing — the same art and the same cycle the scenario panel used to show. A
  first pass drew it from canvas primitives on the argument that the prototype
  was testing the mechanic rather than the art; that was wrong, because the art
  already existed at the right pixel density and a crude ellipse-and-horns goat
  beside a pixel-art backdrop reads as a bug rather than as a placeholder.
- Jump budget, for reference — ms between consecutive notes:

  | tempo | quarter | eighth |
  |---|---:|---:|
  | Baby Lamb 60 | 1000 | 500 |
  | Billy Goat 90 | 667 | 333 |
  | Ibex 120 | 500 | 250 |
  | Markhor GOAT 140 | 429 | **214** |

  214ms is the tightest case today. A jump arc reads in ~6–7 frames there.

---

## 5. REPEAT — Can Crushing

The crusher stands at **one fixed lane** for a measure at a time. A note bar
contains a can. What matters is where the can *appears*:

- Play the authored pitch → the can materialises at the crusher's lane and is
  crushed. The pile grows.
- Play a wrong pitch → the can materialises at **the lane you actually played**
  and sails into his head. The pile does not grow.
- Play something off-scale or unpitched → the can spawns wobbling and off-axis
  rather than snapping to a lane it does not belong in.

The detected pitch is quantised to the nearest lane for placement only. It has
no effect on judgment, which is unchanged.

The crusher may move between measures — never mid-measure — and telegraphs it by
visibly walking during the preceding measure. In the draft he does not move;
the hook exists.

**This needs a second minigame class**, which is the largest single piece of
work in the draft. See §6.

### Two things the build changed

**Every authored note is the root.** The three bullets above are only coherent
if the note the player is *asked* for is on the crusher's lane. Otherwise
playing correctly puts the can somewhere he cannot reach and the player is shown
the failure animation for a note they got right. While he is stationary, the
material has to sit entirely on his lane — so Can Crushing L1–4 escalate by
rhythm alone, which is what a REPEAT exercise is anyway. A test pins it
(`tests/can-crushing.test.ts`). The between-measures walk relaxes this to "one
lane per measure"; it is the first thing worth building next here.

**He stands one beat back from the strike line, not 34px.** The goat's offset
is small on purpose — it lands where you played. But the crusher's read is the
can's *flight*: born in its bar at the strike line, scrolling left at exactly
the bars' speed, and either arriving in his hands or passing over his head. At
34px that flight is under a third of a beat and the crush is over before the eye
finds it. At a beat it is roughly 670ms at 90bpm, there are two cans in the air
at once during eighths, and an overshoot is legible as it happens.

It is a *whole* beat rather than the 1.2 it was first built at, because the
swing below has to meet the cans: a whole beat of flight maps a note on the grid
onto a swing on the grid. A fraction puts every can in his hands while his hand
is somewhere else.

### The rewrite that made it read (DECISION-028)

Everything above was built, screenshotted and shipped, and then failed the only
test that counts: shown the result, the reader could not tell it was a can being
crushed. Three things were wrong, and all three were about *motion*, not art.

**He only moved when he succeeded.** He idled with his arms up and dropped them
for a third of a beat when a can happened to land. So the animation that
explains the game only ever played *after* the player had already done the
thing, and a player who had never crushed a can was shown nothing to aim at.

Now the hand loops to his forehead and back forever, hit or miss, note or no
note. That loop is the instruction: it names the place and the instant a can has
to occupy. It is phase-locked to the authored note grid — one swing per
`strikePeriodBeats`, derived from the tightest gap in the material — so the palm
is down on every grid position a can can arrive at. Quarter-note material gets a
swing a beat; a scenario that drops into sixteenths gets a man working in
sixteenths, which is also an honest picture of what it is asking for.

**The can was never in a place worth crushing.** It rode at bar level, so a
crush was a can at his feet becoming squat. Now a *placed* can rises out of its
bar over its beat of flight into the gap under his palm. The lift is a constant
offset above the can's own lane, which is the whole trick: a can played a lane
high clears his head, a lane low goes past his hip, and the size of the gap is
the size of the interval the player missed by — with no code anywhere that knows
what an interval is.

**Nothing connected the crush to the score.** A crushed can blinked out and the
pile silently incremented. Now it drops from his brow onto the heap, so the
player watches every point they scored land in the thing that becomes the
trophy.

The failure states changed with them. A missed note used to produce *nothing* —
the can riding in simply vanished at the strike line, which is the one outcome
with no feedback at all. Every note now carries a can from the moment it appears
until something happens to it: lifted and crushed, lifted to the wrong height
and sailing past, or never lifted — tipping over and rolling past his boots
while the palm comes down on air.

**Screenshots cannot check any of this.** The swing is phase-locked to the grid,
so a burst of frames at a fixed interval aliases against it and comes back with
his arm in the same position every time; a whole pass was spent debugging a
loop that was working. The geometry is pinned in `tests/repeat-layer.test.ts`
instead, by driving the layer against a context that records where it drew.

A can also rides in every bar that has not reached the strike line yet, which is
the "the note bar is a container" premise made literal: what is coming at you is
visibly a can, and at the strike line it either goes to him or goes where you
actually played.

---

## 6. What this costs in the existing code

`loadScenario` currently assumes every scenario is a `ClimbMinigame`: it calls
`parseClimbBindings` unconditionally, and `parseRoute` **requires one waypoint
per note opportunity**. The four built scenarios carry 93 hand-authored waypoint
coordinates between them.

Proposed:

- Branch `loadScenario` on `minigameClass`. Climb keeps its bindings and its
  route validation exactly as they are.
- Add `parseRepeatBindings` for the smaller REPEAT slot set, and make the route
  optional for classes that have no route.
- **Keep the climb routes.** A waypoint is not a note — it is a *position in the
  scenario art panel*: normalised `x`/`y` plus a `scale` and `rotationDeg` for
  the reused foothold sprite, one per note opportunity, which is what makes "one
  good note = one step" true today. Under this design the actor's position comes
  from the note's lane instead, so the coordinates stop being read. They are
  still the authored record of each route's shape, they still validate, and
  deleting 93 of them on the strength of an untested prototype is not a trade
  worth making. If the actor model survives play, that is when they go.

### What actually happened to the panel

The actor model did survive, and the panel went first. `ClimbMinigame` is
deleted: with the goat on the bars, the class's entire output — waypoint index,
pose, position, wobble, dust — was state nobody drew. `ScenarioStripView` is
`ScenarioBackdropView`, and draws a background, a label and the three-star
meter. `AttemptRuntime` lost its `climb`, its energy events and `deliverEnergy`
with it; a judgment now moves its actor directly.

The **data** stayed, exactly as argued above: all 93 waypoints, the climb
bindings, the climb class parameters. Nothing reads them, the loader still
validates them, and the one-waypoint-per-note check they carry is a real
authoring invariant on the musical content. The nine non-background art files
per Rocky scenario stayed too — they are the canonical slots, and they are what
the actor layer should draw once it stops being primitives.

Files touched:

| File | Change |
|---|---|
| `src/scenario/minigames/timeline-actor.ts` | new — actor state |
| `src/ui/timeline/actor-layer.ts` | new — actor rendering |
| `src/scenario/minigames/repeat-minigame.ts` | new — REPEAT runtime |
| `src/scenario/load.ts` | branch on class; route optional |
| `src/scenario/types.ts` | REPEAT bindings type |
| `src/game/attempt.ts` | own a `TimelineActor`; feed it judgments |
| `src/game/stars.ts` | three-comparison rule (§7) |
| `src/ui/timeline/timeline-view.ts` | draw the actor layer |
| `src/app/game-app.ts` | trophy shelf; wiring |
| `docs/scenarios/can-crushing/` | new scenario JSON |
| `scripts/generate-placeholder-art.mjs` | can + crusher sprites |

---

## 7. Stars and trophies

**Star rule.** `StarMeter.update()` currently takes one number. It would take
two — accuracy points, and accuracy plus streak bonus — and use the right one
per comparison:

| Comparison | Uses |
|---|---|
| 0 → 1 star (45%) | accuracy only. Consistency can never buy a pass. |
| 1 → 2 stars (80%) | accuracy + streak bonus. This is where goats lead to stars. |
| 2 → 3 stars (100%) | accuracy only. Three stars stays a perfection badge. |

The meter is already peak-based and locking, so a star earned can never be lost
— including one earned on a streak that later breaks. That behaviour is
unchanged and is what we want.

The bonus magnitude at the 1→2 boundary is **unresolved**. It needs a number
from play, not from theory.

**Trophy.** One per passed minigame, up to sixteen, on a shelf in the top bar
where the star history is now.

- Size: full at 1 star. Size does not vary — the shelf records results, and the
  live goat already carried consistency during play.
- Ornament: nothing at 1 star, horns at 2, crown at 3.

Built as a goat-head bust on a plinth (`src/ui/trophy.ts`), inline SVG in
`currentColor` so the shelf's existing pass/fail colours keep applying. The
stars that fly from the scenario to the shelf at the end of an attempt now
*build* the trophy as they land: the first raises the bust, the second adds the
horns, the third the crown. That is "goats lead to stars, stars lead to the
trophy" shown rather than explained, and it cost nothing — the flight animation
already fired one callback per star.

---

## 8. Open questions

1. **The streak bonus magnitude.** Needs a real number. Proposal: start at 10%
   of the all-perfect maximum and tune from play.
2. **Does the crusher move in the draft?** Proposed no, hook present.
3. **L7 has no authored material at all.** Unrelated to this design but it is
   the first thing a full run hits, and a run reaching slot 16 currently ends on
   a content limit.
