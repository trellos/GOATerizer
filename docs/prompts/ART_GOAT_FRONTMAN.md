# Prompt — real art for Goat Frontman

Copy everything below the line into a fresh session on branch
`claude/loving-turing-cp90sc`, in an environment whose network policy reaches
the art sites (`opengameart.org`, `itch.io`, `kenney.nl`, `lospec.com`,
`craftpix.net`, `wikimedia.org`). Two sessions have already tried this from
environments that cannot; see `docs/assets/ART_SOURCING_FINDINGS.md` before
spending anything on reachability.

Prompts are not authoritative design documents (`AGENTS.md` §19). The canonical
sources are `AGENTS.md`, `docs/game-design/GOATerizer_Game_Design.md`,
`GOATerizer_Minigame_Authoring.md` and `GOATerizer_Scenario_Asset_Slot_Bindings.md`.

---

Goat Frontman is a built, playable GOATerizer minigame that ships generated
placeholder art. Your job is to replace that art with the real thing: find,
verify and fit genuinely good pixel art, and leave the provenance in a state
someone can audit. **Do not change gameplay code, scenario data, or tests.**

## The first rule

`AGENTS.md` §11 governs everything here and is not negotiable:

- **Verify the source page and the licence yourself, on the page.** A search
  snippet is not a source page. Two previous sessions produced a plausible
  list of candidates and could clear none of them, which is exactly why this
  session exists — access to the page *is* the deliverable.
- Prefer CC0. CC-BY is acceptable **only** if you record the attribution the
  licence demands, in `docs/assets/ASSET_SOURCES.md` and in a form a shipped
  build can carry. Anything non-redistributable is out: the art is committed to
  a public repository, which is redistribution.
- Record source URL, author, licence, and the date you verified it.
- Never hotlink. Files live in `public/assets/`.
- No copyrighted commercial game assets as placeholders.
- If you cannot verify a licence, **do not ship that file.** Partial success is
  the expected outcome and a good one. One excellent goat sprite sheet beats
  sixteen mediocre files.

## What the game is, in one paragraph

A browser guitar game driven by real guitar input. The player reads a scrolling
timeline of note bars to know what to play. **The timeline is the only surface**
— there is no separate scenario panel — and a minigame owns its appearance for
four measures: it decides what the note bars are made of and what actors do
around them. Goat Frontman is the PERFORM verb: a goat rock singer stands at the
current-time bar, the phrase scrolls into it, and on certain authored notes it
strikes a **flourish** pose and more goats wander in from the wings to watch.
Higher levels draw a bigger crowd per flourish. Bad notes embarrass the
performer; nothing already earned is ever taken away.

Read `docs/scenarios/goat-frontman/goat_frontman.scenario.json` (its `assets`
array documents every slot) and `src/scenario/minigames/perform-minigame.ts`
(which decides where each sprite is drawn and at what scale).

## The sixteen slots

Current sizes are the placeholders'. Real art may differ in pixel size — the
renderer scales by height and takes width from the image's own aspect ratio — so
**proportion matters and absolute size mostly does not**, within reason: keep it
small and crisp, this is pixel art displayed at roughly a lane and a half tall.

| Asset id | Now | What it is |
|---|---|---|
| `bg_goat_frontman` | 384×216 | Opaque stage/concert backdrop, fills the play area |
| `goat_goat_frontman_perform_01`…`_04` | 24×18 | Normal-note pose cycle, one step per successful note |
| `goat_goat_frontman_bend` | 24×18 | Flourish: reared back, the stadium-singer backbend |
| `goat_goat_frontman_slur` | 24×18 | Flourish: headbang, head down, horns at the floor |
| `goat_goat_frontman_finish` | 24×18 | Held on a passed attempt |
| `prop_goat_frontman_signature` | 10×24 | Mic stand, placed beside the performer |
| `react_goat_frontman_neutral` | 16×12 | One crowd goat, unimpressed |
| `react_goat_frontman_impressed` | 16×12 | The same goat, impressed (swapped in at ★★) |
| `fx_goat_frontman_swoosh` | 26×14 | Flourish accent, one frame |
| `fx_goat_frontman_sparkle` | 16×16 | Successful-note glint, one frame |
| `fx_goat_frontman_burst` | 36×36 | ★★★ payoff, one frame |
| `note_goat_frontman_light` | 8×12 | What every note bar is made of |
| `note_goat_frontman_star` | 14×14 | Marks a flourish note, overlaid on the bar |

### Priority

1. **The performer** — the pose cycle and the two flourishes, ideally from one
   source so they read as one animal. Side profile, facing right. The flourishes
   are the hard part and the most valuable: they must differ from each other and
   from the neutral pose *in silhouette*, because the player is reading notes,
   not the goat.
2. **The crowd goat**, in two states. Drawn up to 24 times per attempt from one
   sprite, varied only by position and scale, so it has to read tiny.
3. **The backdrop.** Hardest to find and most likely to need drawing: it needs a
   readable middle band, because gameplay notes scroll across the middle of it.
4. **Effects and props.** Easiest to find; lowest value.

### Constraints the surface imposes

- **Every sprite is a static billboard.** The runtime shows, hides, translates,
  scales, rotates and swaps them; it never plays a frame sequence. Reduce any
  strip, GIF or sheet to single frames. A four-pose cycle is four independent
  drawings, not four frames of an animation.
- **`note_goat_frontman_light` is stretched to each note's rect** — a quarter
  note is four times the width of a sixteenth. Band it **horizontally only**;
  anything with vertical detail smears. This is why it is 8px wide.
- `note_goat_frontman_star` and the effects are drawn at natural size, centred,
  and may bleed outside the note.
- The performer and the crowd stand on the stage floor **below** the lane band,
  bottom-anchored. Art with a lot of empty space under the feet will float.
- Transparent PNG for everything except the backdrop, which is opaque.

### The house style you are matching

Look at `public/assets/scenarios/rocky-ascent/` — the Rocky family's goat is the
established look: 24×18, side profile facing right, no black keyline, alpine
palette, readable silhouette at speed. Goat Frontman's performer is deliberately
that same animal in a black coat with gold horns, so the two scenarios read as
one game. If you find art good enough to be worth breaking that consistency for,
say so and show it rather than quietly introducing a second style — and if a
pack is good enough to re-skin the Rocky family too, that is worth raising with
the repository owner as its own piece of work, not doing here.

## What has already been established

`docs/assets/ART_SOURCING_FINDINGS.md` and the "researched third-party sources"
table in `docs/assets/ASSET_SOURCES.md` hold every lead two blocked sessions
could name, including one that is **CC-BY, not CC0**, despite being listed
beside CC0 ones. Treat every row in both as an unverified claim to check, not as
a shortlist to trust. Kenney's 2D library has already been surveyed through a
GitHub mirror and does **not** contain a side-profile goat, a crowd, or a stage —
its only goat is a vector cartoon — so it is not worth re-surveying.

## The trap

`scripts/generate-placeholder-art.mjs` **regenerates and overwrites every one of
the sixteen ids above.** If you drop real art in and someone later runs that
script, your work is silently destroyed. So for each id you replace with real
art, delete its entry from the `goat-frontman` block in that script, and delete
the now-unused drawing function from `scripts/lib/frontman-art.mjs`. Ids still
carrying placeholders keep their entries. If you replace all sixteen, remove the
block and the module entirely. The script must still run clean afterwards.

## Deliver

- Real art saved over the existing ids in
  `public/assets/scenarios/goat-frontman/`, filenames unchanged.
- `docs/assets/ASSET_SOURCES.md`: what you shipped, in a shipped section, with
  author, licence, source URL and verification date. Correct or delete the
  unverified rows for this scenario based on what you actually found on the
  pages — including the CC-BY one.
- `docs/assets/ART_SOURCING_FINDINGS.md`: what you found and rejected, and why.
- The generator and its art module pruned per **The trap**.
- `npm run typecheck`, `npx vitest run`, `npm run build`, and
  `npm run validate:browser -- --keep` all passing. The browser suite's Part 7
  drives this scenario at L1 and L4 and writes
  `validation-screenshots/10-frontman-l1.png` and `11-frontman-l4.png` — **look
  at those two images**. Art that is lovely at 8× zoom and unreadable at
  gameplay size is a regression, and the screenshots are how you find out.
- Commit and push to a new branch off `claude/loving-turing-cp90sc`. Do not push
  to that branch directly; it is under review for merge.

## Two things worth saying plainly

If the art you find is worse than what is there, say so and ship nothing. The
generated placeholders are CC0, original to this repository, reproducible byte
for byte, and good enough to play against — the bar is "better", not "different".

If the network policy turns out to block you too, write that in
`ART_SOURCING_FINDINGS.md`, push it, and stop. Do not attempt to work around a
network policy: it is a decision, not an obstacle.
