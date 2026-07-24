/**
 * Generates a standalone page for dialling in the sound EQ by ear.
 *
 * Runtime EQ is not an option: the game ships to phones, and audio filters like
 * this exist only in the browser. So the tone shaping gets baked into the files
 * instead, and this page exists purely to find the numbers.
 *
 * The three filters mirror ffmpeg's exactly -- same types, same frequencies,
 * same widths -- so what you hear here is what build-sounds.mjs produces:
 *
 *   bass    -> lowshelf  @ 100 Hz   (ffmpeg: bass=g=X)
 *   mid     -> peaking   @ 1200 Hz, 2 octaves wide
 *              (ffmpeg: equalizer=f=1200:width_type=o:width=2:g=X)
 *   treble  -> highshelf @ 3000 Hz  (ffmpeg: treble=g=X)
 *
 * Audio is embedded in the page, so it opens straight from disk with no server.
 *
 * Run: npm run build:eq
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RATE, PEAK_DB, EQ, SOUNDS, trimFilters } from './sound-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'Raw_Assets', 'Lyde');
const OUT = path.join(ROOT, 'tools', 'eq-preview.html');

/**
 * The preview deliberately embeds the audio WITHOUT any EQ -- trimmed and
 * levelled only. The sliders then start at the values currently baked into the
 * shipped files, so what you hear on opening matches the game, and every
 * setting is absolute.
 *
 * Building the preview from the shipped files instead would stack EQ on EQ:
 * zero on the sliders would already mean "minus four treble", invisibly.
 */
const chain = trimFilters().join(',');

function render(src) {
  const res = spawnSync(
    'ffmpeg',
    ['-i', src, '-af', `${chain},volumedetect`, '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(res.stderr ?? '');
  const gain = m ? PEAK_DB - parseFloat(m[1]) : 0;

  const out = spawnSync(
    'ffmpeg',
    ['-i', src, '-af', `${chain},volume=${gain.toFixed(2)}dB`,
      '-ar', String(RATE), '-sample_fmt', 's16', '-f', 'wav', '-'],
    { maxBuffer: 1 << 28 }
  );
  return out.stdout;
}

const clips = [];
for (const { out, src } of SOUNDS) {
  const inPath = path.join(SRC_DIR, src);
  if (!existsSync(inPath)) {
    console.error(`MANGLER: ${src}`);
    continue;
  }
  clips.push({ name: out, data: render(inPath).toString('base64') });
}

if (clips.length === 0) {
  console.error('Ingen kildelyde fundet i Raw_Assets/Lyde/.');
  process.exit(1);
}

const html = `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<title>Equalizer - RPG Survival lyde</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#1a1a2e; color:#e8eaf6;
         font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width:640px; margin:0 auto; }
  h1 { font-size:19px; margin:0 0 4px; }
  .sub { color:#9fa8da; font-size:13px; margin:0 0 24px; }
  .clips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:24px; }
  button { font:inherit; border:0; border-radius:8px; padding:10px 16px; cursor:pointer;
           background:#3949ab; color:#fff; }
  button:hover { background:#5c6bc0; }
  button.ghost { background:#2a2a44; color:#c5cae9; }
  button.ghost:hover { background:#373758; }
  .row { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
  .row label { width:120px; font-size:13px; color:#c5cae9; }
  .row input { flex:1; accent-color:#4fc3f7; }
  .row output { width:64px; text-align:right; font-variant-numeric:tabular-nums;
                font-weight:600; }
  .hint { font-size:12px; color:#9fa8da; margin:-8px 0 20px 134px; }
  .result { margin-top:26px; padding:14px 16px; border-radius:8px; background:#12121f;
            border:1px solid #2f2f4a; }
  .result h2 { font-size:13px; margin:0 0 8px; color:#9fa8da; font-weight:600; }
  code { display:block; white-space:pre; font:13px/1.6 ui-monospace, Consolas, monospace;
         color:#ffe082; }
  .note { margin-top:22px; font-size:12.5px; color:#9fa8da; }
  kbd { background:#2a2a44; border-radius:4px; padding:1px 6px; font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Equalizer for sværdlydene</h1>
  <p class="sub">Skru til det lyder rigtigt, og giv Claude tallene nederst. De bages ind i selve lydfilerne, så de også virker på telefon.</p>

  <div class="clips" id="clips"></div>

  <div class="row">
    <label for="bass">Bas</label>
    <input type="range" id="bass" min="-12" max="12" step="0.5" value="${EQ.bass}">
    <output id="bassOut">0 dB</output>
  </div>
  <div class="hint">Tyngde og bulder. Op = tungere sværd.</div>

  <div class="row">
    <label for="mid">Mellemtone</label>
    <input type="range" id="mid" min="-12" max="12" step="0.5" value="${EQ.mid}">
    <output id="midOut">0 dB</output>
  </div>
  <div class="hint">Kroppen i lyden. Ned = mindre &quot;pap&quot;, mere plads.</div>

  <div class="row">
    <label for="treble">Diskant</label>
    <input type="range" id="treble" min="-12" max="12" step="0.5" value="${EQ.treble}">
    <output id="trebleOut">0 dB</output>
  </div>
  <div class="hint">Skarphed og luftsus. Ned hvis det hviner.</div>

  <div class="row">
    <button id="bypass" class="ghost">Hør helt uden equalizer</button>
    <button id="reset" class="ghost">Tilbage til det spillet bruger</button>
  </div>

  <div class="result">
    <h2>Giv Claude denne linje</h2>
    <code id="out">EQ = { bass: 0, mid: 0, treble: 0 }</code>
  </div>

  <p class="note">Lydene her er <strong>ubehandlede</strong> — skyderne står på det spillet bruger nu, så det du hører ved åbning er det du har i spillet. Derfor er indstillingerne absolutte og bygger ikke oven på hinanden. Tryk <kbd>mellemrum</kbd> for at gentage sidste lyd. Filtrene er de samme som ffmpeg bruger bagefter.</p>
</div>

<script>
const CLIPS = ${JSON.stringify(clips.map((c) => ({ name: c.name, src: `data:audio/wav;base64,${c.data}` })))};

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const buffers = {};
let lastPlayed = CLIPS[0].name;

async function load() {
  for (const c of CLIPS) {
    const res = await fetch(c.src);
    buffers[c.name] = await ctx.decodeAudioData(await res.arrayBuffer());
  }
}
load();

const el = (id) => document.getElementById(id);
const bands = { bass: el('bass'), mid: el('mid'), treble: el('treble') };
let bypassed = false;

function play(name) {
  lastPlayed = name;
  const buf = buffers[name];
  if (!buf) return;
  if (ctx.state === 'suspended') ctx.resume();

  const src = ctx.createBufferSource();
  src.buffer = buf;

  if (bypassed) {
    src.connect(ctx.destination);
  } else {
    // Same filter shapes ffmpeg applies when baking the values in.
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 100;
    low.gain.value = +bands.bass.value;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1200;
    // ffmpeg width=2 octaves -> Q = sqrt(2^n) / (2^n - 1)
    mid.Q.value = Math.sqrt(Math.pow(2, 2)) / (Math.pow(2, 2) - 1);
    mid.gain.value = +bands.mid.value;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 3000;
    high.gain.value = +bands.treble.value;

    src.connect(low); low.connect(mid); mid.connect(high); high.connect(ctx.destination);
  }
  src.start();
}

const clipBar = el('clips');
for (const c of CLIPS) {
  const b = document.createElement('button');
  b.textContent = '\\u25b6 ' + c.name;
  b.onclick = () => { bypassed = false; play(c.name); };
  clipBar.appendChild(b);
}

function refresh() {
  for (const k of Object.keys(bands)) {
    el(k + 'Out').textContent = (+bands[k].value).toFixed(1).replace(/\\.0$/, '') + ' dB';
  }
  el('out').textContent =
    'EQ = { bass: ' + +bands.bass.value +
    ', mid: ' + +bands.mid.value +
    ', treble: ' + +bands.treble.value + ' }';
}
for (const k of Object.keys(bands)) {
  bands[k].addEventListener('input', () => { refresh(); });
  bands[k].addEventListener('change', () => { bypassed = false; play(lastPlayed); });
}

el('bypass').onclick = () => { bypassed = true; play(lastPlayed); };
// "Reset" goes back to what the game currently ships, not to flat -- flat is
// what the bypass button is for.
const BAKED = ${JSON.stringify(EQ)};
el('reset').onclick = () => {
  for (const k of Object.keys(bands)) bands[k].value = BAKED[k];
  refresh();
  bypassed = false;
  play(lastPlayed);
};
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); bypassed = false; play(lastPlayed); }
});
refresh();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`Skrevet: ${path.relative(ROOT, OUT)}  (${(statSync(OUT).size / 1024).toFixed(0)} KB, ${clips.length} lyde indlejret)`);
console.log('Aabn filen ved at dobbeltklikke paa den.');
