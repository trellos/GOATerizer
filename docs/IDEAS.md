# Ideas and open threads

The backlog for things noticed while *playing* — iterations, rough edges, and
work that was deliberately left undone. It exists because a long session gets
summarised and an idea mentioned in passing can quietly fall out of it; a file
in the repo does not.

## How this is used

Say the idea whenever it occurs, in whatever words. It gets written down here
with enough context to act on later — what was observed, what it would touch,
and why it is not already done.

Two words are worth using, because they change what happens to work already in
flight:

- **"add"** (the default) — a new entry. Nothing in progress is affected.
- **"replace"** or **"instead"** — this supersedes something. If work is already
  running on the old version, say so and it gets stopped rather than finished
  into a drawer. This is the only thing in the process that actually wastes
  effort; parallel work does not.

Entries are struck through and dated rather than deleted, so a rejected idea
does not come back round as a new one.

---

## Open — content gaps behind finished systems

These are all cases where the machinery exists, is tested, and has nothing to
run on. They are cheap to close and each one lights up something already built.

### Nothing selects the sixteenth drum variant

Each rung now has four feels — quarters, eighth, sixteenth, triplet — chosen
from the authored notes (DECISION-031, revised by DECISION-033). Current
material only ever produces the first two, because it tops out at eighths. The
sixteenth and triplet patterns are built, tested and unheard; one scenario
authored in each would light them up. Note the content rule the loader test
enforces: a level must not test both.

**Half closed, 2026-09-02 (DECISION-048).** Butt-Butt-BONK authors triplets at
L1-6, so the triplet variant is now selected by real content and
`tests/subdivisions.test.ts` asserts it comes from exactly one scenario. The
**sixteenth** variant is still unheard: nothing authors a sixteenth, and the
obvious candidate is a `BattleMinigame` scenario, whose whole musical family is
sixteenth phrases.

### Nothing authors difficulty 7

The run's difficulty sequence ends on L7 and no scenario has L7 data, so a run
that gets that far ends as a *content limit*. The drum ladder's top rung
("rage") is written and unheard for the same reason. Related: the ladder is not
monotonic in note count — the `_high` scenarios sit two levels above the normal
ones and reuse their phrase tables, so the densest material in the game is an
L4.

### Drum rungs 6–7 are still unmeasured, though no longer unprotected

There is now a soft clipper on the master (DECISION-033), so a loud rung cannot
square off the output the way it could. But rungs 6–7 have still never been
*heard*, because nothing authors those difficulties — worth measuring against
pinned L6/L7 content once it exists, to check they read as an escalation rather
than as the clipper working harder.

---

## Open — design decisions parked

### The G string can only ever offer one hand position

Not a fingering-table problem (DECISION-032): the low root must be *on* the root
string and the lane pitches are fixed, so the root has exactly one possible fret
per string — `tonicMidi - openString`. With `LOWEST_TONIC_MIDI = 45` pinning
tonics to A2..G#3, that fret is negative on the G string in 20 of 24 keys.
Raising it means moving the register the whole game is written in, and every
scenario's material with it. A real decision, not a bug, and not one a fingering
picker should force.

### The can crusher never moves

`RepeatMinigame`'s performer stands at one lane for the whole attempt, which
forces Can Crushing's material to be entirely one pitch — so its levels escalate
by rhythm alone. The design allows him to step between measures, telegraphed by
walking during the preceding one, and the hook exists. That relaxes the
authoring constraint to "one lane per measure" and is the first thing worth
building on that class.

### A wrong-lane can and an unplaceable can look alike

A can played on the wrong lane and a can from an off-scale pitch are both the
same sprite; only a wobble separates them. The distinction is doing real
diagnostic work — one says "you overshot by a third", the other says "that was
not in the key" — and now that the cans are sprites (DECISION-036) the obvious
answer is a second one in a different colour rather than a rotation.

---

## Open — from the first real-guitar playtest

### One-pitch material still slides under a shifted performance

The Good-window floor (DECISION-038) fixed judging for a player whose rig is
late, on every material where the *pitch* moves — pitch is what stops a shifted
note being handed to its neighbour. Can Crushing is a single pitch for a whole
attempt, so it has nothing to disambiguate with, and attribution slides by one
note. Measured at 0.3 beats of lateness: four failures in forty-eight, both at
seams where the rhythm changes, against forty-eight before the floor.

Not obviously worth fixing — two dropped streaks an attempt is a long way from
unplayable — but if it is, the lever is the resolver preferring a target the
note is *late* for over one it is early for, since players run late far more
often than early. That is a real tuning decision and wants its own playtest.

### The player has no way to see they are playing late

The whole failure above is invisible from inside: to a player with 200ms of
uncompensated latency, they are dead on the beat. The timing check exists for
exactly this and now offers a trim to far more people (its spread threshold was
a session player's), but nothing in the *run* ever suggests visiting it. A
"your notes are landing 180ms late — the timing check can fix that" nudge after
an attempt that scored badly on timing alone would close the loop.

**There is already a written answer for half of this**, on the deleted branch
`claude/tuninator-experimental-recognition-lcrsuv` and recoverable from
`055d4f4`: `nearestPitchDelta`, which records how far a played note fell from
the nearest target *of its pitch* while ignoring every window. Samples taken
from resolved notes are truncated at the Good window by construction, so on a
rig sitting further out than that window the timing log stays empty and the
median it does report is biased toward zero — the instrument built to find a
large offset is blindest to exactly that. Deliberately not ported alongside
DECISION-040, because it is a second mechanism and a branch cleanup is not the
place to land one.

### The frame loop costs about 16% more than it did

Measured interleaved on one machine, pre-session `main` against this branch:
98–103 fps versus 84–86. That is the art work of this session, and most of it
is one deliberate decision — the goat is 2.4x bigger, which is 6x the pixels
blitted every frame. Our own JavaScript is not the problem: frame work p95 is
1.3ms against an 11ms frame.

It matters because the browser suite's `not capped at 60fps` check has a
threshold of 90, chosen when the container ran at 198. It now fails at ~85
while `main` passes at ~100 — so on this hardware the check has quietly become
a relative-performance detector rather than the vsync-cap assertion it says it
is. Two honest options, and they are not the same: re-aim the check at what it
claims (comfortably above 60, with the separate 4ms frame-work budget doing the
real work), or spend the frame back. The pile of crushed cans is the obvious
first place to look — up to 24 sprites, each with its own save/rotate/scale,
drawn every frame for a whole attempt.

Deliberately not fixed by lowering the threshold in the same change that caused
the regression.

## Open — untested in the real world

### No physical guitar has been played against this build

Browser validation drives the deterministic provider, and separately asserts the
production path reaches `listening` through Tuninator against a fake capture
device. Everything about feel — latency trim, timing windows, whether the duck
reads as supportive or as nagging — is unverified against an actual instrument.

### A run is now about six minutes and has not been played end to end

An attempt plays its phrase twice (DECISION-029), so a full 16-slot run roughly
doubled, from about three minutes to six at 90bpm. Whether that is the right
length for a sitting is a play question, not a code one.

### Release detection on the live path

The bass duck counts a correctly-timed note *release* as evidence of control
(DECISION-030), and releases now reach judgment for the first time. If Tuninator
turns out not to deliver reliable releases from a real guitar, nothing breaks —
the duck simply recovers on attacks alone, one rung per note instead of two. But
it is unmeasured. There is also one documented hole: a note released *before* a
late `retune` promotes it from wrong to hit never reports a release, costing one
rung.

---

## Open — art that is now one pass in, not finished

### The crusher is still primitives, and now he is the crude thing on screen

The cans became sprites (DECISION-036) and he did not, because his swing is a
solved pose no fixed sprite could hold. That was the right call and it has a
cost: he is a stick figure standing next to a piece of real pixel art, and the
gap got wider rather than narrower. The honest fix is a limb-segment sprite set
driven by the same IK — arm, forearm, torso, head — rather than a pose cycle.

### A big goat overhangs the strike line

The actor is anchored a fixed 34px left of the line, and that number is from
when it was half a lane row tall. It is now up to about 110px wide, so at a
capped streak the body overhangs the line by roughly 21px at rest and 34px at
the bottom of a heavy landing — about a fifth of a beat of read-ahead, sitting
under the most attention-stealing object on screen. `actor-layer.ts` rule 1
used to claim this could not happen.

The fix is to anchor on the body's **right edge** rather than its centre, so
the overhang is a constant margin at every size. That is a one-line change and
a deliberate composition decision — the goat would then stand further left as
the streak builds — so it is a question rather than a job. Dust is already
clamped and does not cross.

Two other things also cross: the impact ring, which is a 1–2px stroke and
probably fine, and the streak sparks.

### The art network policy changed, and two recorded facts went stale with it

`docs/assets/ASSET_SOURCES.md` states that `itch.io` and `opengameart.org` are
"refused by the network policy", and that is the stated reason every shipped
asset is drawn by `scripts/generate-placeholder-art.mjs` rather than sourced.
Re-tested 2026-09-02: both return 200, files download, licence pages read. The
paragraph is load-bearing for how someone reads that whole file, so it wants a
correction and a date rather than a quiet deletion.

Found while re-verifying the recorded swap-in list, which turned up a second
thing: **`spring_goat_ram` is not a quadruped goat.** The plan on record is to
use "frames 1-4 of `goat or ram_strip5.png` as the pose cycle" for
`goat_rocky_ascent_advance_*`. Downloaded and viewed, the strip is a bipedal
armoured ram throwing an axe, 55x51. Swapping it in as recorded puts an
axe-throwing goat-man on the climbing bars. The art is good and wants using —
as a fighting hero, not a climber — and the quadruped the Rocky swap actually
wants is Sevarihk's Mountain Goat pack, at the cost of CC-BY attribution
instead of CC0.

Both sit behind `docs/game-design/PROPOSED_Next_Families.md` (DECISION-047),
which is where the re-verification was done and where the full provenance table
lives.

### The browser suite still asks L4 for eighth notes

DECISION-049 re-pinned the unit tests to the Scale content redo, which moved
Rocky Ascent's eighth-note material from L3/L4 up to L5/L6. `npm run
validate:browser` was not re-pinned with them, so two of its checks — "L4's
eight eighth notes take about four beats" and "L4 is denser than L1" — now fail
on `main` describing content that no longer exists there. Same staleness, same
fix: read the assertion's intent and point it at L5/L6.

(The third failure in the same run, "the frame loop is not capped at 60fps", is
the headless container rendering on the CPU with vsync disabled, not the game.)

### The frontman is the least visible thing on his own stage

Noticed the first time Goat Frontman actually drew its sprites (DECISION-050).
The crowd is white goats on a dark stage floor and reads instantly; the
performer is a dark goat on the same floor, lit from behind by the backdrop's
own spotlights, and at a glance the eye finds the crowd and the mic stand before
it finds him. He is the subject of the scenario and currently its faintest
object.

Nothing is wrong with the placement — he stands where the class puts him and the
crowd grows around him correctly. It is a value problem in the art:
`goat_goat_frontman_perform_*` want a rim light or a lighter body, or
`bg_goat_frontman` wants to be darker where he stands. Both are one pass in
`scripts/lib/frontman-art.mjs`.

### The ram snaps back after every headbutt

Butt-Butt-BONK's leap is an `arc()` toward the wolf that holds for a third of a
beat and then stops being drawn, so the ram is back at its resting spot on the
next frame — it lunges in and teleports out. It was invisible until the sprites
drew (DECISION-050) and it is a real gap in the gesture: the family owns its own
motion (`minigame/api.ts`, **Motion**), so the fix is a return arc, or holding
the landed position until the next note rather than for a fixed span. Worth
doing next to whatever pass gives the wolf a reaction bigger than swapping to
its bonked frame.

## Closed

### The gate sets itself, as early as there is signal — built, 2026-08-31 (DECISION-035)

"It does it during gameplay and not once it starts receiving a signal? I play a
lot during the pregame screen." The measurement was already running from the
first frame — 242ms after the click, on pregame — so the stated mechanism was
not the problem. The report was still right about the feature: **Use my level**
stored the gate and never gave it to the recognizer, because the provider switch
early-returns when the source is already the one running. Measured, not read:
across an apply the recognizer's state never left `listening`.

Now forced, and now automatic — the gate sets itself in pregame once there is
enough playing behind it, ~4.7s after the mic opens, and says so. Either button
hands control back for the session.

Still unvalidated against a real guitar, and now with more riding on it: the
thresholds that decide to move a player's gate *without being asked* are
reasoned, not measured on the rig that motivated any of this.

### Auto-calibrating the input level — built, 2026-08-29 (DECISION-034)

"I have to turn up the gain on my audio interface for it to recognize notes."
My first answer was half wrong and is worth keeping as a correction: I said the
problem was not auto-calibratable, because a software gain stage cannot improve
signal-to-noise. The gain half of that is true. The conclusion was not — the
thing to calibrate was never the *gain*, it was Tuninator's amplitude **gate**,
which is a real `EngineTuning` option this repo simply never passed.

The player's own argument settled it: their amp sim reads the same signal
perfectly, because a sim only amplifies and has no gate to fail. Tuninator's gate
is `min(rmsGate, noiseFloor × 200)` — a cap, not a floor — so on any rig whose
noise floor is above about 4e-5 it binds at the flat 0.008 default, no matter how
clean the signal underneath is.

Still open from the same thread: the **2-in interface** case is *not* the cause
here — Tuninator sums rather than averages its channels, explicitly to avoid the
6 dB loss, so a guitar on input 2 arrives at full level. Per-channel RMS and the
selected channel are now shown in pregame anyway, since that is the one failure
that otherwise looks exactly like a dead detector.
