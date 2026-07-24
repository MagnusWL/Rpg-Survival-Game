/**
 * Mills the princess's animations into the sheets and tilesources the game
 * plays.
 *
 * Her art arrives the way the zombies' does -- one folder per named
 * direction, fifteen loose 128x128 frames in each -- so this mill packs each
 * animation into the same 15 x 8 sheet the knight uses: columns are frames,
 * rows are the eight facings. That means one code path for every actor in
 * the game, and Defold reads it as a plain uniform grid, which is the only
 * thing its tilesources will take.
 *
 * Row order is the game's own: E, SE, S, SW, W, NW, N, NE -- one 45 degree
 * step clockwise from east. It was settled by driving the knight around and
 * watching him, not by reading the art (see tools/README.md: the sword and
 * shield make the profile WIDER than the head-on view, so guessing from the
 * silhouette gets east and north backwards).
 *
 * Writes, per animation:
 *   assets/sprites/princess/<name>.png        the 1920x1024 sheet
 *   main/tiles/princess_<name>.tilesource     eight animations, f0..f7
 *
 * Run: node tools/build-princess.mjs
 */
import sharp from 'sharp';
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Raw_Assets', 'Grafik', 'Princess', '2Archer');
const OUT_IMG = path.join(ROOT, 'assets', 'sprites', 'princess');
const OUT_TILES = path.join(ROOT, 'main', 'tiles');

const CELL = 128;
const COLS = 15;
// The game's facing order, and the folder each one is drawn in.
const ROWS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

// What the game needs of her now. The rest of her art stays in the inbox
// until it has a job -- every sheet costs 7.9 MB of memory unpacked, whatever
// it weighs on disk.
// loop: things she does for as long as she is doing them (standing,
// stepping, running). The rest are single acts with a beginning and an end,
// and the game will want to know when they finish.
const WANTED = [
  { folder: 'Idle', name: 'idle', fps: 10, loop: true },
  { folder: 'Attack1', name: 'attack', fps: 12 },
  { folder: 'CastSpell', name: 'cast', fps: 12 },
  { folder: 'Special1', name: 'special1', fps: 12 },
  { folder: 'StrafeLeft', name: 'strafeleft', fps: 12, loop: true },
  { folder: 'StrafeRight', name: 'straferight', fps: 12, loop: true },
  { folder: 'Run', name: 'run', fps: 14, loop: true },
  { folder: 'QuickShot', name: 'quickshot', fps: 12 },
];

mkdirSync(OUT_IMG, { recursive: true });

let total = 0;
for (const anim of WANTED) {
  const dir = path.join(SRC, anim.folder);
  if (!existsSync(dir)) {
    console.log(`${anim.folder}: mappen findes ikke -- springer over`);
    continue;
  }
  const composite = [];
  let shortest = COLS;
  for (const [row, facing] of ROWS.entries()) {
    const fdir = path.join(dir, facing);
    if (!existsSync(fdir)) throw new Error(`${anim.folder}: mangler retningen ${facing}`);
    const frames = readdirSync(fdir).filter((f) => /\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (frames.length < shortest) shortest = frames.length;
    // A sheet is a fixed grid, so a facing drawn with fewer frames holds its
    // last pose for the rest of the row rather than leaving holes in it.
    for (let col = 0; col < COLS; col++) {
      const file = frames[Math.min(col, frames.length - 1)];
      composite.push({
        input: path.join(fdir, file),
        left: col * CELL, top: row * CELL,
      });
    }
  }
  await sharp({
    create: {
      width: COLS * CELL, height: ROWS.length * CELL,
      channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composite).png({ compressionLevel: 9 })
    .toFile(path.join(OUT_IMG, `${anim.name}.png`));

  let ts = `image: "/assets/sprites/princess/${anim.name}.png"\n`;
  ts += `tile_width: ${CELL}\ntile_height: ${CELL}\n`;
  for (let row = 0; row < ROWS.length; row++) {
    ts += 'animations {\n';
    ts += `  id: "f${row}"\n`;
    ts += `  start_tile: ${row * COLS + 1}\n`;
    ts += `  end_tile: ${(row + 1) * COLS}\n`;
    ts += `  playback: ${anim.loop ? 'PLAYBACK_LOOP_FORWARD' : 'PLAYBACK_ONCE_FORWARD'}\n`;
    ts += `  fps: ${anim.fps}\n`;
    ts += '}\n';
  }
  writeFileSync(path.join(OUT_TILES, `princess_${anim.name}.tilesource`), ts);

  total += (COLS * CELL * ROWS.length * CELL * 4) / 1048576;
  console.log(`${anim.folder.padEnd(12)} -> ${anim.name.padEnd(12)} `
    + `${COLS * CELL}x${ROWS.length * CELL}`
    + (shortest < COLS ? `  (korteste retning har ${shortest} billeder, sidste pose holdes)` : ''));
}
console.log(`\n${WANTED.length} ark, ${total.toFixed(1)} MB udpakket i hukommelsen`);
