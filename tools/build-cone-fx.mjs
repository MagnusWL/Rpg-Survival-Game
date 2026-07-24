/**
 * Bakes the cone's strike lines into one sprite sheet.
 *
 * Why this exists: hand-tuning an effect until it is cheap enough is not a
 * way of working -- Nicolai's point, and he is right. The knight and the
 * zombies are sprite sheets precisely so nobody has to think about their
 * cost, and effects should be no different.
 *
 * What is baked is the LINE, not the whole cone. Baking the whole wedge is
 * possible but a poor trade: unfolded it is 789 x 650 px, so an animation of
 * it is either 40 MB of texture or so few frames that the wave crawls. A
 * strike line is a thin curved thing, and there are only eight of them, so
 * the entire set fits in well under a megabyte -- and the wave's travel then
 * costs nothing at all, because it is eight elements appearing in turn
 * rather than a film of the whole field.
 *
 * Each cell holds one arc: the dotted line the front lights up at that
 * distance from the knight. Drawn pointing east, right-aligned in its cell,
 * so the game can place it at `radius` along the cast direction and rotate
 * the lot.
 *
 * Run: node tools/build-cone-fx.mjs   (or npm run build:sprites, which calls it)
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'sprites', 'fx');

// --- The same numbers App.tsx draws with ------------------------------------
// Kept here rather than imported because App.tsx is TypeScript with JSX; if
// these drift the sheet stops matching the cone, so they are few on purpose.
const SCREEN_W = 390;
const PLAY_H = 844 - 50 - 48 - 60;
const CONE_RANGE = Math.hypot(SCREEN_W, PLAY_H);
const HALF_ANGLE_DEG = 21;
const CELL = 2;
const ARC_GAP = 96;
const ARC_DENSITY = 0.55;
/** The colours a dot can take, brightest first. Same family as the skill. */
const ARC_COLORS = [
  [255, 228, 175],
  [255, 196, 107],
  [255, 168, 90],
];

/** Deterministic dice: the same sheet comes out of every build. */
const mulberry = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const halfRad = (HALF_ANGLE_DEG * Math.PI) / 180;

// One arc per gap out to the far corner. The first sits at ARC_GAP rather
// than at zero: a line of no length at the knight's feet is nothing to see.
const RADII = [];
for (let r = ARC_GAP; r <= CONE_RANGE; r += ARC_GAP) RADII.push(r);

// Every cell is the size of the largest arc, so stepping through the sheet is
// one multiplication. The waste is transparent pixels and costs nothing worth
// counting at this size.
const rMax = RADII[RADII.length - 1];
const CELL_W = Math.ceil(rMax * (1 - Math.cos(halfRad))) + CELL * 2; // how far it bows back
const CELL_H = Math.ceil(2 * rMax * Math.sin(halfRad)) + CELL * 2; // end to end

const sheetW = CELL_W * RADII.length;
const sheetH = CELL_H;
const buf = Buffer.alloc(sheetW * sheetH * 4, 0);

/** Paints one CELL x CELL square, clipped to the sheet. */
function dot(px, py, [r, g, b], alpha) {
  for (let y = py; y < py + CELL; y++) {
    if (y < 0 || y >= sheetH) continue;
    for (let x = px; x < px + CELL; x++) {
      if (x < 0 || x >= sheetW) continue;
      const i = (y * sheetW + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = Math.max(buf[i + 3], Math.round(alpha * 255));
    }
  }
}

let dots = 0;
for (const [cellIndex, radius] of RADII.entries()) {
  const rnd = mulberry(9973 + cellIndex * 7919);
  const originX = cellIndex * CELL_W + CELL_W - CELL; // the arc's midpoint, at the cell's right
  const originY = Math.floor(CELL_H / 2);
  // Walk the arc by arc length so the dots stay evenly spread whatever the
  // radius -- stepping by angle would crowd the near arcs and thin the far.
  const arcLength = 2 * radius * halfRad;
  const steps = Math.max(2, Math.round(arcLength / CELL));
  for (let s = 0; s <= steps; s++) {
    if (rnd() > ARC_DENSITY) continue;
    const theta = -halfRad + (s / steps) * 2 * halfRad;
    // Relative to the midpoint: the arc bows back toward the knight.
    const dx = radius * (Math.cos(theta) - 1);
    const dy = radius * Math.sin(theta);
    const colour = ARC_COLORS[Math.floor(rnd() * ARC_COLORS.length)];
    // A little variation in weight, so the line is a line and not a ruler.
    dot(Math.round(originX + dx), Math.round(originY + dy), colour, 0.65 + rnd() * 0.35);
    dots++;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, 'cone-arcs.png');
await sharp(buf, { raw: { width: sheetW, height: sheetH, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(outPath);

// The game needs to know where each arc sits and how big a cell is. Written
// beside the art so the two can never disagree.
const meta = {
  cellW: CELL_W,
  cellH: CELL_H,
  radii: RADII,
  note: 'Each cell holds one strike line, drawn pointing east and right-aligned. Place cell i with its right edge at radii[i] along the cast direction, centred across it.',
};
writeFileSync(path.join(OUT_DIR, 'cone-arcs.json'), JSON.stringify(meta, null, 2));

const { size } = await sharp(outPath).metadata().then(async (m) => ({ ...m, size: (await sharp(outPath).toBuffer()).length }));
console.log(`Kegle-streger: ${RADII.length} buer, ${dots} prikker`);
console.log(`  ark ${sheetW}x${sheetH} px  (celle ${CELL_W}x${CELL_H})  ->  ${(size / 1024).toFixed(0)} KB paa disken`);
console.log(`  ${((sheetW * sheetH * 4) / 1048576).toFixed(2)} MB i hukommelsen naar det er pakket ud`);
console.log(`  radier: ${RADII.join(', ')}`);
console.log(`Skrevet til ${path.relative(ROOT, outPath)}`);
