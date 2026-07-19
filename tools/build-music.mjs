/**
 * Builds the music tracks from the raw WAVs in Music/.
 *
 * Two things separate this from build-sounds.mjs:
 *
 *   Music is compressed with a codec, where the effects are not. A half-second
 *   sword hit ships fine as raw audio; two and a half minutes of orchestra does
 *   not, and MP3 is where the saving actually lives.
 *
 *   Music is levelled by its average rather than its peak. A hit is a spike --
 *   loud peak, quiet average -- while music is dense and even. Matching peaks
 *   would leave the music sitting on top of the game.
 *
 * Run: npm run build:music
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC, MUSIC_BITRATE, MUSIC_RMS_DB } from './sound-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'music');

function ffmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!ffmpegAvailable()) {
  console.error('ffmpeg blev ikke fundet. Installer med:  winget install Gyan.FFmpeg');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

/** Average level over the whole track, which is what loudness is judged by. */
function measureRmsDb(file) {
  const res = spawnSync(
    'ffmpeg',
    ['-i', file, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  const all = [...(res.stderr ?? '').matchAll(/RMS level dB:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  if (!all.length) throw new Error(`Kunne ikke maale niveau for ${path.basename(file)}`);
  return all[all.length - 1];
}

let totalBefore = 0;
let totalAfter = 0;

for (const { out, src } of MUSIC) {
  const inPath = path.join(ROOT, src);
  if (!existsSync(inPath)) {
    console.error(`MANGLER: ${src}`);
    continue;
  }
  const outPath = path.join(OUT_DIR, `${out}.mp3`);

  const rms = measureRmsDb(inPath);
  const gain = MUSIC_RMS_DB - rms;

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-i', inPath,
      '-af', `volume=${gain.toFixed(2)}dB`,
      '-codec:a', 'libmp3lame',
      '-b:a', MUSIC_BITRATE,
      outPath,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );

  const before = statSync(inPath).size;
  const after = statSync(outPath).size;
  totalBefore += before;
  totalAfter += after;

  const secs = Number(
    spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath], {
      encoding: 'utf8',
    }).stdout
  );

  console.log(
    `${out.padEnd(6)} ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}   ` +
      `${(before / 1024 / 1024).toFixed(1).padStart(5)} MB  ->  ${(after / 1024 / 1024).toFixed(2).padStart(5)} MB   ` +
      `(-${Math.round((1 - after / before) * 100)}%)   ` +
      `gennemsnit ${rms.toFixed(1)} -> ${MUSIC_RMS_DB} dB`
  );
}

console.log(
  `\nI alt ${(totalBefore / 1024 / 1024).toFixed(1)} MB -> ${(totalAfter / 1024 / 1024).toFixed(2)} MB ` +
    `(-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`
);
console.log(`Skrevet til ${path.relative(ROOT, OUT_DIR)}`);
