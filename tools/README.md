# Sprite tooling

## The source art

The knight is a 29-animation pack of 1920x1024 PNGs. Each sheet is a **15 x 8
grid of 128x128 cells**: columns are animation frames, rows are the 8 facings.

That layout was measured, not assumed — `verify-grid.mjs` confirms all 120 cells
are occupied in every sheet, on both axes independently (1920/15 and 1024/8 both
give 128).

The raw art lives in `Grafik/Knight/` and is **git-ignored**: ~15 MB of source
PNGs would sit in the repo's history forever. Keep a copy outside the repo; you
only need it to re-run `build:sprites`.

## Facing order

Going down a sheet the rows are **N, NW, W, SW, S, SE, E, NE**.

Rows 2 and 6 have the narrow side-on silhouettes, so they are the east/west
pair. The shield rides on the knight's left arm, which makes it fully visible on
row 2 (facing west, left arm toward the camera) and hidden behind him on row 6
(facing east). North and south are then rows 0 and 4, and row 4 is the one
showing his face.

`App.tsx` encodes this as `SPRITE_ROW_FOR_EAST`. If the knight ever runs the
wrong way, change that one constant.

## Scripts

| | |
|---|---|
| `npm run build:sprites` | Rebuilds `assets/sprites/knight/` from `Grafik/`. Downscales 128px cells to 96px; edit `SHEETS` to add animations. |
| `node tools/verify-grid.mjs` | Checks the source art still matches the 15x8x128 assumption. Run after adding art. |
| `node tools/check-facing.mjs out.png` | Renders which row `facingFromDelta` picks per compass direction. The regression check for facing. |
| `node tools/check-rows.mjs out.png [sheet] [col]` | Renders all 8 rows large and numbered, for identifying facings by eye. |

Note that cells are **not** trimmed to their content. 11 of the 29 sheets have
artwork touching the cell border — `Melee2` reaches 103x125 of the 128 box — so
a shared crop would clip swords. Keeping the full box also means every animation
shares one anchor, so the knight does not jump when the animation changes.
