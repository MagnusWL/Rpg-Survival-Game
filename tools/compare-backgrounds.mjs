/**
 * Puts every candidate in Raw_Assets/Grafik/Baggrund side by side, with the darkening and
 * vignette from build-sprites.mjs already applied -- so what you see is how each
 * would actually look in the game rather than how it looks on disk.
 *
 * Run: node tools/compare-backgrounds.mjs out.png
 */
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'Raw_Assets', 'Grafik', 'Baggrund');
const OUT = process.argv[2];

// kept in step with build-sprites.mjs
const BRIGHTNESS = 0.85;
const VIGNETTE = { start: 0.45, strength: 0.55 };

const files = readdirSync(DIR).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
if (!files.length) {
  console.error('Ingen baggrunde i Raw_Assets/Grafik/Baggrund');
  process.exit(1);
}

const W = 340;
const GAP = 10;
const LABEL = 30;
const COLS = 3;

const parts = [];
for (const [i, file] of files.entries()) {
  const src = path.join(DIR, file);
  const meta = await sharp(src).metadata();
  const h = Math.round((meta.height / meta.width) * W);

  const vignette = Buffer.from(
    `<svg width="${W}" height="${h}">
       <defs>
         <radialGradient id="v" cx="50%" cy="50%" r="75%">
           <stop offset="${VIGNETTE.start * 100}%" stop-color="#000" stop-opacity="0"/>
           <stop offset="100%" stop-color="#000" stop-opacity="${VIGNETTE.strength}"/>
         </radialGradient>
       </defs>
       <rect width="100%" height="100%" fill="url(#v)"/>
     </svg>`
  );

  const img = await sharp(src)
    .resize(W, h)
    .modulate({ brightness: BRIGHTNESS })
    .composite([{ input: vignette, blend: 'over' }])
    .png()
    .toBuffer();

  const x = GAP + (i % COLS) * (W + GAP);
  const y = GAP + Math.floor(i / COLS) * (h + LABEL + GAP);
  parts.push({ input: img, left: x, top: y + LABEL });
  parts.push({
    input: Buffer.from(
      `<svg width="${W}" height="${LABEL}">
         <text x="0" y="20" font-family="sans-serif" font-size="16" font-weight="bold"
               fill="#e8eaf6">${file}</text>
         <text x="${W}" y="20" font-family="sans-serif" font-size="13" fill="#9fa8da"
               text-anchor="end">${(statSync(src).size / 1024 / 1024).toFixed(1)} MB</text>
       </svg>`
    ),
    left: x,
    top: y,
  });
}

const meta0 = await sharp(path.join(DIR, files[0])).metadata();
const h0 = Math.round((meta0.height / meta0.width) * W);
const rows = Math.ceil(files.length / COLS);

await sharp({
  create: {
    width: COLS * W + (COLS + 1) * GAP,
    height: rows * (h0 + LABEL + GAP) + GAP,
    channels: 4,
    background: { r: 20, g: 20, b: 34, alpha: 1 },
  },
})
  .composite(parts)
  .png()
  .toFile(OUT);

console.log(`${files.length} baggrunde: ${files.join(', ')}`);
console.log('skrevet:', OUT);
