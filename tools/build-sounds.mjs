/**
 * Builds game-ready sound effects from the raw pack in Raw_Assets/Lyde/.
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
import { mkdirSync, statSync, existsSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'Raw_Assets', 'Lyde');
const OUT_DIR = path.join(ROOT, 'assets', 'sounds');

import { RATE, PEAK_DB, EQ, SOUNDS, trimFilters, eqFilters, clipFilters } from './sound-config.mjs';

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

/**
 * The house treatment, unless a clip brought its own EQ.
 *
 * Any explicit cut comes first, so a source that is a long take gets reduced to
 * the part that is wanted before anything else looks at it.
 */
const chainFor = (eq, clip) => [...clipFilters(clip), ...trimFilters(), ...eqFilters(eq ?? EQ)].join(',');

/**
 * Measures the loudest sample after the chain, so the gain can be exact.
 * ffmpeg reports volumedetect on stderr, not stdout.
 */
function measurePeakDb(inPath, chain) {
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

// Every clip is measured before any is written, because a group has to be
// levelled as a whole and that cannot be known one file at a time.
const jobs = [];
for (const { out, src, level = 0, eq, group, clip } of SOUNDS) {
  const inPath = path.join(SRC_DIR, src);
  if (!existsSync(inPath)) {
    console.error(`MANGLER: ${src}`);
    continue;
  }
  const chain = chainFor(eq, clip);
  jobs.push({ out, src, level, eq, group, inPath, chain, peak: measurePeakDb(inPath, chain) });
}

/**
 * One gain per group, set by its loudest member.
 *
 * Taking the smallest gain in the group is the same thing said backwards: the
 * loudest clip needs the least lift, so that lift is what puts it on target and
 * leaves every quieter clip below it, exactly as far below as it was recorded.
 */
const groupGain = {};
for (const j of jobs) {
  if (!j.group) continue;
  const wants = PEAK_DB + j.level - j.peak;
  groupGain[j.group] = Math.min(groupGain[j.group] ?? Infinity, wants);
}

for (const { out, src, level, eq, group, inPath, chain, peak } of jobs) {
  const outPath = path.join(OUT_DIR, `${out}.wav`);

  // Two passes: find the peak, then apply one constant gain to reach the
  // target. A fixed multiplier leaves the waveform's shape untouched.
  const target = PEAK_DB + level;
  const gain = group ? groupGain[group] : target - peak;
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
      `   top ${peak.toFixed(1)} -> ${(peak + gain).toFixed(1)} dB` +
      (level ? `  (${level > 0 ? '+' : ''}${level} dB)` : '') +
      (group ? `  [${group}]` : '') +
      (eq && (eq.bass || eq.mid || eq.treble) ? `  egen EQ: diskant ${eq.treble} dB` : '') +
      (eq && !eq.bass && !eq.mid && !eq.treble ? '  uden EQ' : '')
  );
}

/**
 * How long a clip takes to reach full level, in seconds.
 *
 * A sound that has to land on a particular frame has to be started early by
 * exactly this much, and it is not the same for every clip: measured across the
 * swing pool it runs from 30 ms to 130 ms. Assuming one value for all of them
 * put the gore clips 90 ms behind the blade, which is what made it feel like
 * chance whether a blow sounded like it connected.
 *
 * Read off the decoded audio rather than probed with repeated ffmpeg calls:
 * find the loudest sample, then the first one within a decibel of it.
 */
function measureLeadSeconds(file) {
  const res = spawnSync(
    'ffmpeg',
    ['-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  const pcm = res.stdout;
  if (!pcm || pcm.length < 4) return 0;
  const n = Math.floor(pcm.length / 2);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
  if (peak === 0) return 0;
  const threshold = peak * 0.891; // one decibel below the loudest sample
  for (let i = 0; i < n; i++) {
    if (Math.abs(pcm.readInt16LE(i * 2)) >= threshold) return +(i / RATE).toFixed(4);
  }
  return 0;
}

{
  const leads = {};
  for (const j of jobs) leads[j.out] = measureLeadSeconds(path.join(OUT_DIR, `${j.out}.wav`));
  writeFileSync(path.join(OUT_DIR, 'leads.json'), JSON.stringify(leads));
  const swing = Object.entries(leads).filter(([k]) => /^(attack|kill|gore)-/.test(k));
  const ms = swing.map(([, v]) => Math.round(v * 1000));
  console.log(
    `\nOptrek maalt for ${Object.keys(leads).length} klip  ->  leads.json` +
      (ms.length ? `\n  sværdpuljen naar fuld styrke efter ${Math.min(...ms)}-${Math.max(...ms)} ms` : '')
  );
}

// Anything in the output that the config no longer names.
//
// Renaming a set used to leave its old files behind, still bundled and still
// loadable, so the game could go on playing sounds nothing referred to any more
// -- which is exactly the confusion this had once already.
const wanted = new Set(jobs.map((j) => `${j.out}.wav`));
const stale = readdirSync(OUT_DIR).filter((f) => f.endsWith('.wav') && !wanted.has(f));
for (const f of stale) unlinkSync(path.join(OUT_DIR, f));
if (stale.length) {
  console.log(`\nRyddet ${stale.length} forældede filer: ${stale.sort().join(', ')}`);
}

console.log(
  `\nI alt ${(totalBefore / 1024).toFixed(0)} KB -> ${(totalAfter / 1024).toFixed(0)} KB ` +
    `(-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`
);
console.log(`Skrevet til ${path.relative(ROOT, OUT_DIR)}`);

if (EQ.bass || EQ.mid || EQ.treble) {
  console.log(`Equalizer bagt ind: bas ${EQ.bass} dB, mellemtone ${EQ.mid} dB, diskant ${EQ.treble} dB`);
}
