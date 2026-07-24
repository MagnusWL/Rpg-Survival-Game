/**
 * Packs the recorded intro effects into looping Defold atlases.
 *
 * Takes tools/recordings/intro{fire,eyes,fog}/ (from record-intro.html on
 * the virtual clock) and for each: finds the one box holding every frame's
 * ink, closes the loop, and fits the film onto a single 2048 texture.
 *
 * Loops are packed by different rules than the tear was:
 *
 *  - Never drop tail frames. The tear's tail was a settled pose; a loop's
 *    "tail" is the seam itself. Frame count is only ever changed by STRIDE
 *    (every 2nd exposure), which keeps the recorded period intact because
 *    the recording advanced honest sim time between every exposure.
 *  - Close the seam with a crossfade where the engine is aperiodic: the
 *    first cf output frames are blended toward the frames PAST the loop
 *    end, so frame N-1 flows into frame 0 (out[i] = lerp(rec[N+i], rec[i],
 *    (i+1)/(cf+1))). The fire needs none - one exact glow period was
 *    filmed - and the eyes were cut where the curve meets itself.
 *  - Then sacrifice RESOLUTION, never frames: walk a factor ladder until
 *    all N frames fit the texture. The period is the design; the pixels
 *    scale.
 *
 * Choice among stride/factor combos is by largest factor (sharpest film),
 * ties to the lower stride. Everything chosen is printed.
 *
 * Writes: assets/sprites/introfx/<fx>-NNN.png
 *         main/tiles/introfx_<fx>.atlas   (PLAYBACK_LOOP_FORWARD)
 *         assets/sprites/introfx/<fx>-placement.json
 *
 * Run: node tools/pack-intro.mjs   (after fresh recordings)
 */
import sharp from 'sharp';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_IMG = path.join(ROOT, 'assets', 'sprites', 'introfx');
const ATLAS_DIR = path.join(ROOT, 'main', 'tiles');
const MAX_TEXTURE = 2048;

// stride options: [stride, integer playback fps]. fps = recorded fps/stride,
// rounded down to an integer - a few percent of tempo, never the seam.
const EFFECTS = [
  { fx: 'fire', rec: 'introfire', strides: [[1, 25], [2, 12]] },
  { fx: 'eyes', rec: 'introeyes', strides: [[1, 15]] },
  { fx: 'fog', rec: 'introfog', strides: [[1, 10]] },
];
const FACTORS = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35];
const MIN_STRIDE1_FACTOR = 0.55; // below this, halving the frame rate hurts less

const raw = async (file, box) => {
  let s = sharp(file);
  if (box) s = s.extract({ left: box.x, top: box.y, width: box.w, height: box.h });
  return s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
};

mkdirSync(OUT_IMG, { recursive: true });

for (const { fx, rec, strides } of EFFECTS) {
  const dir = path.join(ROOT, 'tools', 'recordings', rec);
  if (!existsSync(path.join(dir, 'meta.json'))) {
    console.log(`${fx}: ingen optagelse i ${path.relative(ROOT, dir)} - springer over`);
    continue;
  }
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const files = readdirSync(dir).filter((f) => f.startsWith('frame-')).sort()
    .map((f) => path.join(dir, f));
  const cf = meta.cf || 0;

  // --- The one box that holds every frame's ink ----------------------------
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const f of files) {
    const { data, info } = await raw(f);
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
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(meta.canvas.W - 1, maxX + 1);
  maxY = Math.min(meta.canvas.H - 1, maxY + 1);
  const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

  // --- Pick stride and factor: sharpest film that fits one texture ---------
  const fits = (n, f) => {
    const sw = Math.ceil(box.w * f), sh = Math.ceil(box.h * f);
    const cols = Math.floor(MAX_TEXTURE / (sw + 4));
    const rows = Math.floor(MAX_TEXTURE / (sh + 4));
    return cols * rows >= n;
  };
  let pick = null;
  for (const [stride, fps] of strides) {
    if (stride > 1 && cf > 0) continue; // crossfade indexes assume stride 1
    const n = Math.ceil(files.length / stride) - (stride === 1 ? cf : 0);
    for (const f of FACTORS) {
      if (!fits(n, f)) continue;
      if (stride === 1 && strides.length > 1 && f < MIN_STRIDE1_FACTOR) break;
      if (!pick || f > pick.f) pick = { stride, fps, f, n };
      break;
    }
  }
  if (!pick) throw new Error(`${fx}: kan ikke faa filmen ned paa een 2048-tekstur`);
  const { stride, fps, f, n } = pick;

  // --- Write the film ------------------------------------------------------
  for (const old of readdirSync(OUT_IMG)) {
    if (old.startsWith(fx + '-')) rmSync(path.join(OUT_IMG, old));
  }
  const kept = files.filter((_, i) => i % stride === 0);
  const names = [];
  for (let i = 0; i < n; i++) {
    const name = `${fx}-${String(i).padStart(3, '0')}`;
    names.push(name);
    let { data, info } = await raw(kept[i], box);
    if (i < cf && stride === 1) {
      // The seam: this frame leans toward the one past the loop end, so the
      // wrap from frame n-1 back to frame 0 is a continuation, not a cut.
      const w = (i + 1) / (cf + 1);
      const { data: cont } = await raw(kept[n + i], box);
      for (let p = 0; p < data.length; p++) {
        data[p] = Math.round(cont[p] + (data[p] - cont[p]) * w);
      }
    }
    let img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
    if (f < 1) img = img.resize(Math.ceil(box.w * f), Math.ceil(box.h * f));
    await img.png({ compressionLevel: 9 }).toFile(path.join(OUT_IMG, `${name}.png`));
  }

  // --- The atlas: one looping animation ------------------------------------
  let atlas = '';
  atlas += 'animations {\n';
  atlas += `  id: "${fx}"\n`;
  for (const name of names) {
    atlas += '  images {\n';
    atlas += `    image: "/assets/sprites/introfx/${name}.png"\n`;
    atlas += '  }\n';
  }
  atlas += '  playback: PLAYBACK_LOOP_FORWARD\n';
  atlas += `  fps: ${fps}\n`;
  atlas += '}\n';
  atlas += 'margin: 2\n';
  atlas += 'extrude_borders: 2\n';
  writeFileSync(path.join(ATLAS_DIR, `introfx_${fx}.atlas`), atlas);

  const placement = {
    canvas: meta.canvas,
    box,
    frames: n,
    fps,
    stride,
    factor: f,
    crossfade: stride === 1 ? cf : 0,
    note: 'box er i tegne-kort-koordinater (475x844, y nedad); paa kortnoden: lokal pos (box.x+box.w/2-237.5, 422-(box.y+box.h/2)), stoerrelse (box.w, box.h)',
  };
  writeFileSync(path.join(OUT_IMG, `${fx}-placement.json`), JSON.stringify(placement, null, 2));

  const mem = (Math.ceil(box.w * f) * Math.ceil(box.h * f) * 4 * n) / 1048576;
  console.log(
    `${fx}: kasse ${box.w}x${box.h} @ (${box.x},${box.y})  --  ${n} billeder @ ${fps} fps` +
    `  (stride ${stride}, faktor ${f}, krydsfade ${stride === 1 ? cf : 0})  --  ${mem.toFixed(1)} MB udpakket`
  );
  console.log(
    `  gui-node paa kortet: lokal (${(box.x + box.w / 2 - meta.canvas.W / 2).toFixed(1)}, ` +
    `${(meta.canvas.H / 2 - (box.y + box.h / 2)).toFixed(1)}), stoerrelse ${box.w}x${box.h}`
  );
}
