/**
 * Mills the story cards from the human inbox into the game.
 *
 * Reads every image in Raw_Assets/Grafik/Story/, in filename order (they are
 * numbered), and writes one game-ready card per image plus the atlas that
 * carries it. Re-run it whenever the art changes -- that is the whole point:
 * Nicolai repaints, one command, the game has it.
 *
 *   assets/sprites/story/story-N.jpg   the card
 *   main/tiles/story_N.atlas           its atlas, animation "storyN"
 *
 * One atlas per card on purpose. A Defold atlas packs its images onto a
 * single texture page, and these cards are ~1672x941 each: two of them side
 * by side already overflow the 2048 ceiling. Alone, each fits with room to
 * spare.
 *
 * Size: the cards are kept at their delivered resolution, which is also very
 * nearly what a 2x phone screen asks for (the play window is 844x390 logical,
 * so a cover-fitted card is drawn 844x475 -- 1688x950 physical). Set SCALE
 * below 1 if the memory ever matters more than the sharpness; every card is
 * width x height x 4 bytes once unpacked, whatever the file weighs on disk.
 *
 * Run: node tools/build-story.mjs
 */
import sharp from 'sharp';
import { readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Raw_Assets', 'Grafik', 'Story');
const OUT_IMG = path.join(ROOT, 'assets', 'sprites', 'story');
const ATLAS_DIR = path.join(ROOT, 'main', 'tiles');
const SCALE = 1;
const QUALITY = 88;

if (!existsSync(SRC)) {
  console.error(`ingen indbakke: ${path.relative(ROOT, SRC)}`);
  process.exit(1);
}

const files = readdirSync(SRC)
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, 'da', { numeric: true }));

if (files.length === 0) {
  console.error('indbakken er tom');
  process.exit(1);
}

// Old cards go before new ones are written, so a shorter story cannot leave
// a stale fifth card behind for the game to find.
for (const old of existsSync(OUT_IMG) ? readdirSync(OUT_IMG) : []) {
  if (old.startsWith('story-')) rmSync(path.join(OUT_IMG, old));
}
for (const old of readdirSync(ATLAS_DIR)) {
  if (/^story_\d+\.atlas$/.test(old)) rmSync(path.join(ATLAS_DIR, old));
}
mkdirSync(OUT_IMG, { recursive: true });

let memory = 0;
for (const [i, file] of files.entries()) {
  const n = i + 1;
  const name = `story-${n}`;
  const img = sharp(path.join(SRC, file));
  const meta = await img.metadata();
  const w = Math.round(meta.width * SCALE);
  const h = Math.round(meta.height * SCALE);
  await (SCALE < 1 ? img.resize(w, h) : img)
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(path.join(OUT_IMG, `${name}.jpg`));

  writeFileSync(path.join(ATLAS_DIR, `story_${n}.atlas`),
    'images {\n' +
    `  image: "/assets/sprites/story/${name}.jpg"\n` +
    '}\n' +
    'margin: 2\n' +
    'extrude_borders: 2\n');

  memory += (w * h * 4) / 1048576;
  console.log(`${n}. ${file}  ->  ${name}.jpg  ${w}x${h}`);
}

console.log(`\n${files.length} kort, ${memory.toFixed(1)} MB udpakket i hukommelsen`);
console.log('menu.gui skal have et textures-felt pr. kort: story1..story' + files.length);
console.log('menu.gui_script laeser STORY_CARDS -- husk at rette tallet hvis antallet skifter');
