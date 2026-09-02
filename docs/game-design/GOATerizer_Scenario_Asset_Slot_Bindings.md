# GOATerizer Scenario Asset Slot Bindings

This document reconciles the existing **GOATerizer Complete Scenario Asset Catalog** with the parameterized six-class minigame architecture.

It answers, for every scenario:

1. **Which minigame class owns the scenario?**
2. **What is its visual measure span?**
3. **Which exact existing asset IDs bind to which class slots?**
4. **Which scenario-specific mode parameters matter?**

The asset IDs below preserve the existing catalog. This document does **not** create new artwork. It only makes the runtime binding explicit.

---

## 1. Runtime Classes

> ### The surface changed. The bindings did not.
>
> This document was written when a minigame drew into its own panel above the
> timeline. There is no panel. **The minigame draws the timeline** — it supplies
> the background behind its own measures, skins the note bars the host lays down,
> and puts its actors on those bars. See
> [`GOATerizer_Minigame_Authoring.md`](./GOATerizer_Minigame_Authoring.md) for the
> contract and the coordinate space, and GDD §11 for the geometry.
>
> Three consequences for everything below:
>
> - **Every scenario premise and every asset ID here is still correct.** What each
>   slot *is* changed; what art it names did not. Nothing in §3 needs rewriting.
> - **Slots that described positions in a panel are gone.** `route` waypoint
>   coordinates in particular: the note bars are the footholds, so the host's note
>   geometry supplies every position an actor could want. Do not author routes.
> - **"Minigame Class" here means a family, not a base class.** A minigame is a
>   `MinigameModule` implementing the `Minigame` interface (`src/minigame/api.ts`);
>   the six names below are the six families that interface serves, and a seventh
>   needs no change to the host.
>
> §2 below annotates each family's canonical slots with what they become on the
> timeline. §5 of the authoring brief carries the same table with more room.

| Musical Family | Minigame Class | Visual Verb |
|---|---|---|
| Scale | `ClimbMinigame` | CLIMB |
| Blues Lick | `PerformMinigame` | PERFORM |
| Scale Run | `TraverseMinigame` | TRAVERSE |
| Triplets | `ThreeStepMinigame` | THREE-STEP |
| Straight Sixteenths | `RepeatMinigame` | REPEAT |
| Sixteenth Phrases | `BattleMinigame` | BATTLE / SURVIVE |

### Slot reconciliation

The parameterized behavior spec originally defined deliberately broad slots such as `climberPoses[]`, `effects[]`, and `threatPosesOrStates[]`. The asset catalog is more specific. This document therefore uses **semantic subslots** such as `finishPose`, `nearMissEffects[]`, `debrisEffects[]`, and `powerEffects[]`.

These do not require more runtime families. A minigame parses its own `config`
— the host passes it through as `unknown` and never reads it — so a family is
free to name these slots however it likes, as named fields or as typed entries
inside the generic arrays.

### Optional reaction slots

Four existing `PerformMinigame` scenarios deliberately do not contain reaction-state art:

- GOATS — **Beard in the Wind**
- GOATS — **Salt Ecstasy**
- KAIJU — **Tail Swagger**
- KAIJU — **Atomic-Breath Flourish**

For these, `audienceStates[]` is explicitly **unbound**. Performance escalation is carried by the performer, signature prop, and flourish effects instead.

### Measure scope

`Visual span` comes from the parameterized minigame behavior spec:

- **1m**: visual-cycle-local state resets after each measure.
- **2m**: two visual cycles per four-measure attempt.
- **4m continuous**: one visual arc lasts the full attempt.
- Battle scenarios may use **1m tiered rounds at easier levels** and **4m continuous battles at harder levels**.

Attempt-global score, thresholds, star tier, and explicitly persistent spectacle survive visual-cycle resets.

Visual span is the minigame's own decision, taken in `onMeasure(index, beat)`.
The host does not enforce it: it scrolls four measures of notes per attempt and
asks the minigame to render every frame, and whether that reads as one arc or
four rounds is entirely what the minigame draws.

---

## 2. Canonical Slot Schemas

Each family's slot list is unchanged. The note under it says what the slot
becomes now that the minigame draws the timeline rather than a panel. Three rules
are shared by all six:

- **`background`** is `Stage.background`: one image behind exactly the measures
  this minigame owns, fit to the lane band's height and tiled horizontally. It is
  not a cover-fit panel image and it does not span the screen — the previous
  minigame's background is still on the left while yours scrolls in.
- **Anything named a *visual* on a note** — waypoints, targets, hazards standing
  on the beat — is **note art**, supplied through `Stage.notes` as
  `underlay`/`body`/`overlay`. The host owns the bar's geometry (a sixteenth is a
  quarter of a quarter's width); you skin it. Art larger than the bar is drawn
  centred on it, so glows and ornaments need no extra slot.
- **Anything named a *pose* or an *effect*** is a sprite in normalised
  coordinates: x across the playfield, y across the lane band, both free to leave
  0..1. Anchor it to a note (`view.notes[i].rect`) or to `view.strikeX`.

### `ClimbMinigame`

`background`, `climberPoses[]`, `finishPose`, `waypointVisuals[]`, `destinationVisual`, `stepEffects[]`

The bars **are** the footholds: `waypointVisuals[]` is note art, and
`climberPoses[]`/`finishPose` are one sprite anchored to the note the climber
stands on. `destinationVisual` sits at or just past the last note.
`stepEffects[]` fire at the note that was judged. **Authored `route` data —
`startPosition`, `destination`, per-waypoint coordinates — is deleted**; it
described positions in a panel, and the notes now supply every coordinate.

### `PerformMinigame`

`background`, `performerPoses[]`, `flourishPoses[]`, `finishPose`, `signatureProps[]`, optional `audienceStates[]`, `flourishEffects[]`, `accentEffects[]`, `payoffEffects[]`

The performer is not note-anchored: hold it near `strikeX`, where the player is
already looking, and swap `performerPoses[]`/`flourishPoses[]` on judgment.
`signatureProps[]` ride the performer. `audienceStates[]` go **below the band**
(`y > 1`) across your own span and change at star thresholds — which is why the
four scenarios that leave them unbound lose nothing. `payoffEffects[]` fire from
`onStarEarned(3, …)`, `accentEffects[]` at the judged note.

### `TraverseMinigame`

`background`, `travelerPoses[]`, `finishPose`, `waypointVisuals[]`, `hazardVisuals[]`, `travelEffects[]`, `nearMissEffects[]`

As CLIMB, faster: `waypointVisuals[]` are note art and the traveler moves bar to
bar. `hazardVisuals[]` are the family's own idea — place them at beat positions
*between* notes, so the phrase's rests are the gaps that can be fallen into.
`nearMissEffects[]` belong to a hazard cleared on a Good rather than a Perfect.

### `ThreeStepMinigame`

`background`, `stepAPoseOrEffect`, `stepBPoseOrEffect`, `stepCPoseOrEffect`, `alternateStepC[]`, `finishPose`, `targetVisuals[]`, `minorStepEffects[]`, `majorStepEffects[]`, `groupEffects[]`

`targetVisuals[]` are note art. Derive the A/B/C role from a note's position
within its beat rather than from `index % 3`: authored rhythm is not uniform, and
a rest inside the triplet would desynchronise a counter. `groupEffects[]` fire
when all three of a group land. **This family is blocked on the content model** —
see §6 of the authoring brief; the game can detect a triplet grid but cannot yet
author one.

### `RepeatMinigame`

`background`, `performerNeutral`, `performerAction`, `performerFinish`, `repeatTarget`, `targetCompletedState`, `impactEffects[]`, `debrisEffects[]`, `streakEffects[]`

The tidiest fit of the six, because **the can is the note**: `repeatTarget` and
`targetCompletedState` are one note's `body` before and after it is hit, so the
row of targets scrolling into `strikeX` is literally the rhythm. Put
`performerNeutral`/`performerAction` at `strikeX` for them to arrive at.
`debrisEffects[]` fall out of the band (`y > 1`); `streakEffects[]` are yours to
count, since the host tells you each judgment but keeps no streak for you.

### `BattleMinigame`

`background`, `heroPoses[]`, `threatPosesOrStates[]`, `stageHazards[] / arenaProps[]`, `impactEffects[]`, `powerEffects[]`, `debrisEffects[]`, composed `completionStates[]`

Hero at `strikeX`. **The threat closes in along the timeline**: start it near
x ≈ 1 and walk it toward `strikeX` as dominance shifts, so distance on screen
*is* threat and the player reads the fight without a health bar.
`stageHazards[]`/`arenaProps[]` sit below the band. `completionStates[]` compose
in `onComplete`. The per-level visual span (1-measure rounds at L1–4, continuous
at L5–7) is your decision inside `onMeasure`, not something the host imposes.

---

# 3. Scenario Bindings


# GOATS

## Scale — CLIMB → `ClimbMinigame`

### Rocky Ascent

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** L1 is a pleasant series of boulders; each level gets steeper and more precarious until L4 is an absurd near-vertical summit climb.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_rocky_ascent` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_rocky_ascent_advance_01`<br>`goat_rocky_ascent_advance_02`<br>`goat_rocky_ascent_advance_03`<br>`goat_rocky_ascent_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_rocky_ascent_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_rocky_ascent_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_rocky_ascent_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_rocky_ascent_dust`<br>`fx_rocky_ascent_tick` | Contact feedback and clean-progress accent. |

### Dam Wall

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Starts on broad concrete seams; later levels shrink the footholds until the goat is casually walking across tiny protrusions hundreds of feet up.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dam_wall` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_dam_wall_advance_01`<br>`goat_dam_wall_advance_02`<br>`goat_dam_wall_advance_03`<br>`goat_dam_wall_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_dam_wall_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_dam_wall_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_dam_wall_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_dam_wall_dust`<br>`fx_dam_wall_tick` | Contact feedback and clean-progress accent. |

### Alpine Staircase

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Natural rock shelves form clean ascending steps. Higher levels make them taller, narrower, and increasingly ridiculous.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_alpine_staircase` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_alpine_staircase_advance_01`<br>`goat_alpine_staircase_advance_02`<br>`goat_alpine_staircase_advance_03`<br>`goat_alpine_staircase_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_alpine_staircase_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_alpine_staircase_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_alpine_staircase_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_alpine_staircase_dust`<br>`fx_alpine_staircase_tick` | Contact feedback and clean-progress accent. |

### Tree Climber

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–3
- **Visual span:** 4m continuous (default)
- **Scenario role:** The goat climbs branches of a leaning tree. L1 is almost horizontal; L3 looks completely incompatible with goat anatomy.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tree_climber` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_tree_climber_advance_01`<br>`goat_tree_climber_advance_02`<br>`goat_tree_climber_advance_03`<br>`goat_tree_climber_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_tree_climber_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_tree_climber_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_tree_climber_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_tree_climber_dust`<br>`fx_tree_climber_tick` | Contact feedback and clean-progress accent. |

### Glacier Shelves

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L2–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Correct notes move between icy ledges; higher levels add longer reaches, tiny shelves, and huge exposed drops.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_glacier_shelves` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_glacier_shelves_advance_01`<br>`goat_glacier_shelves_advance_02`<br>`goat_glacier_shelves_advance_03`<br>`goat_glacier_shelves_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_glacier_shelves_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_glacier_shelves_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_glacier_shelves_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_glacier_shelves_dust`<br>`fx_glacier_shelves_tick` | Contact feedback and clean-progress accent. |

### Village Rooftops

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Goat walks upward across sheds, houses, church roofs, and chimneys; L4 ends at a weather vane.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_village_rooftops` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_village_rooftops_advance_01`<br>`goat_village_rooftops_advance_02`<br>`goat_village_rooftops_advance_03`<br>`goat_village_rooftops_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_village_rooftops_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_village_rooftops_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_village_rooftops_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_village_rooftops_dust`<br>`fx_village_rooftops_tick` | Contact feedback and clean-progress accent. |

### Salt Shrine

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each note climbs toward a glowing block of mineral salt. Higher levels make the shrine comically taller and more sacred.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_salt_shrine` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_salt_shrine_advance_01`<br>`goat_salt_shrine_advance_02`<br>`goat_salt_shrine_advance_03`<br>`goat_salt_shrine_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_salt_shrine_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_salt_shrine_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_salt_shrine_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_salt_shrine_dust`<br>`fx_salt_shrine_tick` | Contact feedback and clean-progress accent. |

### Goat Tower

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L2–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** The goat climbs over other goats stacked inexplicably upward. L4 ends with a tiny goat standing majestically atop a mountain of goats.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_goat_tower` | Opaque scenario backdrop. |
| `climberPoses[]` | `goat_goat_tower_advance_01`<br>`goat_goat_tower_advance_02`<br>`goat_goat_tower_advance_03`<br>`goat_goat_tower_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `goat_goat_tower_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_goat_tower_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_goat_tower_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_goat_tower_dust`<br>`fx_goat_tower_tick` | Contact feedback and clean-progress accent. |

## Blues Lick — PERFORM → `PerformMinigame`

### Courtship Strut

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Normal notes advance a swagger toward an unimpressed doe; slurs add flourishes, L5’s full-step bend becomes a huge romantic horn flourish, and L6 becomes an absurd dance routine.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_courtship_strut` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_courtship_strut_perform_01`<br>`goat_courtship_strut_perform_02`<br>`goat_courtship_strut_perform_03`<br>`goat_courtship_strut_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_courtship_strut_slur`<br>`goat_courtship_strut_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_courtship_strut_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_courtship_strut_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_courtship_strut_neutral`<br>`react_courtship_strut_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_courtship_strut_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_courtship_strut_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_courtship_strut_burst` | Large Star3/completion flourish. |

### Beard in the Wind

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Notes increase strut and beard magnificence. Bends summon increasingly impossible wind-machine effects.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beard_in_the_wind` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_beard_in_the_wind_perform_01`<br>`goat_beard_in_the_wind_perform_02`<br>`goat_beard_in_the_wind_perform_03`<br>`goat_beard_in_the_wind_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_beard_in_the_wind_slur`<br>`goat_beard_in_the_wind_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_beard_in_the_wind_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_beard_in_the_wind_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | **Unbound / no asset in catalog** | Unbound in the existing asset catalog; this scenario escalates through performer/prop/effects instead. |
| `flourishEffects[]` | `fx_beard_in_the_wind_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_beard_in_the_wind_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_beard_in_the_wind_burst` | Large Star3/completion flourish. |

### Goat Frontman

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Goat performs for a herd. Notes work the crowd; bends rear the goat backward like a stadium-rock singer.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_goat_frontman` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_goat_frontman_perform_01`<br>`goat_goat_frontman_perform_02`<br>`goat_goat_frontman_perform_03`<br>`goat_goat_frontman_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_goat_frontman_slur`<br>`goat_goat_frontman_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_goat_frontman_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_goat_frontman_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_goat_frontman_neutral`<br>`react_goat_frontman_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_goat_frontman_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_goat_frontman_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_goat_frontman_burst` | Large Star3/completion flourish. |

### Salt Ecstasy

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Every phrase gets the goat closer to sublime salt satisfaction. Bend events become almost religious moments of revelation.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_salt_ecstasy` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_salt_ecstasy_perform_01`<br>`goat_salt_ecstasy_perform_02`<br>`goat_salt_ecstasy_perform_03`<br>`goat_salt_ecstasy_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_salt_ecstasy_slur`<br>`goat_salt_ecstasy_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_salt_ecstasy_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_salt_ecstasy_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | **Unbound / no asset in catalog** | Unbound in the existing asset catalog; this scenario escalates through performer/prop/effects instead. |
| `flourishEffects[]` | `fx_salt_ecstasy_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_salt_ecstasy_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_salt_ecstasy_burst` | Large Star3/completion flourish. |

### Bell Swagger

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each note swings the goat’s bell and adds confidence: head nod, foot stomp, turn, pose. Best for simpler licks without major bends.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bell_swagger` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_bell_swagger_perform_01`<br>`goat_bell_swagger_perform_02`<br>`goat_bell_swagger_perform_03`<br>`goat_bell_swagger_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_bell_swagger_slur`<br>`goat_bell_swagger_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_bell_swagger_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_bell_swagger_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_bell_swagger_neutral`<br>`react_bell_swagger_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_bell_swagger_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_bell_swagger_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_bell_swagger_burst` | Large Star3/completion flourish. |

### Meadow Dance

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Flowers, butterflies, and other goats respond to expressive notes; L5–6 turn the solo into an increasingly ridiculous pastoral music video.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_meadow_dance` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_meadow_dance_perform_01`<br>`goat_meadow_dance_perform_02`<br>`goat_meadow_dance_perform_03`<br>`goat_meadow_dance_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_meadow_dance_slur`<br>`goat_meadow_dance_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_meadow_dance_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_meadow_dance_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_meadow_dance_neutral`<br>`react_meadow_dance_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_meadow_dance_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_meadow_dance_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_meadow_dance_burst` | Large Star3/completion flourish. |

### Horn Show-Off

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** The goat displays its horns to rivals. Slurs produce spins and head rolls; a full-step bend makes the horns visually grow another spiral.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_horn_show_off` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_horn_show_off_perform_01`<br>`goat_horn_show_off_perform_02`<br>`goat_horn_show_off_perform_03`<br>`goat_horn_show_off_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_horn_show_off_slur`<br>`goat_horn_show_off_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_horn_show_off_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_horn_show_off_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_horn_show_off_neutral`<br>`react_horn_show_off_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_horn_show_off_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_horn_show_off_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_horn_show_off_burst` | Large Star3/completion flourish. |

### Tavern Goat

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Goat walks across tables while other goats cheer. Every phrase gets cockier; bends kick mugs into the air without spilling them.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tavern_goat` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `goat_tavern_goat_perform_01`<br>`goat_tavern_goat_perform_02`<br>`goat_tavern_goat_perform_03`<br>`goat_tavern_goat_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `goat_tavern_goat_slur`<br>`goat_tavern_goat_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `goat_tavern_goat_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_tavern_goat_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_tavern_goat_neutral`<br>`react_tavern_goat_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_tavern_goat_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_tavern_goat_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_tavern_goat_burst` | Large Star3/completion flourish. |

## Scale Run — TRAVERSE → `TraverseMinigame`

### Cliff Switchbacks

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Slow staggered runs navigate easy switchbacks; by L7 the goat is sprinting down a near-vertical zigzag.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_cliff_switchbacks` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_cliff_switchbacks_travel_01`<br>`goat_cliff_switchbacks_travel_02`<br>`goat_cliff_switchbacks_travel_03`<br>`goat_cliff_switchbacks_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_cliff_switchbacks_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_cliff_switchbacks_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_cliff_switchbacks_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_cliff_switchbacks_dust`<br>`fx_cliff_switchbacks_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_cliff_switchbacks_near_miss` | Authored close-clear danger accent. |

### Canyon Descent

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each note reaches the next foothold; faster levels turn controlled descent into a terrifying downhill charge.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_canyon_descent` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_canyon_descent_travel_01`<br>`goat_canyon_descent_travel_02`<br>`goat_canyon_descent_travel_03`<br>`goat_canyon_descent_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_canyon_descent_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_canyon_descent_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_canyon_descent_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_canyon_descent_dust`<br>`fx_canyon_descent_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_canyon_descent_near_miss` | Authored close-clear danger accent. |

### Avalanche Escape

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L4–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Introduced only once the musical exercise is genuinely threatening. Faster runs keep the goat just ahead of a wall of snow.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_avalanche_escape` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_avalanche_escape_travel_01`<br>`goat_avalanche_escape_travel_02`<br>`goat_avalanche_escape_travel_03`<br>`goat_avalanche_escape_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_avalanche_escape_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_avalanche_escape_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_avalanche_escape_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_avalanche_escape_dust`<br>`fx_avalanche_escape_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_avalanche_escape_near_miss` | Authored close-clear danger accent. |

### Herd Slalom

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** The player goat weaves through other goats. More sophisticated patterns produce denser, faster-moving traffic.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_herd_slalom` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_herd_slalom_travel_01`<br>`goat_herd_slalom_travel_02`<br>`goat_herd_slalom_travel_03`<br>`goat_herd_slalom_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_herd_slalom_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_herd_slalom_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_herd_slalom_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_herd_slalom_dust`<br>`fx_herd_slalom_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_herd_slalom_near_miss` | Authored close-clear danger accent. |

### Village Rooftop Dash

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Traverse roofs, chimneys, laundry lines, and carts; high levels become goat parkour.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_village_rooftop_dash` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_village_rooftop_dash_travel_01`<br>`goat_village_rooftop_dash_travel_02`<br>`goat_village_rooftop_dash_travel_03`<br>`goat_village_rooftop_dash_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_village_rooftop_dash_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_village_rooftop_dash_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_village_rooftop_dash_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_village_rooftop_dash_dust`<br>`fx_village_rooftop_dash_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_village_rooftop_dash_near_miss` | Authored close-clear danger accent. |

### Eagle Shadow

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L3–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** An eagle’s shadow follows while the goat navigates ledges. Speed and danger increase together.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_eagle_shadow` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_eagle_shadow_travel_01`<br>`goat_eagle_shadow_travel_02`<br>`goat_eagle_shadow_travel_03`<br>`goat_eagle_shadow_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_eagle_shadow_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_eagle_shadow_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_eagle_shadow_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_eagle_shadow_dust`<br>`fx_eagle_shadow_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_eagle_shadow_near_miss` | Authored close-clear danger accent. |

### Fallen-Tree Gauntlet

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Logs, roots, and creek beds mirror staggered melodic movement; appropriate for the earlier and middle difficulty range.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_fallen_tree_gauntlet` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_fallen_tree_gauntlet_travel_01`<br>`goat_fallen_tree_gauntlet_travel_02`<br>`goat_fallen_tree_gauntlet_travel_03`<br>`goat_fallen_tree_gauntlet_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_fallen_tree_gauntlet_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_fallen_tree_gauntlet_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_fallen_tree_gauntlet_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_fallen_tree_gauntlet_dust`<br>`fx_fallen_tree_gauntlet_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_fallen_tree_gauntlet_near_miss` | Authored close-clear danger accent. |

### Impossible Ridge

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L5–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** A late-game version: razor-thin mountain spine, violent wind, huge gaps. Sixteenths look genuinely suicidal.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_impossible_ridge` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `goat_impossible_ridge_travel_01`<br>`goat_impossible_ridge_travel_02`<br>`goat_impossible_ridge_travel_03`<br>`goat_impossible_ridge_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `goat_impossible_ridge_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_impossible_ridge_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_impossible_ridge_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_impossible_ridge_dust`<br>`fx_impossible_ridge_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_impossible_ridge_near_miss` | Authored close-clear danger accent. |

## Triplets — THREE-STEP → `ThreeStepMinigame`

### Hop-Hop-LEAP

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** The canonical triplet visualization. First two notes are little hops; third is a larger leap. Higher levels move the entire pattern around the mountain.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_hop_hop_leap` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_hop_hop_leap_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_hop_hop_leap_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_hop_hop_leap_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_hop_hop_leap_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_hop_hop_leap_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_hop_hop_leap_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_hop_hop_leap_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_hop_hop_leap_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_hop_hop_leap_accent` | Triplet-group punctuation / threshold accent. |

### Triple Hoofbeat

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Three hoof strikes create a galloping cadence. At high levels whole herds synchronize behind the player.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_triple_hoofbeat` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_triple_hoofbeat_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_triple_hoofbeat_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_triple_hoofbeat_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_triple_hoofbeat_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_triple_hoofbeat_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_triple_hoofbeat_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_triple_hoofbeat_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_triple_hoofbeat_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_triple_hoofbeat_accent` | Triplet-group punctuation / threshold accent. |

### Butt-Butt-BONK

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Two little preparatory horn taps followed by a major third impact. Altered endings produce different victims or objects.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_butt_butt_bonk` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_butt_butt_bonk_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_butt_butt_bonk_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_butt_butt_bonk_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_butt_butt_bonk_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_butt_butt_bonk_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_butt_butt_bonk_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_butt_butt_bonk_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_butt_butt_bonk_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_butt_butt_bonk_accent` | Triplet-group punctuation / threshold accent. |

### Three-Stone Creek

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Every triplet crosses three stepping stones. Later phrases alter the third stone or jump direction.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_three_stone_creek` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_three_stone_creek_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_three_stone_creek_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_three_stone_creek_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_three_stone_creek_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_three_stone_creek_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_three_stone_creek_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_three_stone_creek_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_three_stone_creek_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_three_stone_creek_accent` | Triplet-group punctuation / threshold accent. |

### Bell-Bell-BONG

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Two little bell rings, one huge ring. High levels generate an entire absurd alpine bell orchestra.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bell_bell_bong` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_bell_bell_bong_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_bell_bell_bong_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_bell_bell_bong_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_bell_bell_bong_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_bell_bell_bong_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_bell_bell_bong_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_bell_bell_bong_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_bell_bell_bong_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_bell_bell_bong_accent` | Triplet-group punctuation / threshold accent. |

### Herd Bound

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Groups of three goats bound across the screen in rhythmic units; starting-note changes move the lead goat to new lanes.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_herd_bound` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_herd_bound_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_herd_bound_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_herd_bound_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_herd_bound_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_herd_bound_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_herd_bound_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_herd_bound_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_herd_bound_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_herd_bound_accent` | Triplet-group punctuation / threshold accent. |

### Hay-Bale Bounce

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Bounce-bounce-launch. Good for teaching the triplet shape before the patterns become genuinely hostile.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_hay_bale_bounce` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_hay_bale_bounce_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_hay_bale_bounce_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_hay_bale_bounce_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_hay_bale_bounce_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_hay_bale_bounce_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_hay_bale_bounce_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_hay_bale_bounce_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_hay_bale_bounce_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_hay_bale_bounce_accent` | Triplet-group punctuation / threshold accent. |

### Horn-Lock Shuffle

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L3–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Three-part movements in a ritualized goat fight: step, step, clash. Different starting notes change which goat leads.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_horn_lock_shuffle` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `goat_horn_lock_shuffle_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `goat_horn_lock_shuffle_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `goat_horn_lock_shuffle_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `goat_horn_lock_shuffle_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `goat_horn_lock_shuffle_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_horn_lock_shuffle_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_horn_lock_shuffle_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_horn_lock_shuffle_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_horn_lock_shuffle_accent` | Triplet-group punctuation / threshold accent. |

## Straight Sixteenths — REPEAT → `RepeatMinigame`

### Fence-Post Demolition

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 1m — refresh posts; tier/spectacle persists
- **Repeat mode:** `sequence`
- **Scenario role:** Every correct sixteenth headbutts another fence post. Four hits feels funny; 64 looks like a goat-powered industrial machine.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_fence_post_demolition` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_fence_post_demolition_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_fence_post_demolition_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_fence_post_demolition_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_fence_post_demolition_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_fence_post_demolition_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_fence_post_demolition_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_fence_post_demolition_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_fence_post_demolition_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Tin-Can Knockdown

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–6
- **Visual span:** 1m — refresh cans; tier/spectacle persists
- **Repeat mode:** `sequence`
- **Scenario role:** Rapid horn flicks knock cans from a wall. Higher quotas turn one neat trick into impossible precision.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tin_can_knockdown` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_tin_can_knockdown_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_tin_can_knockdown_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_tin_can_knockdown_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_tin_can_knockdown_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_tin_can_knockdown_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_tin_can_knockdown_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_tin_can_knockdown_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_tin_can_knockdown_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Hay Shredder

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 1m — fresh bale; eater/spectacle persists
- **Repeat mode:** `sequence`
- **Scenario role:** Goat rapidly chomps a hay bale. At elite execution the bale vanishes into a cartoon cloud.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_hay_shredder` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_hay_shredder_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_hay_shredder_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_hay_shredder_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_hay_shredder_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_hay_shredder_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_hay_shredder_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_hay_shredder_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_hay_shredder_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Hoof Stamp

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous — cracks/crater accumulate
- **Repeat mode:** `sequence`
- **Scenario role:** Same note, same hoof stomp. More sustained accuracy creates dust, cracks, then eventually a small crater.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_hoof_stamp` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_hoof_stamp_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_hoof_stamp_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_hoof_stamp_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_hoof_stamp_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_hoof_stamp_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_hoof_stamp_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_hoof_stamp_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_hoof_stamp_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Bell Machine

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous — percussion wall accumulates
- **Repeat mode:** `sequence`
- **Scenario role:** Each note rings another hanging bell. Perfect sustained sixteenths become a ridiculous wall of alpine percussion.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bell_machine` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_bell_machine_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_bell_machine_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_bell_machine_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_bell_machine_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_bell_machine_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_bell_machine_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_bell_machine_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_bell_machine_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Door Battering

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous — door/barn damage accumulates
- **Repeat mode:** `sequence`
- **Scenario role:** Goat repeatedly headbutts a barn door. Low quotas dent it; high quotas convert the barn into splinters.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_door_battering` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_door_battering_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_door_battering_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_door_battering_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_door_battering_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_door_battering_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_door_battering_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_door_battering_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_door_battering_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Pebble Gatling

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–5
- **Visual span:** 1m — refresh pebble line
- **Repeat mode:** `sequence`
- **Scenario role:** Each hoof kick launches a pebble off a cliff. The visual stays simple and readable for lower and middle levels.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_pebble_gatling` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_pebble_gatling_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_pebble_gatling_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_pebble_gatling_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_pebble_gatling_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_pebble_gatling_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_pebble_gatling_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_pebble_gatling_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_pebble_gatling_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Walnut Cracker

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L2–7
- **Visual span:** 1m — refresh object line; absurdity tier persists
- **Repeat mode:** `sequence`
- **Scenario role:** Rapid headbutts crack a line of increasingly implausible objects: walnuts, coconuts, bowling balls, anvils.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_walnut_cracker` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `goat_walnut_cracker_ready` | Persistent ready/reset pose. |
| `performerAction` | `goat_walnut_cracker_action` | Single repeated successful-note action pose. |
| `performerFinish` | `goat_walnut_cracker_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_walnut_cracker_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_walnut_cracker_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_walnut_cracker_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_walnut_cracker_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_walnut_cracker_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

## Sixteenth Phrases — BATTLE / SURVIVE → `BattleMinigame`

### Wolf Pack

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Low levels fend off a single wolf; higher levels turn the phrase into positioning against an entire coordinated pack.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_wolf_pack` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_wolf_pack_ready`<br>`goat_wolf_pack_attack`<br>`goat_wolf_pack_evade`<br>`goat_wolf_pack_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_wolf_pack_base`<br>`threat_wolf_pack_attack`<br>`threat_wolf_pack_recoil`<br>`threat_wolf_pack_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_wolf_pack_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_wolf_pack_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_wolf_pack_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_wolf_pack_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_wolf_pack_finisher`<br>`threat_wolf_pack_humiliated`<br>`fx_wolf_pack_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Mountain Lion

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Correct notes dodge or counter swipes. High-level sixteenths culminate in the goat launching the cat into a tree.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_mountain_lion` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_mountain_lion_ready`<br>`goat_mountain_lion_attack`<br>`goat_mountain_lion_evade`<br>`goat_mountain_lion_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_mountain_lion_base`<br>`threat_mountain_lion_attack`<br>`threat_mountain_lion_recoil`<br>`threat_mountain_lion_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_mountain_lion_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_mountain_lion_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_mountain_lion_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_mountain_lion_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_mountain_lion_finisher`<br>`threat_mountain_lion_humiliated`<br>`fx_mountain_lion_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Grizzly

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L3–7
- **Visual span:** L3–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Tiny goat, enormous bear. Early levels merely survive; elite performance makes the bear visibly regret its decision.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_grizzly` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_grizzly_ready`<br>`goat_grizzly_attack`<br>`goat_grizzly_evade`<br>`goat_grizzly_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_grizzly_base`<br>`threat_grizzly_attack`<br>`threat_grizzly_recoil`<br>`threat_grizzly_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_grizzly_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_grizzly_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_grizzly_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_grizzly_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_grizzly_finisher`<br>`threat_grizzly_humiliated`<br>`fx_grizzly_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Golden Eagle

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–6
- **Visual span:** L1–4: 1m tiered rounds; L5–6: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Phrase notes evade dives and pecking attacks. Perfect runs eventually send the eagle riding unwillingly on the goat’s horns.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_golden_eagle` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_golden_eagle_ready`<br>`goat_golden_eagle_attack`<br>`goat_golden_eagle_evade`<br>`goat_golden_eagle_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_golden_eagle_base`<br>`threat_golden_eagle_attack`<br>`threat_golden_eagle_recoil`<br>`threat_golden_eagle_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_golden_eagle_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_golden_eagle_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_golden_eagle_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_golden_eagle_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_golden_eagle_finisher`<br>`threat_golden_eagle_humiliated`<br>`fx_golden_eagle_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Ibex Warlord

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Rival goat grows larger through misses; correct phrases charge the player goat. Climactic horn collisions punctuate each bar.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_ibex_warlord` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_ibex_warlord_ready`<br>`goat_ibex_warlord_attack`<br>`goat_ibex_warlord_evade`<br>`goat_ibex_warlord_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_ibex_warlord_base`<br>`threat_ibex_warlord_attack`<br>`threat_ibex_warlord_recoil`<br>`threat_ibex_warlord_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_ibex_warlord_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_ibex_warlord_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_ibex_warlord_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_ibex_warlord_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_ibex_warlord_finisher`<br>`threat_ibex_warlord_humiliated`<br>`fx_ibex_warlord_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Avalanche

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L3–7
- **Visual span:** L3–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `survival/catastrophe`
- **Scenario role:** Not a literal opponent, but visually a boss fight. Every correct phrase wins ground against the encroaching snow.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_avalanche` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_avalanche_ready`<br>`goat_avalanche_attack`<br>`goat_avalanche_evade`<br>`goat_avalanche_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_avalanche_base`<br>`threat_avalanche_attack`<br>`threat_avalanche_recoil`<br>`threat_avalanche_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_avalanche_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_avalanche_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_avalanche_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_avalanche_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_avalanche_finisher`<br>`threat_avalanche_humiliated`<br>`fx_avalanche_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Rockslide

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L4–7
- **Visual span:** L4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `survival/catastrophe`
- **Scenario role:** Goat dodges, jumps, and headbutts falling stones. Sixteenth patterns become a dense choreographed survival sequence.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_rockslide` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_rockslide_ready`<br>`goat_rockslide_attack`<br>`goat_rockslide_evade`<br>`goat_rockslide_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_rockslide_base`<br>`threat_rockslide_attack`<br>`threat_rockslide_recoil`<br>`threat_rockslide_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_rockslide_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_rockslide_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_rockslide_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_rockslide_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_rockslide_finisher`<br>`threat_rockslide_humiliated`<br>`fx_rockslide_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Thunder Ram

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L5–7
- **Visual span:** L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Mythic final-boss goat with lightning horns. At L7, perfection ends with the player goat becoming even more magnificently impossible.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_thunder_ram` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `goat_thunder_ram_ready`<br>`goat_thunder_ram_attack`<br>`goat_thunder_ram_evade`<br>`goat_thunder_ram_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_thunder_ram_base`<br>`threat_thunder_ram_attack`<br>`threat_thunder_ram_recoil`<br>`threat_thunder_ram_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_thunder_ram_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_thunder_ram_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_thunder_ram_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_thunder_ram_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `goat_thunder_ram_finisher`<br>`threat_thunder_ram_humiliated`<br>`fx_thunder_ram_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.


# KAIJU

## Scale — CLIMB → `ClimbMinigame`

### Skyscraper Climb

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Apartment blocks at L1; enormous downtown towers at L4. Each correct note moves one floor.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_skyscraper_climb` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_skyscraper_climb_advance_01`<br>`kaiju_skyscraper_climb_advance_02`<br>`kaiju_skyscraper_climb_advance_03`<br>`kaiju_skyscraper_climb_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_skyscraper_climb_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_skyscraper_climb_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_skyscraper_climb_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_skyscraper_climb_dust`<br>`fx_skyscraper_climb_tick` | Contact feedback and clean-progress accent. |

### Radio Tower

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Kaiju climbs from broad structural braces to a tiny antenna tip.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_radio_tower` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_radio_tower_advance_01`<br>`kaiju_radio_tower_advance_02`<br>`kaiju_radio_tower_advance_03`<br>`kaiju_radio_tower_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_radio_tower_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_radio_tower_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_radio_tower_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_radio_tower_dust`<br>`fx_radio_tower_tick` | Contact feedback and clean-progress accent. |

### Shipping Containers

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–3
- **Visual span:** 4m continuous (default)
- **Scenario role:** Walk upward across stacks of containers; simple, chunky, mechanical visualization for early scales.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_shipping_containers` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_shipping_containers_advance_01`<br>`kaiju_shipping_containers_advance_02`<br>`kaiju_shipping_containers_advance_03`<br>`kaiju_shipping_containers_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_shipping_containers_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_shipping_containers_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_shipping_containers_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_shipping_containers_dust`<br>`fx_shipping_containers_tick` | Contact feedback and clean-progress accent. |

### Cooling Towers

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L2–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Power-plant architecture becomes an improbable staircase; L4 ends atop a giant smoking stack.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_cooling_towers` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_cooling_towers_advance_01`<br>`kaiju_cooling_towers_advance_02`<br>`kaiju_cooling_towers_advance_03`<br>`kaiju_cooling_towers_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_cooling_towers_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_cooling_towers_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_cooling_towers_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_cooling_towers_dust`<br>`fx_cooling_towers_tick` | Contact feedback and clean-progress accent. |

### Mountain Entrance

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Start in wilderness and climb toward the city skyline, each level making the terrain more dramatic.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_mountain_entrance` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_mountain_entrance_advance_01`<br>`kaiju_mountain_entrance_advance_02`<br>`kaiju_mountain_entrance_advance_03`<br>`kaiju_mountain_entrance_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_mountain_entrance_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_mountain_entrance_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_mountain_entrance_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_mountain_entrance_dust`<br>`fx_mountain_entrance_tick` | Contact feedback and clean-progress accent. |

### Robot Scaffolding

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L2–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Kaiju ascends the scaffolding around an unfinished giant robot while tiny workers flee.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_robot_scaffolding` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_robot_scaffolding_advance_01`<br>`kaiju_robot_scaffolding_advance_02`<br>`kaiju_robot_scaffolding_advance_03`<br>`kaiju_robot_scaffolding_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_robot_scaffolding_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_robot_scaffolding_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_robot_scaffolding_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_robot_scaffolding_dust`<br>`fx_robot_scaffolding_tick` | Contact feedback and clean-progress accent. |

### Space Elevator

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L3–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Late Scale variant where the simple mechanical exercise gets an absurdly grand setting.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_space_elevator` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_space_elevator_advance_01`<br>`kaiju_space_elevator_advance_02`<br>`kaiju_space_elevator_advance_03`<br>`kaiju_space_elevator_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_space_elevator_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_space_elevator_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_space_elevator_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_space_elevator_dust`<br>`fx_space_elevator_tick` | Contact feedback and clean-progress accent. |

### Apartment Balconies

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each correct note grabs another balcony. Tiny residents continue mundane domestic activities while the monster climbs.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_apartment_balconies` | Opaque scenario backdrop. |
| `climberPoses[]` | `kaiju_apartment_balconies_advance_01`<br>`kaiju_apartment_balconies_advance_02`<br>`kaiju_apartment_balconies_advance_03`<br>`kaiju_apartment_balconies_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `kaiju_apartment_balconies_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_apartment_balconies_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_apartment_balconies_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_apartment_balconies_dust`<br>`fx_apartment_balconies_tick` | Contact feedback and clean-progress accent. |

## Blues Lick — PERFORM → `PerformMinigame`

### Roar Solo

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Every phrase adds attitude to a roar; bends produce enormous mouth-open sustained notes and shake windows across the city.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_roar_solo` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_roar_solo_perform_01`<br>`kaiju_roar_solo_perform_02`<br>`kaiju_roar_solo_perform_03`<br>`kaiju_roar_solo_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_roar_solo_slur`<br>`kaiju_roar_solo_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_roar_solo_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_roar_solo_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_roar_solo_neutral`<br>`react_roar_solo_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_roar_solo_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_roar_solo_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_roar_solo_burst` | Large Star3/completion flourish. |

### Tail Swagger

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Notes create increasingly expressive tail swings; slurs sweep cars aside, bends curl the tail around buildings.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tail_swagger` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_tail_swagger_perform_01`<br>`kaiju_tail_swagger_perform_02`<br>`kaiju_tail_swagger_perform_03`<br>`kaiju_tail_swagger_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_tail_swagger_slur`<br>`kaiju_tail_swagger_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_tail_swagger_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_tail_swagger_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | **Unbound / no asset in catalog** | Unbound in the existing asset catalog; this scenario escalates through performer/prop/effects instead. |
| `flourishEffects[]` | `fx_tail_swagger_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_tail_swagger_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_tail_swagger_burst` | Large Star3/completion flourish. |

### Neon Monster Dance

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Kaiju dances in a nightlife district; bends trigger glowing signs, spotlights, and increasingly ridiculous choreography.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_neon_monster_dance` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_neon_monster_dance_perform_01`<br>`kaiju_neon_monster_dance_perform_02`<br>`kaiju_neon_monster_dance_perform_03`<br>`kaiju_neon_monster_dance_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_neon_monster_dance_slur`<br>`kaiju_neon_monster_dance_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_neon_monster_dance_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_neon_monster_dance_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_neon_monster_dance_neutral`<br>`react_neon_monster_dance_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_neon_monster_dance_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_neon_monster_dance_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_neon_monster_dance_burst` | Large Star3/completion flourish. |

### Kaiju Courtship

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** One monster serenades another. L5’s full-step bend finally gets the other monster’s attention.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_kaiju_courtship` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_kaiju_courtship_perform_01`<br>`kaiju_kaiju_courtship_perform_02`<br>`kaiju_kaiju_courtship_perform_03`<br>`kaiju_kaiju_courtship_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_kaiju_courtship_slur`<br>`kaiju_kaiju_courtship_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_kaiju_courtship_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_kaiju_courtship_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_kaiju_courtship_neutral`<br>`react_kaiju_courtship_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_kaiju_courtship_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_kaiju_courtship_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_kaiju_courtship_burst` | Large Star3/completion flourish. |

### News Camera Pose

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Every correct note gives the television crews a better heroic pose. Best for simple licks.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_news_camera_pose` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_news_camera_pose_perform_01`<br>`kaiju_news_camera_pose_perform_02`<br>`kaiju_news_camera_pose_perform_03`<br>`kaiju_news_camera_pose_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_news_camera_pose_slur`<br>`kaiju_news_camera_pose_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_news_camera_pose_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_news_camera_pose_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_news_camera_pose_neutral`<br>`react_news_camera_pose_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_news_camera_pose_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_news_camera_pose_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_news_camera_pose_burst` | Large Star3/completion flourish. |

### Train Microphone

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Kaiju holds a commuter train like a microphone. Bends become stadium-rock screams while passengers remain visibly annoyed.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_train_microphone` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_train_microphone_perform_01`<br>`kaiju_train_microphone_perform_02`<br>`kaiju_train_microphone_perform_03`<br>`kaiju_train_microphone_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_train_microphone_slur`<br>`kaiju_train_microphone_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_train_microphone_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_train_microphone_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_train_microphone_neutral`<br>`react_train_microphone_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_train_microphone_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_train_microphone_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_train_microphone_burst` | Large Star3/completion flourish. |

### Atomic-Breath Flourish

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L3–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Normal notes build charge; expressive notes shape the beam. Full-step bend creates an extravagant arcing blast.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_atomic_breath_flourish` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_atomic_breath_flourish_perform_01`<br>`kaiju_atomic_breath_flourish_perform_02`<br>`kaiju_atomic_breath_flourish_perform_03`<br>`kaiju_atomic_breath_flourish_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_atomic_breath_flourish_slur`<br>`kaiju_atomic_breath_flourish_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_atomic_breath_flourish_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_atomic_breath_flourish_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | **Unbound / no asset in catalog** | Unbound in the existing asset catalog; this scenario escalates through performer/prop/effects instead. |
| `flourishEffects[]` | `fx_atomic_breath_flourish_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_atomic_breath_flourish_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_atomic_breath_flourish_burst` | Large Star3/completion flourish. |

### Monster Idol Show

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Tiny crowd, backup dancers, and stage pyrotechnics escalate with the lick’s expressiveness.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_monster_idol_show` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `kaiju_monster_idol_show_perform_01`<br>`kaiju_monster_idol_show_perform_02`<br>`kaiju_monster_idol_show_perform_03`<br>`kaiju_monster_idol_show_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `kaiju_monster_idol_show_slur`<br>`kaiju_monster_idol_show_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `kaiju_monster_idol_show_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_monster_idol_show_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_monster_idol_show_neutral`<br>`react_monster_idol_show_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_monster_idol_show_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_monster_idol_show_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_monster_idol_show_burst` | Large Star3/completion flourish. |

## Scale Run — TRAVERSE → `TraverseMinigame`

### Boulevard Rampage

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Stagger around cars and buildings; high levels become high-speed city weaving.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_boulevard_rampage` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_boulevard_rampage_travel_01`<br>`kaiju_boulevard_rampage_travel_02`<br>`kaiju_boulevard_rampage_travel_03`<br>`kaiju_boulevard_rampage_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_boulevard_rampage_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_boulevard_rampage_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_boulevard_rampage_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_boulevard_rampage_dust`<br>`fx_boulevard_rampage_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_boulevard_rampage_near_miss` | Authored close-clear danger accent. |

### Rooftop Parkour

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Jump from roof to roof as the melodic pattern changes direction.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_rooftop_parkour` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_rooftop_parkour_travel_01`<br>`kaiju_rooftop_parkour_travel_02`<br>`kaiju_rooftop_parkour_travel_03`<br>`kaiju_rooftop_parkour_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_rooftop_parkour_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_rooftop_parkour_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_rooftop_parkour_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_rooftop_parkour_dust`<br>`fx_rooftop_parkour_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_rooftop_parkour_near_miss` | Authored close-clear danger accent. |

### Highway Slalom

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Dodge overpasses, tank columns, and traffic. Musical staggering maps naturally to lane changes.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_highway_slalom` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_highway_slalom_travel_01`<br>`kaiju_highway_slalom_travel_02`<br>`kaiju_highway_slalom_travel_03`<br>`kaiju_highway_slalom_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_highway_slalom_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_highway_slalom_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_highway_slalom_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_highway_slalom_dust`<br>`fx_highway_slalom_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_highway_slalom_near_miss` | Authored close-clear danger accent. |

### Missile Dodge

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L3–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Pattern direction corresponds to dodging missile trails; L7 becomes beautifully chaotic.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_missile_dodge` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_missile_dodge_travel_01`<br>`kaiju_missile_dodge_travel_02`<br>`kaiju_missile_dodge_travel_03`<br>`kaiju_missile_dodge_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_missile_dodge_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_missile_dodge_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_missile_dodge_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_missile_dodge_dust`<br>`fx_missile_dodge_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_missile_dodge_near_miss` | Authored close-clear danger accent. |

### Harbor Dash

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Containers, cranes, ships, and piers create a readable obstacle path.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_harbor_dash` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_harbor_dash_travel_01`<br>`kaiju_harbor_dash_travel_02`<br>`kaiju_harbor_dash_travel_03`<br>`kaiju_harbor_dash_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_harbor_dash_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_harbor_dash_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_harbor_dash_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_harbor_dash_dust`<br>`fx_harbor_dash_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_harbor_dash_near_miss` | Authored close-clear danger accent. |

### Monorail Chase

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Kaiju runs beside an elevated train, repeatedly changing lanes and elevation.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_monorail_chase` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_monorail_chase_travel_01`<br>`kaiju_monorail_chase_travel_02`<br>`kaiju_monorail_chase_travel_03`<br>`kaiju_monorail_chase_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_monorail_chase_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_monorail_chase_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_monorail_chase_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_monorail_chase_dust`<br>`fx_monorail_chase_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_monorail_chase_near_miss` | Authored close-clear danger accent. |

### Lava City

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L4–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Streets collapse behind the monster. Best reserved for fast and threatening versions.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_lava_city` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_lava_city_travel_01`<br>`kaiju_lava_city_travel_02`<br>`kaiju_lava_city_travel_03`<br>`kaiju_lava_city_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_lava_city_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_lava_city_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_lava_city_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_lava_city_dust`<br>`fx_lava_city_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_lava_city_near_miss` | Authored close-clear danger accent. |

### Moonbase Sprint

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L5–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Low gravity, domes, craters, and tiny lunar rovers make the highest levels feel gloriously excessive.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_moonbase_sprint` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `kaiju_moonbase_sprint_travel_01`<br>`kaiju_moonbase_sprint_travel_02`<br>`kaiju_moonbase_sprint_travel_03`<br>`kaiju_moonbase_sprint_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `kaiju_moonbase_sprint_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_moonbase_sprint_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_moonbase_sprint_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_moonbase_sprint_dust`<br>`fx_moonbase_sprint_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_moonbase_sprint_near_miss` | Authored close-clear danger accent. |

## Triplets — THREE-STEP → `ThreeStepMinigame`

### Punch-Punch-TAIL

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Two punches followed by a giant tail swipe. The essential kaiju triplet.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_punch_punch_tail` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_punch_punch_tail_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_punch_punch_tail_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_punch_punch_tail_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_punch_punch_tail_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_punch_punch_tail_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_punch_punch_tail_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_punch_punch_tail_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_punch_punch_tail_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_punch_punch_tail_accent` | Triplet-group punctuation / threshold accent. |

### Stomp-Stomp-ROAR

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Two compact stomps, one huge roar on the third subdivision.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_stomp_stomp_roar` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_stomp_stomp_roar_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_stomp_stomp_roar_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_stomp_stomp_roar_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_stomp_stomp_roar_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_stomp_stomp_roar_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_stomp_stomp_roar_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_stomp_stomp_roar_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_stomp_stomp_roar_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_stomp_stomp_roar_accent` | Triplet-group punctuation / threshold accent. |

### Jet-Jet-HELICOPTER

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Swat two jets, grab a helicopter. Altered endings substitute different aircraft.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_jet_jet_helicopter` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_jet_jet_helicopter_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_jet_jet_helicopter_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_jet_jet_helicopter_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_jet_jet_helicopter_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_jet_jet_helicopter_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_jet_jet_helicopter_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_jet_jet_helicopter_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_jet_jet_helicopter_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_jet_jet_helicopter_accent` | Triplet-group punctuation / threshold accent. |

### House-House-TOWER

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Smash two little buildings then one big one.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_house_house_tower` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_house_house_tower_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_house_house_tower_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_house_house_tower_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_house_house_tower_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_house_house_tower_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_house_house_tower_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_house_house_tower_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_house_house_tower_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_house_house_tower_accent` | Triplet-group punctuation / threshold accent. |

### Tank-Tank-THROW

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Crush, crush, pick up something absurdly larger.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tank_tank_throw` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_tank_tank_throw_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_tank_tank_throw_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_tank_tank_throw_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_tank_tank_throw_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_tank_tank_throw_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_tank_tank_throw_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_tank_tank_throw_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_tank_tank_throw_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_tank_tank_throw_accent` | Triplet-group punctuation / threshold accent. |

### Sumo Step

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Step, step, shove against another kaiju. Starting-note changes reverse which direction the monster moves.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_sumo_step` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_sumo_step_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_sumo_step_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_sumo_step_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_sumo_step_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_sumo_step_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_sumo_step_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_sumo_step_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_sumo_step_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_sumo_step_accent` | Triplet-group punctuation / threshold accent. |

### Bite-Claw-HEADBUTT

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L3–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** More sophisticated three-hit combo suitable once actual triplets arrive.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bite_claw_headbutt` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_bite_claw_headbutt_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_bite_claw_headbutt_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_bite_claw_headbutt_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_bite_claw_headbutt_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_bite_claw_headbutt_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_bite_claw_headbutt_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_bite_claw_headbutt_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_bite_claw_headbutt_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_bite_claw_headbutt_accent` | Triplet-group punctuation / threshold accent. |

### Beam-Beam-BLAST

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L4–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Three rhythmic pulses of energy; advanced variants relocate targets and alter the final pulse.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beam_beam_blast` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `kaiju_beam_beam_blast_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `kaiju_beam_beam_blast_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `kaiju_beam_beam_blast_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `kaiju_beam_beam_blast_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `kaiju_beam_beam_blast_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_beam_beam_blast_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_beam_beam_blast_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_beam_beam_blast_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_beam_beam_blast_accent` | Triplet-group punctuation / threshold accent. |

## Straight Sixteenths — REPEAT → `RepeatMinigame`

### Tank Stomp

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 1m — refresh tank wave; devastation tier persists
- **Repeat mode:** `sequence`
- **Scenario role:** Every note crushes a tiny toy tank. Perfect high-level play creates an absurdly long tank graveyard.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tank_stomp` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_tank_stomp_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_tank_stomp_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_tank_stomp_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_tank_stomp_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_tank_stomp_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_tank_stomp_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_tank_stomp_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_tank_stomp_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Car Flick

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–5
- **Visual span:** 1m — refresh cars
- **Repeat mode:** `sequence`
- **Scenario role:** Flick cars off a bridge one by one. Very readable at low quotas.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_car_flick` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_car_flick_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_car_flick_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_car_flick_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_car_flick_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_car_flick_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_car_flick_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_car_flick_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_car_flick_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Helicopter Swat

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous — swarm/spectacle builds
- **Repeat mode:** `sequence`
- **Scenario role:** Repeated rapid swats; longer quota turns the kaiju into a terrifying flyswatter.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_helicopter_swat` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_helicopter_swat_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_helicopter_swat_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_helicopter_swat_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_helicopter_swat_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_helicopter_swat_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_helicopter_swat_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_helicopter_swat_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_helicopter_swat_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Window Punch

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–6
- **Visual span:** 1m — fresh façade/building section
- **Repeat mode:** `sequence`
- **Scenario role:** Smash one window per sixteenth as the monster’s fist travels across a skyscraper façade.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_window_punch` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_window_punch_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_window_punch_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_window_punch_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_window_punch_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_window_punch_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_window_punch_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_window_punch_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_window_punch_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Train Chomp

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous — one absurdly long train
- **Repeat mode:** `sequence`
- **Scenario role:** Each note bites another train car. At 64, the train disappears like spaghetti.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_train_chomp` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_train_chomp_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_train_chomp_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_train_chomp_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_train_chomp_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_train_chomp_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_train_chomp_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_train_chomp_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_train_chomp_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Beam Pulse

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L3–7
- **Visual span:** 4m continuous — beam spectacle accumulates
- **Repeat mode:** `sequence/accumulate`
- **Scenario role:** Each correct sixteenth emits one clean energy bolt. Elite execution becomes a beam machine gun.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beam_pulse` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_beam_pulse_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_beam_pulse_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_beam_pulse_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_beam_pulse_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_beam_pulse_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_beam_pulse_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_beam_pulse_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_beam_pulse_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Battleship Slap

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L4–7
- **Visual span:** 1m — refresh shell/ship wave
- **Repeat mode:** `sequence`
- **Scenario role:** Repeatedly slap shells or small ships aside; reserved for more demanding levels.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_battleship_slap` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_battleship_slap_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_battleship_slap_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_battleship_slap_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_battleship_slap_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_battleship_slap_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_battleship_slap_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_battleship_slap_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_battleship_slap_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Building Drums

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous — same city-block drum kit
- **Repeat mode:** `sequence`
- **Scenario role:** Kaiju treats a city block as a drum kit. Same note, same glorious repetitive smash.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_building_drums` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `kaiju_building_drums_ready` | Persistent ready/reset pose. |
| `performerAction` | `kaiju_building_drums_action` | Single repeated successful-note action pose. |
| `performerFinish` | `kaiju_building_drums_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_building_drums_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_building_drums_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_building_drums_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_building_drums_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_building_drums_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

## Sixteenth Phrases — BATTLE / SURVIVE → `BattleMinigame`

### Lizard Rival

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Classic monster-versus-monster fight; phrases map to blocks, punches, and throws.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_lizard_rival` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_lizard_rival_ready`<br>`kaiju_lizard_rival_attack`<br>`kaiju_lizard_rival_evade`<br>`kaiju_lizard_rival_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_lizard_rival_base`<br>`threat_lizard_rival_attack`<br>`threat_lizard_rival_recoil`<br>`threat_lizard_rival_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_lizard_rival_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_lizard_rival_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_lizard_rival_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_lizard_rival_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_lizard_rival_finisher`<br>`threat_lizard_rival_humiliated`<br>`fx_lizard_rival_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Giant Mecha

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Robot attacks become more elaborate with level; sixteenth phrases power frantic close-range combat.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_giant_mecha` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_giant_mecha_ready`<br>`kaiju_giant_mecha_attack`<br>`kaiju_giant_mecha_evade`<br>`kaiju_giant_mecha_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_giant_mecha_base`<br>`threat_giant_mecha_attack`<br>`threat_giant_mecha_recoil`<br>`threat_giant_mecha_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_giant_mecha_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_giant_mecha_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_giant_mecha_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_giant_mecha_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_giant_mecha_finisher`<br>`threat_giant_mecha_humiliated`<br>`fx_giant_mecha_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Three-Headed Dragon

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L3–7
- **Visual span:** L3–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Each phrase must manage several attacking heads; altered note patterns naturally produce target switching.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_three_headed_dragon` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_three_headed_dragon_ready`<br>`kaiju_three_headed_dragon_attack`<br>`kaiju_three_headed_dragon_evade`<br>`kaiju_three_headed_dragon_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_three_headed_dragon_base`<br>`threat_three_headed_dragon_attack`<br>`threat_three_headed_dragon_recoil`<br>`threat_three_headed_dragon_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_three_headed_dragon_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_three_headed_dragon_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_three_headed_dragon_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_three_headed_dragon_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_three_headed_dragon_finisher`<br>`threat_three_headed_dragon_humiliated`<br>`fx_three_headed_dragon_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Alien Mothership

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `survival/catastrophe`
- **Scenario role:** Fight tractor beams, drones, and the ship itself. Perfection punches straight through the saucer.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_alien_mothership` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_alien_mothership_ready`<br>`kaiju_alien_mothership_attack`<br>`kaiju_alien_mothership_evade`<br>`kaiju_alien_mothership_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_alien_mothership_base`<br>`threat_alien_mothership_attack`<br>`threat_alien_mothership_recoil`<br>`threat_alien_mothership_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_alien_mothership_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_alien_mothership_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_alien_mothership_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_alien_mothership_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_alien_mothership_finisher`<br>`threat_alien_mothership_humiliated`<br>`fx_alien_mothership_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Giant Ape

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Wrestling-oriented boss with grapples, throws, and skyscraper-assisted attacks.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_giant_ape` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_giant_ape_ready`<br>`kaiju_giant_ape_attack`<br>`kaiju_giant_ape_evade`<br>`kaiju_giant_ape_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_giant_ape_base`<br>`threat_giant_ape_attack`<br>`threat_giant_ape_recoil`<br>`threat_giant_ape_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_giant_ape_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_giant_ape_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_giant_ape_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_giant_ape_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_giant_ape_finisher`<br>`threat_giant_ape_humiliated`<br>`fx_giant_ape_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Sea Serpent

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Harbor battle where phrases control dodging coils and counterattacks.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_sea_serpent` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_sea_serpent_ready`<br>`kaiju_sea_serpent_attack`<br>`kaiju_sea_serpent_evade`<br>`kaiju_sea_serpent_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_sea_serpent_base`<br>`threat_sea_serpent_attack`<br>`threat_sea_serpent_recoil`<br>`threat_sea_serpent_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_sea_serpent_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_sea_serpent_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_sea_serpent_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_sea_serpent_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_sea_serpent_finisher`<br>`threat_sea_serpent_humiliated`<br>`fx_sea_serpent_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Military Superweapon

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L4–7
- **Visual span:** L4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `survival/catastrophe`
- **Scenario role:** Enormous cannon charges while the kaiju fights through defenses. A good late-game pressure scenario.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_military_superweapon` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_military_superweapon_ready`<br>`kaiju_military_superweapon_attack`<br>`kaiju_military_superweapon_evade`<br>`kaiju_military_superweapon_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_military_superweapon_base`<br>`threat_military_superweapon_attack`<br>`threat_military_superweapon_recoil`<br>`threat_military_superweapon_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_military_superweapon_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_military_superweapon_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_military_superweapon_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_military_superweapon_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_military_superweapon_finisher`<br>`threat_military_superweapon_humiliated`<br>`fx_military_superweapon_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Cosmic Kaiju

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L5–7
- **Visual span:** L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** The rubber suit somehow ends up in space. L7 perfection knocks an intergalactic monster through a visibly cardboard moon.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_cosmic_kaiju` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `kaiju_cosmic_kaiju_ready`<br>`kaiju_cosmic_kaiju_attack`<br>`kaiju_cosmic_kaiju_evade`<br>`kaiju_cosmic_kaiju_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_cosmic_kaiju_base`<br>`threat_cosmic_kaiju_attack`<br>`threat_cosmic_kaiju_recoil`<br>`threat_cosmic_kaiju_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_cosmic_kaiju_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_cosmic_kaiju_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_cosmic_kaiju_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_cosmic_kaiju_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `kaiju_cosmic_kaiju_finisher`<br>`threat_cosmic_kaiju_humiliated`<br>`fx_cosmic_kaiju_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.


# 80s TRAINING & PARTY MONTAGE

## Scale — CLIMB → `ClimbMinigame`

### Stadium Steps

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each correct note climbs one bleacher step. L4 reaches absurd upper-deck altitude at sunrise.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_stadium_steps` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_stadium_steps_advance_01`<br>`hero80_stadium_steps_advance_02`<br>`hero80_stadium_steps_advance_03`<br>`hero80_stadium_steps_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_stadium_steps_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_stadium_steps_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_stadium_steps_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_stadium_steps_dust`<br>`fx_stadium_steps_tick` | Contact feedback and clean-progress accent. |

### Dumbbell Ladder

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each note completes one controlled curl and moves to a slightly larger dumbbell.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dumbbell_ladder` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_dumbbell_ladder_advance_01`<br>`hero80_dumbbell_ladder_advance_02`<br>`hero80_dumbbell_ladder_advance_03`<br>`hero80_dumbbell_ladder_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_dumbbell_ladder_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_dumbbell_ladder_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_dumbbell_ladder_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_dumbbell_ladder_dust`<br>`fx_dumbbell_ladder_tick` | Contact feedback and clean-progress accent. |

### Beach Pushups

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Orderly reps; higher levels add people sitting on the protagonist’s back.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beach_pushups` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_beach_pushups_advance_01`<br>`hero80_beach_pushups_advance_02`<br>`hero80_beach_pushups_advance_03`<br>`hero80_beach_pushups_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_beach_pushups_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_beach_pushups_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_beach_pushups_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_beach_pushups_dust`<br>`fx_beach_pushups_tick` | Contact feedback and clean-progress accent. |

### Pull-Up Tower

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each note is another clean pull-up; the bar itself gets progressively higher and more ridiculous.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_pull_up_tower` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_pull_up_tower_advance_01`<br>`hero80_pull_up_tower_advance_02`<br>`hero80_pull_up_tower_advance_03`<br>`hero80_pull_up_tower_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_pull_up_tower_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_pull_up_tower_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_pull_up_tower_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_pull_up_tower_dust`<br>`fx_pull_up_tower_tick` | Contact feedback and clean-progress accent. |

### Rocky Stairwell

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L2–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Industrial concrete stairs, sweatband, boombox. Pure training montage.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_rocky_stairwell` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_rocky_stairwell_advance_01`<br>`hero80_rocky_stairwell_advance_02`<br>`hero80_rocky_stairwell_advance_03`<br>`hero80_rocky_stairwell_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_rocky_stairwell_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_rocky_stairwell_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_rocky_stairwell_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_rocky_stairwell_dust`<br>`fx_rocky_stairwell_tick` | Contact feedback and clean-progress accent. |

### Weight-Plate Stack

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Each correct note adds another plate to the bar; the physical climb is metaphorical but beautifully legible.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_weight_plate_stack` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_weight_plate_stack_advance_01`<br>`hero80_weight_plate_stack_advance_02`<br>`hero80_weight_plate_stack_advance_03`<br>`hero80_weight_plate_stack_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_weight_plate_stack_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_weight_plate_stack_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_weight_plate_stack_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_weight_plate_stack_dust`<br>`fx_weight_plate_stack_tick` | Contact feedback and clean-progress accent. |

### Lifeguard Tower

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–3
- **Visual span:** 4m continuous (default)
- **Scenario role:** Calm early-game climb toward a sunny beach vista.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_lifeguard_tower` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_lifeguard_tower_advance_01`<br>`hero80_lifeguard_tower_advance_02`<br>`hero80_lifeguard_tower_advance_03`<br>`hero80_lifeguard_tower_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_lifeguard_tower_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_lifeguard_tower_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_lifeguard_tower_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_lifeguard_tower_dust`<br>`fx_lifeguard_tower_tick` | Contact feedback and clean-progress accent. |

### Boardwalk Rise

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Jog uphill past evenly spaced landmarks; each note advances one marker.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_boardwalk_rise` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero80_boardwalk_rise_advance_01`<br>`hero80_boardwalk_rise_advance_02`<br>`hero80_boardwalk_rise_advance_03`<br>`hero80_boardwalk_rise_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero80_boardwalk_rise_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_boardwalk_rise_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_boardwalk_rise_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_boardwalk_rise_dust`<br>`fx_boardwalk_rise_tick` | Contact feedback and clean-progress accent. |

## Blues Lick — PERFORM → `PerformMinigame`

### Poolside Swagger

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Every phrase adds another layer of confidence; bends become exaggerated sunglasses-off, lean-back moments.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_poolside_swagger` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_poolside_swagger_perform_01`<br>`hero80_poolside_swagger_perform_02`<br>`hero80_poolside_swagger_perform_03`<br>`hero80_poolside_swagger_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_poolside_swagger_slur`<br>`hero80_poolside_swagger_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_poolside_swagger_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_poolside_swagger_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_poolside_swagger_neutral`<br>`react_poolside_swagger_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_poolside_swagger_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_poolside_swagger_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_poolside_swagger_burst` | Large Star3/completion flourish. |

### Beach Flirt

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Notes carry the protagonist through an increasingly smooth approach. A perfect full-step bend gets the other character to finally smile.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beach_flirt` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_beach_flirt_perform_01`<br>`hero80_beach_flirt_perform_02`<br>`hero80_beach_flirt_perform_03`<br>`hero80_beach_flirt_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_beach_flirt_slur`<br>`hero80_beach_flirt_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_beach_flirt_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_beach_flirt_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_beach_flirt_neutral`<br>`react_beach_flirt_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_beach_flirt_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_beach_flirt_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_beach_flirt_burst` | Large Star3/completion flourish. |

### Roller-Rink Dance

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Normal notes glide; slurs spin; bends produce huge backward leans under a disco ball.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_roller_rink_dance` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_roller_rink_dance_perform_01`<br>`hero80_roller_rink_dance_perform_02`<br>`hero80_roller_rink_dance_perform_03`<br>`hero80_roller_rink_dance_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_roller_rink_dance_slur`<br>`hero80_roller_rink_dance_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_roller_rink_dance_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_roller_rink_dance_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_roller_rink_dance_neutral`<br>`react_roller_rink_dance_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_roller_rink_dance_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_roller_rink_dance_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_roller_rink_dance_burst` | Large Star3/completion flourish. |

### Bartender Flair

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Bottles, shakers, and pours become the expressive vocabulary; bend = absurd high toss and catch.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bartender_flair` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_bartender_flair_perform_01`<br>`hero80_bartender_flair_perform_02`<br>`hero80_bartender_flair_perform_03`<br>`hero80_bartender_flair_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_bartender_flair_slur`<br>`hero80_bartender_flair_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_bartender_flair_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_bartender_flair_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_bartender_flair_neutral`<br>`react_bartender_flair_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_bartender_flair_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_bartender_flair_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_bartender_flair_burst` | Large Star3/completion flourish. |

### Boombox Dance

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Small moves become increasingly smooth, culminating in spontaneous background dancers.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_boombox_dance` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_boombox_dance_perform_01`<br>`hero80_boombox_dance_perform_02`<br>`hero80_boombox_dance_perform_03`<br>`hero80_boombox_dance_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_boombox_dance_slur`<br>`hero80_boombox_dance_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_boombox_dance_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_boombox_dance_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_boombox_dance_neutral`<br>`react_boombox_dance_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_boombox_dance_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_boombox_dance_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_boombox_dance_burst` | Large Star3/completion flourish. |

### Surf Victory Pose

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Guitar articulation maps to carving and body language; the bend is a huge slow-motion cutback.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_surf_victory_pose` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_surf_victory_pose_perform_01`<br>`hero80_surf_victory_pose_perform_02`<br>`hero80_surf_victory_pose_perform_03`<br>`hero80_surf_victory_pose_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_surf_victory_pose_slur`<br>`hero80_surf_victory_pose_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_surf_victory_pose_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_surf_victory_pose_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_surf_victory_pose_neutral`<br>`react_surf_victory_pose_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_surf_victory_pose_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_surf_victory_pose_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_surf_victory_pose_burst` | Large Star3/completion flourish. |

### Karaoke Hero

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Protagonist somehow becomes the room’s greatest singer despite clearly not being one.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_karaoke_hero` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_karaoke_hero_perform_01`<br>`hero80_karaoke_hero_perform_02`<br>`hero80_karaoke_hero_perform_03`<br>`hero80_karaoke_hero_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_karaoke_hero_slur`<br>`hero80_karaoke_hero_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_karaoke_hero_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_karaoke_hero_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_karaoke_hero_neutral`<br>`react_karaoke_hero_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_karaoke_hero_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_karaoke_hero_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_karaoke_hero_burst` | Large Star3/completion flourish. |

### Convertible Arrival

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Every phrase makes getting out of a convertible increasingly elaborate, slow-motion, and unnecessarily cool.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_convertible_arrival` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero80_convertible_arrival_perform_01`<br>`hero80_convertible_arrival_perform_02`<br>`hero80_convertible_arrival_perform_03`<br>`hero80_convertible_arrival_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero80_convertible_arrival_slur`<br>`hero80_convertible_arrival_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero80_convertible_arrival_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_convertible_arrival_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_convertible_arrival_neutral`<br>`react_convertible_arrival_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_convertible_arrival_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_convertible_arrival_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_convertible_arrival_burst` | Large Star3/completion flourish. |

## Scale Run — TRAVERSE → `TraverseMinigame`

### Surfing

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Probably the flagship. Slow patterns carve a gentle wave; L7 is a frantic tube ride with constant corrections.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_surfing` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_surfing_travel_01`<br>`hero80_surfing_travel_02`<br>`hero80_surfing_travel_03`<br>`hero80_surfing_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_surfing_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_surfing_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_surfing_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_surfing_dust`<br>`fx_surfing_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_surfing_near_miss` | Authored close-clear danger accent. |

### Rollerblade Boardwalk

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Weave through pedestrians, dogs, coolers, and beach vendors.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_rollerblade_boardwalk` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_rollerblade_boardwalk_travel_01`<br>`hero80_rollerblade_boardwalk_travel_02`<br>`hero80_rollerblade_boardwalk_travel_03`<br>`hero80_rollerblade_boardwalk_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_rollerblade_boardwalk_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_rollerblade_boardwalk_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_rollerblade_boardwalk_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_rollerblade_boardwalk_dust`<br>`fx_rollerblade_boardwalk_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_rollerblade_boardwalk_near_miss` | Authored close-clear danger accent. |

### BMX Slalom

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Staggered scale movement maps directly to weaving through cones and ramps.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bmx_slalom` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_bmx_slalom_travel_01`<br>`hero80_bmx_slalom_travel_02`<br>`hero80_bmx_slalom_travel_03`<br>`hero80_bmx_slalom_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_bmx_slalom_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_bmx_slalom_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_bmx_slalom_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_bmx_slalom_dust`<br>`fx_bmx_slalom_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_bmx_slalom_near_miss` | Authored close-clear danger accent. |

### Jet Ski Buoys

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Higher levels tighten the turns until the rider looks absurdly elite.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_jet_ski_buoys` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_jet_ski_buoys_travel_01`<br>`hero80_jet_ski_buoys_travel_02`<br>`hero80_jet_ski_buoys_travel_03`<br>`hero80_jet_ski_buoys_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_jet_ski_buoys_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_jet_ski_buoys_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_jet_ski_buoys_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_jet_ski_buoys_dust`<br>`fx_jet_ski_buoys_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_jet_ski_buoys_near_miss` | Authored close-clear danger accent. |

### Water Ski

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Navigate wakes, boats, and ramps behind an increasingly ridiculous speedboat.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_water_ski` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_water_ski_travel_01`<br>`hero80_water_ski_travel_02`<br>`hero80_water_ski_travel_03`<br>`hero80_water_ski_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_water_ski_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_water_ski_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_water_ski_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_water_ski_dust`<br>`fx_water_ski_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_water_ski_near_miss` | Authored close-clear danger accent. |

### Beach Obstacle Course

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Towels, umbrellas, volleyball nets, and coolers become a comic traversal gauntlet.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beach_obstacle_course` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_beach_obstacle_course_travel_01`<br>`hero80_beach_obstacle_course_travel_02`<br>`hero80_beach_obstacle_course_travel_03`<br>`hero80_beach_obstacle_course_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_beach_obstacle_course_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_beach_obstacle_course_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_beach_obstacle_course_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_beach_obstacle_course_dust`<br>`fx_beach_obstacle_course_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_beach_obstacle_course_near_miss` | Authored close-clear danger accent. |

### Speedboat Run

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L3–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Fast levels dodge docks, buoys, and other boats; ideal for the genuinely threatening exercises.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_speedboat_run` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_speedboat_run_travel_01`<br>`hero80_speedboat_run_travel_02`<br>`hero80_speedboat_run_travel_03`<br>`hero80_speedboat_run_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_speedboat_run_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_speedboat_run_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_speedboat_run_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_speedboat_run_dust`<br>`fx_speedboat_run_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_speedboat_run_near_miss` | Authored close-clear danger accent. |

### Dune Buggy

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Desert-beach course with jumps and sudden direction changes; a very clean scale-run visualization.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dune_buggy` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero80_dune_buggy_travel_01`<br>`hero80_dune_buggy_travel_02`<br>`hero80_dune_buggy_travel_03`<br>`hero80_dune_buggy_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero80_dune_buggy_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_dune_buggy_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_dune_buggy_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_dune_buggy_dust`<br>`fx_dune_buggy_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_dune_buggy_near_miss` | Authored close-clear danger accent. |

## Triplets — THREE-STEP → `ThreeStepMinigame`

### Bump-Set-SPIKE

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Almost perfect. The three-note unit is inherently understandable and the altered ending can change the spike.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bump_set_spike` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_bump_set_spike_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_bump_set_spike_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_bump_set_spike_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_bump_set_spike_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_bump_set_spike_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_bump_set_spike_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_bump_set_spike_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_bump_set_spike_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_bump_set_spike_accent` | Triplet-group punctuation / threshold accent. |

### Jab-Cross-HOOK

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Boxing gym. Slow learning versions become devastating triplet combinations later.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_jab_cross_hook` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_jab_cross_hook_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_jab_cross_hook_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_jab_cross_hook_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_jab_cross_hook_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_jab_cross_hook_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_jab_cross_hook_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_jab_cross_hook_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_jab_cross_hook_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_jab_cross_hook_accent` | Triplet-group punctuation / threshold accent. |

### Aerobics Three-Step

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Step-step-KICK. Increasingly large synchronized class joins in.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_aerobics_three_step` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_aerobics_three_step_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_aerobics_three_step_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_aerobics_three_step_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_aerobics_three_step_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_aerobics_three_step_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_aerobics_three_step_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_aerobics_three_step_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_aerobics_three_step_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_aerobics_three_step_accent` | Triplet-group punctuation / threshold accent. |

### Jump-Rope Triple

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Two normal skips and one trick move; different ending phrase introduces new tricks.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_jump_rope_triple` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_jump_rope_triple_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_jump_rope_triple_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_jump_rope_triple_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_jump_rope_triple_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_jump_rope_triple_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_jump_rope_triple_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_jump_rope_triple_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_jump_rope_triple_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_jump_rope_triple_accent` | Triplet-group punctuation / threshold accent. |

### Hacky Sack

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Left-right-TRICK. Moving starting notes changes the player’s body position naturally.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_hacky_sack` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_hacky_sack_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_hacky_sack_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_hacky_sack_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_hacky_sack_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_hacky_sack_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_hacky_sack_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_hacky_sack_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_hacky_sack_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_hacky_sack_accent` | Triplet-group punctuation / threshold accent. |

### Dance Combo

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Three linked dance movements; at high levels the whole party joins.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dance_combo` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_dance_combo_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_dance_combo_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_dance_combo_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_dance_combo_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_dance_combo_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_dance_combo_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_dance_combo_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_dance_combo_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_dance_combo_accent` | Triplet-group punctuation / threshold accent. |

### Frisbee Rhythm

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Run-run-CATCH. Good for earlier triplet learning.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_frisbee_rhythm` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_frisbee_rhythm_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_frisbee_rhythm_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_frisbee_rhythm_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_frisbee_rhythm_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_frisbee_rhythm_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_frisbee_rhythm_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_frisbee_rhythm_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_frisbee_rhythm_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_frisbee_rhythm_accent` | Triplet-group punctuation / threshold accent. |

### Diving Board

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Approach, bounce, launch. Advanced versions change the trick or landing on the final triplet.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_diving_board` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero80_diving_board_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero80_diving_board_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero80_diving_board_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero80_diving_board_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero80_diving_board_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_diving_board_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_diving_board_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_diving_board_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_diving_board_accent` | Triplet-group punctuation / threshold accent. |

## Straight Sixteenths — REPEAT → `RepeatMinigame`

### OPEN THE BEERS

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 1m — refresh beers; drunk/crowd tier persists
- **Repeat mode:** `sequence`
- **Scenario role:** The definitive version. A line of cans: `PSHT PSHT PSHT PSHT`. Four is competence; 64 is a supernatural gift.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_open_the_beers` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_open_the_beers_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_open_the_beers_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_open_the_beers_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_open_the_beers_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_open_the_beers_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_open_the_beers_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_open_the_beers_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_open_the_beers_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Speed Bag

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous — virtuosity becomes hypnotic
- **Repeat mode:** `accumulate`
- **Scenario role:** Pure elite repetition. More correct notes turn mundane boxing practice into hypnotic virtuosity.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_speed_bag` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_speed_bag_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_speed_bag_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_speed_bag_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_speed_bag_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_speed_bag_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_speed_bag_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_speed_bag_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_speed_bag_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Pushups

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous — rep count/crowd accumulate
- **Repeat mode:** `sequence`
- **Scenario role:** Straightforward at four reps, preposterous at 64. Crowd slowly gathers to watch.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_pushups` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_pushups_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_pushups_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_pushups_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_pushups_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_pushups_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_pushups_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_pushups_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_pushups_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Cocktail Shaker

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous — bartender blur escalates
- **Repeat mode:** `accumulate`
- **Scenario role:** Each note is another sharp shake. Sustained accuracy eventually creates bartender blur.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_cocktail_shaker` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_cocktail_shaker_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_cocktail_shaker_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_cocktail_shaker_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_cocktail_shaker_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_cocktail_shaker_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_cocktail_shaker_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_cocktail_shaker_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_cocktail_shaker_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Can Crushing

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 1m — refresh cans/objects; drunk/crowd tier persists
- **Repeat mode:** `sequence`
- **Scenario role:** One-handed crush after crush. Later levels graduate from beer cans to objects that absolutely should not crush.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_can_crushing` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_can_crushing_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_can_crushing_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_can_crushing_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_can_crushing_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_can_crushing_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_can_crushing_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_can_crushing_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_can_crushing_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Party Cup Fill

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–5
- **Visual span:** 1m — refresh cup line
- **Repeat mode:** `sequence`
- **Scenario role:** Tap, fill, slide, next. Best for early/middle quotas where the joke remains legible.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_party_cup_fill` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_party_cup_fill_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_party_cup_fill_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_party_cup_fill_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_party_cup_fill_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_party_cup_fill_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_party_cup_fill_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_party_cup_fill_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_party_cup_fill_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Beach-Ball Tap

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous — taps and crowd accumulate
- **Repeat mode:** `accumulate`
- **Scenario role:** Keep a beach ball aloft with one tiny perfect tap per note; elite performance attracts an entire circle of players.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beach_ball_tap` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_beach_ball_tap_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_beach_ball_tap_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_beach_ball_tap_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_beach_ball_tap_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_beach_ball_tap_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_beach_ball_tap_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_beach_ball_tap_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_beach_ball_tap_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Arcade Button

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous — crowd astonishment accumulates
- **Repeat mode:** `sequence`
- **Scenario role:** Protagonist annihilates a cabinet’s button while an increasingly astonished arcade crowd watches.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_arcade_button` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero80_arcade_button_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero80_arcade_button_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero80_arcade_button_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_arcade_button_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_arcade_button_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_arcade_button_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_arcade_button_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_arcade_button_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

## Sixteenth Phrases — BATTLE / SURVIVE → `BattleMinigame`

### Beach Bully

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Training montage pays off in a ridiculous beach fight. Low levels survive; high levels embarrass the antagonist.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_beach_bully` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_beach_bully_ready`<br>`hero80_beach_bully_attack`<br>`hero80_beach_bully_evade`<br>`hero80_beach_bully_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_beach_bully_base`<br>`threat_beach_bully_attack`<br>`threat_beach_bully_recoil`<br>`threat_beach_bully_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_beach_bully_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_beach_bully_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_beach_bully_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_beach_bully_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_beach_bully_finisher`<br>`threat_beach_bully_humiliated`<br>`fx_beach_bully_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Monster Wave

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `survival/catastrophe`
- **Scenario role:** Surfing becomes boss combat. Phrase notes carve, duck, recover, and finally dominate the wave.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_monster_wave` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_monster_wave_ready`<br>`hero80_monster_wave_attack`<br>`hero80_monster_wave_evade`<br>`hero80_monster_wave_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_monster_wave_base`<br>`threat_monster_wave_attack`<br>`threat_monster_wave_recoil`<br>`threat_monster_wave_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_monster_wave_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_monster_wave_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_monster_wave_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_monster_wave_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_monster_wave_finisher`<br>`threat_monster_wave_humiliated`<br>`fx_monster_wave_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Gym Rival

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** Competitive lifting, not literal violence. Phrases control bench, clean, press, and increasingly absurd feats.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_gym_rival` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_gym_rival_ready`<br>`hero80_gym_rival_attack`<br>`hero80_gym_rival_evade`<br>`hero80_gym_rival_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_gym_rival_base`<br>`threat_gym_rival_attack`<br>`threat_gym_rival_recoil`<br>`threat_gym_rival_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_gym_rival_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_gym_rival_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_gym_rival_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_gym_rival_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_gym_rival_finisher`<br>`threat_gym_rival_humiliated`<br>`fx_gym_rival_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Volleyball Championship

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** Long phrases become extended rallies; each successful cluster pushes toward a ludicrous match-winning spike.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_volleyball_championship` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_volleyball_championship_ready`<br>`hero80_volleyball_championship_attack`<br>`hero80_volleyball_championship_evade`<br>`hero80_volleyball_championship_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_volleyball_championship_base`<br>`threat_volleyball_championship_attack`<br>`threat_volleyball_championship_recoil`<br>`threat_volleyball_championship_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_volleyball_championship_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_volleyball_championship_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_volleyball_championship_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_volleyball_championship_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_volleyball_championship_finisher`<br>`threat_volleyball_championship_humiliated`<br>`fx_volleyball_championship_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Dance-Off

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** The “battle” is pure dominance. Sixteenth phrases unleash increasingly impossible choreography.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dance_off` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_dance_off_ready`<br>`hero80_dance_off_attack`<br>`hero80_dance_off_evade`<br>`hero80_dance_off_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_dance_off_base`<br>`threat_dance_off_attack`<br>`threat_dance_off_recoil`<br>`threat_dance_off_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_dance_off_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_dance_off_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_dance_off_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_dance_off_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_dance_off_finisher`<br>`threat_dance_off_humiliated`<br>`fx_dance_off_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Storm Boat Race

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L3–7
- **Visual span:** L3–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `survival/catastrophe`
- **Scenario role:** Party spills onto boats; phrase accuracy keeps the hero alive through waves, ramps, and debris.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_storm_boat_race` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_storm_boat_race_ready`<br>`hero80_storm_boat_race_attack`<br>`hero80_storm_boat_race_evade`<br>`hero80_storm_boat_race_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_storm_boat_race_base`<br>`threat_storm_boat_race_attack`<br>`threat_storm_boat_race_recoil`<br>`threat_storm_boat_race_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_storm_boat_race_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_storm_boat_race_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_storm_boat_race_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_storm_boat_race_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_storm_boat_race_finisher`<br>`threat_storm_boat_race_humiliated`<br>`fx_storm_boat_race_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Party Shutdown

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** An officious lifeguard or security guy tries to end the party. Every phrase somehow causes the party to become bigger instead.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_party_shutdown` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_party_shutdown_ready`<br>`hero80_party_shutdown_attack`<br>`hero80_party_shutdown_evade`<br>`hero80_party_shutdown_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_party_shutdown_base`<br>`threat_party_shutdown_attack`<br>`threat_party_shutdown_recoil`<br>`threat_party_shutdown_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_party_shutdown_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_party_shutdown_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_party_shutdown_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_party_shutdown_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_party_shutdown_finisher`<br>`threat_party_shutdown_humiliated`<br>`fx_party_shutdown_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Burning Yacht Keg Rescue

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L5–7
- **Visual span:** L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Peak 80s logic: yacht on fire, keg endangered. Perfect 64-note run saves keg, party, and possibly civilization.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_burning_yacht_keg_rescue` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero80_burning_yacht_keg_rescue_ready`<br>`hero80_burning_yacht_keg_rescue_attack`<br>`hero80_burning_yacht_keg_rescue_evade`<br>`hero80_burning_yacht_keg_rescue_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_burning_yacht_keg_rescue_base`<br>`threat_burning_yacht_keg_rescue_attack`<br>`threat_burning_yacht_keg_rescue_recoil`<br>`threat_burning_yacht_keg_rescue_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_burning_yacht_keg_rescue_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_burning_yacht_keg_rescue_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_burning_yacht_keg_rescue_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_burning_yacht_keg_rescue_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero80_burning_yacht_keg_rescue_finisher`<br>`threat_burning_yacht_keg_rescue_humiliated`<br>`fx_burning_yacht_keg_rescue_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.


# PETTY EPIC FANTASY

## Scale — CLIMB → `ClimbMinigame`

### Broken Dungeon Elevator

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Hero has to take the stairs because the lift is out. Every increasingly epic floor makes him more irritated.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_broken_dungeon_elevator` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_broken_dungeon_elevator_advance_01`<br>`hero_fantasy_broken_dungeon_elevator_advance_02`<br>`hero_fantasy_broken_dungeon_elevator_advance_03`<br>`hero_fantasy_broken_dungeon_elevator_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_broken_dungeon_elevator_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_broken_dungeon_elevator_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_broken_dungeon_elevator_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_broken_dungeon_elevator_dust`<br>`fx_broken_dungeon_elevator_tick` | Contact feedback and clean-progress accent. |

### Noise Complaint Tower

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Climb a sorcerer’s tower solely to ask him to turn the music down.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_noise_complaint_tower` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_noise_complaint_tower_advance_01`<br>`hero_fantasy_noise_complaint_tower_advance_02`<br>`hero_fantasy_noise_complaint_tower_advance_03`<br>`hero_fantasy_noise_complaint_tower_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_noise_complaint_tower_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_noise_complaint_tower_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_noise_complaint_tower_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_noise_complaint_tower_dust`<br>`fx_noise_complaint_tower_tick` | Contact feedback and clean-progress accent. |

### Grocery Castle

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–3
- **Visual span:** 4m continuous (default)
- **Scenario role:** Carry grocery sacks up endless stone stairs because nobody offered to help.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_grocery_castle` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_grocery_castle_advance_01`<br>`hero_fantasy_grocery_castle_advance_02`<br>`hero_fantasy_grocery_castle_advance_03`<br>`hero_fantasy_grocery_castle_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_grocery_castle_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_grocery_castle_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_grocery_castle_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_grocery_castle_dust`<br>`fx_grocery_castle_tick` | Contact feedback and clean-progress accent. |

### Throne-Room Queue

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Move one ceremonial step forward per note through an insanely long bureaucratic line.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_throne_room_queue` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_throne_room_queue_advance_01`<br>`hero_fantasy_throne_room_queue_advance_02`<br>`hero_fantasy_throne_room_queue_advance_03`<br>`hero_fantasy_throne_room_queue_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_throne_room_queue_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_throne_room_queue_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_throne_room_queue_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_throne_room_queue_dust`<br>`fx_throne_room_queue_tick` | Contact feedback and clean-progress accent. |

### Dragon Hoard Receipt

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L2–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Climb a mountain of treasure to recover one exact coin because the merchant gave incorrect change.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dragon_hoard_receipt` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_dragon_hoard_receipt_advance_01`<br>`hero_fantasy_dragon_hoard_receipt_advance_02`<br>`hero_fantasy_dragon_hoard_receipt_advance_03`<br>`hero_fantasy_dragon_hoard_receipt_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_dragon_hoard_receipt_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_dragon_hoard_receipt_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_dragon_hoard_receipt_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_dragon_hoard_receipt_dust`<br>`fx_dragon_hoard_receipt_tick` | Contact feedback and clean-progress accent. |

### Restroom Spiral

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Hero climbs a grand infernal tower trying to find the restroom. Each floor sign points higher.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_restroom_spiral` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_restroom_spiral_advance_01`<br>`hero_fantasy_restroom_spiral_advance_02`<br>`hero_fantasy_restroom_spiral_advance_03`<br>`hero_fantasy_restroom_spiral_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_restroom_spiral_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_restroom_spiral_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_restroom_spiral_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_restroom_spiral_dust`<br>`fx_restroom_spiral_tick` | Contact feedback and clean-progress accent. |

### Valet Hill

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L1–3
- **Visual span:** 4m continuous (default)
- **Scenario role:** Walk up an enormous mountain because the horse valet “can’t find the ticket.”

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_valet_hill` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_valet_hill_advance_01`<br>`hero_fantasy_valet_hill_advance_02`<br>`hero_fantasy_valet_hill_advance_03`<br>`hero_fantasy_valet_hill_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_valet_hill_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_valet_hill_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_valet_hill_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_valet_hill_dust`<br>`fx_valet_hill_tick` | Contact feedback and clean-progress accent. |

### Cursed Library Ladder

- **Minigame class:** `ClimbMinigame`
- **Supported levels:** L2–4
- **Visual span:** 4m continuous (default)
- **Scenario role:** Climb impossible bookshelves to return a scroll before accruing another late fee.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_cursed_library_ladder` | Opaque scenario backdrop. |
| `climberPoses[]` | `hero_fantasy_cursed_library_ladder_advance_01`<br>`hero_fantasy_cursed_library_ladder_advance_02`<br>`hero_fantasy_cursed_library_ladder_advance_03`<br>`hero_fantasy_cursed_library_ladder_advance_04` | Reusable advance/step pose cycle. |
| `finishPose` | `hero_fantasy_cursed_library_ladder_finish` | Successful endpoint / completion pose. |
| `waypointVisuals[]` | `prop_cursed_library_ladder_step` | Reusable foothold/step/marker instance. |
| `destinationVisual` | `prop_cursed_library_ladder_goal` | Visible endpoint or goal object. |
| `stepEffects[]` | `fx_cursed_library_ladder_dust`<br>`fx_cursed_library_ladder_tick` | Contact feedback and clean-progress accent. |

## Blues Lick — PERFORM → `PerformMinigame`

### Tavern Complaint

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** The hero tries to explain that the bard is too loud. Slurs become increasingly elaborate hand gestures; bend becomes a full-body incredulous lean.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tavern_complaint` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_tavern_complaint_perform_01`<br>`hero_fantasy_tavern_complaint_perform_02`<br>`hero_fantasy_tavern_complaint_perform_03`<br>`hero_fantasy_tavern_complaint_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_tavern_complaint_slur`<br>`hero_fantasy_tavern_complaint_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_tavern_complaint_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_tavern_complaint_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_tavern_complaint_neutral`<br>`react_tavern_complaint_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_tavern_complaint_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_tavern_complaint_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_tavern_complaint_burst` | Large Star3/completion flourish. |

### Potion Haggling

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Every phrase advances a negotiation over a two-copper price discrepancy. Full-step bend = “TWO COPPER?!”

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_potion_haggling` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_potion_haggling_perform_01`<br>`hero_fantasy_potion_haggling_perform_02`<br>`hero_fantasy_potion_haggling_perform_03`<br>`hero_fantasy_potion_haggling_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_potion_haggling_slur`<br>`hero_fantasy_potion_haggling_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_potion_haggling_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_potion_haggling_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_potion_haggling_neutral`<br>`react_potion_haggling_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_potion_haggling_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_potion_haggling_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_potion_haggling_burst` | Large Star3/completion flourish. |

### Dinner Order

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Hero repeatedly explains that he asked for the dragon sauce *on the side*. Increasing expression generates escalating waiter confusion.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dinner_order` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_dinner_order_perform_01`<br>`hero_fantasy_dinner_order_perform_02`<br>`hero_fantasy_dinner_order_perform_03`<br>`hero_fantasy_dinner_order_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_dinner_order_slur`<br>`hero_fantasy_dinner_order_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_dinner_order_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_dinner_order_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_dinner_order_neutral`<br>`react_dinner_order_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_dinner_order_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_dinner_order_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_dinner_order_burst` | Large Star3/completion flourish. |

### Quest Refusal

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Wizard keeps pitching a heroic quest; every lick is another increasingly elaborate “No.”

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_quest_refusal` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_quest_refusal_perform_01`<br>`hero_fantasy_quest_refusal_perform_02`<br>`hero_fantasy_quest_refusal_perform_03`<br>`hero_fantasy_quest_refusal_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_quest_refusal_slur`<br>`hero_fantasy_quest_refusal_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_quest_refusal_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_quest_refusal_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_quest_refusal_neutral`<br>`react_quest_refusal_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_quest_refusal_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_quest_refusal_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_quest_refusal_burst` | Large Star3/completion flourish. |

### Passive-Aggressive Toast

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** At a barbarian feast, the hero gives a “complimentary” speech clearly aimed at one person.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_passive_aggressive_toast` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_passive_aggressive_toast_perform_01`<br>`hero_fantasy_passive_aggressive_toast_perform_02`<br>`hero_fantasy_passive_aggressive_toast_perform_03`<br>`hero_fantasy_passive_aggressive_toast_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_passive_aggressive_toast_slur`<br>`hero_fantasy_passive_aggressive_toast_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_passive_aggressive_toast_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_passive_aggressive_toast_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_passive_aggressive_toast_neutral`<br>`react_passive_aggressive_toast_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_passive_aggressive_toast_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_passive_aggressive_toast_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_passive_aggressive_toast_burst` | Large Star3/completion flourish. |

### Cursed Armor Fitting

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Hero tries on magnificent armor and keeps identifying minor tailoring problems.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_cursed_armor_fitting` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_cursed_armor_fitting_perform_01`<br>`hero_fantasy_cursed_armor_fitting_perform_02`<br>`hero_fantasy_cursed_armor_fitting_perform_03`<br>`hero_fantasy_cursed_armor_fitting_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_cursed_armor_fitting_slur`<br>`hero_fantasy_cursed_armor_fitting_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_cursed_armor_fitting_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_cursed_armor_fitting_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_cursed_armor_fitting_neutral`<br>`react_cursed_armor_fitting_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_cursed_armor_fitting_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_cursed_armor_fitting_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_cursed_armor_fitting_burst` | Large Star3/completion flourish. |

### Parking Etiquette Lecture

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Hero explains to a demon why occupying two chariot spaces is unacceptable.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_parking_etiquette_lecture` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_parking_etiquette_lecture_perform_01`<br>`hero_fantasy_parking_etiquette_lecture_perform_02`<br>`hero_fantasy_parking_etiquette_lecture_perform_03`<br>`hero_fantasy_parking_etiquette_lecture_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_parking_etiquette_lecture_slur`<br>`hero_fantasy_parking_etiquette_lecture_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_parking_etiquette_lecture_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_parking_etiquette_lecture_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_parking_etiquette_lecture_neutral`<br>`react_parking_etiquette_lecture_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_parking_etiquette_lecture_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_parking_etiquette_lecture_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_parking_etiquette_lecture_burst` | Large Star3/completion flourish. |

### Bard Feedback

- **Minigame class:** `PerformMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** The hero demonstrates how the tavern singer *should* have phrased the song, accidentally becoming an incredible heavy-metal frontman.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bard_feedback` | Opaque performance stage/backdrop. |
| `performerPoses[]` | `hero_fantasy_bard_feedback_perform_01`<br>`hero_fantasy_bard_feedback_perform_02`<br>`hero_fantasy_bard_feedback_perform_03`<br>`hero_fantasy_bard_feedback_perform_04` | Reusable normal-note performance pose cycle. |
| `flourishPoses[]` | `hero_fantasy_bard_feedback_slur`<br>`hero_fantasy_bard_feedback_bend` | Distinctive expressive poses selected by slur/bend visual tags. |
| `finishPose` | `hero_fantasy_bard_feedback_finish` | Best earned completion pose. |
| `signatureProps[]` | `prop_bard_feedback_signature` | Scenario-specific prop/staging object manipulated by transforms. |
| `audienceStates[]` | `react_bard_feedback_neutral`<br>`react_bard_feedback_impressed` | Registered reaction-state swap at performance thresholds. |
| `flourishEffects[]` | `fx_bard_feedback_swoosh` | Slur/bend gesture accent. |
| `accentEffects[]` | `fx_bard_feedback_sparkle` | Small successful-note/performance highlight. |
| `payoffEffects[]` | `fx_bard_feedback_burst` | Large Star3/completion flourish. |

## Scale Run — TRAVERSE → `TraverseMinigame`

### Parking Meter

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Sprint through a medieval city before the chimera parking officer writes a ticket. High levels become life-or-death over twelve minutes of expired time.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_parking_meter` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_parking_meter_travel_01`<br>`hero_fantasy_parking_meter_travel_02`<br>`hero_fantasy_parking_meter_travel_03`<br>`hero_fantasy_parking_meter_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_parking_meter_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_parking_meter_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_parking_meter_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_parking_meter_dust`<br>`fx_parking_meter_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_parking_meter_near_miss` | Authored close-clear danger accent. |

### Escape the Chatty Wizard

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Navigate corridors while a wizard relentlessly attempts small talk.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_escape_the_chatty_wizard` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_escape_the_chatty_wizard_travel_01`<br>`hero_fantasy_escape_the_chatty_wizard_travel_02`<br>`hero_fantasy_escape_the_chatty_wizard_travel_03`<br>`hero_fantasy_escape_the_chatty_wizard_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_escape_the_chatty_wizard_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_escape_the_chatty_wizard_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_escape_the_chatty_wizard_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_escape_the_chatty_wizard_dust`<br>`fx_escape_the_chatty_wizard_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_escape_the_chatty_wizard_near_miss` | Authored close-clear danger accent. |

### Library Late Fee

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Rush a cursed book back before midnight; escalating hazards exist only because the fee is one copper.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_library_late_fee` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_library_late_fee_travel_01`<br>`hero_fantasy_library_late_fee_travel_02`<br>`hero_fantasy_library_late_fee_travel_03`<br>`hero_fantasy_library_late_fee_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_library_late_fee_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_library_late_fee_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_library_late_fee_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_library_late_fee_dust`<br>`fx_library_late_fee_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_library_late_fee_near_miss` | Authored close-clear danger accent. |

### Quest-Giver Slalom

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Weave through NPCs attempting to burden you with side quests.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_quest_giver_slalom` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_quest_giver_slalom_travel_01`<br>`hero_fantasy_quest_giver_slalom_travel_02`<br>`hero_fantasy_quest_giver_slalom_travel_03`<br>`hero_fantasy_quest_giver_slalom_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_quest_giver_slalom_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_quest_giver_slalom_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_quest_giver_slalom_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_quest_giver_slalom_dust`<br>`fx_quest_giver_slalom_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_quest_giver_slalom_near_miss` | Authored close-clear danger accent. |

### Bazaar Restroom

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Navigate an impossibly crowded marketplace while increasingly desperate.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_bazaar_restroom` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_bazaar_restroom_travel_01`<br>`hero_fantasy_bazaar_restroom_travel_02`<br>`hero_fantasy_bazaar_restroom_travel_03`<br>`hero_fantasy_bazaar_restroom_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_bazaar_restroom_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_bazaar_restroom_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_bazaar_restroom_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_bazaar_restroom_dust`<br>`fx_bazaar_restroom_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_bazaar_restroom_near_miss` | Authored close-clear danger accent. |

### Waiter With the Check

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Chase the waiter because the bill is clearly wrong.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_waiter_with_the_check` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_waiter_with_the_check_travel_01`<br>`hero_fantasy_waiter_with_the_check_travel_02`<br>`hero_fantasy_waiter_with_the_check_travel_03`<br>`hero_fantasy_waiter_with_the_check_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_waiter_with_the_check_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_waiter_with_the_check_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_waiter_with_the_check_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_waiter_with_the_check_dust`<br>`fx_waiter_with_the_check_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_waiter_with_the_check_near_miss` | Authored close-clear danger accent. |

### Reservation Dash

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L3–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Cross an active fantasy battlefield because the restaurant will only hold the table for ten minutes.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_reservation_dash` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_reservation_dash_travel_01`<br>`hero_fantasy_reservation_dash_travel_02`<br>`hero_fantasy_reservation_dash_travel_03`<br>`hero_fantasy_reservation_dash_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_reservation_dash_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_reservation_dash_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_reservation_dash_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_reservation_dash_dust`<br>`fx_reservation_dash_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_reservation_dash_near_miss` | Authored close-clear danger accent. |

### Horse-Valet Chase

- **Minigame class:** `TraverseMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Valet returns the wrong horse. Hero pursues the correct one through progressively more epic terrain.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_horse_valet_chase` | Static/scrolling traversal backdrop. |
| `travelerPoses[]` | `hero_fantasy_horse_valet_chase_travel_01`<br>`hero_fantasy_horse_valet_chase_travel_02`<br>`hero_fantasy_horse_valet_chase_travel_03`<br>`hero_fantasy_horse_valet_chase_travel_04` | Reusable route-navigation pose cycle. |
| `finishPose` | `hero_fantasy_horse_valet_chase_finish` | Endpoint / controlled stop pose. |
| `waypointVisuals[]` | `prop_horse_valet_chase_waypoint` | Reusable route marker/obstacle instance. |
| `hazardVisuals[]` | `prop_horse_valet_chase_hazard` | Persistent/repeated danger source. |
| `travelEffects[]` | `fx_horse_valet_chase_dust`<br>`fx_horse_valet_chase_speed` | Contact and velocity feedback. |
| `nearMissEffects[]` | `fx_horse_valet_chase_near_miss` | Authored close-clear danger accent. |

## Triplets — THREE-STEP → `ThreeStepMinigame`

### Knock-Knock-KNOCK

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Hero tries to get a wizard to answer his door. The third knock becomes progressively more hostile.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_knock_knock_knock` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_knock_knock_knock_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_knock_knock_knock_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_knock_knock_knock_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_knock_knock_knock_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_knock_knock_knock_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_knock_knock_knock_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_knock_knock_knock_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_knock_knock_knock_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_knock_knock_knock_accent` | Triplet-group punctuation / threshold accent. |

### Point-Shrug-SIGH

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Three-part argument gesture repeated rhythmically; altered endings substitute eye roll, grimace, or walk-away.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_point_shrug_sigh` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_point_shrug_sigh_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_point_shrug_sigh_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_point_shrug_sigh_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_point_shrug_sigh_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_point_shrug_sigh_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_point_shrug_sigh_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_point_shrug_sigh_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_point_shrug_sigh_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_point_shrug_sigh_accent` | Triplet-group punctuation / threshold accent. |

### Fork-Knife-GOBLET

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–5
- **Visual span:** 4m continuous (default)
- **Scenario role:** Correct an improperly set royal banquet one triplet at a time.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_fork_knife_goblet` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_fork_knife_goblet_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_fork_knife_goblet_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_fork_knife_goblet_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_fork_knife_goblet_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_fork_knife_goblet_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_fork_knife_goblet_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_fork_knife_goblet_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_fork_knife_goblet_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_fork_knife_goblet_accent` | Triplet-group punctuation / threshold accent. |

### Step-Step-STOP

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Move forward in a queue until somebody cuts in; final subdivision becomes an indignant halt.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_step_step_stop` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_step_step_stop_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_step_step_stop_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_step_step_stop_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_step_step_stop_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_step_step_stop_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_step_step_stop_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_step_step_stop_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_step_step_stop_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_step_step_stop_accent` | Triplet-group punctuation / threshold accent. |

### Look-Look-STARE

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Hero repeatedly checks whether another patron is going to acknowledge an obvious social violation.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_look_look_stare` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_look_look_stare_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_look_look_stare_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_look_look_stare_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_look_look_stare_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_look_look_stare_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_look_look_stare_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_look_look_stare_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_look_look_stare_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_look_look_stare_accent` | Triplet-group punctuation / threshold accent. |

### Goblin-Goblin-MANAGER

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L2–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** Get past two employees, then demand the manager. Advanced variants move the interaction around the establishment.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_goblin_goblin_manager` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_goblin_goblin_manager_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_goblin_goblin_manager_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_goblin_goblin_manager_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_goblin_goblin_manager_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_goblin_goblin_manager_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_goblin_goblin_manager_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_goblin_goblin_manager_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_goblin_goblin_manager_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_goblin_goblin_manager_accent` | Triplet-group punctuation / threshold accent. |

### Cloak-Cloak-DOOR

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L2–6
- **Visual span:** 4m continuous (default)
- **Scenario role:** Gather cloak, gather again, dramatically exit. Different endings reveal another reason he has to come back inside.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_cloak_cloak_door` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_cloak_cloak_door_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_cloak_cloak_door_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_cloak_cloak_door_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_cloak_cloak_door_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_cloak_cloak_door_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_cloak_cloak_door_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_cloak_cloak_door_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_cloak_cloak_door_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_cloak_cloak_door_accent` | Triplet-group punctuation / threshold accent. |

### Tap-Tap-AHEM

- **Minigame class:** `ThreeStepMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous (default)
- **Scenario role:** The pure passive-aggressive triplet. At Level 7 it somehow summons lightning.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_tap_tap_ahem` | Opaque three-step staging backdrop. |
| `stepAPoseOrEffect` | `hero_fantasy_tap_tap_ahem_step_1` | First subdivision action. |
| `stepBPoseOrEffect` | `hero_fantasy_tap_tap_ahem_step_2` | Second subdivision action. |
| `stepCPoseOrEffect` | `hero_fantasy_tap_tap_ahem_step_3` | Strong third subdivision action. |
| `alternateStepC[]` | `hero_fantasy_tap_tap_ahem_step_3_alt` | Mutated phrase ending / alternate third action. |
| `finishPose` | `hero_fantasy_tap_tap_ahem_finish` | Final resolved three-step pose. |
| `targetVisuals[]` | `prop_tap_tap_ahem_target` | Reusable object/target for the three-beat action. |
| `minorStepEffects[]` | `fx_tap_tap_ahem_hit_small` | Small A/B subdivision impact. |
| `majorStepEffects[]` | `fx_tap_tap_ahem_hit_big` | Large C subdivision impact. |
| `groupEffects[]` | `fx_tap_tap_ahem_accent` | Triplet-group punctuation / threshold accent. |

## Straight Sixteenths — REPEAT → `RepeatMinigame`

### Service Bell

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous — irritation escalates across all dings
- **Repeat mode:** `sequence`
- **Scenario role:** `DING DING DING DING.` The hero becomes increasingly furious that no one is coming.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_service_bell` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_service_bell_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_service_bell_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_service_bell_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_service_bell_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_service_bell_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_service_bell_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_service_bell_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_service_bell_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Complaint Stamps

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 1m — fresh grievance stack; bureaucracy tier persists
- **Repeat mode:** `sequence`
- **Scenario role:** Stamp formal grievance after grievance with impossible administrative speed.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_complaint_stamps` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_complaint_stamps_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_complaint_stamps_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_complaint_stamps_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_complaint_stamps_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_complaint_stamps_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_complaint_stamps_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_complaint_stamps_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_complaint_stamps_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Neighbor Wall

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–6
- **Visual span:** 4m continuous — damage/anger accumulate
- **Repeat mode:** `sequence`
- **Scenario role:** Repeatedly knock on a castle wall because the barbarian next door is practicing drums.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_neighbor_wall` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_neighbor_wall_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_neighbor_wall_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_neighbor_wall_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_neighbor_wall_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_neighbor_wall_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_neighbor_wall_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_neighbor_wall_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_neighbor_wall_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Crumb Flick

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–5
- **Visual span:** 1m — refresh table section
- **Repeat mode:** `accumulate`
- **Scenario role:** Hero removes crumbs from a banquet table with insane rhythmic precision.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_crumb_flick` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_crumb_flick_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_crumb_flick_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_crumb_flick_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_crumb_flick_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_crumb_flick_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_crumb_flick_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_crumb_flick_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_crumb_flick_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Potion Corks

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 1m — refresh bottle crate
- **Repeat mode:** `sequence`
- **Scenario role:** Pop dozens of tiny bottles because the apothecary refuses to sell a larger size.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_potion_corks` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_potion_corks_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_potion_corks_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_potion_corks_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_potion_corks_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_potion_corks_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_potion_corks_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_potion_corks_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_potion_corks_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Queue Foot Tap

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–7
- **Visual span:** 4m continuous — hostility accumulates
- **Repeat mode:** `accumulate`
- **Scenario role:** Every correct sixteenth is one increasingly hostile foot tap.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_queue_foot_tap` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_queue_foot_tap_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_queue_foot_tap_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_queue_foot_tap_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_queue_foot_tap_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_queue_foot_tap_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_queue_foot_tap_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_queue_foot_tap_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_queue_foot_tap_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** keep target/accumulation state across the four-measure visual arc; threshold spectacle layers onto the same persistent setup.

### Parking Ticket Shred

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L2–7
- **Visual span:** 1m — refresh citation stack
- **Repeat mode:** `sequence`
- **Scenario role:** Tear up a line of enchanted parking citations at shred-guitar speed.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_parking_ticket_shred` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_parking_ticket_shred_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_parking_ticket_shred_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_parking_ticket_shred_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_parking_ticket_shred_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_parking_ticket_shred_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_parking_ticket_shred_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_parking_ticket_shred_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_parking_ticket_shred_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

### Place-Setting Correction

- **Minigame class:** `RepeatMinigame`
- **Supported levels:** L1–6
- **Visual span:** 1m — refresh table-setting section
- **Repeat mode:** `sequence`
- **Scenario role:** Rapidly straighten plates, forks, and goblets while everyone else at the feast stares.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_place_setting_correction` | Opaque repeated-action staging backdrop. |
| `performerNeutral` | `hero_fantasy_place_setting_correction_ready` | Persistent ready/reset pose. |
| `performerAction` | `hero_fantasy_place_setting_correction_action` | Single repeated successful-note action pose. |
| `performerFinish` | `hero_fantasy_place_setting_correction_finish` | Completion pose beside accumulated results. |
| `repeatTarget` | `prop_place_setting_correction_intact` | Reusable untouched target/unit. |
| `targetCompletedState` | `prop_place_setting_correction_done` | Registered post-action target state. |
| `impactEffects[]` | `fx_place_setting_correction_impact` | Immediate hit/pop/tap feedback. |
| `debrisEffects[]` | `fx_place_setting_correction_debris` | Intermittent accumulated spectacle. |
| `streakEffects[]` | `fx_place_setting_correction_streak` | High-tier sustained-execution blur/streak. |

**Measure-cycle binding:** reset `repeatTarget` / `targetCompletedState` instances and local target index each measure; preserve attempt-global tier and any actor/spectacle state named by the visual-span note.

## Sixteenth Phrases — BATTLE / SURVIVE → `BattleMinigame`

### Dragon in the Driveway

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** Hero's horse is boxed in. A colossal dragon refuses to move. This somehow becomes an apocalyptic sword fight.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_dragon_in_the_driveway` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_dragon_in_the_driveway_ready`<br>`hero_fantasy_dragon_in_the_driveway_attack`<br>`hero_fantasy_dragon_in_the_driveway_evade`<br>`hero_fantasy_dragon_in_the_driveway_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_dragon_in_the_driveway_base`<br>`threat_dragon_in_the_driveway_attack`<br>`threat_dragon_in_the_driveway_recoil`<br>`threat_dragon_in_the_driveway_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_dragon_in_the_driveway_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_dragon_in_the_driveway_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_dragon_in_the_driveway_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_dragon_in_the_driveway_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_dragon_in_the_driveway_finisher`<br>`threat_dragon_in_the_driveway_humiliated`<br>`fx_dragon_in_the_driveway_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Demon Cuts the Line

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** The demon could destroy kingdoms; instead the conflict is entirely about queue etiquette.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_demon_cuts_the_line` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_demon_cuts_the_line_ready`<br>`hero_fantasy_demon_cuts_the_line_attack`<br>`hero_fantasy_demon_cuts_the_line_evade`<br>`hero_fantasy_demon_cuts_the_line_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_demon_cuts_the_line_base`<br>`threat_demon_cuts_the_line_attack`<br>`threat_demon_cuts_the_line_recoil`<br>`threat_demon_cuts_the_line_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_demon_cuts_the_line_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_demon_cuts_the_line_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_demon_cuts_the_line_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_demon_cuts_the_line_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_demon_cuts_the_line_finisher`<br>`threat_demon_cuts_the_line_humiliated`<br>`fx_demon_cuts_the_line_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Necromancer Splits the Check

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** He ordered the expensive wine and wants to divide evenly. Phrase combat escalates from argument to skeleton-army warfare.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_necromancer_splits_the_check` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_necromancer_splits_the_check_ready`<br>`hero_fantasy_necromancer_splits_the_check_attack`<br>`hero_fantasy_necromancer_splits_the_check_evade`<br>`hero_fantasy_necromancer_splits_the_check_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_necromancer_splits_the_check_base`<br>`threat_necromancer_splits_the_check_attack`<br>`threat_necromancer_splits_the_check_recoil`<br>`threat_necromancer_splits_the_check_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_necromancer_splits_the_check_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_necromancer_splits_the_check_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_necromancer_splits_the_check_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_necromancer_splits_the_check_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_necromancer_splits_the_check_finisher`<br>`threat_necromancer_splits_the_check_humiliated`<br>`fx_necromancer_splits_the_check_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Wizard Adds Scope

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** “One quick favor” becomes twelve requirements. Every phrase destroys another unnecessary deliverable.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_wizard_adds_scope` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_wizard_adds_scope_ready`<br>`hero_fantasy_wizard_adds_scope_attack`<br>`hero_fantasy_wizard_adds_scope_evade`<br>`hero_fantasy_wizard_adds_scope_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_wizard_adds_scope_base`<br>`threat_wizard_adds_scope_attack`<br>`threat_wizard_adds_scope_recoil`<br>`threat_wizard_adds_scope_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_wizard_adds_scope_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_wizard_adds_scope_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_wizard_adds_scope_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_wizard_adds_scope_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_wizard_adds_scope_finisher`<br>`threat_wizard_adds_scope_humiliated`<br>`fx_wizard_adds_scope_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Barbarian Neighbor

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L2–7
- **Visual span:** L2–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** His 3 a.m. drum practice finally leads to an operatic battle on the castle roof.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_barbarian_neighbor` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_barbarian_neighbor_ready`<br>`hero_fantasy_barbarian_neighbor_attack`<br>`hero_fantasy_barbarian_neighbor_evade`<br>`hero_fantasy_barbarian_neighbor_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_barbarian_neighbor_base`<br>`threat_barbarian_neighbor_attack`<br>`threat_barbarian_neighbor_recoil`<br>`threat_barbarian_neighbor_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_barbarian_neighbor_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_barbarian_neighbor_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_barbarian_neighbor_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_barbarian_neighbor_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_barbarian_neighbor_finisher`<br>`threat_barbarian_neighbor_humiliated`<br>`fx_barbarian_neighbor_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Minotaur Restaurant Host

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L1–7
- **Visual span:** L1–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** Won’t seat the party until everyone arrives despite the restaurant being visibly empty. Naturally, combat.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_minotaur_restaurant_host` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_minotaur_restaurant_host_ready`<br>`hero_fantasy_minotaur_restaurant_host_attack`<br>`hero_fantasy_minotaur_restaurant_host_evade`<br>`hero_fantasy_minotaur_restaurant_host_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_minotaur_restaurant_host_base`<br>`threat_minotaur_restaurant_host_attack`<br>`threat_minotaur_restaurant_host_recoil`<br>`threat_minotaur_restaurant_host_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_minotaur_restaurant_host_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_minotaur_restaurant_host_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_minotaur_restaurant_host_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_minotaur_restaurant_host_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_minotaur_restaurant_host_finisher`<br>`threat_minotaur_restaurant_host_humiliated`<br>`fx_minotaur_restaurant_host_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Titan Parking Spot

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L3–7
- **Visual span:** L3–4: 1m tiered rounds; L5–7: 4m continuous battle
- **Battle mode:** `duel`
- **Scenario role:** A hundred-foot titan took the spot the hero was clearly waiting for. Sixteenth phrases become a city-destroying parking dispute.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_titan_parking_spot` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_titan_parking_spot_ready`<br>`hero_fantasy_titan_parking_spot_attack`<br>`hero_fantasy_titan_parking_spot_evade`<br>`hero_fantasy_titan_parking_spot_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_titan_parking_spot_base`<br>`threat_titan_parking_spot_attack`<br>`threat_titan_parking_spot_recoil`<br>`threat_titan_parking_spot_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_titan_parking_spot_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_titan_parking_spot_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_titan_parking_spot_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_titan_parking_spot_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_titan_parking_spot_finisher`<br>`threat_titan_parking_spot_humiliated`<br>`fx_titan_parking_spot_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.

### Municipal Trash Council

- **Minigame class:** `BattleMinigame`
- **Supported levels:** L5–7
- **Visual span:** L5–7: 4m continuous battle
- **Battle mode:** `contest/escalation`
- **Scenario role:** The ultimate boss: infernal town council introduces new trash-barrel regulations. Perfect 64-note performance tears open the heavens over curb placement.

| Class slot | Existing asset ID(s) | How the asset fits |
|---|---|---|
| `background` | `bg_municipal_trash_council` | Opaque battle/survival arena backdrop. |
| `heroPoses[]` | `hero_fantasy_municipal_trash_council_ready`<br>`hero_fantasy_municipal_trash_council_attack`<br>`hero_fantasy_municipal_trash_council_evade`<br>`hero_fantasy_municipal_trash_council_finisher` | Ready, advantage/counter, survival/evasion, and decisive finisher states. |
| `threatPosesOrStates[]` | `threat_municipal_trash_council_base`<br>`threat_municipal_trash_council_attack`<br>`threat_municipal_trash_council_recoil`<br>`threat_municipal_trash_council_humiliated` | Baseline, encroachment, losing-ground, and GOATerized threat states. |
| `stageHazards[] / arenaProps[]` | `prop_municipal_trash_council_arena` | Foreground arena object/obstacle used for staging and scale. |
| `impactEffects[]` | `fx_municipal_trash_council_impact` | Successful counter/impact feedback. |
| `powerEffects[]` | `fx_municipal_trash_council_power` | Dominance/finisher burst for higher tiers. |
| `debrisEffects[]` | `fx_municipal_trash_council_debris` | Environmental combat/catastrophe reaction. |
| `completionStates[] (composed)` | `hero_fantasy_municipal_trash_council_finisher`<br>`threat_municipal_trash_council_humiliated`<br>`fx_municipal_trash_council_power` | No extra completion art: compose the existing finisher, humiliated threat, and power effect. |

**Measure-cycle binding:** at levels marked `1m tiered rounds`, reset local dominance/threat state after each measure but preserve attempt-global tier; at levels marked `4m continuous battle`, keep dominance/threat state through measure 4 and present the tiered victory once at completion.


---

# 4. Production Rules

1. **Scenario code should not know individual asset names.** `ScenarioDefinition` binds asset references to these semantic slots; the minigame class only reads the slots.
2. **Arrays are small pose/effect libraries, not animation frame sequences.** Show/hide, transforms, duplication, and authored positions create the apparent animation.
3. **Visual-cycle reset and score reset are separate concepts.** A one-measure visual reset never resets attempt-global score or star tier.
4. **Do not manufacture assets to fill optional slots.** Empty slots are legal when the scenario communicates its escalation through other bound assets.
5. **Completion should reuse existing assets whenever possible.** `BattleMinigame` in particular composes its hero finisher, humiliated threat state, and power effect rather than requiring a separate “victory frame.”
6. **Asset naming remains scenario-local.** The slot name is stable across worlds; the asset ID remains specific to the scenario.
7. **The class is the gameplay contract.** The scenario supplies art, authored placement, modes, level profiles, and measure plan.

## Recommended Unity-facing data shape

```text
ScenarioDefinition
    MinigameClassId
    MeasurePlan
    LevelProfile[]
    AssetBindings

AssetBindings
    // Class-specific serialized binding object:
    ClimbAssetBindings |
    PerformAssetBindings |
    TraverseAssetBindings |
    ThreeStepAssetBindings |
    RepeatAssetBindings |
    BattleAssetBindings
```

The central production rule remains:

> **Six stable behavior classes + scenario data + reusable static assets.**

