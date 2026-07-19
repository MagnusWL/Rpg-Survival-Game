/**
 * Builds game-ready sound effects from the raw pack in Lyde/.
 *
 * The source files are 96 kHz / 24-bit studio masters, roughly 830 KB each, and
 * two thirds of every file is silence. Three lossless-sounding steps handle it:
 *
 *   1. Trim the silence. Beyond size, this is a timing fix: the leading 0.18 s
 *      of quiet would delay the swing sound past a fifth of the animation.
 *   2. 96 kHz -> 48 kHz. An exact 2:1 decimation, and 48 kHz is what phone
 *      audio hardware runs at natively. Only discards content above 24 kHz.
 *   3. 24-bit -> 16-bit, which drops a noise floor nobody can hear.
 *
 * No lossy codec is involved, so there are no compression artefacts -- the
 * "tinfoil" sound comes from codecs guessing at discarded audio, and nothing
 * here is guessed.
 *
 * Run: npm run build:sounds
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, statSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'Lyde');
const OUT_DIR = path.join(ROOT, 'assets', 'sounds');

const RATE = 48000;

// Low enough to keep the quiet head of the transient and the reverb tail. At
// -50 dB the very front of the swing was being clipped off.
const SILENCE_THRESHOLD = '-60dB';

/**
 * Tone shaping, baked in here rather than applied at runtime: mobile has no
 * equaliser, so anything done live would work on web only. Values are dB gain,
 * 0 meaning untouched.
 */
const EQ = { bass: 0, mid: 0, treble: 0 };

/**
 * Peak to normalise to. This is PEAK normalisation -- a single constant gain
 * applied to the whole clip, which cannot change the shape of the sound.
 *
 * It is deliberately not loudnorm. That is EBU R128 broadcast normalisation,
 * built for speech and music running over minutes; it rides the gain up and
 * down as it goes. Measured against the source, a loudnorm'd clip correlated at
 * 0.08 with a gain that wandered without bound, where a fixed gain correlates at
 * 1.0000 and holds to within 0.3 dB. It did not sound like the source because
 * it no longer was it.
 */
const PEAK_DB = -3;

const SOUNDS = [
  { out: 'attack-1', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_01.wav' },
  { out: 'attack-2', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_11.wav' },
  { out: 'attack-3', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_17.wav' },
];

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
  console.error('(og genstart terminalen bagefter, saa PATH er opdateret)');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const filters = [
  // strip leading and trailing quiet; the reverb tail is kept by only cutting
  // once a full 0.1 s stays below the threshold
  `silenceremove=start_periods=1:start_threshold=${SILENCE_THRESHOLD}:start_silence=0.01`,
  'areverse',
  `silenceremove=start_periods=1:start_threshold=${SILENCE_THRESHOLD}:start_silence=0.1`,
  'areverse',
];

if (EQ.bass) filters.push(`bass=g=${EQ.bass}`);
if (EQ.mid) filters.push(`equalizer=f=1200:width_type=o:width=2:g=${EQ.mid}`);
if (EQ.treble) filters.push(`treble=g=${EQ.treble}`);

const chain = filters.join(',');

/**
 * Measures the loudest sample after the chain, so the gain can be exact.
 * ffmpeg reports volumedetect on stderr, not stdout.
 */
function measurePeakDb(inPath) {
  const res = spawnSync(
    'ffmpeg',
    ['-i', inPath, '-af', `${chain},volumedetect`, '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(res.stderr ?? '');
  if (!m) throw new Error(`Kunne ikke maale topniveau for ${path.basename(inPath)}`);
  return parseFloat(m[1]);
}

let totalBefore = 0;
let totalAfter = 0;

for (const { out, src } of SOUNDS) {
  const inPath = path.join(SRC_DIR, src);
  if (!existsSync(inPath)) {
    console.error(`MANGLER: ${src}`);
    continue;
  }
  const outPath = path.join(OUT_DIR, `${out}.wav`);

  // Two passes: find the peak, then apply one constant gain to reach PEAK_DB.
  // A fixed multiplier leaves the waveform's shape untouched.
  const peak = measurePeakDb(inPath);
  const gain = PEAK_DB - peak;
  const af = `${chain},volume=${gain.toFixed(2)}dB`;

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-i', inPath,
      '-af', af,
      '-ar', String(RATE),
      '-sample_fmt', 's16',
      outPath,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );

  const before = statSync(inPath).size;
  const after = statSync(outPath).size;
  totalBefore += before;
  totalAfter += after;
  console.log(
    `${out.padEnd(9)} ${(before / 1024).toFixed(0).padStart(5)} KB  ->  ` +
      `${(after / 1024).toFixed(0).padStart(4)} KB   (-${Math.round((1 - after / before) * 100)}%)` +
      `   top ${peak.toFixed(1)} dB, forstaerket ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`
  );
}

console.log(
  `\nI alt ${(totalBefore / 1024).toFixed(0)} KB -> ${(totalAfter / 1024).toFixed(0)} KB ` +
    `(-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`
);
console.log(`Skrevet til ${path.relative(ROOT, OUT_DIR)}`);

if (EQ.bass || EQ.mid || EQ.treble) {
  console.log(`Equalizer bagt ind: bas ${EQ.bass} dB, mellemtone ${EQ.mid} dB, diskant ${EQ.treble} dB`);
}
