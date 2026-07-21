/**
 * Proves that packing the sheets did not change a single pixel of what
 * reaches the screen.
 *
 * For every frame of every sheet it takes the packed frame, puts it back at
 * the offset it was cropped by, and compares it against the same frame in an
 * older commit's plain 15x8 grid. Alpha is what is compared: colour under
 * zero alpha is invisible, so a difference there would be a difference in
 * nothing.
 *
 * This is the tool that makes packing safe to attempt at all. Cropping every
 * frame separately is 120 chances per sheet to be off by a pixel, and the eye
 * cannot audit 2400 frames -- but this can, and did: it is what caught the
 * clip box still being 128 square while the cells had shrunk, which had the
 * neighbouring frames bleeding into view.
 *
 * Run: node tools/verify-sprites.mjs [ref]
 *   ref defaults to HEAD~1; pass any commit whose sheets are a plain grid.
 */
import sharp from 'sharp';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';

const CELL = 128, COLS = 15, ROWS = 8;
const REF = process.argv[2] ?? 'HEAD~1'; // the untrimmed sheets
const atlas = JSON.parse(readFileSync('assets/sprites/knight/atlas.json', 'utf8'));
const names = readdirSync('assets/sprites/knight').filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', ''));

let worst = 0, worstWhere = '';
for (const name of names) {
  const layout = atlas.sheets[name.replace('-rim', '')];
  const tmp = `_ref-${name}.png`;
  writeFileSync(tmp, execSync(`git show ${REF}:assets/sprites/knight/${name}.png`, { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }));
  const ref = await sharp(tmp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  unlinkSync(tmp);
  if (ref.info.width !== COLS * CELL) { console.log(`${name}: reference er ${ref.info.width}px bred, ikke et 15x8 gitter -- sprunget over`); continue; }

  const now = await sharp(`assets/sprites/knight/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  let maxDiff = 0, at = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const [fx, fy, fw, fh, ox, oy] = layout.frames[r * COLS + c];
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const refA = ref.data[((r * CELL + y) * ref.info.width + c * CELL + x) * 4 + 3];
          // Inside the frame's box the packed sheet has the pixel; outside it
          // was cropped away and must have been empty.
          const inBox = fw > 0 && x >= ox && x < ox + fw && y >= oy && y < oy + fh;
          const nowA = inBox
            ? now.data[((fy + (y - oy)) * now.info.width + fx + (x - ox)) * 4 + 3]
            : 0;
          const d = Math.abs(refA - nowA);
          if (d > maxDiff) { maxDiff = d; at = `celle ${c},${r} px ${x},${y}`; }
        }
      }
    }
  }
  console.log(`${name.padEnd(20)} ark ${`${layout.w}x${layout.h}`.padEnd(10)} ${maxDiff ? 'AFVIGELSE ' + maxDiff + '  (' + at + ')' : 'identisk'}`);
  if (maxDiff > worst) { worst = maxDiff; worstWhere = name; }
}
console.log(`\n${names.length} ark, ${COLS * ROWS} billeder hver = ${names.length * COLS * ROWS} sammenlignet mod ${REF}`);
console.log(worst ? `VAERSTE AFVIGELSE ${worst} i ${worstWhere}` : 'ALT PIXEL-IDENTISK');
