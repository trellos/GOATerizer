# PROPOSED: The next five scenarios, and the art to build them from

**Status:** Proposed. Not canonical design. Nothing here overrides
`GOATerizer_Game_Design.md` or `GOATerizer_Scenario_Asset_Slot_Bindings.md`.

**Date:** 2026-09-02

> **Update, same day: two of the five are now built.** `ThreeStepMinigame`
> ships, and the triplet slot was filled by **Butt-Butt-BONK** — triplets
> against a wolf, by moonlight — rather than Hop-Hop-LEAP, on the designer's
> instruction. It uses the same two asset packs entry 2 names below, plus the
> backdrop from entry 3 recoloured to night. See `DECISION-048` and
> `docs/scenarios/butt-butt-bonk/`.
>
> **Later update: `PerformMinigame` also ships**, as entry 5's own **Goat
> Frontman**, despite this document ranking it last on the grounds that no
> pack served its expressive-pose needs — see `DECISION-046` and
> `docs/scenarios/goat-frontman/`. §5 below stands as originally written and
> is superseded by that decision. The two entries still not built (entries 3
> and 4, plus the second `BattleMinigame` in entry 1) stand as written.
>
> Worth recording, because it changes entry 1's cost: **alizard's wolf sheet has
> an opaque teal background, not alpha.** It needs the same keying step the birds
> in entry 4 do. One import pass, now written and verified.

Four of the six permanent minigame families have no scenario and no code:

| Family | Musical family | Built? | Where |
|---|---|---|---|
| `ClimbMinigame` | Scale | yes | `src/scenario/minigames/climb-minigame.ts` |
| `RepeatMinigame` | Straight Sixteenths | yes | `src/scenario/minigames/repeat-module.ts` |
| `PerformMinigame` | Blues Lick | **yes** | `src/scenario/minigames/perform-minigame.ts` (Goat Frontman, DECISION-046) |
| `TraverseMinigame` | Scale Run | **no** | — |
| `ThreeStepMinigame` | Triplets | **yes** | `src/scenario/minigames/three-step-minigame.ts` (Butt-Butt-BONK, DECISION-048) |
| `BattleMinigame` | Sixteenth Phrases | **no** | — |

Five scenarios were proposed below when this document was written: one per
unbuilt family, plus a second `BattleMinigame` that costs almost no new art.
Two of the five families (`ThreeStepMinigame`, `PerformMinigame`) are now
built, though not always with the exact scenario proposed here — see the
update note above. They were ranked by the only criterion that separates
them — **whether usable pixel art actually exists online under a licence
this repository can accept.**

Every asset named here was fetched and inspected from this environment on
2026-09-02: licence page read, file downloaded, dimensions and frame layout
measured, sprite viewed. Nothing below is a search result taken on trust.

---

## 0. The network policy changed, and that is why this document exists

`docs/assets/ASSET_SOURCES.md` records that `itch.io` and `opengameart.org`
were unreachable, and that all shipped art was therefore drawn by
`scripts/generate-placeholder-art.mjs` rather than sourced. **That is no longer
true.** Both hosts now return 200, files download, and the licence pages read.

That is the whole reason external art is on the table for these five, and it
also unblocks the swap-in plan already recorded for the Rocky family. See §6
for what re-verification turned up there, including one thing the recorded plan
gets wrong.

---

## 1. Wolf Pack — `BattleMinigame` (Sixteenth Phrases), GOATS

Catalogue entry: `GOATerizer_Scenario_Asset_Slot_Bindings.md` §3, GOATS →
Sixteenth Phrases. Supported L1–7. `duel`. 1m tiered rounds at L1–4, 4m
continuous at L5–7.

**Why this one first: the slot schema and a standard enemy sprite sheet are the
same shape.** `threatPosesOrStates[]` wants baseline / encroaching / losing
ground / humiliated. Practically every free enemy sheet ever published ships
idle, attack, hurt, death. The mapping needs no invention.

| Slot | Source | Licence | What lands there |
|---|---|---|---|
| `threatPosesOrStates[]` | [pixel wolf](https://opengameart.org/content/pixel-wolf), alizard | **CC0** | `wolf_run.png` 330×66, 5 frames of 66×66 — side profile, drawn running left-to-right. Frames 1–2 baseline, 4–5 encroaching. `wolf_jump.png` 4 frames → lunge/attack. `wolf_sit.png` 4 frames is a standing→sitting transition: **a wolf that sits down is the humiliated state, already drawn.** |
| `heroPoses[]` | [Pixel Art Enemies — Axe Throwing Goat or Ram](https://opengameart.org/content/pixel-art-enemies-axe-throwing-goat-or-ram-axe-throwing-monkey-or-ape-walking-pig), Spring Spring | CC-BY 3.0 / CC-BY-SA 3.0 / OGA-BY 3.0 / **CC0** (pick CC0) | `goat or ram_strip5.png` 275×51, 5 frames of 55×51. A **bipedal, armoured, axe-throwing ram**, side view. Five frames for four hero poses — ready / attack / evade / finisher — with one spare. |
| `impactEffects[]`, `powerEffects[]`, `debrisEffects[]` | [Free Pixel Effects Pack](https://opengameart.org/content/free-pixel-effects-pack), CodeManu | **CC0**, README says "No credit required" | 20 sheets, 100×100 frames. `10_weaponhit` (6×6) → impact; `9_brightfire` (8×8) → power; `5_magickahit` → debris. Take one frame each — the runtime treats sprites as static billboards. |
| `background` | [Pixel Art Mountains Parallax](https://opengameart.org/content/pixel-art-mountains-parallax), DustDFG (Yevhen Babiichuk) | **CC0**, ships its own `CC0.txt` | 8 separate layers at 160×80: sky, two mountain ranges, valley, two cloud layers, two tree layers. Flatten to one 384×216 backdrop at 2.4× nearest-neighbour. |
| `completionStates[]` | — | — | Composed, per production rule 5. No new art. |

**Every slot is CC0.** No attribution is legally required anywhere in this
scenario, though `ASSET_SOURCES.md` records it regardless (`AGENTS.md` §11).

**Two things it unblocks beyond the family.** The drum ladder's **sixteenth
variant is built, tested and has never been heard** because no scenario authors
sixteenths (`docs/IDEAS.md`, "Nothing selects the sixteenth or triplet drum
variant"). This is the family that fixes that. And at L1–7 it can carry the
first **L7** content in the game, closing the second gap in the same list.

**Design work it forces, in a good way.** The threat closes in *along the
timeline* — start it at x ≈ 1 and walk it toward `strikeX` as dominance shifts,
so distance on screen is threat (`GOATerizer_Minigame_Authoring.md` §5). The
1m-round / 4m-continuous split is an `onMeasure` decision the host does not
make, so this scenario is also the first real exercise of that boundary.

---

## 2. Hop-Hop-LEAP — `ThreeStepMinigame` (Triplets), GOATS

Catalogue entry: GOATS → Triplets, the entry the doc itself calls "the
canonical triplet visualization". Supported L1–7.

**Why: one asset pack contains the A/B/C triple as three separate, already-drawn
actions.** This is the only found art that fills `stepAPoseOrEffect` /
`stepBPoseOrEffect` / `stepCPoseOrEffect` without editing a sprite.

[Mountain Goat Sprites](https://opengameart.org/content/mountain-goat-sprites)
by **Sevarihk**, **CC-BY 4.0** (the one non-CC0 recommendation here; the pack
carries a Copyright/Attribution Notice, so credit it in `ASSET_SOURCES.md`).

Sheets are 252×252, RPG-Maker layout: 4 directions × 4 frames of 63×63. **Rows
2 and 3 are left- and right-facing side profiles**, which is what the timeline
needs — confirmed by inspection, not assumed from the format.

| Slot | File | What lands there |
|---|---|---|
| `stepAPoseOrEffect` / `stepBPoseOrEffect` | `bergschaf-laufanimation-m.png` | Two walk frames — the two little hops. |
| `stepCPoseOrEffect` | `bergschaf-bocksprung-m.png` | *Bocksprung* is German for a goat's leap. A horned ram in mid-air, side profile. This is step C, drawn, named, and free. |
| `alternateStepC[]` | `bergschaf-lookup-m.png` | Head-raise — the mutated phrase ending. |
| `finishPose` | `bergschaf-grasend-m.png` | Grazing: the resolved, job-done pose. |
| `targetVisuals[]` | karsiori [Rock Pile Pack](https://karsiori.itch.io/pixel-art-rock-pile-pack) (CC0) | The thing being leapt to. |
| `minorStepEffects[]` / `majorStepEffects[]` / `groupEffects[]` | CodeManu (CC0) | Small hit, big hit, group accent. |
| `background` | DustDFG or karsiori (CC0) | Shared with §1 and §3. |

Four goat variations ship in the pack (white/brown × small/large horns), so
`Herd Bound` or `Triple Hoofbeat` later cost no new download.

**It lights up the other unheard drum rung.** The **triplet** variant has the
same never-been-played status as the sixteenth one. Author this and §1 and both
rungs are heard.

**Note for the author:** `arc()` is already shipped for exactly this family, and
the A/B/C role must be derived from each note's position within its beat, not
from `index % 3` (`GOATerizer_Minigame_Authoring.md` §5). Author triplets as
`duration: "eighthTriplet"`.

---

## 3. Cliff Switchbacks — `TraverseMinigame` (Scale Run), GOATS

Catalogue entry: GOATS → Scale Run. Supported L1–7.

**Why: "side-scrolling run cycle over a parallax mountain" is the most
over-supplied category in free pixel art.** The risk here is choosing, not
finding.

| Slot | Source | Licence | Note |
|---|---|---|---|
| `travelerPoses[]` | Mountain Goat Sprites, Sevarihk | CC-BY 4.0 | The walk sheet's side row is **exactly four frames**, and the slot asks for exactly four. Shared with §2, so no second download. |
| `finishPose` | same pack, `bergschaf-down.png` | CC-BY 4.0 | A resting/downed goat — the controlled stop. (The pack also ships a `-gore` variant; ignore it.) |
| `background` | karsiori [FREE Pixel Art Mountains Tileset and Backgrounds](https://karsiori.itch.io/free-pixel-art-mountains-tileset-and-backgrounds) | **CC0**, name-your-own-price | 4 parallax layers at **768×288** — twice the resolution of the DustDFG pack and already the recorded intended source for Rocky Ascent. Plus 120 32×32 tiles and 31 decorations. |
| `waypointVisuals[]` / `hazardVisuals[]` | karsiori Rock Pile Pack (CC0) + the tileset's rocks and trees | CC0 | One sprite instantiated many times, per §1.3. |
| `travelEffects[]` / `nearMissEffects[]` | Spring Spring [Dust Animation](https://opengameart.org/content/dust-animation) + CodeManu | CC0 | One frame each, never the animation. |

**The interesting half is placement, not art.** Per the authoring brief, hazards
go at beat positions *between* notes, so the phrase's rests become the dangerous
gaps. That is a scenario-data decision and needs no new code.

**Cheap follow-ons in the same family, same art:** `Herd Slalom` (the waypoints
are other goats — duplicate instances of a sprite already downloaded, zero new
files) and `Canyon Descent` (the same run cycle, mirrored, L1–7).

---

## 4. Golden Eagle — `BattleMinigame` #2, GOATS

Catalogue entry: GOATS → Sixteenth Phrases. Supported L1–6.

**Why a second Battle rather than a fifth family: there is no fifth unbuilt
family, and this one costs almost nothing.** Hero poses, effects, background and
all the class code come from §1. Only the threat is new.

| Slot | Source | Licence | Note |
|---|---|---|---|
| `threatPosesOrStates[]` | [Animated Birds (32×32)](https://opengameart.org/content/animated-birds-32x32), MoikMellah | **CC0** (relicensed from CC-BY in 2014) | 192×64 sheet, two raptors × 5 frames. Verified by eye: birds of prey, wings through a full beat. **Caveat: magenta is the transparency key and must be stripped** — a one-off preprocessing step, not a runtime one. |
| alternative | [\[LPC\] Birds](https://opengameart.org/content/lpc-birds), bluecarrot16 | CC-BY 4.0 / CC-BY-SA / GPL / OGA-BY | 15 birds including a **literal eagle**, 32×32, fly and walk in 4 directions. Take the CC-BY 4.0 option; avoid the SA and GPL options, which would reach further than art. Requires a link back to the OGA page. |
| everything else | §1 | CC0 | Reused. |

**It is a different shape of threat, which is the point.** The wolf closes in
horizontally along the timeline; the eagle dives from above the lane band
(`y < 0`). Two scenarios in one family that do not look alike is the cheapest
available evidence that the family is a family and not a scenario with extra
steps.

---

## 5. Goat Frontman — `PerformMinigame` (Blues Lick), GOATS

> **Built, DECISION-046.** Goat Frontman shipped — see
> `docs/scenarios/goat-frontman/` and `docs/assets/ASSET_SOURCES.md`. The
> analysis below is kept as the record of why it was ranked last, not as a
> live proposal.

Catalogue entry: GOATS → Blues Lick. Supported L2–6.

**Ranked last, and honestly: `PerformMinigame` is the one family found art does
not serve well.** The recommendation is still to build it — it is a permanent
family and something has to be first — but go in knowing the art will be the
weak part, or plan to draw it.

**Why it is hard.** The slot schema wants `performerPoses[]` ×4, plus a slur
pose, a bend pose, and a finish pose — **seven distinct expressive poses of one
character** — plus two audience states. Free packs ship *locomotion and combat*
vocabularies (idle, walk, run, jump, attack, hurt, die). Nobody publishes a free
"strut, preen, rear back like a stadium-rock singer" set. I searched
OpenGameArt, itch.io's CC0 tag and Kenney; there is no pack that fills this
without drawing.

**What genuinely does work:**

| Slot | Source | Note |
|---|---|---|
| `audienceStates[]` | Mountain Goat Sprites, Sevarihk (CC-BY 4.0) | The pack ships **bust portraits and 24×24 head icons in four goat variants** — these land directly on neutral/impressed, and the herd is duplicated instances of one sprite, exactly the §1.3 production rule. This slot is genuinely solved. |
| `performerPoses[]` | same pack | Grazing, head-up, head-down, leap and rest give about five distinguishable side-profile poses. Enough to read as *changing*; not enough to read as *strutting*. |
| `flourishPoses[]` | — | The real gap. `bocksprung` can carry the bend; the slur has no honest candidate. |
| `signatureProps[]` | [Kenney](https://kenney.nl/assets/tag:pixel) — every pack CC0 1.0 | A microphone, bell or amp from the pixel packs. |
| `flourishEffects[]` / `accentEffects[]` / `payoffEffects[]` | CodeManu (CC0) | This pack is *strongest* here — 20 showy magic/burst effects, which is what a flourish wants. |

**Two ways to proceed, both defensible.** Build it with what is above and accept
that the performer reads as under-animated; or note that the catalogue
explicitly permits `audienceStates[]` to be **unbound** for some Perform
scenarios (`Beard in the Wind`, `Salt Ecstasy`) and pick one of those instead,
letting effects and a prop carry the escalation the poses cannot. The second is
less art for a more coherent result.

---

## 6. What re-verifying the recorded Rocky sources turned up

`ASSET_SOURCES.md` lists five intended-but-unshipped sources for the Rocky
family. All five are now reachable and their licences read as recorded — with
one exception that matters:

> **`spring_goat_ram` is not a quadruped goat.** The recorded plan is to use
> "frames 1–4 of `goat or ram_strip5.png` as the pose cycle, frame 5 as the
> finish pose" for `goat_rocky_ascent_advance_*`. The strip is a **bipedal
> armoured ram warrior throwing an axe**, 55×51. Swapping it in as recorded
> would put an axe-throwing goat-man on the climbing bars.

That art is good and this document uses it — as the **hero of `Wolf Pack`**,
where a bipedal fighting ram is exactly right. It is the wrong sprite for the
climb. The quadruped the Rocky swap-in actually wants is Sevarihk's Mountain
Goat pack (§2), at the cost of CC-BY attribution instead of CC0.

Suggested follow-up, out of scope here: correct that row in `ASSET_SOURCES.md`
and re-date the "cannot reach itch.io or opengameart.org" paragraph, which is
now false and is load-bearing for how someone reads the whole file.

---

## 7. Cost, and what a family actually touches

Adding a family touches `src/scenario/registry.ts` and nothing else in the host
(`AGENTS.md` §3; DECISION-043). Not `types.ts`, not `load.ts`, not `attempt.ts`,
not `game-app.ts`. For scale: `climb-minigame.ts` is 306 lines and
`repeat-module.ts` is 296.

Per scenario the work is: one module implementing `MinigameModule`, one authored
`docs/scenarios/<id>/<id>.scenario.json`, the art under
`public/assets/scenarios/<id>/`, one `registerMinigame` call, one entry in
`SCENARIOS`, and rows in `ASSET_SOURCES.md`.

Suggested order — it is not the ranked order, because §1 and §2 share nothing
but §2 and §3 share an asset pack:

1. **Wolf Pack** — all-CC0, best structural fit, unlocks the sixteenth drum rung.
2. **Hop-Hop-LEAP** — unlocks the triplet drum rung; pulls in the goat pack.
3. **Cliff Switchbacks** — reuses that goat pack; adds only backgrounds.
4. **Golden Eagle** — one new sprite on top of §1.
5. **Goat Frontman** — last, and budget for drawing rather than sourcing.

## 8. Every source, with what was verified

| Source | Author | Licence | Verified |
|---|---|---|---|
| [pixel wolf](https://opengameart.org/content/pixel-wolf) | alizard | CC0 | page read; 4 sheets downloaded; 66×66 frames confirmed; sprites viewed |
| [Pixel Art Enemies — Goat or Ram](https://opengameart.org/content/pixel-art-enemies-axe-throwing-goat-or-ram-axe-throwing-monkey-or-ape-walking-pig) | Spring Spring | CC0 option | page read; strip downloaded; 275×51 / 5 frames; viewed (bipedal — see §6) |
| [Mountain Goat Sprites](https://opengameart.org/content/mountain-goat-sprites) | Sevarihk | CC-BY 4.0 | page read; 5 sheets downloaded; 252×252 = 4×4 of 63×63; side rows confirmed by eye |
| [Free Pixel Effects Pack](https://opengameart.org/content/free-pixel-effects-pack) | CodeManu | CC0 | page read; zip downloaded; 20 sheets + README; 100×100 frames confirmed |
| [Pixel Art Mountains Parallax](https://opengameart.org/content/pixel-art-mountains-parallax) | DustDFG | CC0 | page read; zip downloaded; 8 layers at 160×80; bundled `CC0.txt` |
| [FREE Pixel Art Mountains Tileset](https://karsiori.itch.io/free-pixel-art-mountains-tileset-and-backgrounds) | karsiori | CC0 | page read; 4 layers at 768×288, 120 tiles, 31 decorations |
| [Pixel Art Rock Pile Pack](https://karsiori.itch.io/pixel-art-rock-pile-pack) | karsiori | CC0 (as recorded) | already recorded in `ASSET_SOURCES.md`; host reachable |
| [Animated Birds (32×32)](https://opengameart.org/content/animated-birds-32x32) | MoikMellah | CC0 | page read; sheet downloaded; 192×64 = 2×5 of 32×32; viewed; magenta key noted |
| [\[LPC\] Birds](https://opengameart.org/content/lpc-birds) | bluecarrot16 | CC-BY 4.0 among others | page read; eagle confirmed present; link-back required |
| [Kenney](https://kenney.nl/assets/tag:pixel) | Kenney | CC0 1.0 | licence confirmed across packs |
| [Dust Animation](https://opengameart.org/content/dust-animation) | Spring Spring | CC0 (as recorded) | already recorded in `ASSET_SOURCES.md`; host reachable |

Nothing here is hotlinked at runtime; every file would be committed under
`public/assets/` with provenance in `ASSET_SOURCES.md`, per `AGENTS.md` §11.
