# Art sourcing findings — Goat Frontman

Written by a second session (`claude/goat-frontman-art-review`) whose only job
was to find out whether *this* environment can reach art sites that the session
which built the scenario could not, and if so, to fetch and verify real
placeholder art.

**Outcome: no art shipped. Every art host is blocked here too.** The scenario's
sixteen assets remain the generated placeholders described in
`docs/assets/ASSET_SOURCES.md`. No code, scenario JSON, test or art file was
changed on this branch — this document is the whole of it.

## 1. Reachability, checked 2026-09-02

Plain HTTPS GET to the root of each host, through the environment's egress
proxy. Every one of the seven named art hosts is refused by the network policy,
not by the site:

| Host | Result |
|---|---|
| `opengameart.org` | **blocked** — proxy answered `403` to `CONNECT` |
| `itch.io` | **blocked** — proxy answered `403` to `CONNECT` |
| `kenney.nl` | **blocked** — proxy answered `403` to `CONNECT` |
| `craftpix.net` | **blocked** — proxy answered `403` to `CONNECT` |
| `lospec.com` | **blocked** — proxy answered `403` to `CONNECT` |
| `pixeljoint.com` | **blocked** — proxy answered `403` to `CONNECT` |
| `wikimedia.org` | **blocked** — proxy answered `403` to `CONNECT` |

The proxy's own status endpoint (`$HTTPS_PROXY/__agentproxy/status`) lists all
seven under `recentRelayFailures` with
`"gateway answered 403 to CONNECT (policy denial or upstream failure)"`, which
confirms the refusal is the network policy rather than a TLS or DNS fault.

Related hosts, to establish the shape of the allowlist:

| Host | Result |
|---|---|
| `commons.wikimedia.org`, `upload.wikimedia.org` | blocked (same 403) |
| `raw.githubusercontent.com` | blocked (same 403) |
| `github.com` | reachable (git/API paths only) |
| `registry.npmjs.org` | reachable via the proxy's `noProxy` bypass |

So the allowlist covers the toolchain (npm, git, the GitHub API) and nothing
else. There is no route from here to an image file or a licence page.

### The two tool paths, both closed

- `curl` / any direct HTTPS request → `CONNECT tunnel failed, response 403`.
- The `WebFetch` tool → `{"error_type":"EGRESS_BLOCKED", "message":"Access to
  opengameart.org is blocked by the network egress proxy."}`. Same for
  `kenney.nl`. WebFetch does not take a different path out.

**`WebSearch` does work.** This is the one asymmetry worth knowing: a future
session can still *search* and read result snippets, but cannot open the page
a snippet came from, and cannot download the file. That is the wrong half of
the job. `AGENTS.md` §11 requires verifying the source page and the licence
before reusing external art, and a search snippet is not the source page — so
search results alone can never clear an asset for shipping. This is exactly
the position the previous session was already in.

No workaround was attempted, per the brief and per the principle that a
network policy is a decision, not an obstacle.

## 2. What was looked for, and what search turned up

One search was run (`CC0 goat pixel art sprite side profile opengameart`),
purely to establish whether `WebSearch` functions. Its results **corroborate
the existing "researched third-party sources" table** in `ASSET_SOURCES.md` —
the same OpenGameArt goat/ram strip, the same CC0 Walk Cycles collection, and
the same Mountain Goat Sprites set, which the snippet again describes as
**CC-BY 4.0, not CC0**. That table was written blind from search results; it
has been independently reproduced from search results, which is not the same
as verified. **Its rows are neither corrected nor deleted here**, because
nothing was learned from a source page that would justify either. They remain
accurate as a record of claims, and no more trustworthy than before.

Two leads that were not already in that table, recorded only so they are not
re-discovered from scratch. **Neither page could be opened; both licences are
unverified claims from a search snippet, and neither should be used until a
human or an unblocked session confirms the licence on the page itself:**

| Lead | Claimed | Page | Possible use |
|---|---|---|---|
| Animated Sideview Sprite Pack — Normal Animals (vectoraith) | includes a brown goat, side view; licence unknown | `https://vectoraith.itch.io/animated-sideview-sprite-pack-normal-animals` | side-profile pose cycle — the right *view* for `performerPoses[]`, if the licence allows |
| 64x64 Pixel Art Character (hylsy) | "CC0" per snippet | `https://hylsy.itch.io/64x64-pixel-art-character1` | not a goat; noted only to rule out |

Nothing was found for the harder slots, and no search was run for them, since
a found result could not have been verified anyway. Recorded as still open:

- **`bg_goat_frontman`** — an opaque 384×216 stage/concert backdrop with a
  readable middle band for the scrolling notes. The previous session's search
  found no CC0 stage/crowd/spotlight pixel pack; stock-photo results are
  photographs, not sprites. This is the slot least likely to be filled by
  found art and the most likely to need commissioning or hand-drawing.
- **`goat_goat_frontman_bend` / `_slur`** — the two expressive flourish poses
  (reared back; headbanging) that the brief calls the weakest current art.
  These are the highest-value slots and also the least likely to exist as
  found art: a stadium-singer goat pose is not a thing asset packs contain.
  A found walk-cycle strip solves the *pose cycle*, not the flourishes.

## 3. What the next session should know

1. **Do not re-run the reachability check from a session in this environment.**
   It is blocked, twice confirmed, by two independent tool paths.
2. **Search-only access is a trap for this task.** It produces plausible rows
   that cannot be verified and must not be shipped. Two sessions have now
   generated substantially the same list of leads without being able to clear
   a single one.
3. **The unblocked paths are all human-side.** Someone with a browser can open
   the five rows in `ASSET_SOURCES.md` plus the two above, confirm the
   licences, and drop the files in — the swap is a file replacement under the
   existing asset ids, and `ASSET_SOURCES.md` §"How to swap them in" already
   describes it. Alternatively the environment's network policy can be widened
   to the art hosts, which is a decision for the repository's owner.
4. **The generated placeholders are not blocking anything.** They are CC0,
   they are original work for this repository, they are reproducible byte for
   byte from `scripts/generate-placeholder-art.mjs`, and the flourish poses
   can be improved by editing `scripts/lib/frontman-art.mjs` — which is a
   drawing problem, not a sourcing problem, and needs no network at all. If
   the goal is "the flourish poses should read as a goat", that is the
   cheapest available route and it is entirely inside this repository.

## 4. Verification

The brief asked for `npm run typecheck` and `npx vitest run`. **Neither could
be run here, and neither is claimed to pass.** `node_modules` is empty in this
container and `npm ci` fails partway through with
`403 Forbidden - GET https://registry.npmjs.org/why-is-node-running/-/why-is-node-running-2.3.0.tgz`
— the registry metadata host is reachable but package tarballs are refused by
the same policy that blocks the art hosts, so the dependencies cannot be
installed and the checks cannot execute. `tsc` without `node_modules` fails on
missing `@types/node` and `vite/client`, which is a missing-dependency error,
not a type error in the code.

This costs nothing in confidence: **this branch changes one new documentation
file and nothing else.** No source file, test, scenario JSON or image was
touched, so there is no change here that typecheck or the test suite could
react to. `git show --stat` on this branch is the proof. The other session's
own CI run on merge is the check that matters.
