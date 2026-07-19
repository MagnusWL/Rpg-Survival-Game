/**
 * Builds game-ready sprite sheets from the raw 1920x1024 source art in Grafik/.
 *
 * Source layout (verified, see tools/verify-grid.mjs):
 *   15 columns x 8 rows of 128x128 cells = 120 frames.
 *   Columns are animation frames, rows are the 8 facing directions.
 *
 * The cell size is kept intact rather than trimmed: 11 of the 29 source sheets
 * have artwork touching the cell border (Melee2 reaches 103x125 of the 128 box),
 * so a shared crop would clip swords. All savings come from downscaling instead.
 *
 * Run: node tools/build-sprites.mjs
 */
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'Grafik', 'Knight');
const OUT_DIR = path.join(ROOT, 'assets', 'sprites', 'knight');

const SRC_CELL = 128;
// Output at source resolution. Downscaling to 96 only bought 16-25% on file
// size -- PNG does not shrink linearly with pixel count on art this detailed --
// and cost sharpness at every display size. Lower this if bundle size ever
// starts to matter more than crispness; App.tsx scales independently.
const OUT_CELL = 128; // must match SPRITE_CELL in App.tsx
const COLS = 15;
const ROWS = 8;

// Only what the game actually renders today. 'Walk' stays out because
// PLAYER_SPEED is a constant 220 px/s with no slow-walk state; 'Die' stays out
// because the game loop stops simulating on death, so it would freeze on frame 0.
const SHEETS = ['Idle', 'Run', 'Melee', 'TakeDamage'];

mkdirSync(OUT_DIR, { recursive: true });

const scale = OUT_CELL / SRC_CELL;
const outW = Math.round(COLS * SRC_CELL * scale);
const outH = Math.round(ROWS * SRC_CELL * scale);

console.log(`Kilde : ${COLS}x${ROWS} celler a ${SRC_CELL}px  (${COLS * SRC_CELL}x${ROWS * SRC_CELL})`);
console.log(`Ud    : ${COLS}x${ROWS} celler a ${OUT_CELL}px  (${outW}x${outH})\n`);

for (const name of SHEETS) {
  const srcPath = path.join(SRC_DIR, `${name}.png`);
  const outPath = path.join(OUT_DIR, `${name.toLowerCase()}.png`);

  const meta = await sharp(srcPath).metadata();
  if (meta.width !== COLS * SRC_CELL || meta.height !== ROWS * SRC_CELL) {
    throw new Error(
      `${name}.png er ${meta.width}x${meta.height}, forventede ${COLS * SRC_CELL}x${ROWS * SRC_CELL}`
    );
  }

  // Resize the whole sheet in one pass. Because every cell edge lands on an
  // exact multiple of OUT_CELL (128 -> 96 is a clean 3/4), no frame bleeds
  // into its neighbour.
  await sharp(srcPath)
    .resize(outW, outH, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 9, palette: false })
    .toFile(outPath);

  const before = statSync(srcPath).size;
  const after = statSync(outPath).size;
  const saved = Math.round((1 - after / before) * 100);
  console.log(
    `${name.padEnd(6)} ${(before / 1024).toFixed(0).padStart(5)} KB  ->  ` +
      `${(after / 1024).toFixed(0).padStart(5)} KB   (-${saved}%)`
  );
}

console.log(`\nSkrevet til ${path.relative(ROOT, OUT_DIR)}`);
