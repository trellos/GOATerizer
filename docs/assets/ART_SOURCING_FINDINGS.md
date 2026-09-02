# Art sourcing findings — Goat Frontman

Written by a third session, in an environment whose network policy reaches the
art hosts the first two sessions could not. **This session's finding
supersedes the "every art host is blocked" conclusion below** — see git
history for the two earlier sessions' full write-ups if you need them; they
are summarised in §4.

## Outcome

**Two of sixteen assets shipped as real art.** `react_goat_frontman_neutral`
and `react_goat_frontman_impressed` (the crowd goat, both states) now ship
cropped frames from Sevarihk's *Mountain Goat Sprites*, CC-BY 4.0, verified on
the source page and recorded in `docs/assets/ASSET_SOURCES.md`.

The other fourteen — background, the performer's four-pose cycle, its two
flourishes and finish pose, the mic stand, the three effects, and the two
note-art pieces — remain the generated CC0 placeholders. Every candidate found
for them was checked and rejected on fit or licence (§2); none beat what is
already there.

## 1. Reachability, checked 2026-09-02

Direct `curl` to the root of each named host, through this environment's
egress proxy:

| Host | Result |
|---|---|
| `opengameart.org` | reachable (200) |
| `itch.io` | reachable (200) |
| `kenney.nl` | reachable (200) |
| `lospec.com` | reachable (200) |
| `craftpix.net` | reachable (200 with a UA header; the bare request without one got a 403 from the *site*, not the proxy — retried with `-A "Mozilla/5.0"` and it passed) |
| `wikimedia.org` / `commons.wikimedia.org` | reachable (redirects, 301) |

All six are open here. `$HTTPS_PROXY/__agentproxy/status` showed
`recentRelayFailures: []` throughout.

**A second, separate block was found and left alone: this environment's
`registry.npmjs.org` (and `pypi.org`, `jsr.io`, `files.pythonhosted.org`) is
refused with a direct `403 host_not_allowed`**, confirmed with `curl` both
unproxied and explicitly routed through `127.0.0.1:41567` (the approved agent
proxy) — same denial either way, so it is a deliberate policy boundary, not a
proxy misconfiguration. `npm ci`'s debug log showed 55/55 tarball fetches
403'd with zero cache hits; nothing for this project was pre-vendored in the
container. This is a *different* boundary from the art-host policy above:
this environment was widened to reach art hosts, but not to let `npm install`
complete. Per `AGENTS.md`'s and this brief's own principle for the art-host
case — a network policy is a decision, not an obstacle — no workaround was
attempted (no building `esbuild`/`rollup` from source, no fetching packages
through unofficial mirrors). See §5 for what this means for verification.

## 2. Candidates checked this session

Every row below was opened on the source page itself, not judged from a
search snippet.

### Shipped

**`oga_mountain_goat` — Mountain Goat Sprites, Sevarihk, CC-BY 4.0.**
<https://opengameart.org/content/mountain-goat-sprites> — license confirmed on
the page (`license-name'>CC-BY 4.0`), author confirmed, and the page's own
copyright notice explicitly permits derivatives: *"You are also allowed to
share and repost my assets (or edits thereof) as long as you credit me and
provide a link that leads back here or to my homepage."* This corrects the
prior sessions' row, which had the license claim right but "unverified from a
search snippet" — it is now verified from the page.

The pack is a quadruped, side-profile, small-horned goat/sheep with soft
painterly shading, no black keyline, a cream/tan palette — genuinely good
pixel art, a clear step up from the abstract 16×12 placeholder blob. Two
frames were used:

- `bergschaf-lookup-f.png`, row 2 col 1 (a standing/alert frame, all four legs
  grounded, already facing left) → `react_goat_frontman_neutral`.
- `bergschaf-bocksprung-f.png`, row 2 col 1 (reared up on its hind legs, front
  hooves raised, head thrown back — already facing left) →
  `react_goat_frontman_impressed`.

Both were cropped to their opaque bounding box and downsampled with an
alpha-weighted box filter (not nearest-neighbour) to a small, crisp size — the
renderer draws with `imageSmoothingEnabled = false`
(`src/ui/timeline/timeline-view.ts`), so a soft, detailed source has to be
pre-downsampled to the pixel grid it should read at, or nearest-neighbour
scaling at render time turns it to noise. Both frames already faced left,
matching the crowd's established convention in the (now-removed) placeholder
code — `frontman-art.mjs` drew the crowd goat "facing LEFT — toward the stage,
which sits at the strike line to the crowd's left for every goat on the right
wing." No hue edit was made; the cream/tan coat and horn colour are the
source's own.

**Considered and rejected: recolouring this same pack for the performer.**
The highest-value slots (the pose cycle and the two flourishes) are also the
hardest: no found pack has a "reared back like a stadium singer" or
"headbang" pose, quadruped or otherwise, because that is not a pose asset
packs draw. Recolouring this pack's cream coat to the established black-coat/
gold-horn Rocky Ascent → Frontman palette was tried three ways — an HSL-style
darken with a hue-threshold to pick out "horn-coloured" pixels, a
warm-pixel-brightness threshold for the same, and a flat multiply-darken with
no horn detection at all. Every threshold approach also caught the source's
own fur highlights and shading, producing a gold-speckled or gold-faced
result that read as a rendering bug, not "gold horns." The flat darken alone
was clean but left no gold horns at all. Rather than ship a shaky automatic
recolour, the performer's four-pose cycle, its two flourish poses and its
finish pose were left as the generated placeholder — which already matches
the Rocky Ascent body and palette exactly (no found art does), and whose two
flourishes already got a dedicated silhouette fix in an earlier commit on
this branch.

### Rejected

**`spring_goat_ram` — Pixel Art Enemies (Spring Spring).**
<https://opengameart.org/content/pixel-art-enemies-axe-throwing-goat-or-ram-axe-throwing-monkey-or-ape-walking-pig>
— license confirmed: the page offers CC0 among several license options, so
the prior sessions' licence claim was right. **The art itself is wrong for
this scenario**, and that could only be seen by opening the actual sprite
sheet (`goat or ram_strip5.png`): it is a bipedal, armoured ram *warrior* —
navy armour, heavy black keyline, holding an axe — not a quadruped side-profile
goat. It does not fit the performer, the flourishes, or the crowd. Rejected on
fit, not licence.

This is worth flagging even though fixing it is out of scope here: the same
asset is named as an "intended source" for the Rocky family's own goat pose
cycle in this file's Rocky Ascent section (`spring_goat_ram` row, "intended
placeholder sources (NOT SHIPPED)"). It has the identical problem there — a
future session filling in Rocky's real art should not expect this asset to
work either.

**`oga_cc0_walk_cycles` — CC0 Walk Cycles (collection).**
<https://opengameart.org/content/cc0-walk-cycles> — this collection's
goat/ram entry is the same `spring_goat_ram` asset above. Same rejection.

**Vectoraith's "Animated Sideview Sprite Pack — Normal Animals."**
<https://vectoraith.itch.io/animated-sideview-sprite-pack-normal-animals> —
this resolves the prior session's "licence unknown" note. It is a **paid**
pack (minimum $2) under a custom licence that explicitly states: *"You
cannot: ... Redistribute, re-sell, and/or sub-license the asset files or
derivatives as is."* Committing it, even cropped or recoloured, to a public
repository is redistribution. Definitively rejected — not a licence this
project can use regardless of price.

**Seliel the Shaper's "Livestock."**
<https://seliel-the-shaper.itch.io/livestock> — opened to check for a goat.
It contains chicken, baby chick, cow, pig, and duck. No goat. Also a paid pack
(minimum $19.99). Rejected — wrong animal, and priced/licensed for a
different kind of use besides.

**`codemanu_pixel_fx` — Free Pixel Effects Pack (CodeManu).**
<https://opengameart.org/content/free-pixel-effects-pack> — licence CC0
confirmed on the page, author confirmed. But every effect in the pack (per
its own cover image) is a multi-colour animated elemental burst — fire, ice
shatter, blood spray, a poison ring — as sprite *sheets*, not the small clean
single-shape glints this scenario wants. A single frame pulled from a
mid-explosion animation reads as a broken screenshot, not a "four-point
glint" or "an arc of stage light." The generated `fx_goat_frontman_sparkle`,
`_swoosh` and `_burst` are already small, clean, and drawn to those exact
descriptions. Rejected on fit; kept the generated effects.

**Backdrop.** Searched OpenGameArt (`stage`, `concert`, `crowd`, `spotlight`,
`stage+pixel`) for a stage/concert/crowd pixel-art background. The one
plausible hit, "Welcome to The Arena!" (Spring Spring, CC-BY family) —
<https://opengameart.org/content/welcome-to-the-arena> — is a 1024×768 dark
gladiator-colosseum scene shot from the arena floor looking *up* at tiered
seating, tagged "furry games of death." Wrong composition (up at a bowl of
seats, not out across a stage floor at a lit middle band) and wrong mood
(blood-sport gladiator vs. this scenario's colourful rock-concert vibe).
Rejected. No other stage/concert pixel-art pack turned up under a CC0 or
CC-BY claim. The generated backdrop — truss and bulbs, crossed light beams,
speaker stacks, a readable middle band for the scrolling notes — is already a
well-composed match for the slot's own `sourceSelection` text and stays.

**Not actively searched this session:** the mic stand prop and the two
note-art pieces (the stretched light bar, the flourish star). These are
simple, purpose-built shapes the generator already draws exactly to their
slot's specification (a bar meant to be stretched horizontally only, a small
overlay star), and there was no specific reason to expect found art to fit a
bespoke UI shape better than one drawn for the purpose. `hylsy`'s "64x64
Pixel Art Character" was not re-checked; the prior session already ruled it
out as not a goat.

## 3. Kenney

Not re-surveyed. The prior sessions' finding stands: Kenney's 2D library
(reached there via a GitHub mirror) has no side-profile goat, no crowd, and no
stage — its one goat is a vector cartoon, and its pixel farm animals are
16×16 top-down tiles with heavy outlines that would not sit beside the Rocky
family's art.

## 4. Prior sessions, summarised

Two earlier sessions, in two different environments, found every one of
`opengameart.org`, `itch.io`, `kenney.nl`, `craftpix.net`, `lospec.com`,
`pixeljoint.com` and `wikimedia.org` refused by network policy (403 on
`CONNECT`, confirmed via both `curl` and the `WebFetch` tool). Neither could
open a single source page or download a single file; `WebSearch` worked but
searching alone cannot clear `AGENTS.md` §11's "verify the source page and the
licence" bar. Both left the scenario's asset ids as the generated CC0
placeholders and made no code, scenario, or art changes. See
`claude/goat-frontman-art-review` in git history for the full write-ups.

## 5. Verification

**`npm run typecheck`, `npx vitest run`, `npm run build`, and
`npm run validate:browser -- --keep` could not be run**, and none of them is
claimed to pass. Cause: §1's `registry.npmjs.org` block — `npm ci` fails
immediately (`403 Forbidden`, `x-deny-reason: host_not_allowed`) with zero
packages cacheable, `node_modules` never materializes, and there is no global
`vite`/`vitest` in this container to fall back to (a global `typescript` and
`playwright` exist but the rest of the toolchain does not). This is an
environment limitation orthogonal to the change on this branch, not something
introduced by it.

What **was** verified without npm:

- Both shipped PNGs decode cleanly under a hand-rolled zlib-based PNG reader
  (correct IHDR, correct RGBA `IDAT`, expected dimensions) — not just "the
  file has a `.png` extension."
- `node scripts/generate-placeholder-art.mjs` — pure Node, `node:fs`/`node:zlib`
  only, no npm dependency — was run directly. It still succeeds, still writes
  all fourteen Goat Frontman ids that remain generated, and (checked with
  `md5sum` before and after) leaves the two now-shipped real-art files
  byte-for-byte untouched. This is the one piece of "the trap" that can
  actually be exercised here, and it passes.
- `git status`/`git diff` confirm the change is scoped to exactly: the two
  shipped PNGs, this file, `ASSET_SOURCES.md`, and the two art-generator files
  pruned per "the trap" — no scenario JSON, gameplay code, or test was
  touched.

The browser-validation screenshots this brief asks reviewers to look at
(`validation-screenshots/10-frontman-l1.png`, `11-frontman-l4.png`) could not
be produced, for the same reason `npm run validate:browser` could not run.
Whoever reviews this branch in an environment where `npm install` succeeds
should run that step and look at both images before merging — this session
could not.
