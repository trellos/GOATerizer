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

### Nothing selects the sixteenth or triplet drum variant

Each rung now has four feels — quarters, eighth, sixteenth, triplet — chosen
from the authored notes (DECISION-031, revised by DECISION-033). Current
material only ever produces the first two, because it tops out at eighths. The
sixteenth and triplet patterns are built, tested and unheard; one scenario
authored in each would light them up. Note the content rule the loader test
enforces: a level must not test both.

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
