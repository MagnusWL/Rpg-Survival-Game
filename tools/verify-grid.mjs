import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from the script's own location rather than hardcoded to one
// machine, which it embarrassingly was until 21 July.
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Raw_Assets', 'Grafik', 'Knight');
const CELL = 128;
const ALPHA_MIN = 8;

const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
const rows = [];

for (const file of files) {
  const img = sharp(path.join(DIR, file));
  const { width, height } = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const alphaAt = (x, y) => data[(y * width + x) * ch + (ch - 1)];

  // 1. Bleed: any content sitting ON a 128 grid line?
  let vBleed = 0;
  let hBleed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = CELL; x < width; x += CELL) {
      if (alphaAt(x - 1, y) > ALPHA_MIN) vBleed++;
      if (alphaAt(x, y) > ALPHA_MIN) vBleed++;
    }
  }
  for (let y = CELL; y < height; y += CELL) {
    for (const yy of [y - 1, y]) {
      for (let x = 0; x < width; x++) {
        if (alphaAt(x, yy) > ALPHA_MIN) hBleed++;
      }
    }
  }

  // 2. How many of the 15x8 cells actually contain a sprite?
  const cols = width / CELL;
  const rowsN = height / CELL;
  let filled = 0;
  const perCellBox = [];
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      let minX = CELL, maxX = -1, minY = CELL, maxY = -1;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          if (alphaAt(c * CELL + x, r * CELL + y) > ALPHA_MIN) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) {
        filled++;
        perCellBox.push({ minX, maxX, minY, maxY });
      }
    }
  }

  // 3. Widest/tallest sprite found in any single cell
  const maxW = Math.max(...perCellBox.map((b) => b.maxX - b.minX + 1));
  const maxH = Math.max(...perCellBox.map((b) => b.maxY - b.minY + 1));
  const gMinX = Math.min(...perCellBox.map((b) => b.minX));
  const gMaxX = Math.max(...perCellBox.map((b) => b.maxX));
  const gMinY = Math.min(...perCellBox.map((b) => b.minY));
  const gMaxY = Math.max(...perCellBox.map((b) => b.maxY));

  rows.push({
    sheet: file.replace('.png', ''),
    size: `${width}x${height}`,
    cells: `${filled}/${cols * rowsN}`,
    bleed: vBleed + hBleed,
    maxSprite: `${maxW}x${maxH}`,
    union: `x${gMinX}-${gMaxX} y${gMinY}-${gMaxY}`,
  });
}

console.table(rows);
const clean = rows.filter((r) => r.bleed === 0).length;
const full = rows.filter((r) => r.cells === '120/120').length;
console.log(`\nSheets med NUL indhold paa 128-rasterets graenser : ${clean} / ${rows.length}`);
console.log(`Sheets hvor alle 120 celler er fyldt              : ${full} / ${rows.length}`);
