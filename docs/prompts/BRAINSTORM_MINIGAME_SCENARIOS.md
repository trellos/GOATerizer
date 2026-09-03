# Prompt — Brainstorm minigame scenarios for the unexplored families

Copy everything below the line into a fresh session in the GOATerizer repo.
It is self-contained: it states the model, the constraints, and what already
exists, so the session does not need this conversation's history.

Prompts are not authoritative design documents (`AGENTS.md` §19). The canonical
sources are `docs/game-design/GOATerizer_Game_Design.md`,
`GOATerizer_Minigame_Authoring.md` and `GOATerizer_Scenario_Asset_Slot_Bindings.md`.

---

I want to brainstorm new minigame scenarios for GOATerizer. Read
`docs/game-design/GOATerizer_Minigame_Authoring.md` and `GOATerizer_Game_Design.md`
§§1, 4, 6, 11 and 12 before proposing anything — the play surface changed
recently and older material in the repo may describe the previous one.

## The model, in short

GOATerizer is a browser guitar game driven by real guitar input. A run is 16
minigames; each is four measures of authored musical material at one difficulty
level. The player reads a scrolling timeline to know what to play.

**The timeline is the only surface, and the minigame is what happens on it.**
There is no separate scenario panel. A minigame owns the timeline's appearance
for its four measures: it decides what the note bars are made of, what the
background behind its measures is, and what actors and effects do there in
response to playing. A goat hops from note bar to note bar. A tin can rides its
bar into a waiting forehead and is crushed. Cause and effect are in one place.

Constraints that shape what is possible:

- **The host owns note geometry absolutely.** Horizontal position from musical
  time, vertical from pitch lane, width from duration — a quarter note is four
  times the width of a sixteenth. A minigame cannot move, resize or re-pitch a
  note, and cannot obscure the player's own played-note row.
- **Two anchors.** A note (every note of the attempt is handed over with a rect,
  including off-screen ones), or the current-time bar — put an actor there and
  let the notes come to it.
- **Above and below the lanes is usable space.** The background fills the play
  area; `y < 0` is above the lanes, `y > 1` below.
- **Static billboards only** — show/hide, translate, scale, rotate, short tweens,
  pose swaps. No skeletal animation, no particle systems, no bespoke art per
  note. The production rule is *lots of authored gameplay events, very few
  authored art assets*: one reusable sprite instantiated many times.
- Each measure is a golden rectangle; at least one measure is visible either
  side of the current-time bar.

## Tone

Mean, funny, earnest. Preserve the insulting humour and the deliberately
absurd premises. Do not replace it with generic motivational copy, and do not
propose currencies, unlocks, accounts, progression trees or procedural
generation.

## What I want from you

Propose new scenarios for `TraverseMinigame` and `BattleMinigame`, which have
no built scenario yet, or a second scenario for a family that already has
one (`ClimbMinigame`, `RepeatMinigame`, `PerformMinigame`, `ThreeStepMinigame`
all have exactly one built scenario each and could take another). Check
`src/scenario/registry.ts` for the current list before proposing — this list
goes stale as families ship. For each proposal give me:

1. **Name** and one-line premise.
2. **Family** and why the musical material suits it.
3. **What the note bars are.** The single most important question.
4. **Where the actor is** — riding the bars, or waiting at the current-time bar.
5. **Perfect / Good / Miss / wrong-note** consequences.
6. **What a measure boundary resets, and what survives it.**
7. **What three stars looks like.**
8. **What is on screen during a rest**, when nothing is being played.
9. **Asset list** against that family's canonical slots — and flag any slot that
   has no sensible home on a timeline.
10. **Supported difficulty levels** (L1–L7; not every scenario spans all of them).

Push on ideas that use the timeline as terrain rather than treating it as a
backdrop with a sprite on top. The best ones will make the phrase's *shape*
legible — a scale run that is visibly a staircase, a sixteenth barrage that is
visibly a row of things to knock down.

## Triplets

`ThreeStepMinigame` is buildable. A triplet is `duration: "eighthTriplet"` — a
third of a beat — and the drums mark the triplet grid an attempt ahead of the
phrase that needs it, so a THREE-STEP scenario can count on the player hearing
the feel before they have to play it.

## Already taken — do not duplicate

192 scenarios exist across three themes (GOATS, KAIJU, PETTY EPIC FANTASY) in
`docs/game-design/GOATerizer_Scenario_Asset_Slot_Bindings.md`. New proposals may
extend an existing theme or open a new one, but must not re-use these names or
re-tread their premises:

### `ClimbMinigame` — Scale — CLIMB (32 taken)
- **GOATS:** Rocky Ascent, Dam Wall, Alpine Staircase, Tree Climber, Glacier Shelves, Village Rooftops, Salt Shrine, Goat Tower
- **KAIJU:** Skyscraper Climb, Radio Tower, Shipping Containers, Cooling Towers, Mountain Entrance, Robot Scaffolding, Space Elevator, Apartment Balconies, Stadium Steps, Dumbbell Ladder, Beach Pushups, Pull-Up Tower, Rocky Stairwell, Weight-Plate Stack, Lifeguard Tower, Boardwalk Rise
- **PETTY EPIC FANTASY:** Broken Dungeon Elevator, Noise Complaint Tower, Grocery Castle, Throne-Room Queue, Dragon Hoard Receipt, Restroom Spiral, Valet Hill, Cursed Library Ladder

### `PerformMinigame` — Blues Lick — PERFORM (32 taken)
- **GOATS:** Courtship Strut, Beard in the Wind, Goat Frontman, Salt Ecstasy, Bell Swagger, Meadow Dance, Horn Show-Off, Tavern Goat
- **KAIJU:** Roar Solo, Tail Swagger, Neon Monster Dance, Kaiju Courtship, News Camera Pose, Train Microphone, Atomic-Breath Flourish, Monster Idol Show, Poolside Swagger, Beach Flirt, Roller-Rink Dance, Bartender Flair, Boombox Dance, Surf Victory Pose, Karaoke Hero, Convertible Arrival
- **PETTY EPIC FANTASY:** Tavern Complaint, Potion Haggling, Dinner Order, Quest Refusal, Passive-Aggressive Toast, Cursed Armor Fitting, Parking Etiquette Lecture, Bard Feedback

### `TraverseMinigame` — Scale Run — TRAVERSE (32 taken)
- **GOATS:** Cliff Switchbacks, Canyon Descent, Avalanche Escape, Herd Slalom, Village Rooftop Dash, Eagle Shadow, Fallen-Tree Gauntlet, Impossible Ridge
- **KAIJU:** Boulevard Rampage, Rooftop Parkour, Highway Slalom, Missile Dodge, Harbor Dash, Monorail Chase, Lava City, Moonbase Sprint, Surfing, Rollerblade Boardwalk, BMX Slalom, Jet Ski Buoys, Water Ski, Beach Obstacle Course, Speedboat Run, Dune Buggy
- **PETTY EPIC FANTASY:** Parking Meter, Escape the Chatty Wizard, Library Late Fee, Quest-Giver Slalom, Bazaar Restroom, Waiter With the Check, Reservation Dash, Horse-Valet Chase

### `ThreeStepMinigame` — Triplets — THREE-STEP (32 taken)
- **GOATS:** Hop-Hop-LEAP, Triple Hoofbeat, Butt-Butt-BONK, Three-Stone Creek, Bell-Bell-BONG, Herd Bound, Hay-Bale Bounce, Horn-Lock Shuffle
- **KAIJU:** Punch-Punch-TAIL, Stomp-Stomp-ROAR, Jet-Jet-HELICOPTER, House-House-TOWER, Tank-Tank-THROW, Sumo Step, Bite-Claw-HEADBUTT, Beam-Beam-BLAST, Bump-Set-SPIKE, Jab-Cross-HOOK, Aerobics Three-Step, Jump-Rope Triple, Hacky Sack, Dance Combo, Frisbee Rhythm, Diving Board
- **PETTY EPIC FANTASY:** Knock-Knock-KNOCK, Point-Shrug-SIGH, Fork-Knife-GOBLET, Step-Step-STOP, Look-Look-STARE, Goblin-Goblin-MANAGER, Cloak-Cloak-DOOR, Tap-Tap-AHEM

### `RepeatMinigame` — Straight Sixteenths — REPEAT (32 taken)
- **GOATS:** Fence-Post Demolition, Tin-Can Knockdown, Hay Shredder, Hoof Stamp, Bell Machine, Door Battering, Pebble Gatling, Walnut Cracker
- **KAIJU:** Tank Stomp, Car Flick, Helicopter Swat, Window Punch, Train Chomp, Beam Pulse, Battleship Slap, Building Drums, OPEN THE BEERS, Speed Bag, Pushups, Cocktail Shaker, Can Crushing, Party Cup Fill, Beach-Ball Tap, Arcade Button
- **PETTY EPIC FANTASY:** Service Bell, Complaint Stamps, Neighbor Wall, Crumb Flick, Potion Corks, Queue Foot Tap, Parking Ticket Shred, Place-Setting Correction

### `BattleMinigame` — Sixteenth Phrases — BATTLE / SURVIVE (32 taken)
- **GOATS:** Wolf Pack, Mountain Lion, Grizzly, Golden Eagle, Ibex Warlord, Avalanche, Rockslide, Thunder Ram
- **KAIJU:** Lizard Rival, Giant Mecha, Three-Headed Dragon, Alien Mothership, Giant Ape, Sea Serpent, Military Superweapon, Cosmic Kaiju, Beach Bully, Monster Wave, Gym Rival, Volleyball Championship, Dance-Off, Storm Boat Race, Party Shutdown, Burning Yacht Keg Rescue
- **PETTY EPIC FANTASY:** Dragon in the Driveway, Demon Cuts the Line, Necromancer Splits the Check, Wizard Adds Scope, Barbarian Neighbor, Minotaur Restaurant Host, Titan Parking Spot, Municipal Trash Council
## Output

Group by family. Ten to fifteen proposals is more useful than fifty thin ones —
I would rather have a few that are genuinely buildable on a scrolling note
highway than a long list that assumes a stage. For any idea you like that the
surface cannot support, say so explicitly rather than bending it.
