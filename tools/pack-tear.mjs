/**
 * Packs the recorded tear frames into Defold assets.
 *
 * Takes tools/recordings/tear/ (produced by record-tear.html on the virtual
 * clock), finds the one box that holds every frame's ink, crops all frames to
 * it -- uniform on purpose: a GUI flipbook stretches each image to the node,
 * so differing sizes would swim -- and writes:
 *
 *   assets/sprites/tear/frame-XX.png   the film
 *   main/tiles/tear.atlas              one animation, "tear"
 *
 * If the full 30 fps film cannot fit a 2048x2048 texture, every other frame
 * is dropped and the animation plays at 15 -- decided by arithmetic here, not
 * by taste, and printed so the choice is visible.
 *
 * The placement numbers the menu script needs are printed at the end and
 * written into the atlas folder as placement.json.
 *
 * Run: node tools/pack-tear.mjs   (after a fresh recording)
 */
import sharp from 'sharp';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REC = path.join(ROOT, 'tools', 'recordings', 'tear');
const OUT_IMG = path.join(ROOT, 'assets', 'sprites', 'tear');
const OUT_ATLAS = path.join(ROOT, 'main', 'tiles', 'tear.atlas');
const MAX_TEXTURE = 2048;

const meta = JSON.parse(readFileSync(path.join(REC, 'meta.json'), 'utf8'));
const files = readdirSync(REC).filter((f) => f.startsWith('frame-')).sort();

// --- The one box that holds every frame's ink ------------------------------
let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
for (const f of files) {
  const { data, info } = await sharp(path.join(REC, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
}
// A pixel of air on every side, so linear filtering cannot bleed an edge.
minX = Math.max(0, minX - 1);
minY = Math.max(0, minY - 1);
maxX = Math.min(meta.screen.W - 1, maxX + 1);
maxY = Math.min(meta.screen.H - 1, maxY + 1);
const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

// --- Does the film fit a single texture? Grid arithmetic, no guessing ------
const fits = (count) => {
  const cols = Math.floor(MAX_TEXTURE / (box.w + 4));
  if (cols === 0) return false;
  const rows = Math.ceil(count / cols);
  return rows * (box.h + 4) <= MAX_TEXTURE;
};
// Prefer dropping up to two TAIL frames over halving the frame rate again:
// the tail is the settled end state, where consecutive frames are all but
// identical, while the rate is the snap itself. 30 fps -> 42 frames misses a
// 2048 texture by a row; 15 fps -> 21 misses it by ONE frame, and the film
// ends 66 ms early on a pose the eye cannot tell from the final one.
let stride = 1;
let keepCount = files.length;
outer: while (stride < 8) {
  keepCount = Math.ceil(files.length / stride);
  for (let drop = 0; drop <= 2; drop++) {
    if (fits(keepCount - drop)) {
      keepCount -= drop;
      break outer;
    }
  }
  stride++;
}
const kept = files.filter((_, i) => i % stride === 0).slice(0, keepCount);
const fps = Math.round(meta.fps / stride);

// --- Write the cropped film ------------------------------------------------
rmSync(OUT_IMG, { recursive: true, force: true });
mkdirSync(OUT_IMG, { recursive: true });
const names = [];
for (const [i, f] of kept.entries()) {
  const name = `tear-${String(i).padStart(2, '0')}`;
  names.push(name);
  await sharp(path.join(REC, f))
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_IMG, `${name}.png`));
}

// --- The atlas: one animation, played once, then the script takes over -----
let atlas = '';
atlas += 'animations {\n';
atlas += '  id: "tear"\n';
for (const name of names) {
  atlas += '  images {\n';
  atlas += `    image: "/assets/sprites/tear/${name}.png"\n`;
  atlas += '  }\n';
}
atlas += '  playback: PLAYBACK_ONCE_FORWARD\n';
atlas += `  fps: ${fps}\n`;
atlas += '}\n';
atlas += 'margin: 2\n';
atlas += 'extrude_borders: 2\n';
writeFileSync(OUT_ATLAS, atlas);

// --- Placement for the menu script ----------------------------------------
const placement = {
  screen: meta.screen,
  box,
  frames: names.length,
  fps,
  note: 'box er i skaerm-koordinater (y nedad) paa 390x844; gui-noden skal staa med centrum i (box.x+box.w/2, H-(box.y+box.h/2)) og stoerrelse (box.w, box.h)',
};
writeFileSync(path.join(OUT_IMG, 'placement.json'), JSON.stringify(placement, null, 2));

const mem = (box.w * box.h * 4 * names.length) / 1048576;
console.log(`kasse: ${box.w}x${box.h} @ (${box.x},${box.y})  --  ${names.length} billeder @ ${fps} fps (stride ${stride})`);
console.log(`hukommelse for filmen: ${mem.toFixed(1)} MB udpakket`);
console.log(`atlas: ${path.relative(ROOT, OUT_ATLAS)}`);
console.log(`gui-node: centrum (${(box.x + box.w / 2).toFixed(1)}, ${(meta.screen.H - (box.y + box.h / 2)).toFixed(1)}) i gui-koordinater, stoerrelse ${box.w}x${box.h}`);
