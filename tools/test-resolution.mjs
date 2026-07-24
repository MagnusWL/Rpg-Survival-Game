/**
 * A look at what lower-resolution sheets would cost, before anyone rebuilds
 * anything. Writes one comparison picture and touches nothing else.
 *
 * The question is whether the knight can be stored smaller and blown back up
 * to the 128 px he is drawn at. It turns on arithmetic: nearest-neighbour --
 * the scaling that keeps pixel art crisp -- only stays clean at whole-number
 * ratios. 128 to 96 is 1.33, so it drops an uneven three pixels in four and
 * comes back ragged; 128 to 64 is exactly 2, so every stored pixel becomes a
 * tidy 2x2 block. Hence four columns rather than two.
 *
 * Run: node tools/test-resolution.mjs
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNIGHT = path.join(ROOT, 'assets', 'sprites', 'knight');
const OUT = path.join(ROOT, 'tools', 'opløsnings-test.png');

const CELL = 128;
const ROW_S = 2; // facings run E, SE, S, SW, ... so row 2 looks at the camera

/** One cell, cut out of a sheet. */
async function cut(sheet, col, row) {
  return sharp(path.join(KNIGHT, sheet))
    .extract({ left: col * CELL, top: row * CELL, width: CELL, height: CELL })
    .toBuffer();
}

/** Store it smaller, then blow it back up to the size it is drawn at. */
async function roundTrip(cell, stored, kernel) {
  const small = await sharp(cell).resize(stored, stored, { kernel: 'lanczos3' }).toBuffer();
  return sharp(small).resize(CELL, CELL, { kernel }).toBuffer();
}

const COLUMNS = [
  { label: '128 px  som nu', make: (c) => Promise.resolve(c) },
  { label: '96 px  bloed', make: (c) => roundTrip(c, 96, 'lanczos3') },
  { label: '96 px  nearest', make: (c) => roundTrip(c, 96, 'nearest') },
  { label: '64 px  nearest 2x', make: (c) => roundTrip(c, 64, 'nearest') },
];

// Two animations, a couple of frames each, so it is judged on more than one pose.
const SUBJECTS = [
  { sheet: 'idle.png', col: 0, name: 'idle 1' },
  { sheet: 'run.png', col: 3, name: 'run 4' },
  { sheet: 'run.png', col: 10, name: 'run 11' },
];

// The knight uses only the middle of his cell -- verify-grid puts idle inside
// x36-95 y32-110 and run inside x21-108 y25-121 -- so the comparison crops to
// where he actually is. Judging him inside the full box means judging mostly
// empty space.
const CROP = { left: 18, top: 22, width: 94, height: 100 };
const ZOOM = 6;
const PAD = 8;
const HEAD = 26;
const cellW = CROP.width * ZOOM;
const cellH = CROP.height * ZOOM;
const sheetW = PAD + COLUMNS.length * (cellW + PAD);
const sheetH = HEAD + SUBJECTS.length * (cellH + PAD) + PAD;

const layers = [];
for (const [ci, col] of COLUMNS.entries()) {
  const x = PAD + ci * (cellW + PAD);
  layers.push({
    input: Buffer.from(
      `<svg width="${cellW}" height="${HEAD}"><text x="4" y="18" font-family="sans-serif" font-size="16" fill="#ffffff">${col.label}</text></svg>`
    ),
    left: x,
    top: 2,
  });
  for (const [si, subject] of SUBJECTS.entries()) {
    const cell = await cut(subject.sheet, subject.col, ROW_S);
    const treated = await col.make(cell);
    // Blown up with nearest so the comparison shows the stored pixels
    // themselves rather than the viewer's own smoothing.
    const zoomed = await sharp(treated)
      .extract(CROP)
      .resize(cellW, cellH, { kernel: 'nearest' })
      .toBuffer();
    layers.push({ input: zoomed, left: x, top: HEAD + si * (cellH + PAD) });
  }
}

await sharp({
  create: { width: sheetW, height: sheetH, channels: 4, background: { r: 26, g: 26, b: 38, alpha: 1 } },
})
  .composite(layers)
  .png()
  .toFile(OUT);

console.log(`Skrevet ${path.relative(ROOT, OUT)}  (${sheetW}x${sheetH})`);
console.log('Kolonner: som nu / 96 bloed / 96 nearest / 64 nearest -- vist 3x forstoerret');
console.log('Raekker : idle 1, idle 8, run 4, run 11 -- alle set forfra');
console.log('\nIngen ark er roert. Testen skriver kun dette ene billede.');
