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

Going down a sheet the rows are **E, SE, S, SW, W, NW, N, NE** — one 45 degree
step clockwise per row, starting at east. `App.tsx` encodes this in
`facingFromDelta` and `SPRITE_ROW_FOR_EAST`.

This was settled by driving the game and watching which way the knight ran, and
it is worth knowing why reading the art failed. The obvious inference — that a
figure seen in profile has a narrow silhouette and one seen head-on a wide one —
is backwards here. The knight's sword and shield extend along the direction he
faces, so in profile they stretch across the screen and make him **wider**,
while head-on they foreshorten and make him **narrower**. Reasoning from
silhouette width gets east and north swapped, and reasoning from shield
visibility fails the same way: the shield reads clearest when he faces the
camera, not when he faces west.

If a future sheet ever disagrees, drive it rather than squinting at it.

## Enemies

The zombie pack ships **loose frames in one folder per named direction**
(`N`, `NE`, `E`, …), 15 frames each, at the same 128x128 as the knight.
`build:sprites` packs them into the same 15x8 sheet so both share one code path.

Those folder names are worth noting: they state outright that the layout used
here — east first, then clockwise — is the convention this art follows, which is
the same order the knight's rows turned out to use. Packed art hides that;
named folders do not.

## Sound

The raw pack in `Lyde/` is 96 kHz / 24-bit studio masters, ~830 KB per clip, and
**two thirds of every file is silence**. That padding is not just weight: the
0.18 s of leading quiet would delay the swing sound past a fifth of the attack
animation, so trimming it is a timing fix first and a size win second.

`build:sounds` trims, drops to 48 kHz (an exact 2:1 decimation, and what phone
audio hardware runs natively) and to 16-bit. That is an 88% reduction with **no
lossy codec involved** — the "tinfoil" artefact everyone recognises comes from a
codec guessing at audio it discarded, and nothing here is guessed.

### Tone shaping

There is no runtime equaliser, and there cannot be a useful one: audio filters
of that kind exist only in the browser, so anything adjustable in-game would do
nothing on a phone. Tone is baked into the files instead, via the `EQ` object at
the top of `build-sounds.mjs`.

To find values, run `npm run build:eq` and open `tools/eq-preview.html`. It uses
the same filter shapes ffmpeg applies — lowshelf at 100 Hz, peaking at 1200 Hz
two octaves wide, highshelf at 3000 Hz — so what it plays is what gets baked.
Paste the numbers into `EQ` and re-run `build:sounds`.

Requires ffmpeg on PATH: `winget install Gyan.FFmpeg`.

## Scripts

| | |
|---|---|
| `npm run build:sprites` | Rebuilds `assets/sprites/knight/` from `Grafik/`. Edit `SHEETS` to add animations. |
| `npm run build:sounds` | Rebuilds `assets/sounds/` from `Lyde/`. Trims silence, 48 kHz, 16-bit, bakes in `EQ`. Needs ffmpeg. |
| `npm run build:eq` | Regenerates `tools/eq-preview.html` for dialling in `EQ` by ear. Open it from disk. |
| `node tools/verify-grid.mjs` | Checks the source art still matches the 15x8x128 assumption. Run after adding art. |
| `node tools/check-facing.mjs out.png` | Renders which row `facingFromDelta` picks per compass direction. The regression check for facing. |
| `node tools/check-rows.mjs out.png [sheet] [col]` | Renders all 8 rows large and numbered, for identifying facings by eye. |

Note that cells are **not** trimmed to their content. 11 of the 29 sheets have
artwork touching the cell border — `Melee2` reaches 103x125 of the 128 box — so
a shared crop would clip swords. Keeping the full box also means every animation
shares one anchor, so the knight does not jump when the animation changes.
