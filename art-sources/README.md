# Vendored art sources

The sprite sheets, tilesets and effect sheets that
`scripts/import-scenario-art.mjs` cuts down into the per-slot PNGs under
`public/assets/scenarios/`.

**These are inputs, not shipped assets.** Nothing here is loaded at runtime.
The runtime only ever sees the derived files, which are single static
billboards (`AGENTS.md` §10); a five-frame strip or a 4x4 RPG-Maker grid has to
be cut down before it gets there.

## Why the sources are committed rather than downloaded

`AGENTS.md` §11 requires that placeholder art be stored locally and never
hotlinked. Downloading at build time would satisfy the letter of that and miss
the point: a build that reaches the network is a build that breaks when a page
moves, and a derivation nobody can re-run is a derivation nobody can review.
Committing the sheets makes `npm run art:import` reproducible offline and makes
a changed frame choice show up as a reviewable diff in two places — the source
that was cut, and the file that came out.

They are small: the whole directory is well under a megabyte.

## What is here

| Directory | Pack | Author | Licence |
|---|---|---|---|
| `alizard-pixel-wolf/` | [pixel wolf](https://opengameart.org/content/pixel-wolf) | alizard | CC0 |
| `sevarihk-mountain-goat/` | [Mountain Goat Sprites](https://opengameart.org/content/mountain-goat-sprites) | Sevarihk | **CC-BY 4.0** — attribution required |
| `dustdfg-mountains-parallax/` | [Pixel Art Mountains Parallax](https://opengameart.org/content/pixel-art-mountains-parallax) | Yevhen Babiichuk (DustDFG) | CC0 (ships `CC0.txt`) |
| `codemanu-pixel-effects/` | [Free Pixel Effects Pack](https://opengameart.org/content/free-pixel-effects-pack) | CodeManu | CC0 (ships `README.txt`) |

Full provenance, per asset id and per slot, is in `docs/assets/ASSET_SOURCES.md`.

## Two of these sheets have opaque backgrounds, not alpha

alizard's wolf sits on solid `rgb(12, 98, 98)` and MoikMellah's birds (not yet
used) on magenta. That is invisible until the sprite is composited over
something, at which point it is a coloured rectangle. `keyColour` in
`scripts/lib/external-art.mjs` removes it at import; do not assume a new sheet
has transparency without checking its corner pixel.

## Adding a pack

1. Read the licence on the source page. Prefer CC0; CC-BY is acceptable with
   attribution recorded. Do not add commercial game assets.
2. Drop the files in a directory named `<author>-<pack>/`, keeping any licence
   file the pack ships.
3. Add a row above, and the per-asset rows in `docs/assets/ASSET_SOURCES.md`.
4. Derive the slot files in `scripts/import-scenario-art.mjs` and re-run
   `npm run art:import`.
