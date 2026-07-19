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
import { mkdirSync, statSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'Grafik', 'Knight');
const OUT_DIR = path.join(ROOT, 'assets', 'sprites', 'knight');

/**
 * Row order every sheet in this game uses, top to bottom. The knight's art
 * arrived already packed this way; the zombies arrive as one folder per named
 * direction, so packing them in this order lets both share the rendering code
 * and facingFromDelta in App.tsx.
 */
const DIR_ORDER = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

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

// --- Enemies -------------------------------------------------------------
// The zombie pack ships loose frames in one folder per direction rather than a
// packed sheet, so these get assembled into the same 15x8 grid the knight uses.

const ZOMBIE_SRC = path.join(
  ROOT, 'Grafik', 'Enemies', '2D HD Zombie individual sprites', 'ZombieMale2'
);
const ZOMBIE_OUT = path.join(ROOT, 'assets', 'sprites', 'zombie');

// Walking plus three swings, picked at random per attack so a crowd does not
// move in lockstep.
const ZOMBIE_ANIMS = [
  { out: 'walk', src: 'Walk' },
  { out: 'attack', src: 'Attack1' },
  { out: 'attack2', src: 'Attack2' },
  { out: 'attack3', src: 'Attack3' },
];

// Blood has no facings -- it is an effect seen from above. The five variants are
// packed as rows instead, so picking one is the same lookup as picking a facing
// and the renderer needs no special case.
const BLOOD_SRC = path.join(
  ROOT, 'Grafik', 'Enemies', '2D HD Zombie individual sprites', 'Blood'
);
const BLOOD_VARIANTS = ['Blood1', 'Blood2', 'Blood3', 'Blood4', 'Blood5'];

async function packDirectionFolders(srcDir, outPath) {
  const tiles = [];
  for (const [row, dir] of DIR_ORDER.entries()) {
    const dirPath = path.join(srcDir, dir);
    if (!existsSync(dirPath)) throw new Error(`Mangler retningsmappe: ${dirPath}`);
    // Filenames are zero-padded, so plain sorting is already frame order.
    const frames = readdirSync(dirPath).filter((f) => f.endsWith('.png')).sort();
    if (frames.length !== COLS) {
      throw new Error(`${dirPath} har ${frames.length} billeder, forventede ${COLS}`);
    }
    for (const [col, file] of frames.entries()) {
      const meta = await sharp(path.join(dirPath, file)).metadata();
      if (meta.width !== SRC_CELL || meta.height !== SRC_CELL) {
        throw new Error(`${file} er ${meta.width}x${meta.height}, forventede ${SRC_CELL}x${SRC_CELL}`);
      }
      tiles.push({
        input: path.join(dirPath, file),
        left: col * OUT_CELL,
        top: row * OUT_CELL,
      });
    }
  }

  await sharp({
    create: { width: outW, height: outH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(tiles)
    .png({ compressionLevel: 9, palette: false })
    .toFile(outPath);

  return tiles.length;
}

/** Packs a list of flat frame folders into one sheet, one folder per row. */
async function packFrameFolders(folders, outPath) {
  const tiles = [];
  for (const [row, dir] of folders.entries()) {
    if (!existsSync(dir)) throw new Error(`Mangler mappe: ${dir}`);
    const frames = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    if (frames.length !== COLS) {
      throw new Error(`${dir} har ${frames.length} billeder, forventede ${COLS}`);
    }
    for (const [col, file] of frames.entries()) {
      const meta = await sharp(path.join(dir, file)).metadata();
      if (meta.width !== SRC_CELL || meta.height !== SRC_CELL) {
        throw new Error(`${file} er ${meta.width}x${meta.height}, forventede ${SRC_CELL}x${SRC_CELL}`);
      }
      tiles.push({ input: path.join(dir, file), left: col * OUT_CELL, top: row * OUT_CELL });
    }
  }

  await sharp({
    create: {
      width: COLS * OUT_CELL,
      height: folders.length * OUT_CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(tiles)
    .png({ compressionLevel: 9, palette: false })
    .toFile(outPath);

  return tiles.length;
}

if (!existsSync(ZOMBIE_SRC)) {
  console.log('\n(Springer fjender over -- Grafik/Enemies findes ikke)');
} else {
  mkdirSync(ZOMBIE_OUT, { recursive: true });
  console.log('\nFjender: samler loese billeder til ark');
  for (const { out, src } of ZOMBIE_ANIMS) {
    const outPath = path.join(ZOMBIE_OUT, `${out}.png`);
    const count = await packDirectionFolders(path.join(ZOMBIE_SRC, src), outPath);
    console.log(
      `${out.padEnd(7)} ${String(count).padStart(3)} billeder  ->  ` +
        `${(statSync(outPath).size / 1024).toFixed(0).padStart(4)} KB`
    );
  }
  console.log(`Skrevet til ${path.relative(ROOT, ZOMBIE_OUT)}`);
}

if (existsSync(BLOOD_SRC)) {
  const outPath = path.join(ROOT, 'assets', 'sprites', 'effects', 'blood.png');
  mkdirSync(path.dirname(outPath), { recursive: true });
  const count = await packFrameFolders(
    BLOOD_VARIANTS.map((v) => path.join(BLOOD_SRC, v)),
    outPath
  );
  console.log(
    `\nBlod: ${BLOOD_VARIANTS.length} varianter som raekker, ` +
      `${count} billeder  ->  ${(statSync(outPath).size / 1024).toFixed(0)} KB`
  );
}
