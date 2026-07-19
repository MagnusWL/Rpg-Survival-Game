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

// --- Glow ----------------------------------------------------------------
// A soft disc drawn under a character. Generated rather than drawn by hand so
// its falloff can be adjusted by editing a number.
//
// Deliberately white: React Native can tint an image, which replaces its colour
// while keeping its transparency, so one file covers any glow the game wants.
//
// This is how a 2D game does a glow. Filters that trace a sprite's silhouette
// exist in a browser but not in React Native, so anything built on those would
// look right here and do nothing on a phone.
const GLOW_OUT = path.join(ROOT, 'assets', 'sprites', 'effects', 'glow.png');
const GLOW_SIZE = 256;

{
  mkdirSync(path.dirname(GLOW_OUT), { recursive: true });
  const r = GLOW_SIZE / 2;
  const glow = Buffer.from(
    `<svg width="${GLOW_SIZE}" height="${GLOW_SIZE}">
       <defs>
         <radialGradient id="g" cx="50%" cy="50%" r="50%">
           <stop offset="0%"   stop-color="#fff" stop-opacity="1"/>
           <stop offset="35%"  stop-color="#fff" stop-opacity="0.55"/>
           <stop offset="70%"  stop-color="#fff" stop-opacity="0.15"/>
           <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
         </radialGradient>
       </defs>
       <circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/>
     </svg>`
  );
  await sharp(glow).png({ compressionLevel: 9 }).toFile(GLOW_OUT);
  console.log(`\nLysskaer: ${GLOW_SIZE}x${GLOW_SIZE}  ->  ${(statSync(GLOW_OUT).size / 1024).toFixed(0)} KB`);
}

// --- Background ----------------------------------------------------------
// A ground texture rather than a sheet, so it gets none of the grid treatment.
// It carries no alpha, which means JPEG rather than PNG: identical to the eye at
// an eighth of the size on disk.
//
// Kept at full resolution on purpose. Drawn to cover the play area, a phone in
// portrait at 2x needs about 1108 px of height and the source has 1086, so it
// lands near 1:1. Anything smaller gets stretched back up and turns to mush.
/**
 * Which of the candidates in Grafik/Baggrund to use. Change the filename, run
 * the build again, and the game picks it up -- the output name never changes,
 * so nothing in App.tsx has to know which one is in play.
 *
 * Others sitting there: Background.png (the first one), A.png, B.png, C.png,
 * D.png. Run tools/compare-backgrounds.mjs to see them side by side.
 */
const BG_CHOICE = 'Remaster.jpg';

const BG_SRC = path.join(ROOT, 'Grafik', 'Baggrund', BG_CHOICE);
const BG_OUT = path.join(ROOT, 'assets', 'sprites', 'background.jpg');

/** Overall brightness. 0.85 is the 15% knock-down the ground gets. */
const BG_BRIGHTNESS = 0.85;

/**
 * The corner darkening, on top of the vignette already painted into the source.
 * `start` is how far out from the centre it begins as a fraction of the radius,
 * `strength` how black the very corners go.
 */
const BG_VIGNETTE = { start: 0.45, strength: 0.55 };

if (existsSync(BG_SRC)) {
  const meta = await sharp(BG_SRC).metadata();

  // An ellipse rather than a circle: an SVG gradient defaults to the shape's own
  // box, so it follows the image's proportions instead of cropping to a square.
  const vignette = Buffer.from(
    `<svg width="${meta.width}" height="${meta.height}">
       <defs>
         <radialGradient id="v" cx="50%" cy="50%" r="75%">
           <stop offset="${BG_VIGNETTE.start * 100}%" stop-color="#000" stop-opacity="0"/>
           <stop offset="100%" stop-color="#000" stop-opacity="${BG_VIGNETTE.strength}"/>
         </radialGradient>
       </defs>
       <rect width="100%" height="100%" fill="url(#v)"/>
     </svg>`
  );

  await sharp(BG_SRC)
    .modulate({ brightness: BG_BRIGHTNESS })
    .composite([{ input: vignette, blend: 'over' }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(BG_OUT);

  const before = statSync(BG_SRC).size;
  const after = statSync(BG_OUT).size;
  console.log(
    `\nBaggrund: ${BG_CHOICE}  ${meta.width}x${meta.height}  ` +
      `${(before / 1024).toFixed(0)} KB  ->  ${(after / 1024).toFixed(0)} KB JPEG ` +
      `(-${Math.round((1 - after / before) * 100)}%)`
  );
  console.log(
    `  daempet ${Math.round((1 - BG_BRIGHTNESS) * 100)}%, ` +
      `vignet fra ${Math.round(BG_VIGNETTE.start * 100)}% ud til ${BG_VIGNETTE.strength} i hjoernerne`
  );
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
