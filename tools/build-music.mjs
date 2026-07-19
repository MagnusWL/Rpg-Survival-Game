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
import { MUSIC, MUSIC_BITRATE, MUSIC_RMS_DB, AMBIENCE, AMBIENCE_RMS_DB } from './sound-config.mjs';

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

/**
 * Average level over the whole track, which is what loudness is judged by.
 *
 * Takes the filter chain too, because ambience is measured after it has been
 * cut and folded -- the level of a chosen stretch is not the level of the file
 * it came out of.
 */
function measureRmsDb(file, chain) {
  const args = chain
    ? ['-i', file, '-filter_complex', `${chain},astats=metadata=1:reset=0[m]`, '-map', '[m]', '-f', 'null', '-']
    : ['-i', file, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'];
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  const all = [...(res.stderr ?? '').matchAll(/RMS level dB:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  if (!all.length) throw new Error(`Kunne ikke maale niveau for ${path.basename(file)}`);
  return all[all.length - 1];
}

/**
 * Cuts `from`-`to` out of a recording and folds its last seconds back over its
 * first, so the result can be played round and round with no seam.
 *
 * The join works because the piece ends on the material at `to - crossfade` and
 * begins with that same material fading out under the opening -- so looping
 * carries straight on rather than cutting. Equal-power curves, since two
 * uncorrelated stretches of rain on straight fades sag in the middle.
 */
function loopChain({ from, to, crossfade }) {
  const len = to - from - crossfade;
  return (
    `[0:a]atrim=start=${from}:end=${to - crossfade},asetpts=PTS-STARTPTS,` +
    `afade=t=in:curve=qsin:st=0:d=${crossfade}[head];` +
    `[0:a]atrim=start=${to - crossfade}:end=${to},asetpts=PTS-STARTPTS,` +
    `afade=t=out:curve=qsin:st=0:d=${crossfade},apad=whole_dur=${len}[tail];` +
    // normalize=0, or amix halves everything it touches.
    `[head][tail]amix=inputs=2:duration=first:normalize=0`
  );
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

for (const entry of AMBIENCE) {
  const inPath = path.join(ROOT, entry.src);
  if (!existsSync(inPath)) {
    console.error(`MANGLER: ${entry.src}`);
    continue;
  }
  const outPath = path.join(OUT_DIR, `${entry.out}.mp3`);
  const chain = loopChain(entry);

  const rms = measureRmsDb(inPath, chain);
  const gain = AMBIENCE_RMS_DB - rms;

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-i', inPath,
      '-filter_complex', `${chain},volume=${gain.toFixed(2)}dB[out]`,
      '-map', '[out]',
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

  console.log(
    `${entry.out.padEnd(6)} ${entry.to - entry.from - entry.crossfade}s loop   ` +
      `${(before / 1024 / 1024).toFixed(1).padStart(5)} MB  ->  ${(after / 1024 / 1024).toFixed(2).padStart(5)} MB   ` +
      `(-${Math.round((1 - after / before) * 100)}%)   ` +
      `gennemsnit ${rms.toFixed(1)} -> ${AMBIENCE_RMS_DB} dB` +
      `   (klippet ${entry.from}-${entry.to}s, ${entry.crossfade}s overblanding)`
  );
}

console.log(
  `\nI alt ${(totalBefore / 1024 / 1024).toFixed(1)} MB -> ${(totalAfter / 1024 / 1024).toFixed(2)} MB ` +
    `(-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`
);
console.log(`Skrevet til ${path.relative(ROOT, OUT_DIR)}`);
