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
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'Lyde');
const OUT_DIR = path.join(ROOT, 'assets', 'sounds');

const RATE = 48000;
const SILENCE_THRESHOLD = '-50dB';

/**
 * Tone shaping, baked in here rather than applied at runtime: mobile has no
 * equaliser, so anything done live would work on web only. Values are dB gain,
 * 0 meaning untouched.
 */
const EQ = { bass: 0, mid: 0, treble: 0 };

/** Peak level to normalise to. Sources sit around -12.6 dB, quieter than needed. */
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

// a gentle fade out stops the trim from ending on a click
filters.push('afade=t=out:st=0:d=0.02:curve=nofade');

let totalBefore = 0;
let totalAfter = 0;

for (const { out, src } of SOUNDS) {
  const inPath = path.join(SRC_DIR, src);
  if (!existsSync(inPath)) {
    console.error(`MANGLER: ${src}`);
    continue;
  }
  const outPath = path.join(OUT_DIR, `${out}.wav`);

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-i', inPath,
      '-af', `${filters.join(',')},loudnorm=I=-16:TP=${PEAK_DB}:LRA=11`,
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
      `${(after / 1024).toFixed(0).padStart(4)} KB   (-${Math.round((1 - after / before) * 100)}%)`
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
