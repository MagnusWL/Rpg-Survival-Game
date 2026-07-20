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
import { mkdirSync, statSync, readdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
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

// Only what the game actually renders today. 'Die' stays out because the game
// loop stops simulating on death, so it would freeze on frame 0.
//
// A plain string means the output takes the source's name in lower case; give
// `out` when they need to differ.
const SHEETS = [
  'Idle',
  // The sheathed walk, not the ordinary one. Walking only happens on the way in,
  // before he has drawn -- carrying a visible sword there would contradict the
  // flourish that follows. 'Walk.png' with the sword out is still in Grafik if a
  // slow-walk state ever turns up in play.
  { src: 'Walk no sword', out: 'walk' },
  'Run',
  'Melee',
  'TakeDamage',
  'UnSheathSword',
  // The answer to TakeDamage: hit between swings, he flinches, then kicks the
  // crowd off him. The shove that used to ride on the invisible swing rides
  // on this instead.
  'Kick',
];

/**
 * The shape of the rim light on the knight -- where it falls, not what colour.
 *
 * This writes a second sheet beside each of his, holding only the light: white,
 * with the alpha channel carrying how strongly each pixel is lit. The game lays
 * that over him and recolours it as it draws, which is what makes colour and
 * strength adjustable while it runs.
 *
 * It is worked out here rather than at runtime because the light has to stay
 * inside his outline, and nothing the renderer can do clips a layer to a
 * sprite's silhouette -- blend modes change the colour where two layers meet
 * but still paint where the one underneath is empty, so a live version would
 * need a real mask, which is web only. Computed from his own alpha, the mask
 * simply is his silhouette, so no clipping is needed at all.
 *
 * The light sits in the scene, not on him, so its direction is the same for
 * every one of the eight facings: he turns, the moon does not.
 *
 * What lives where: direction and reach are baked into the shape below and need
 * a rebuild. Colour and strength are the game's, in RIM_STYLE in App.tsx.
 *
 * `toLight` points at the light in screen terms -- x right, y down -- so
 * [-1, -1] is over his left shoulder. `band` is how far the light reaches in
 * from the edge, in pixels at OUT_CELL.
 */
const RIM = {
  enabled: true,
  toLight: [-1, -1],
  // He is only 35 to 42 px across inside the cell, so this is already a tenth
  // of his width. Four read as half of him being lit rather than an edge.
  band: 2,
  /**
   * What counts as him rather than as his shadow.
   *
   * Each frame carries its own drop shadow in the same picture, and without
   * this the light finds the shadow's edges too and draws bright lines along
   * the ground and across the blob, which looks like a bug because it is one.
   *
   * Transparency alone does not separate them. The shadow is soft at its rim
   * but solid in the middle, so half of it passes an alpha test and its inner
   * boundary then reads as an edge. Brightness does separate them, and cleanly:
   * measured over a frame, the shadow is flat black -- 273 of 950 opaque pixels
   * sit below brightness 2 -- and his darkest armour starts at 6, with almost
   * nothing in between. So the test is both, and 4 sits in the gap.
   *
   * It applies both ways: a pixel that is not him neither takes the light nor
   * blocks it, so the shadow is simply not there as far as the light is
   * concerned.
   */
  bodyAlpha: 200,
  bodyLuma: 4,
};

/**
 * Works out where the light falls and returns it as its own picture.
 *
 * For each pixel inside a figure it steps toward the light until it leaves the
 * figure. Leave within `band` pixels and the pixel is near a lit edge, so it is
 * lit by how close it was; leave later, or not at all, and it stays dark. The
 * result is white everywhere, with alpha carrying that strength -- so tinting
 * it in the game gives the light a colour, and fading it gives it a level.
 *
 * Because every lit pixel was one of his to begin with, the mask can never
 * reach past his outline however it is drawn.
 *
 * Steps that would cross into the neighbouring frame are treated as solid
 * rather than as empty space. A sheet is a grid of separate drawings, and
 * reading across the seam would light the edge of the cell instead of the edge
 * of the man standing in it.
 */
function rimMask(data, width, height, cell, opts) {
  const mask = new Uint8ClampedArray(width * height * 4);
  const [lx, ly] = opts.toLight;
  const len = Math.hypot(lx, ly) || 1;
  const ux = lx / len;
  const uy = ly / len;
  const band = Math.max(1, opts.band);

  /** Him, as opposed to his shadow or the empty space around him. */
  const isBody = (i) =>
    data[i + 3] >= opts.bodyAlpha &&
    0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] >= opts.bodyLuma;

  for (let y = 0; y < height; y++) {
    const cellTop = Math.floor(y / cell) * cell;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isBody(i)) continue;

      const cellLeft = Math.floor(x / cell) * cell;
      let reach = 0;
      for (let d = 1; d <= band; d++) {
        const sx = Math.round(x + ux * d);
        const sy = Math.round(y + uy * d);
        const outsideCell =
          sx < cellLeft || sx >= cellLeft + cell || sy < cellTop || sy >= cellTop + cell;
        if (outsideCell) break; // treat the seam as solid: no light here
        if (!isBody((sy * width + sx) * 4)) {
          reach = d;
          break;
        }
      }
      if (!reach) continue;

      // Brightest against the edge, gone by the far side of the band. White,
      // so whatever colour the game tints it with arrives undiluted.
      mask[i] = 255;
      mask[i + 1] = 255;
      mask[i + 2] = 255;
      mask[i + 3] = Math.round((1 - (reach - 1) / band) * 255);
    }
  }
  return mask;
}

mkdirSync(OUT_DIR, { recursive: true });

const scale = OUT_CELL / SRC_CELL;
const outW = Math.round(COLS * SRC_CELL * scale);
const outH = Math.round(ROWS * SRC_CELL * scale);

console.log(`Kilde : ${COLS}x${ROWS} celler a ${SRC_CELL}px  (${COLS * SRC_CELL}x${ROWS * SRC_CELL})`);
console.log(`Ud    : ${COLS}x${ROWS} celler a ${OUT_CELL}px  (${outW}x${outH})\n`);

for (const entry of SHEETS) {
  const name = typeof entry === 'string' ? entry : entry.src;
  const outName = typeof entry === 'string' ? entry.toLowerCase() : entry.out;
  const srcPath = path.join(SRC_DIR, `${name}.png`);
  const outPath = path.join(OUT_DIR, `${outName}.png`);

  const meta = await sharp(srcPath).metadata();
  if (meta.width !== COLS * SRC_CELL || meta.height !== ROWS * SRC_CELL) {
    throw new Error(
      `${name}.png er ${meta.width}x${meta.height}, forventede ${COLS * SRC_CELL}x${ROWS * SRC_CELL}`
    );
  }

  // Resize the whole sheet in one pass. Because every cell edge lands on an
  // exact multiple of OUT_CELL (128 -> 96 is a clean 3/4), no frame bleeds
  // into its neighbour.
  const sheet = sharp(srcPath).resize(outW, outH, { kernel: 'lanczos3', fit: 'fill' });
  await sheet.clone().png({ compressionLevel: 9, palette: false }).toFile(outPath);

  // The light is read off the finished sheet, so its band is measured in the
  // pixels the game actually draws rather than in the source's. He is left
  // exactly as he was -- the light is a separate picture laid over him.
  if (RIM.enabled) {
    const { data, info } = await sheet.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = rimMask(data, info.width, info.height, OUT_CELL, RIM);
    await sharp(Buffer.from(mask.buffer), {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, `${outName}-rim.png`));
  }

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
  { out: 'hurt', src: 'TakeDamage' },
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

// --- Puddles --------------------------------------------------------------
// Two layers arrive alongside the ground. One is art: the puddles themselves,
// composited into the background so they cost nothing at runtime. The other is
// data: the same puddles painted as flat pink, marking where water effects
// belong. That one is never drawn -- it is read, turned into coordinates, and
// discarded.
//
// What comes out is a list of spots where a ripple may appear, as fractions of
// the image rather than pixels -- the background is drawn to cover, so its scale
// depends on the screen.
//
// Spots rather than shapes, because the first attempt stored each puddle as its
// bounding ellipse and 27% of the rings landed on dry grass: the puddles are
// irregular, and an ellipse drawn round one covers a good deal of ground that is
// not water. Measured coverage was as low as 62%. Points sampled from the mask
// itself cannot miss, and they leave the runtime with less to do rather than
// more -- it picks one and draws there.
const PUDDLE_ART = path.join(ROOT, 'Grafik', 'Baggrund', 'effekt', 'water puddles on background.png');
const PUDDLE_MASK = path.join(ROOT, 'Grafik', 'Baggrund', 'effekt', 'waterpuddles placement for effekt.png');
const PUDDLE_OUT = path.join(ROOT, 'assets', 'sprites', 'effects', 'puddles.json');

/** Keeps ripples off the rim, so a ring spreads into water rather than out of it. */
const PUDDLE_EDGE_MARGIN = 11; // px in the mask
/** Roughly how far apart the spots sit. Smaller means more of them. */
const PUDDLE_POINT_SPACING = 11; // px in the mask
/** No point measuring elbow room past this; nothing draws a ring that big. */
const PUDDLE_MAX_ROOM = 70; // px in the mask

/**
 * Finds the marked blobs and samples each one for places a ripple can sit.
 *
 * Sampling is spread over a grid rather than taken at random so the spots cover
 * a puddle evenly. Big puddles yield more of them, which is what makes the rain
 * fall harder on open water without anything having to weight it.
 */
async function readPuddleMask(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const marked = (i) => data[i * channels + 3] > 40 && data[i * channels] > 90;

  /** True when every pixel within the margin is water too. */
  const wellInside = (x, y) => {
    const r = PUDDLE_EDGE_MARGIN;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
        if (!marked(ny * width + nx)) return false;
      }
    }
    return true;
  };

  /**
   * How wide a ring can grow here before it touches the bank.
   *
   * Measured squashed to half height, since that is the shape a ring is drawn
   * as -- the ground is seen at an angle. Recorded per spot so a ring in a
   * narrow puddle stays small while one in open water spreads properly, which
   * also keeps the effect right on a phone, where the ground is drawn smaller
   * and a fixed size would swamp the little puddles.
   */
  const roomFor = (x, y) => {
    for (let r = 1; r <= PUDDLE_MAX_ROOM; r++) {
      for (let a = 0; a < 32; a++) {
        const th = (a / 32) * Math.PI * 2;
        const nx = Math.round(x + Math.cos(th) * r);
        const ny = Math.round(y + Math.sin(th) * r * 0.5);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return r;
        if (!marked(ny * width + nx)) return r;
      }
    }
    return PUDDLE_MAX_ROOM;
  };

  const seen = new Uint8Array(width * height);
  const puddles = [];
  const stack = [];

  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !marked(start)) continue;
    let minX = width, maxX = -1, minY = height, maxY = -1, count = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % width;
      const y = (i / width) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (!seen[n] && marked(n)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    // Ignore stray specks; a real puddle covers a decent patch of ground.
    if (count < 400) continue;

    // One spot per grid cell, taken as near the cell's middle as the water
    // allows. A puddle too narrow to hold any is dropped rather than fudged.
    const step = PUDDLE_POINT_SPACING;
    const points = [];
    for (let cy = minY; cy <= maxY; cy += step) {
      for (let cx = minX; cx <= maxX; cx += step) {
        let best = null;
        let bestD = Infinity;
        for (let y = cy; y < Math.min(cy + step, maxY + 1); y++) {
          for (let x = cx; x < Math.min(cx + step, maxX + 1); x++) {
            if (!marked(y * width + x)) continue;
            const d = (x - cx - step / 2) ** 2 + (y - cy - step / 2) ** 2;
            if (d < bestD && wellInside(x, y)) {
              bestD = d;
              best = [x, y];
            }
          }
        }
        if (best) {
          points.push([
            +(best[0] / width).toFixed(4),
            +(best[1] / height).toFixed(4),
            roomFor(best[0], best[1]),
          ]);
        }
      }
    }
    if (points.length) puddles.push({ points, pixels: count });
  }
  return puddles.sort((a, b) => b.pixels - a.pixels);
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
const BG_CHOICE = 'Background.png';

const BG_SRC = path.join(ROOT, 'Grafik', 'Baggrund', BG_CHOICE);
const BG_OUT = path.join(ROOT, 'assets', 'sprites', 'background.jpg');

/**
 * Darkening and corner shading, for a source that arrives ungraded.
 *
 * Chosen by comparing the two side by side in the game: this one lands at 38.2
 * in the middle and 6.5 in the corners, against the remaster's 48.6 and 11.6.
 * Darker throughout, and the corners fall away far more, which is what won.
 *
 * Turn both off (brightness 1, strength 0) for a source that was graded before
 * it got here -- Remaster.jpg was, and ours would land on top of that rather
 * than instead of it. The build then copies rather than re-encoding.
 */
const BG_BRIGHTNESS = 0.85;
const BG_VIGNETTE = { start: 0.45, strength: 0.55 };

if (existsSync(BG_SRC)) {
  const meta = await sharp(BG_SRC).metadata();
  const darkening = BG_BRIGHTNESS !== 1;
  const vignetting = BG_VIGNETTE.strength > 0;
  const alreadyJpeg = /\.jpe?g$/i.test(BG_CHOICE);
  const puddles = existsSync(PUDDLE_ART);

  if (!darkening && !vignetting && !puddles && alreadyJpeg) {
    // Nothing to do, and re-encoding a JPEG only throws away detail for no
    // reason. Copy it through untouched.
    copyFileSync(BG_SRC, BG_OUT);
    console.log(
      `\nBaggrund: ${BG_CHOICE}  ${meta.width}x${meta.height}  ` +
        `${(statSync(BG_OUT).size / 1024).toFixed(0)} KB, kopieret uroert (ingen behandling)`
    );
  } else {
    let img = sharp(BG_SRC);
    // Puddles first, so the darkening and vignette fall on them too and they
    // sit in the ground rather than on top of it.
    if (puddles) {
      img = sharp(await img.composite([{ input: PUDDLE_ART, blend: 'over' }]).png().toBuffer());
    }
    if (darkening) img = img.modulate({ brightness: BG_BRIGHTNESS });
    if (vignetting) {
      // An ellipse rather than a circle: an SVG gradient defaults to the shape's
      // own box, so it follows the image's proportions instead of a square.
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
      img = img.composite([{ input: vignette, blend: 'over' }]);
    }
    await img.jpeg({ quality: 88, mozjpeg: true }).toFile(BG_OUT);

    const before = statSync(BG_SRC).size;
    const after = statSync(BG_OUT).size;
    console.log(
      `\nBaggrund: ${BG_CHOICE}  ${meta.width}x${meta.height}  ` +
        `${(before / 1024).toFixed(0)} KB  ->  ${(after / 1024).toFixed(0)} KB JPEG ` +
        `(-${Math.round((1 - after / before) * 100)}%)`
    );
    if (puddles) console.log('  vandpytter bagt ind');
    if (darkening) console.log(`  daempet ${Math.round((1 - BG_BRIGHTNESS) * 100)}%`);
    if (vignetting) {
      console.log(`  vignet fra ${Math.round(BG_VIGNETTE.start * 100)}% ud til ${BG_VIGNETTE.strength}`);
    }
  }
}

if (existsSync(PUDDLE_MASK)) {
  const found = await readPuddleMask(PUDDLE_MASK);
  // Flattened on the way out: the game picks a spot, not a puddle. Which means
  // the big puddles win more rings simply by holding more spots.
  const points = found.flatMap((p) => p.points);
  mkdirSync(path.dirname(PUDDLE_OUT), { recursive: true });
  writeFileSync(PUDDLE_OUT, JSON.stringify(points));
  console.log(`\nVandpytter: ${found.length} fundet i markeringslaget`);
  for (const p of found) {
    console.log(`  ${String(p.pixels).padStart(6)} px vand  ->  ${String(p.points.length).padStart(3)} pladser`);
  }
  const room = points.map((p) => p[2]).sort((a, b) => a - b);
  console.log(
    `  ${points.length} pladser i alt, mindst ${PUDDLE_EDGE_MARGIN} px fra kanten  ->  ` +
      `${(statSync(PUDDLE_OUT).size / 1024).toFixed(1)} KB`
  );
  console.log(`  plads til ringen: ${room[0]} til ${room[room.length - 1]} px, median ${room[room.length >> 1]}`);
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

// --- Menu ------------------------------------------------------------------
// The title screen: the knight ringed by what he is about to fight, under the
// game's name, and the plaque that starts a run.
//
// The background carries no alpha, so it goes to JPEG like the ground does --
// indistinguishable at a glance and a fraction of the size. The plaque needs
// its alpha, so it stays PNG, and is brought down to twice the width it is
// drawn at, which is as much as a phone at 2x can show.
const MENU_SRC = path.join(ROOT, 'Grafik', 'Menu', 'Mobile game menu buttons3', 'dropin', 'assets');
const MENU_OUT = path.join(ROOT, 'assets', 'sprites', 'menu');
const MENU_BUTTON_W = 720;

if (existsSync(MENU_SRC)) {
  mkdirSync(MENU_OUT, { recursive: true });

  const bgIn = path.join(MENU_SRC, 'bg.png');
  const bgOut = path.join(MENU_OUT, 'bg.jpg');
  const bgMeta = await sharp(bgIn).metadata();
  await sharp(bgIn).jpeg({ quality: 86, mozjpeg: true }).toFile(bgOut);

  const btIn = path.join(MENU_SRC, 'button.png');
  const btOut = path.join(MENU_OUT, 'button.png');
  const btMeta = await sharp(btIn).metadata();
  await sharp(btIn).resize(MENU_BUTTON_W).png({ compressionLevel: 9 }).toFile(btOut);
  const btAfter = await sharp(btOut).metadata();

  console.log(
    `\nMenu: baggrund ${bgMeta.width}x${bgMeta.height}  ` +
      `${(statSync(bgIn).size / 1024).toFixed(0)} KB -> ${(statSync(bgOut).size / 1024).toFixed(0)} KB JPEG ` +
      `(-${Math.round((1 - statSync(bgOut).size / statSync(bgIn).size) * 100)}%)`
  );
  console.log(
    `      knap ${btMeta.width}x${btMeta.height} -> ${btAfter.width}x${btAfter.height}  ` +
      `${(statSync(btIn).size / 1024).toFixed(0)} KB -> ${(statSync(btOut).size / 1024).toFixed(0)} KB`
  );
}

// --- Intro -----------------------------------------------------------------
// The three story cards shown before the menu: the two of them at the fire, her
// being carried off, and what he walks into looking for her.
//
// Numbered rather than named, because the order is the story. They arrive at
// 941x1672 -- the same shape as the menu art, so they take the same cover fit --
// and that is left alone: a phone at 2x draws them about 950 across, so the
// source is already the right size and downscaling would only soften them.
//
// Quality 92 rather than the 86 the menu background gets. These are much darker,
// and flat near-black gradients are where JPEG bands; measured against the
// source, 86 puts 0.4-0.7% of samples more than 8 levels out where 92 keeps it
// near 0.1%, for about 70 KB a card. Worth it on the first thing anyone sees.
// Each card is now the still half of a drop-in kit, and the kit's own canvas
// draws the moving half over it -- see vendor/intro-*. Taken from inside those
// folders rather than from loose files, so the background and the effect that
// belongs on it can never drift apart.
//
// The campfire's background matters especially: the flames are painted out of
// it, because the fire is the animation. Reach for the older 1.png and the
// scene ends up burning twice.
const INTRO_SRC = path.join(ROOT, 'Grafik', 'Intro');
const INTRO_OUT = path.join(ROOT, 'assets', 'sprites', 'intro');
const INTRO_CARDS = [
  { card: '1', from: path.join('1 Campfire', 'dropin-campfire', 'assets', 'campfire.png') },
  { card: '2', from: path.join('2 Monster', 'dropin-monster', 'assets', 'monster.png') },
  { card: '3', from: path.join('3 Horizon', 'dropin-fog', 'assets', 'knight-vista.png') },
];
const INTRO_QUALITY = 92;

if (existsSync(INTRO_SRC)) {
  mkdirSync(INTRO_OUT, { recursive: true });
  const lines = [];

  for (const { card, from: rel } of INTRO_CARDS) {
    const from = path.join(INTRO_SRC, rel);
    if (!existsSync(from)) {
      lines.push(`      ${card}: mangler -- ${rel}`);
      continue;
    }
    const to = path.join(INTRO_OUT, `${card}.jpg`);
    const meta = await sharp(from).metadata();
    await sharp(from).jpeg({ quality: INTRO_QUALITY, mozjpeg: true }).toFile(to);
    lines.push(
      `      ${card}: ${meta.width}x${meta.height}  ` +
        `${(statSync(from).size / 1024).toFixed(0)} KB -> ${(statSync(to).size / 1024).toFixed(0)} KB JPEG ` +
        `(-${Math.round((1 - statSync(to).size / statSync(from).size) * 100)}%)`
    );
  }

  console.log(`\nIntro: ${INTRO_CARDS.length} historiebilleder`);
  for (const line of lines) console.log(line);
}
