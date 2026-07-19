/**
 * Generates a standalone page for dialling in the weather by eye.
 *
 * The game's rain and ripples are worked out from the clock rather than stored,
 * which makes them cheap but also means there is nothing to inspect while they
 * run -- and the effect only reads as right or wrong in motion, over the actual
 * ground, at the actual size. So this page draws the same thing from the same
 * numbers and puts sliders on them.
 *
 * It opens the settings the game currently uses, read straight out of App.tsx,
 * so what you see when it opens is what you have. Paste the block it prints back
 * over the same two objects when you like what you see.
 *
 * The drawing is deliberately a copy of App.tsx rather than a rough impression:
 * same depth-dealing, same wrap-around fall, same cover-fit for the ground, same
 * ellipse for a ring. Where the two disagree the page is wrong and should be
 * fixed, because it is the game that ships.
 *
 * Built as one file with the ground and the puddle spots embedded, so it opens
 * straight from disk with no server.
 *
 * Run: npm run build:rain
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'App.tsx');
const BG = path.join(ROOT, 'assets', 'sprites', 'background.jpg');
const PUDDLES = path.join(ROOT, 'assets', 'sprites', 'effects', 'puddles.json');
const OUT = path.join(ROOT, 'tools', 'rain-preview.html');

for (const f of [APP, BG, PUDDLES]) {
  if (!existsSync(f)) {
    console.error(`MANGLER: ${path.relative(ROOT, f)}`);
    console.error('Koer "npm run build:sprites" foerst.');
    process.exit(1);
  }
}

/**
 * Lifts a settings object out of App.tsx by name.
 *
 * Reading the real source rather than keeping a second copy here: two copies
 * drift apart, and the page is worthless the moment it stops showing what the
 * game does. Evaluated rather than JSON-parsed because the block has comments
 * and unquoted keys.
 */
function readSettings(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`Fandt ikke "const ${name} = {" i App.tsx`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return eval(`(${source.slice(open, i + 1)})`);
    }
  }
  throw new Error(`"const ${name}" i App.tsx ser ikke afsluttet ud`);
}

const app = readFileSync(APP, 'utf8');
const rain = readSettings(app, 'RAIN');
const ripple = readSettings(app, 'RIPPLE');
const puddles = JSON.parse(readFileSync(PUDDLES, 'utf8'));
const bgData = readFileSync(BG).toString('base64');

// The play area is the screen less the bars around it. Mirrored here so the
// presets below are the shapes the game actually gets, not invented ones.
const CHROME = 50 + 66 + 84 + 58;

const html = `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<title>Vejr - RPG Survival</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#14141f; color:#e8eaf6;
         font:14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .app { display:flex; gap:20px; padding:18px; height:100vh; }
  .stage { flex:1; display:flex; flex-direction:column; gap:10px; min-width:0; }
  .frame { flex:1; display:flex; align-items:center; justify-content:center;
           background:#0b0b12; border-radius:10px; border:1px solid #2a2a40;
           overflow:hidden; }
  canvas { display:block; box-shadow:0 6px 30px rgba(0,0,0,.55); }
  .panel { width:360px; overflow-y:auto; padding-right:6px; }
  h1 { font-size:17px; margin:0 0 3px; }
  .sub { color:#9fa8da; font-size:12.5px; margin:0 0 16px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.07em;
       color:#7986cb; margin:20px 0 10px; padding-bottom:6px;
       border-bottom:1px solid #2a2a40; }
  .row { display:flex; align-items:center; gap:10px; margin-bottom:7px; }
  .row label { width:126px; font-size:12.5px; color:#c5cae9; flex:none; }
  .row input[type=range] { flex:1; accent-color:#4fc3f7; min-width:0; }
  .row input[type=color] { flex:none; width:44px; height:26px; padding:0;
                           border:1px solid #3a3a58; border-radius:5px;
                           background:none; cursor:pointer; }
  .row output { width:56px; text-align:right; font-variant-numeric:tabular-nums;
                font-weight:600; font-size:12.5px; flex:none; }
  .hint { font-size:11.5px; color:#8a92c4; margin:-3px 0 11px 136px; }
  .bar { display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
  button { font:inherit; font-size:12.5px; border:0; border-radius:7px;
           padding:7px 13px; cursor:pointer; background:#2a2a44; color:#c5cae9; }
  button:hover { background:#373758; }
  button.on { background:#3949ab; color:#fff; }
  button.go { background:#3949ab; color:#fff; }
  button.go:hover { background:#5c6bc0; }
  .result { margin-top:18px; padding:12px 14px; border-radius:8px; background:#0e0e18;
            border:1px solid #2a2a40; }
  .result h3 { font-size:11.5px; margin:0 0 8px; color:#9fa8da; font-weight:600;
               text-transform:uppercase; letter-spacing:.06em; }
  code { display:block; white-space:pre; overflow-x:auto; color:#ffe082;
         font:12px/1.55 ui-monospace, Consolas, monospace; }
  .note { font-size:11.5px; color:#8a92c4; margin:14px 0 0; }
  .size { font-size:11.5px; color:#8a92c4; font-variant-numeric:tabular-nums; }
</style>
</head>
<body>
<div class="app">
  <div class="stage">
    <div class="frame"><canvas id="c"></canvas></div>
    <div class="bar">
      <button data-shape="phone" class="on">Telefon</button>
      <button data-shape="tablet">Tablet</button>
      <button data-shape="wide">Bred sk&aelig;rm</button>
      <button id="spots">Vis vandets pladser</button>
      <button id="pause">Pause</button>
      <span class="size" id="size"></span>
    </div>
  </div>

  <div class="panel">
    <h1>Vejret</h1>
    <p class="sub">Skyderne st&aring;r p&aring; det spillet bruger nu. Skru til det ser rigtigt ud, og giv Claude blokken nederst.</p>
    <div id="controls"></div>

    <div class="result">
      <h3>Giv Claude denne blok</h3>
      <code id="out"></code>
    </div>
    <div class="bar" style="margin-top:10px">
      <button id="copy" class="go">Kopi&eacute;r</button>
      <button id="reset">Tilbage til spillets tal</button>
    </div>

    <p class="note">Baggrunden, vandets pladser og al udregning er de samme som spillets &mdash; s&aring; det du ser her er det du f&aring;r. Ringene kan kun lande p&aring; de pladser bygningen fandt i vandet; tryk <em>Vis vandets pladser</em> for at se dem.</p>
  </div>
</div>

<script>
var PUDDLE_SPOTS = ${JSON.stringify(puddles)};
var DEFAULTS = { rain: ${JSON.stringify(rain)}, ripple: ${JSON.stringify(ripple)} };
var BG_ASPECT = 1448 / 1086;
var CHROME = ${CHROME};

var SHAPES = {
  phone:  { w: 390,  h: 844 - CHROME,  name: 'Telefon' },
  tablet: { w: 820,  h: 1180 - CHROME, name: 'Tablet' },
  wide:   { w: 1280, h: 800 - CHROME,  name: 'Bred' }
};

// Laid out as data so another effect can be added by describing it, rather than
// by writing another page.
var CONTROLS = [
  { group: 'Regn', of: 'rain', key: 'drops', label: 'Antal', min: 0, max: 400, step: 1,
    hint: 'Hvor t&aelig;t det regner.' },
  { group: 'Regn', of: 'rain', key: 'tiltDeg', label: 'Retning', min: -60, max: 60, step: 1, unit: '\\u00b0',
    hint: '0 er lodret. Positiv bl&aelig;ser mod h&oslash;jre.' },
  { group: 'Regn', of: 'rain', key: 'speedFar', label: 'Fart, fjerneste', min: 60, max: 1600, step: 10, unit: '' },
  { group: 'Regn', of: 'rain', key: 'speedNear', label: 'Fart, n&aelig;rmeste', min: 60, max: 1600, step: 10, unit: '',
    hint: 'Forskellen mellem de to er det der giver dybde. Ens tal = fladt gardin.' },
  { group: 'Regn', of: 'rain', key: 'lengthFar', label: 'L&aelig;ngde, fjerneste', min: 1, max: 90, step: 1, unit: '' },
  { group: 'Regn', of: 'rain', key: 'lengthNear', label: 'L&aelig;ngde, n&aelig;rmeste', min: 1, max: 90, step: 1, unit: '',
    hint: 'Lange streger = kraftigt skybrud. Korte prikker = st&oslash;vregn.' },
  { group: 'Regn', of: 'rain', key: 'opacityFar', label: 'Synlighed, fjern', min: 0, max: 1, step: 0.01 },
  { group: 'Regn', of: 'rain', key: 'opacityNear', label: 'Synlighed, n&aelig;r', min: 0, max: 1, step: 0.01 },
  { group: 'Regn', of: 'rain', key: 'thickFrom', label: 'Tykke fra', min: 0, max: 1, step: 0.05,
    hint: 'Hvor t&aelig;t p&aring; en dr&aring;be skal v&aelig;re for at blive tegnet dobbelt s&aring; tyk. 1 = ingen tykke.' },
  { group: 'Regn', of: 'rain', key: 'colour', label: 'Farve', kind: 'colour' },

  { group: 'Ringe i vandet', of: 'ripple', key: 'slots', label: 'Antal', min: 0, max: 60, step: 1,
    hint: 'Hvor mange ringe der kan v&aelig;re i gang p&aring; &eacute;n gang.' },
  { group: 'Ringe i vandet', of: 'ripple', key: 'size', label: 'St&oslash;rrelse', min: 4, max: 90, step: 1, unit: '' },
  { group: 'Ringe i vandet', of: 'ripple', key: 'periodFast', label: 'Hurtigste', min: 0.3, max: 8, step: 0.1, unit: 's' },
  { group: 'Ringe i vandet', of: 'ripple', key: 'periodSlow', label: 'Langsomste', min: 0.3, max: 8, step: 0.1, unit: 's',
    hint: 'Hvor l&aelig;nge en ring er om at brede sig ud og forsvinde.' },
  { group: 'Ringe i vandet', of: 'ripple', key: 'opacity', label: 'Synlighed', min: 0, max: 1, step: 0.01 },
  { group: 'Ringe i vandet', of: 'ripple', key: 'colour', label: 'Farve', kind: 'colour' }
];

var S = JSON.parse(JSON.stringify(DEFAULTS));
var shape = 'phone';
var showSpots = false;
var paused = false;
var streaks = [];

var bg = new Image();
bg.src = 'data:image/jpeg;base64,${bgData}';

// --- the same maths the game uses ------------------------------------------

function noise(n) { var x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }

function dealStreaks() {
  var r = S.rain;
  streaks = [];
  for (var i = 0; i < r.drops; i++) {
    var near = Math.random();
    streaks.push({
      x: Math.random(),
      speed: r.speedFar + near * (r.speedNear - r.speedFar),
      length: r.lengthFar + near * (r.lengthNear - r.lengthFar),
      width: near > r.thickFrom ? 2 : 1,
      opacity: r.opacityFar + near * (r.opacityNear - r.opacityFar),
      offset: Math.random()
    });
  }
}

function slots() {
  var out = [];
  for (var i = 0; i < S.ripple.slots; i++) {
    out.push({
      seed: i * 37 + 11,
      period: S.ripple.periodFast + noise(i * 3.1) * (S.ripple.periodSlow - S.ripple.periodFast),
      phase: noise(i * 7.7)
    });
  }
  return out;
}

// --- drawing ---------------------------------------------------------------

var canvas = document.getElementById('c');
var ctx = canvas.getContext('2d');
var frozenAt = 0;

function draw() {
  var W = canvas.width, H = canvas.height;
  var t = (paused ? frozenAt : Date.now()) / 1000;

  // Cover-fit, exactly as the game lays the ground out.
  var dw = Math.max(W, H * BG_ASPECT);
  var dh = Math.max(H, W / BG_ASPECT);
  var ox = (W - dw) / 2, oy = (H - dh) / 2;
  ctx.clearRect(0, 0, W, H);
  if (bg.complete) ctx.drawImage(bg, ox, oy, dw, dh);

  if (showSpots) {
    ctx.fillStyle = 'rgba(255,64,160,.85)';
    for (var s = 0; s < PUDDLE_SPOTS.length; s++) {
      ctx.fillRect(ox + PUDDLE_SPOTS[s][0] * dw - 1, oy + PUDDLE_SPOTS[s][1] * dh - 1, 2, 2);
    }
  }

  // Rings, under the characters in the game and so drawn first here.
  var rp = S.ripple, ring = slots();
  ctx.strokeStyle = rp.colour;
  ctx.lineWidth = 1;
  for (var i = 0; i < ring.length && PUDDLE_SPOTS.length; i++) {
    var r = ring[i];
    var tt = t + r.phase * r.period;
    var cycle = Math.floor(tt / r.period);
    var life = (tt % r.period) / r.period;
    var spot = PUDDLE_SPOTS[Math.floor(noise(r.seed + cycle * 1.7) * PUDDLE_SPOTS.length)];
    // Never wider than the water it sits in. The third number is the room the
    // build measured there, in the source image's pixels.
    var size = Math.min(rp.size, spot[2] * 2 * (dh / 1086)) * life;
    if (size < 1) continue;
    ctx.globalAlpha = (1 - life) * rp.opacity;
    ctx.beginPath();
    // Squashed to half height, because the ground is seen at an angle.
    ctx.ellipse(ox + spot[0] * dw, oy + spot[1] * dh, size / 2, size / 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rain, in front of everyone.
  var rn = S.rain;
  var tiltX = Math.tan(rn.tiltDeg * Math.PI / 180);
  var drift = H * tiltX;
  ctx.fillStyle = rn.colour;
  for (var d = 0; d < streaks.length; d++) {
    var s2 = streaks[d];
    var span = H + s2.length;
    var y = ((s2.offset * span + t * s2.speed) % span) - s2.length;
    var left = s2.x * (W + drift) - drift + y * tiltX;
    ctx.globalAlpha = s2.opacity;
    ctx.save();
    // Turned about its middle, and against the wind's sign: a rotation goes
    // clockwise while the drift carries the drop the other way.
    ctx.translate(left + s2.width / 2, y + s2.length / 2);
    ctx.rotate(-rn.tiltDeg * Math.PI / 180);
    ctx.fillRect(-s2.width / 2, -s2.length / 2, s2.width, s2.length);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(draw);
}

// --- controls --------------------------------------------------------------

function toHex(rgba) {
  var m = /rgba?\\(([^)]+)\\)/.exec(rgba);
  if (!m) return { hex: '#ffffff', alpha: 1 };
  var p = m[1].split(',').map(function (v) { return parseFloat(v); });
  var h = '#';
  for (var i = 0; i < 3; i++) h += ('0' + Math.round(p[i]).toString(16)).slice(-2);
  return { hex: h, alpha: p.length > 3 ? p[3] : 1 };
}

function toRgba(hex, alpha) {
  var n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + alpha + ')';
}

var panel = document.getElementById('controls');

function buildControls() {
  panel.innerHTML = '';
  var group = null;
  CONTROLS.forEach(function (c) {
    if (c.group !== group) {
      group = c.group;
      var h = document.createElement('h2');
      h.innerHTML = group;
      panel.appendChild(h);
    }
    var row = document.createElement('div');
    row.className = 'row';
    var lab = document.createElement('label');
    lab.innerHTML = c.label;
    row.appendChild(lab);

    if (c.kind === 'colour') {
      var parts = toHex(S[c.of][c.key]);
      var col = document.createElement('input');
      col.type = 'color';
      col.value = parts.hex;
      var alpha = document.createElement('input');
      alpha.type = 'range';
      alpha.min = 0; alpha.max = 1; alpha.step = 0.01; alpha.value = parts.alpha;
      var out = document.createElement('output');
      out.textContent = parts.alpha;
      function push() {
        S[c.of][c.key] = toRgba(col.value, +alpha.value);
        out.textContent = (+alpha.value).toFixed(2);
        if (c.of === 'rain') dealStreaks();
        writeOut();
      }
      col.oninput = push; alpha.oninput = push;
      row.appendChild(col); row.appendChild(alpha); row.appendChild(out);
    } else {
      var input = document.createElement('input');
      input.type = 'range';
      input.min = c.min; input.max = c.max; input.step = c.step;
      input.value = S[c.of][c.key];
      var o = document.createElement('output');
      o.textContent = S[c.of][c.key] + (c.unit || '');
      input.oninput = function () {
        S[c.of][c.key] = +input.value;
        o.textContent = input.value + (c.unit || '');
        if (c.of === 'rain') dealStreaks();
        writeOut();
      };
      row.appendChild(input); row.appendChild(o);
    }
    panel.appendChild(row);
    if (c.hint) {
      var hint = document.createElement('div');
      hint.className = 'hint';
      hint.innerHTML = c.hint;
      panel.appendChild(hint);
    }
  });
}

function block(name, obj, order) {
  var lines = ['const ' + name + ' = {'];
  order.forEach(function (k) {
    var v = obj[k];
    lines.push('  ' + k + ': ' + (typeof v === 'string' ? "'" + v + "'" : v) + ',');
  });
  lines.push('};');
  return lines.join('\\n');
}

function writeOut() {
  document.getElementById('out').textContent =
    block('RAIN', S.rain, ['drops', 'tiltDeg', 'speedFar', 'speedNear', 'lengthFar',
                           'lengthNear', 'opacityFar', 'opacityNear', 'thickFrom', 'colour']) +
    '\\n\\n' +
    block('RIPPLE', S.ripple, ['slots', 'size', 'periodFast', 'periodSlow', 'opacity', 'colour']);
}

function fit() {
  var sh = SHAPES[shape];
  var frame = document.querySelector('.frame');
  var pad = 24;
  var scale = Math.min((frame.clientWidth - pad) / sh.w, (frame.clientHeight - pad) / sh.h, 1);
  canvas.width = sh.w;
  canvas.height = sh.h;
  canvas.style.width = Math.round(sh.w * scale) + 'px';
  canvas.style.height = Math.round(sh.h * scale) + 'px';
  document.getElementById('size').textContent =
    'spilleflade ' + sh.w + ' x ' + sh.h + ' px' + (scale < 1 ? '  (vist ' + Math.round(scale * 100) + '%)' : '');
}

document.querySelectorAll('[data-shape]').forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll('[data-shape]').forEach(function (o) { o.className = ''; });
    b.className = 'on';
    shape = b.dataset.shape;
    fit();
  };
});
document.getElementById('spots').onclick = function () {
  showSpots = !showSpots;
  this.className = showSpots ? 'on' : '';
};
document.getElementById('pause').onclick = function () {
  if (!paused) frozenAt = Date.now();
  paused = !paused;
  this.className = paused ? 'on' : '';
};
document.getElementById('copy').onclick = function () {
  navigator.clipboard.writeText(document.getElementById('out').textContent);
  var b = this; b.textContent = 'Kopieret';
  setTimeout(function () { b.textContent = 'Kopi\\u00e9r'; }, 1200);
};
document.getElementById('reset').onclick = function () {
  S = JSON.parse(JSON.stringify(DEFAULTS));
  dealStreaks(); buildControls(); writeOut();
};

window.addEventListener('resize', fit);
dealStreaks();
buildControls();
writeOut();
fit();
draw();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(
  `\nVejr-vaerktoej: ${path.relative(ROOT, OUT)}  ->  ${(statSync(OUT).size / 1024).toFixed(0)} KB\n` +
    `  ${rain.drops} draaber, ${ripple.slots} ringe, ${puddles.length} pladser i vandet\n` +
    `  Aabn filen i en browser.`
);
