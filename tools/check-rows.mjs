/**
 * Renders all 8 sheet rows side by side, large and numbered, so the facing of
 * each row can be identified directly from the art.
 *
 * Run: node tools/check-rows.mjs <out.png>
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2];
const SHEET_NAME = process.argv[3] ?? 'idle';
const COL = Number(process.argv[4] ?? 0);
const CELL = 96;
const ZOOM = 3;
const GAP = 10;
const LABEL_H = 26;
const TILE = CELL * ZOOM;

const sheet = path.join(ROOT, 'assets', 'sprites', 'knight', `${SHEET_NAME}.png`);

const tiles = [];
for (let row = 0; row < 8; row++) {
  const frame = await sharp(sheet)
    .extract({ left: COL * CELL, top: row * CELL, width: CELL, height: CELL })
    .resize(TILE, TILE, { kernel: 'nearest' })
    .toBuffer();
  const label = Buffer.from(
    `<svg width="${TILE}" height="${LABEL_H}">
       <text x="${TILE / 2}" y="19" font-family="sans-serif" font-size="18"
             font-weight="bold" fill="#ffe082" text-anchor="middle">raekke ${row}</text>
     </svg>`
  );
  tiles.push({ frame, label });
}

const cols = 4;
const rows = 2;
await sharp({
  create: {
    width: cols * TILE + (cols + 1) * GAP,
    height: rows * (TILE + LABEL_H) + (rows + 1) * GAP,
    channels: 4,
    background: { r: 38, g: 38, b: 63, alpha: 1 },
  },
})
  .composite(
    tiles.flatMap((t, i) => {
      const x = (i % cols) * (TILE + GAP) + GAP;
      const y = Math.floor(i / cols) * (TILE + LABEL_H + GAP) + GAP;
      return [
        { input: t.frame, left: x, top: y },
        { input: t.label, left: x, top: y + TILE },
      ];
    })
  )
  .png()
  .toFile(OUT);

console.log('skrevet:', OUT);
