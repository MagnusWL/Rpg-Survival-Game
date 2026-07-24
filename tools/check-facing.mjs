/**
 * Renders which sprite row facingFromDelta() picks for each compass direction,
 * so the row order baked into App.tsx can be checked by eye.
 *
 * If a tile's knight does not face the way its label says, the row order in the
 * comment above facingFromDelta is wrong -- fix the constant, not the art.
 *
 * Run: node tools/check-facing.mjs <out.png>
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = path.join(ROOT, 'assets', 'sprites', 'knight', 'run.png');
const OUT = process.argv[2];
const CELL = 96;
const ROWS = 8;

// Kept in sync with facingFromDelta() in App.tsx.
const SPRITE_ROW_FOR_EAST = 0;
function facingFromDelta(dx, dy) {
  const eighths = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((SPRITE_ROW_FOR_EAST + eighths) % ROWS) + ROWS) % ROWS;
}

// Screen coordinates: y grows downward, so "north" is dy = -1.
const DIRS = [
  { label: 'N  (op)', dx: 0, dy: -1 },
  { label: 'NE', dx: 1, dy: -1 },
  { label: 'E  (hoejre)', dx: 1, dy: 0 },
  { label: 'SE', dx: 1, dy: 1 },
  { label: 'S  (ned)', dx: 0, dy: 1 },
  { label: 'SW', dx: -1, dy: 1 },
  { label: 'W  (venstre)', dx: -1, dy: 0 },
  { label: 'NW', dx: -1, dy: -1 },
];

const COL = 6; // a mid-stride frame reads more clearly than frame 0
const GAP = 8;
const LABEL_H = 22;
const TILE_H = CELL + LABEL_H;

const tiles = [];
for (const d of DIRS) {
  const row = facingFromDelta(d.dx, d.dy);
  const frame = await sharp(SHEET)
    .extract({ left: COL * CELL, top: row * CELL, width: CELL, height: CELL })
    .toBuffer();
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL_H}">
       <text x="${CELL / 2}" y="15" font-family="sans-serif" font-size="13"
             fill="#ffffff" text-anchor="middle">${d.label} = ${row}</text>
     </svg>`
  );
  tiles.push({ frame, label });
  console.log(`${d.label.padEnd(14)} dx=${String(d.dx).padStart(2)} dy=${String(d.dy).padStart(2)}  ->  raekke ${row}`);
}

const cols = 4;
const rows = Math.ceil(tiles.length / cols);
await sharp({
  create: {
    width: cols * CELL + (cols + 1) * GAP,
    height: rows * TILE_H + (rows + 1) * GAP,
    channels: 4,
    background: { r: 38, g: 38, b: 63, alpha: 1 }, // the game's play-area colour
  },
})
  .composite(
    tiles.flatMap((t, i) => {
      const x = (i % cols) * (CELL + GAP) + GAP;
      const y = Math.floor(i / cols) * (TILE_H + GAP) + GAP;
      return [
        { input: t.frame, left: x, top: y },
        { input: t.label, left: x, top: y + CELL },
      ];
    })
  )
  .png()
  .toFile(OUT);

const unique = new Set(DIRS.map((d) => facingFromDelta(d.dx, d.dy)));
console.log(`\nUnikke raekker ramt: ${unique.size}/8 ${unique.size === 8 ? '(alle, ingen dubletter)' : '*** FEJL ***'}`);
console.log('skrevet:', OUT);
