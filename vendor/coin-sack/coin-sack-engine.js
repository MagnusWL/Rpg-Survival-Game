// Coin-in-sack physics + gold render engine.
// Taken as-is from the design handoff in "UI/Fra claude design/Mønt falder i
// sæk 4". Its README says the engine is framework-agnostic and can be reused
// directly — it only wants a canvas and Matter.js — so it is, unedited beyond
// this note. The sack's interior geometry is measured into the ART constant
// below; re-measure it if the art is ever re-exported. Styles other than
// 'artsack' are earlier exploration and unused here.
//
// What each revision added, all of it opt-in and off by default:
//   spendCoins(n)  flies the top n coins out with a pixel ka-ching, 1–4.
//   coinSamples    one of fourteen real coin clips over the synth clink, per
//                  earn. fetch()ed — which file:// forbids, so public/lab hands
//                  them in as data: URIs.
//   flipSample     an mp3 played the moment a coin spawns, at four random
//                  playback rates so no two are quite alike. Also fetch()ed.
//   pixelate       renders the whole sack into a 1/pixelSize buffer and lets
//                  the browser upscale it nearest-neighbour, so the art reads
//                  as chunky as the coins. It replaces dpr, so a pixelated
//                  sack is deliberately low-res.
//   art.shade      a dark copy of the body over the coins at 30%, so coins
//                  down in the sack read as recessed.
//   coinTones      one gold for every theme — the sacks are tinted, the coins
//                  are not.
//
// Physics: Matter.js (loaded globally as window.Matter).
// Rendering: custom canvas for premium gold coins (gradient body, sweeping
// glint, airborne flip) and three container skins (jar / sack / chest).

const GOLD = {
  hi:   '#FFF6D6',
  lite: '#FFE08A',
  base: '#F5BE3C',
  mid:  '#E0A32B',
  shad: '#B67C1E',
  deep: '#8A5A15',
  edge: '#5E3D0E',
};

// measured geometry of the user's sack art (1024x1024 image px)
const ART = {
  bx0: 94, bx1: 933, cxImg: 514, mouthY: 494, floorImgY: 896, botImgY: 929,
  prof: [[494, 336], [528, 331], [561, 341], [595, 354], [628, 370], [662, 391], [695, 401], [728, 411], [762, 411], [795, 420], [829, 411], [862, 395], [896, 342]],
};

function rr(ctx, x, y, w, h, r) {
  const m = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + m, y);
  ctx.arcTo(x + w, y, x + w, y + h, m);
  ctx.arcTo(x + w, y + h, x, y + h, m);
  ctx.arcTo(x, y + h, x, y, m);
  ctx.arcTo(x, y, x + w, y, m);
  ctx.closePath();
}

export class CoinSack {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.style = opts.style || 'jar';
    this.fillCount = opts.fillCount || 20;
    this.geomCount = opts.geomCount || opts.fillCount || 20;
    this.restitution = opts.restitution != null ? opts.restitution : 0.32;
    this.friction = opts.friction != null ? opts.friction : 0.48;
    this.bodyScale = opts.bodyScale != null ? opts.bodyScale : 1;
    this.spin = opts.spin != null ? opts.spin : 0.25;
    this.density = opts.density != null ? opts.density : 0.004;
    this.shadeMode = opts.shadeMode || 'round';
    this.tempo = opts.tempo != null ? opts.tempo : 1;
    this.simTime = 0;
    this.glintStyle = opts.glintStyle || 'star';
    this.soundStyle = opts.soundStyle || 'classic';
    this.glintEvery = opts.glintEvery || 620;
    this._lastGlint = 0;
    this.soundOn = opts.soundOn !== false;
    this._sampleUrls = opts.coinSamples || null;
    this._flipUrl = opts.flipSample || null;
    // 4 near-identical variants (playbackRate) chosen at random per spawned coin
    this._flipRates = opts.flipRates || [0.92, 1.0, 1.08, 1.15];
    this.spendStyle = opts.spendStyle || 1;
    this.pixelate = opts.pixelate || false;
    this.pixelSize = opts.pixelSize || 2.4;
    this.coinTones = opts.coinTones || null;
    this.coinPixel = opts.coinPixel || null;
    this.onCount = opts.onCount || (() => {});
    this.onFull = opts.onFull || (() => {});
    this.coins = [];
    this.sparks = [];
    this.confetti = [];
    this.count = 0;
    this.full = false;
    this.lastClink = 0;
    this.audio = null;
    this.destroyed = false;
    this._raf = null;
    if (opts.art) {
      const mk = (u) => { const im = new Image(); im.onload = () => { try { this._draw(); } catch (e) {} }; im.src = u; return im; };
      this._imgBg = mk(opts.art.bg); this._imgFg = mk(opts.art.fg);
      this._imgRingBack = mk(opts.art.ringBack); this._imgRingFront = mk(opts.art.ringFront);
      if (opts.art.bgB) this._imgBgB = mk(opts.art.bgB);
      if (opts.art.shade) this._imgShade = mk(opts.art.shade);
    }

    const M = window.Matter;
    this.engine = M.Engine.create({ enableSleeping: true });
    this.engine.gravity.y = opts.gravity != null ? opts.gravity : 1.35;
    this.world = this.engine.world;

    M.Events.on(this.engine, 'collisionStart', (e) => this._onCollide(e));

    this._resize();
    this._loop = this._loop.bind(this);
    this._draw();
    this._raf = requestAnimationFrame(this._loop);
  }

  _resize() {
    const M = window.Matter;
    const W = Math.max(220, this.canvas.offsetWidth || 320);
    const H = Math.max(360, this.canvas.offsetHeight || 640);
    this.W = W; this.H = H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.rs = this.pixelate ? (1 / this.pixelSize) : dpr;
    this.canvas.width = Math.round(W * this.rs);
    this.canvas.height = Math.round(H * this.rs);
    if (this.pixelate) { this.canvas.style.imageRendering = 'pixelated'; this.ctx.imageSmoothingEnabled = false; }

    // coin radius + interior sized so ~fillCount reaches the rim
    this.r = Math.max(15, Math.min(26, W * 0.072));
    const d = this.r * 2;
    const perRow = 4;
    this.iw = Math.min(W * 0.66, perRow * d * 1.02);
    this.cx = W / 2;
    this.floorY = H * 0.9;
    const rows = Math.ceil(this.geomCount / perRow);
    this.rimY = Math.max(H * 0.44, this.floorY - rows * d * 0.9);

    if (this.style === 'artsack') this._layoutArt();
    if (this._isSack()) this._buildSackWalls();
    else this._buildBoxWalls();
    if (this._isPixelSack()) this._ensurePixSprite();
  }

  _isPixelSack() { return this.style === 'pixel1' || this.style === 'pixel2'; }
  _pixelCoins() { return this.style === 'pixel2' || this.style === 'artsack'; }
  _isSack() { return this.style === 'sack' || this.style === 'artsack' || this._isPixelSack(); }

  _buildBoxWalls() {
    const M = window.Matter;
    if (this.walls) M.World.remove(this.world, this.walls);
    const t = 60;
    const left = this.cx - this.iw / 2;
    const right = this.cx + this.iw / 2;
    const wallH = this.floorY - this.rimY + t;
    const wallCy = this.rimY + wallH / 2 - t / 2;
    const wopt = { isStatic: true, restitution: 0.05, friction: 0.9 };
    this.walls = [
      M.Bodies.rectangle(this.cx, this.floorY + t / 2, this.iw + t * 2, t, wopt),
      M.Bodies.rectangle(left - t / 2, wallCy, t, wallH, wopt),
      M.Bodies.rectangle(right + t / 2, wallCy, t, wallH, wopt),
    ];
    M.World.add(this.world, this.walls);
  }

  // curved container that follows the bag's bulging profile
  _buildSackWalls() {
    const M = window.Matter;
    if (this.walls) M.World.remove(this.world, this.walls);
    this.walls = [];
    const N = 11, Hs = this.floorY - this.rimY, buf = this.r * 0.3, t = 30;
    const L = [], R = [];
    for (let i = 0; i <= N; i++) {
      const ty = i / N;
      const hw = Math.max(6, this._sackHalf(ty) - buf);
      const y = this.rimY + ty * Hs;
      L.push({ x: this.cx - hw, y }); R.push({ x: this.cx + hw, y });
    }
    const bottom = { x: this.cx, y: this.floorY + this.r * 0.5 };
    const seg = (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) + t;
      const ang = Math.atan2(dy, dx);
      this.walls.push(M.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, t, { isStatic: true, restitution: 0.04, friction: 0.95, angle: ang }));
    };
    for (let i = 0; i < N; i++) { seg(L[i], L[i + 1]); seg(R[i], R[i + 1]); }
    seg(L[N], bottom); seg(bottom, R[N]);
    // tag lower segments as "floor" (landing surface); upper side/neck edges are not
    const floorLine = this.rimY + 0.62 * Hs;
    for (const w of this.walls) if (w.position.y > floorLine) w.isFloor = true;
    M.World.add(this.world, this.walls);
  }

  addCoin() {
    if (this.destroyed) return;
    const M = window.Matter;
    const neck = this._isSack() ? this._sackHalf(0) : this.iw / 2;
    const jitter = Math.max(4, (neck - this.r) * 0.55);
    const x = this.cx + (Math.random() * 2 - 1) * jitter;
    const overflowing = this.count >= this.fillCount;
    const body = M.Bodies.circle(x, -this.r - 10, this.r * this.bodyScale, {
      restitution: this.restitution,
      friction: this.friction,
      frictionStatic: Math.min(this.friction + 0.15, 1),
      density: this.density,
      sleepThreshold: 26,
    });
    body.isCoin = true;
    body.visR = this.r;
    body.landed = false;
    body.flipPhase = Math.random() * Math.PI * 2;
    body.flipSpeed = 6 + this.spin * 12 + Math.random() * 4;
    body.born = this.simTime;
    body.tone = 0.85 + Math.random() * 0.3; // slight per-coin shade variety
    // a little sideways drift; overflow coins get a stronger shove to spill
    const vx = (Math.random() * 2 - 1) * (overflowing ? 3.2 : 1.1);
    M.Body.setVelocity(body, { x: vx, y: 2 });
    M.Body.setAngularVelocity(body, (Math.random() * 2 - 1) * this.spin);
    M.World.add(this.world, body);
    this.coins.push(body);

    this.count += 1;
    this.onCount(this.count);
    if (!this.full && this.count >= this.fillCount) {
      this.full = true;
      this._burst();
      this.onFull();
    }
    this._ensureAudio();
    this._playFlip(0.3);
  }

  reset() {
    const M = window.Matter;
    for (const c of this.coins) M.World.remove(this.world, c);
    this.coins = []; this.sparks = []; this.confetti = [];
    this.count = 0; this.full = false;
    this.onCount(0);
  }

  // Spend n coins: lift the topmost coins up and out of the sack, play a soft
  // "spent" sound, and wake the rest so the pile settles into the gap.
  spendCoins(n) {
    const M = window.Matter;
    const now = performance.now();
    const settled = this.coins
      .filter((c) => c.isCoin && !c.spending && (c.isSleeping || (c.speed || 0) < 0.7))
      .sort((a, b) => a.position.y - b.position.y);
    const take = settled.slice(0, Math.max(0, Math.floor(n)));
    for (const c of take) {
      c.spending = true; c.spendAt = now; c.landed = true;
      if (c.isSleeping) M.Sleeping.set(c, false);
      M.Body.setVelocity(c, { x: (Math.random() * 2 - 1) * 2.4, y: -(9 + Math.random() * 5) });
      M.Body.setAngularVelocity(c, (Math.random() * 2 - 1) * 0.45);
    }
    for (const c of this.coins) if (!c.spending && c.isSleeping) M.Sleeping.set(c, false);
    this.count = Math.max(0, this.count - take.length);
    if (this.count < this.fillCount) this.full = false;
    this.onCount(this.count);
    if (take.length) { this._ensureAudio(); this._spend(Math.min(0.35, 0.12 + take.length * 0.03)); }
    return take.length;
  }

  destroy() {
    this.destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    try { window.Matter.Engine.clear(this.engine); } catch (e) {}
  }

  _onCollide(e) {
    const now = performance.now();
    for (const pair of e.pairs) {
      const A = pair.bodyA, B = pair.bodyB;
      const check = (coin, other) => {
        if (!coin.isCoin || coin.landed) return;
        // only a real landing counts: on other coins or the bottom — never a
        // graze against the sack's side/rim edge on the way down.
        if (!(other.isCoin || other.isFloor)) return;
        coin.landed = true;
        const spd = Math.min(coin.speed || 0, 14);
        this._spark(coin.position.x, coin.position.y, spd);
        this._ensureAudio();
        this._playSample(0.24);
        if (now - this.lastClink > 45) {
          this.lastClink = now;
          this._clink(Math.min(0.12 + spd * 0.03, 0.55), coin.position.y / this.H);
        }
      };
      check(A, B); check(B, A);
    }
  }

  // ---- particles ----
  _spark(x, y, spd) {
    const n = 5 + Math.floor(spd * 0.8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI - Math.PI; // upward-ish fan
      const sp = 1.2 + Math.random() * (2 + spd * 0.35);
      this.sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        life: 1, decay: 0.02 + Math.random() * 0.03,
        size: 1 + Math.random() * 2.2,
      });
    }
  }

  _burst() {
    for (let i = 0; i < 90; i++) {
      const a = -Math.PI / 2 + (Math.random() * 2 - 1) * 1.1;
      const sp = 6 + Math.random() * 11;
      const gold = Math.random() > 0.35;
      this.confetti.push({
        x: this.cx + (Math.random() * 2 - 1) * this.iw * 0.4,
        y: this.rimY,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: Math.random() * Math.PI, vr: (Math.random() * 2 - 1) * 0.3,
        w: 5 + Math.random() * 7, h: 8 + Math.random() * 10,
        life: 1, decay: 0.006 + Math.random() * 0.006,
        color: gold ? GOLD.base : '#FFF6D6',
      });
    }
    this._chime();
  }

  // ---- audio (web-audio synth, no assets) ----
  _ensureAudio() {
    if (this.audio) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.audio = new AC();
      const ac = this.audio;
      this.master = ac.createGain(); this.master.gain.value = 0.85; this.master.connect(ac.destination);
      this.reverb = ac.createConvolver(); this.reverb.buffer = this._impulse(ac, 1.1, 3.2);
      this.wet = ac.createGain(); this.wet.gain.value = 0.3; this.reverb.connect(this.wet); this.wet.connect(ac.destination);
      if (this._flipUrl && !this._flipBuf) {
        fetch(this._flipUrl).then((r) => r.arrayBuffer()).then((ab) => ac.decodeAudioData(ab)).then((b) => { this._flipBuf = b; }).catch(() => {});
      }
      if (this._sampleUrls && !this._sampleBufs) {
        this._sampleBufs = [];
        this._sampleUrls.forEach((u) => {
          fetch(u).then((r) => r.arrayBuffer()).then((ab) => ac.decodeAudioData(ab)).then((b) => this._sampleBufs.push(b)).catch(() => {});
        });
      }
    } catch (e) { this.audio = null; }
    if (this.audio && this.audio.state === 'suspended') this.audio.resume();
  }

  _impulse(ac, dur, decay) {
    const rate = ac.sampleRate, len = Math.floor(rate * dur), buf = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }

  _clink(vol, depth) {
    if (!this.soundOn) return;
    const ac = this.audio; if (!ac) return;
    const t = ac.currentTime, V = Math.min(vol, 0.5), s = this.soundStyle;
    if (s === 'clinkWarm') this._sClinkWarm(ac, t, V, depth);
    else if (s === 'clinkBright') this._sClinkBright(ac, t, V, depth);
    else if (s === 'clinkDeep') this._sClinkDeep(ac, t, V, depth);
    else if (s === 'bell') this._sBell(ac, t, V, depth);
    else if (s === 'crystal') this._sCrystal(ac, t, V, depth);
    else if (s === 'harp') this._sHarp(ac, t, V, depth);
    else this._sClassic(ac, t, V, depth);
  }

  _pitch(base, depth) {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const idx = Math.max(0, Math.min(scale.length - 1, Math.floor((1 - depth) * scale.length)));
    return base * Math.pow(2, scale[idx] / 12);
  }

  _voice(ac, type, freq, t, peak, attack, decay, wet) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g); g.connect(this.master || ac.destination);
    if (wet && this.reverb) { const sd = ac.createGain(); sd.gain.value = wet; g.connect(sd); sd.connect(this.reverb); }
    o.start(t); o.stop(t + attack + decay + 0.05);
    return o;
  }

  _sClassic(ac, t, vol, depth) {
    const base = 1650 - depth * 550 + (Math.random() * 2 - 1) * 90;
    this._voice(ac, 'triangle', base, t, vol, 0.004, 0.126, 0);
    this._voice(ac, 'triangle', base * 1.5, t, vol * 0.4, 0.004, 0.126, 0);
  }

  // soft descending "spent" cue (opposite of the rising earn clink)
  _spend(vol) {
    if (!this.soundOn) return;
    const ac = this.audio; if (!ac) return;
    const t = ac.currentTime, V = Math.min(vol, 0.4);
    const fn = this['_spendFx' + (this.spendStyle || 1)] || this._spendFx1;
    fn.call(this, ac, t, V);
  }

  // ka-ching spend cues — 4 nære afarter (A–D), square-waves, dry + punchy
  _spendFx1(ac, t, V) { // A — grundtonen du valgte
    this._voice(ac, 'square', 196, t, V * 0.7, 0.002, 0.06, 0);
    this._voice(ac, 'square', 1319, t + 0.06, V * 0.9, 0.003, 0.15, 0.06);
    this._voice(ac, 'square', 1760, t + 0.08, V * 0.5, 0.003, 0.17, 0.06);
  }
  _spendFx2(ac, t, V) { // B — lidt varmere/lavere
    this._voice(ac, 'square', 175, t, V * 0.72, 0.002, 0.07, 0);
    this._voice(ac, 'square', 1245, t + 0.055, V * 0.9, 0.003, 0.17, 0.06);
    this._voice(ac, 'square', 1661, t + 0.075, V * 0.5, 0.003, 0.19, 0.06);
  }
  _spendFx3(ac, t, V) { // C — lysere top + lille sparkle
    this._voice(ac, 'square', 208, t, V * 0.68, 0.002, 0.055, 0);
    this._voice(ac, 'square', 1397, t + 0.055, V * 0.9, 0.003, 0.14, 0.06);
    this._voice(ac, 'square', 1865, t + 0.07, V * 0.55, 0.003, 0.16, 0.06);
    this._voice(ac, 'square', 2349, t + 0.075, V * 0.22, 0.002, 0.09, 0);
  }
  _spendFx4(ac, t, V) { // D — bredere interval + længere hale
    this._voice(ac, 'square', 185, t, V * 0.72, 0.002, 0.07, 0);
    this._voice(ac, 'square', 1319, t + 0.06, V * 0.9, 0.003, 0.18, 0.07);
    this._voice(ac, 'square', 1976, t + 0.085, V * 0.5, 0.003, 0.2, 0.07);
  }

  // layer a random real coin-drop sample on top of the synth clink (earn only)
  // random "flip" variant played the moment a coin spawns / becomes visible
  _playFlip(vol) {
    const ac = this.audio; if (!ac || !this._flipBuf) return;
    const src = ac.createBufferSource(); src.buffer = this._flipBuf;
    src.playbackRate.value = this._flipRates[(Math.random() * this._flipRates.length) | 0] * (0.99 + Math.random() * 0.02);
    const g = ac.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this.master || ac.destination);
    src.start();
  }

  _playSample(vol) {
    const ac = this.audio; if (!ac || !this._sampleBufs || !this._sampleBufs.length) return;
    const b = this._sampleBufs[(Math.random() * this._sampleBufs.length) | 0];
    const src = ac.createBufferSource(); src.buffer = b;
    const g = ac.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this.master || ac.destination);
    if (this.reverb) { const s = ac.createGain(); s.gain.value = 0.06; g.connect(s); s.connect(this.reverb); }
    src.start();
  }

  // three "lækre" takes on the classic clink (same character, richer)
  _sClinkWarm(ac, t, vol, depth) {
    const f = 1580 - depth * 520 + (Math.random() * 2 - 1) * 70;
    this._voice(ac, 'triangle', f, t, vol, 0.003, 0.16, 0.22);
    this._voice(ac, 'triangle', f * 1.5, t, vol * 0.4, 0.003, 0.14, 0.22);
    this._voice(ac, 'sine', f * 0.5, t, vol * 0.5, 0.004, 0.12, 0.15); // low body
  }

  _sClinkBright(ac, t, vol, depth) {
    const f = 1720 - depth * 540 + (Math.random() * 2 - 1) * 80;
    const o = this._voice(ac, 'triangle', f, t, vol, 0.002, 0.13, 0.2);
    o.frequency.exponentialRampToValueAtTime(f * 1.06, t + 0.05); // tiny up-glide sparkle
    this._voice(ac, 'triangle', f * 1.5, t, vol * 0.42, 0.002, 0.12, 0.2);
    this._voice(ac, 'sine', f * 3.0, t, vol * 0.16, 0.002, 0.09, 0.3); // high shimmer
  }

  _sClinkDeep(ac, t, vol, depth) {
    const f = 1500 - depth * 500 + (Math.random() * 2 - 1) * 60;
    this._voice(ac, 'triangle', f * 0.997, t, vol * 0.8, 0.003, 0.16, 0.24);
    this._voice(ac, 'triangle', f * 1.004, t, vol * 0.8, 0.003, 0.16, 0.24); // detuned pair = chorus
    this._voice(ac, 'triangle', f * 1.5, t, vol * 0.35, 0.003, 0.14, 0.24);
    this._voice(ac, 'sine', f * 0.5, t, vol * 0.6, 0.004, 0.14, 0.16); // sub weight
  }

  _sBell(ac, t, vol, depth) {
    const base = this._pitch(524, depth);
    [[1, 1, 0.7], [2, 0.42, 0.55], [3, 0.18, 0.4], [4.2, 0.08, 0.3]].forEach(function (row) {
      this._voice(ac, 'sine', base * row[0], t, vol * row[1], 0.012, row[2], 0.55);
    }.bind(this));
  }

  _sCrystal(ac, t, vol, depth) {
    const base = this._pitch(1046, depth);
    const o = this._voice(ac, 'sine', base, t, vol * 0.9, 0.006, 0.34, 0.6);
    o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.14);
    this._voice(ac, 'sine', base * 2, t, vol * 0.3, 0.006, 0.24, 0.6);
    this._voice(ac, 'triangle', base * 3.01, t, vol * 0.12, 0.004, 0.16, 0.5);
  }

  _sHarp(ac, t, vol, depth) {
    const base = this._pitch(392, depth);
    [0, 4, 7].forEach(function (semi, i) {
      const f = base * Math.pow(2, semi / 12);
      this._voice(ac, 'triangle', f, t + i * 0.055, vol * 0.9, 0.006, 0.26, 0.4);
      this._voice(ac, 'sine', f * 2, t + i * 0.055, vol * 0.25, 0.006, 0.2, 0.4);
    }.bind(this));
  }

  _chime() {
    if (!this.soundOn) return;
    const ac = this.audio; if (!ac) return;
    const t = ac.currentTime;
    [1046, 1318, 1568, 2093].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t + i * 0.07);
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.16, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.5);
      o.connect(g).connect(ac.destination);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.55);
    });
  }

  // ---- main loop ----
  _loop() {
    if (this.destroyed) return;
    try {
      const M = window.Matter;
      const now = performance.now();
      const dt = (1000 / 60) * this.tempo;
      this.simTime += dt;
      M.Engine.update(this.engine, dt);

      for (let i = this.coins.length - 1; i >= 0; i--) {
        const c = this.coins[i];
        if (c.position.y > this.H + 90 || c.position.x < -90 || c.position.x > this.W + 90 || (c.spending && (c.position.y < -30 || performance.now() - c.spendAt > 1300))) {
          M.World.remove(this.world, c);
          this.coins.splice(i, 1);
        }
      }
      if (this.coins.length > 64) {
        const victim = this.coins.find((c) => c.isSleeping);
        if (victim) { M.World.remove(this.world, victim); this.coins.splice(this.coins.indexOf(victim), 1); }
      }

      if (this._pixelCoins() && now - this._lastGlint > this.glintEvery) {
        this._lastGlint = now;
        const rest = [];
        for (const c of this.coins) if (c.position.y > this.rimY && (c.isSleeping || (c.speed || 0) < 0.4)) rest.push(c);
        if (rest.length) rest[(Math.random() * rest.length) | 0].glintT = now;
      }
      this._draw();
    } catch (e) { /* skip a bad frame */ }
    this._raf = requestAnimationFrame(this._loop);
  }

  _draw() {
    const ctx = this.ctx;
    const now = performance.now();
    ctx.save();
    ctx.scale(this.rs, this.rs);
    if (this.pixelate) ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.W, this.H);

    const fill = Math.min(this.count / this.fillCount, 1);
    this._drawContainerBack(ctx, fill, now);

    const pix = this._pixelCoins();
    ctx.save();
    if (this._isSack()) { this._coinClipPath(ctx); ctx.clip(); }
    else { ctx.beginPath(); rr(ctx, this.cx - this.iw / 2 - 82, this.rimY - this.r - 8, this.iw + 164, this.H - (this.rimY - this.r - 8) + 40, 20); ctx.clip(); }
    for (const c of this.coins) { pix ? this._pixCoin(ctx, c, now) : this._drawCoin(ctx, c, now); }
    ctx.restore();
    // coins above the rim (mid-air) drawn without clip so the fall is visible
    for (const c of this.coins) {
      if (c.position.y < this.rimY - this.r) { pix ? this._pixCoin(ctx, c, now) : this._drawCoin(ctx, c, now); }
    }

    this._drawContainerFront(ctx, fill, now);

    // sparkles (additive)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += 0.14; s.life -= s.decay;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = '#FFE9A6';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * (0.4 + s.life), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // confetti (celebration)
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const p = this.confetti[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.vx *= 0.99;
      p.rot += p.vr; p.life -= p.decay;
      if (p.life <= 0 || p.y > this.H + 40) { this.confetti.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    ctx.restore();
  }

  _drawCoin(ctx, b, now) {
    const r = b.visR || b.circleRadius;
    const p = b.position;
    // airborne coins flip about a horizontal axis (face -> edge -> face)
    const settled = b.isSleeping || (b.speed || 0) < 0.5;
    const flip = settled ? 1 : Math.abs(Math.cos((this.simTime - b.born) * 0.001 * b.flipSpeed + b.flipPhase));
    const sy = Math.max(flip, 0.08);

    ctx.save();
    ctx.translate(p.x, p.y);

    // soft contact shadow while resting
    if (settled) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.72, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(b.angle);
    ctx.scale(1, sy);

    const t = b.tone;
    // rim / edge ring
    const rim = ctx.createLinearGradient(-r, -r, r, r);
    rim.addColorStop(0, GOLD.mid); rim.addColorStop(0.5, GOLD.deep); rim.addColorStop(1, GOLD.edge);
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // face
    const rf = r * 0.86;
    const g = ctx.createRadialGradient(-rf * 0.4, -rf * 0.45, rf * 0.1, 0, 0, rf * 1.25);
    g.addColorStop(0, GOLD.hi);
    g.addColorStop(0.32, GOLD.lite);
    g.addColorStop(0.68, GOLD.base);
    g.addColorStop(1, GOLD.shad);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rf, 0, Math.PI * 2); ctx.fill();

    // engraved concentric ring
    ctx.strokeStyle = 'rgba(120,78,20,0.45)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath(); ctx.arc(0, 0, rf * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,214,0.35)';
    ctx.lineWidth = Math.max(0.75, r * 0.03);
    ctx.beginPath(); ctx.arc(0, 0, rf * 0.66, 0, Math.PI * 2); ctx.stroke();

    // sweeping glint band
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, rf, 0, Math.PI * 2); ctx.clip();
    const sweep = ((now * 0.00035 + b.flipPhase) % 1) * (r * 3) - r * 1.5;
    ctx.rotate(-0.5);
    const gl = ctx.createLinearGradient(sweep - r * 0.5, 0, sweep + r * 0.5, 0);
    gl.addColorStop(0, 'rgba(255,255,255,0)');
    gl.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();

    // top specular dot
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#FFFDF2';
    ctx.beginPath();
    ctx.ellipse(-rf * 0.34, -rf * 0.4, rf * 0.24, rf * 0.16, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // ============ container skins ============
  _geom() {
    return {
      left: this.cx - this.iw / 2,
      right: this.cx + this.iw / 2,
      cx: this.cx, iw: this.iw, rimY: this.rimY, floorY: this.floorY, W: this.W, H: this.H,
    };
  }

  _drawContainerBack(ctx, fill, now) {
    const g = this._geom();
    // ground shadow
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(g.cx, g.floorY + 24, g.iw * 0.82, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (this.style === 'artsack') this._artBack(ctx, g, fill);
    else if (this.style === 'jar' || this.style === 'jar-orb') this._jarBack(ctx, g, fill);
    else if (this._isPixelSack()) this._pixSackBack(ctx, g, fill);
    else if (this.style === 'sack') this._sackBack(ctx, g, fill);
    else this._chestBack(ctx, g, fill);
  }

  _drawContainerFront(ctx, fill, now) {
    const g = this._geom();
    if (this.style === 'artsack') this._artFront(ctx, g, fill);
    else if (this.style === 'jar' || this.style === 'jar-orb') this._jarFront(ctx, g, fill, now);
    else if (this._isPixelSack()) this._pixSackFront(ctx, g, fill);
    else if (this.style === 'sack') this._sackFront(ctx, g, fill);
    else this._chestFront(ctx, g, fill);
  }

  // ---- glass jar ('jar' = tall apothecary, 'jar-orb' = rounded) ----
  _jarGeom(g) {
    const orb = this.style === 'jar-orb';
    const wall = orb ? 19 : 15;
    const outerL = g.left - wall;
    const outerR = g.right + wall;
    const outerW = outerR - outerL;
    const top = g.rimY;
    const bottom = g.floorY + (orb ? 26 : 18);
    const topR = orb ? 20 : 11;
    const botR = orb ? Math.min(outerW * 0.46, (bottom - top) * 0.52) : 30;
    const lipRx = outerW / 2 + (orb ? 10 : 6);
    const lipRy = orb ? 12 : 14;
    return { orb, wall, outerL, outerR, outerW, top, bottom, topR, botR, lipRx, lipRy };
  }

  _jarBodyPath(ctx, jg) {
    const { outerL: L, outerR: R, top: T, bottom: B, topR: tR, botR: bR } = jg;
    ctx.beginPath();
    ctx.moveTo(L, T + tR);
    ctx.quadraticCurveTo(L, T, L + tR, T);
    ctx.lineTo(R - tR, T);
    ctx.quadraticCurveTo(R, T, R, T + tR);
    ctx.lineTo(R, B - bR);
    ctx.quadraticCurveTo(R, B, R - bR, B);
    ctx.lineTo(L + bR, B);
    ctx.quadraticCurveTo(L, B, L, B - bR);
    ctx.closePath();
  }

  _jarBack(ctx, g, fill) {
    const jg = this._jarGeom(g);
    const H = jg.bottom - jg.top;
    // glass volume: horizontal tint + vertical depth
    this._jarBodyPath(ctx, jg);
    const hg = ctx.createLinearGradient(jg.outerL, 0, jg.outerR, 0);
    hg.addColorStop(0.00, 'rgba(216,231,242,0.22)');
    hg.addColorStop(0.16, 'rgba(150,180,205,0.06)');
    hg.addColorStop(0.50, 'rgba(120,150,175,0.03)');
    hg.addColorStop(0.84, 'rgba(150,180,205,0.06)');
    hg.addColorStop(1.00, 'rgba(196,216,232,0.18)');
    ctx.fillStyle = hg; ctx.fill();
    this._jarBodyPath(ctx, jg);
    const vg = ctx.createLinearGradient(0, jg.top, 0, jg.bottom);
    vg.addColorStop(0, 'rgba(255,255,255,0.05)');
    vg.addColorStop(0.72, 'rgba(70,100,130,0.03)');
    vg.addColorStop(1, 'rgba(35,55,80,0.16)');
    ctx.fillStyle = vg; ctx.fill();
    // interior bottom shadow behind coins
    ctx.save();
    this._jarBodyPath(ctx, jg); ctx.clip();
    const sh = ctx.createRadialGradient(g.cx, jg.bottom, 4, g.cx, jg.bottom, jg.outerW * 0.72);
    sh.addColorStop(0, 'rgba(15,28,42,0.5)');
    sh.addColorStop(1, 'rgba(15,28,42,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(jg.outerL, jg.bottom - jg.outerW, jg.outerW, jg.outerW);
    ctx.restore();
    // far edge of the mouth (behind coins)
    ctx.strokeStyle = 'rgba(20,35,52,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(g.cx, jg.top, g.iw / 2, 9, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  _jarFront(ctx, g, fill, now) {
    const jg = this._jarGeom(g);
    const H = jg.bottom - jg.top;
    ctx.save();
    this._jarBodyPath(ctx, jg); ctx.clip();
    // cool edge refraction over the coins (glass thickness)
    const etL = ctx.createLinearGradient(jg.outerL, 0, jg.outerL + jg.outerW * 0.17, 0);
    etL.addColorStop(0, 'rgba(120,150,175,0.24)'); etL.addColorStop(1, 'rgba(120,150,175,0)');
    ctx.fillStyle = etL; ctx.fillRect(jg.outerL, jg.top, jg.outerW * 0.17, H);
    const etR = ctx.createLinearGradient(jg.outerR, 0, jg.outerR - jg.outerW * 0.15, 0);
    etR.addColorStop(0, 'rgba(120,150,175,0.2)'); etR.addColorStop(1, 'rgba(120,150,175,0)');
    ctx.fillStyle = etR; ctx.fillRect(jg.outerR - jg.outerW * 0.15, jg.top, jg.outerW * 0.15, H);
    // warm glow rising from the gold as it fills
    if (fill > 0.04) {
      const glow = ctx.createRadialGradient(g.cx, jg.bottom, 4, g.cx, jg.bottom, jg.outerW * 0.85);
      glow.addColorStop(0, 'rgba(255,196,80,' + (0.18 * fill).toFixed(3) + ')');
      glow.addColorStop(1, 'rgba(255,196,80,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(jg.outerL, jg.bottom - H * 0.7, jg.outerW, H * 0.7);
    }
    // left bright edge highlight + crisp specular line
    const lw = jg.outerW * 0.13;
    const lh = ctx.createLinearGradient(jg.outerL, 0, jg.outerL + lw, 0);
    lh.addColorStop(0, 'rgba(255,255,255,0.5)'); lh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lh; ctx.fillRect(jg.outerL, jg.top + 6, lw, H - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    rr(ctx, jg.outerL + lw * 0.42, jg.top + jg.lipRy + 10, 2.4, H * 0.6, 2); ctx.fill();
    // right subtle highlight
    const rw = jg.outerW * 0.08;
    const rhg = ctx.createLinearGradient(jg.outerR, 0, jg.outerR - rw, 0);
    rhg.addColorStop(0, 'rgba(255,255,255,0.3)'); rhg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rhg; ctx.fillRect(jg.outerR - rw, jg.top + 6, rw, H - 12);
    // broad soft sheen upper body
    const sx = g.cx - jg.outerW * 0.16, sy = jg.top + H * 0.2;
    const sheen = ctx.createRadialGradient(sx, sy, 6, sx, sy, jg.outerW * 0.55);
    sheen.addColorStop(0, 'rgba(255,255,255,0.14)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(jg.outerL, jg.top, jg.outerW, H * 0.7);
    ctx.restore();
    // soft outer contour (not a hard cartoon outline)
    this._jarBodyPath(ctx, jg);
    ctx.strokeStyle = 'rgba(226,240,252,0.28)'; ctx.lineWidth = 1.5; ctx.stroke();
    // base contact glint
    ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(g.cx, jg.bottom - 4, jg.outerW * 0.32, 5, 0, Math.PI * 0.15, Math.PI * 0.6);
    ctx.stroke();
    // thick glass mouth ring (hole reveals the coins)
    this._jarRim(ctx, g, jg);
  }

  _jarRim(ctx, g, jg) {
    const cx = g.cx, ry = jg.top;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, ry - 2, jg.lipRx, jg.lipRy, 0, 0, Math.PI * 2);
    ctx.ellipse(cx, ry + 1, g.iw / 2, jg.lipRy - 4, 0, 0, Math.PI * 2, true);
    const lipG = ctx.createLinearGradient(cx - jg.lipRx, 0, cx + jg.lipRx, 0);
    lipG.addColorStop(0, 'rgba(238,248,255,0.9)');
    lipG.addColorStop(0.45, 'rgba(150,180,205,0.45)');
    lipG.addColorStop(1, 'rgba(224,238,251,0.85)');
    ctx.fillStyle = lipG; ctx.fill('evenodd');
    // bright front lip arc
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(cx, ry - 2, jg.lipRx - 1, jg.lipRy - 1, 0, Math.PI * 0.15, Math.PI * 0.62);
    ctx.stroke();
    // inner mouth back edge
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, ry + 1, g.iw / 2, jg.lipRy - 4, 0, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
    ctx.restore();
  }

  // ---- shared bulging bag profile ----
  // ty: 0 at the mouth, 1 at the floor. Returns half-width at that height.
  _sackHalf(ty) {
    if (this.style === 'artsack') return this._artHalf(ty);
    const R = this.iw / 2;
    const mouth = 0.72, belly = 1.10, bottom = 0.76;
    let w;
    if (ty <= 0.58) { const k = ty / 0.58; w = mouth + (belly - mouth) * (1 - (1 - k) * (1 - k)); }
    else { const k = (ty - 0.58) / 0.42; w = belly + (bottom - belly) * (k * k); }
    return R * w;
  }

  _layoutArt() {
    const A = ART, s = (this.W * 0.96) / (A.bx1 - A.bx0);
    this._artScale = s;
    this._artOffX = this.W / 2 - A.cxImg * s;
    this._artOffY = (this.H - 14) - A.botImgY * s;
    this.cx = this.W / 2;
    this.rimY = this._artOffY + A.mouthY * s;
    this.floorY = this._artOffY + A.floorImgY * s;
    this.iw = 2 * 420 * s;
    this.r = Math.max(3, Math.min(30, (420 * s) / 6.4));
  }

  _artHalf(ty) {
    const A = ART, imgY = A.mouthY + ty * (A.floorImgY - A.mouthY), p = A.prof;
    let h = p[0][1];
    for (let i = 0; i < p.length - 1; i++) {
      if (imgY >= p[i][0] && imgY <= p[i + 1][0]) { const f = (imgY - p[i][0]) / (p[i + 1][0] - p[i][0]); h = p[i][1] + (p[i + 1][1] - p[i][1]) * f; break; }
      if (imgY > p[i + 1][0]) h = p[i + 1][1];
    }
    return h * this._artScale;
  }

  _artBack(ctx, g, fill) {
    const s = this._artScale, ox = this._artOffX, oy = this._artOffY, sz = 1024 * s;
    if (this._imgBg && this._imgBg.naturalWidth) ctx.drawImage(this._imgBg, ox, oy, sz, sz);
    if (this._imgBgB && this._imgBgB.naturalWidth) ctx.drawImage(this._imgBgB, ox, oy, sz, sz);
    if (this._imgRingBack && this._imgRingBack.naturalWidth) ctx.drawImage(this._imgRingBack, ox, oy, sz, sz);
  }

  _artFront(ctx, g, fill) {
    const s = this._artScale, ox = this._artOffX, oy = this._artOffY, sz = 1024 * s;
    // dark body layer over the coins (30%): coins deep in the sack read recessed/darker
    if (this._imgShade && this._imgShade.naturalWidth) { ctx.save(); ctx.globalAlpha = 0.3; ctx.drawImage(this._imgShade, ox, oy, sz, sz); ctx.restore(); }
    if (this._imgFg && this._imgFg.naturalWidth) ctx.drawImage(this._imgFg, ox, oy, sz, sz);
    if (this._imgRingFront && this._imgRingFront.naturalWidth) ctx.drawImage(this._imgRingFront, ox, oy, sz, sz);
  }

  // closed path tracing the bag silhouette at (_sackHalf + inset)
  _bagPath(ctx, inset) {
    const N = 18, Hs = this.floorY - this.rimY;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const ty = i / N; const x = this.cx - (this._sackHalf(ty) + inset); const y = this.rimY + ty * Hs;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.quadraticCurveTo(this.cx - this._sackHalf(1) * 0.5, this.floorY + this.r * 0.6 + inset, this.cx, this.floorY + this.r * 0.6 + inset);
    ctx.quadraticCurveTo(this.cx + this._sackHalf(1) * 0.5, this.floorY + this.r * 0.6 + inset, this.cx + this._sackHalf(1) + inset, this.floorY);
    for (let i = N - 1; i >= 0; i--) {
      const ty = i / N; const x = this.cx + (this._sackHalf(ty) + inset); const y = this.rimY + ty * Hs;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // coin clip: follows the sack sides but stays open (tall) at the neck so
  // coins piled near the mouth are never cropped at the top.
  _coinClipPath(ctx) {
    const N = 16, Hs = this.floorY - this.rimY, inset = 4, up = this.r * 3.2;
    const neck = this._sackHalf(0) + inset;
    ctx.beginPath();
    ctx.moveTo(this.cx - neck, this.rimY - up);
    for (let i = 0; i <= N; i++) { const ty = i / N; ctx.lineTo(this.cx - (this._sackHalf(ty) + inset), this.rimY + ty * Hs); }
    ctx.quadraticCurveTo(this.cx - this._sackHalf(1) * 0.5, this.floorY + this.r * 0.6, this.cx, this.floorY + this.r * 0.6);
    ctx.quadraticCurveTo(this.cx + this._sackHalf(1) * 0.5, this.floorY + this.r * 0.6, this.cx + this._sackHalf(1) + inset, this.floorY);
    for (let i = N; i >= 0; i--) { const ty = i / N; ctx.lineTo(this.cx + (this._sackHalf(ty) + inset), this.rimY + ty * Hs); }
    ctx.lineTo(this.cx + neck, this.rimY - up);
    ctx.closePath();
  }

  // ---- burlap money sack (smooth cloth, follows the profile) ----
  _sackBack(ctx, g, fill) {
    const thk = 11;
    this._bagPath(ctx, thk);
    const grad = ctx.createLinearGradient(g.cx - g.iw, 0, g.cx + g.iw, 0);
    grad.addColorStop(0, '#5f4321'); grad.addColorStop(0.42, '#b58c52'); grad.addColorStop(0.62, '#a67f45'); grad.addColorStop(1, '#573c1d');
    ctx.fillStyle = grad; ctx.fill();
    ctx.save(); this._bagPath(ctx, thk); ctx.clip();
    // vertical sheen
    const vs = ctx.createLinearGradient(0, g.rimY, 0, g.floorY + 30);
    vs.addColorStop(0, 'rgba(0,0,0,0.16)'); vs.addColorStop(0.4, 'rgba(255,240,210,0.05)'); vs.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = vs; ctx.fillRect(g.cx - g.iw * 1.3, g.rimY - 10, g.iw * 2.6, this.floorY - g.rimY + 60);
    // weave
    ctx.globalAlpha = 0.1; ctx.strokeStyle = '#3f2c15'; ctx.lineWidth = 1;
    for (let yy = g.rimY; yy < g.floorY + 30; yy += 7) { ctx.beginPath(); ctx.moveTo(g.cx - g.iw, yy); ctx.lineTo(g.cx + g.iw, yy); ctx.stroke(); }
    // inner side shading for depth
    ctx.globalAlpha = 1;
    const sh = ctx.createLinearGradient(g.cx - g.iw / 2, 0, g.cx + g.iw / 2, 0);
    sh.addColorStop(0, 'rgba(35,22,8,0.55)'); sh.addColorStop(0.22, 'rgba(35,22,8,0)'); sh.addColorStop(0.78, 'rgba(35,22,8,0)'); sh.addColorStop(1, 'rgba(35,22,8,0.55)');
    ctx.fillStyle = sh; ctx.fillRect(g.cx - g.iw, g.rimY, g.iw * 2, this.floorY - g.rimY + 30);
    ctx.restore();
    // dark mouth opening (coins sit in front)
    ctx.fillStyle = 'rgba(32,20,7,0.92)';
    ctx.beginPath(); ctx.ellipse(g.cx, g.rimY + 2, this._sackHalf(0), 11, 0, 0, Math.PI * 2); ctx.fill();
  }

  _sackFront(ctx, g, fill) {
    const nh = this._sackHalf(0);
    const rimX = g.cx - nh - 12, rimW = (nh + 12) * 2;
    const grad = ctx.createLinearGradient(0, g.rimY - 10, 0, g.rimY + 28);
    grad.addColorStop(0, '#d8b57a'); grad.addColorStop(1, '#8f6333');
    ctx.fillStyle = grad; rr(ctx, rimX, g.rimY + 1, rimW, 23, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,18,0.5)'; ctx.lineWidth = 1.5; rr(ctx, rimX, g.rimY + 1, rimW, 23, 12); ctx.stroke();
    ctx.strokeStyle = '#5e4021'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(rimX + 6, g.rimY + 13); ctx.quadraticCurveTo(g.cx, g.rimY + 20, rimX + rimW - 6, g.rimY + 13); ctx.stroke();
  }

  // ---- pixel-art sack + coins ----
  _pixelPalette() {
    const co = this.coinTones, cp = this.coinPixel;
    if (this.style === 'pixel2') return {
      p: cp || 5,
      tones: ['#dabf8b', '#b8975f', '#957646', '#6d5334', '#48351e'],
      gold: co || ['#fff6d6', '#ffe08a', '#f5be3c', '#c6871f', '#7e5212'],
    };
    return {
      p: cp || 7,
      tones: ['#b98a44', '#8a6228', '#553a18'],
      gold: co || ['#fff2b0', '#ffd24a', '#e0a02a', '#9c6a18', '#5e3d0e'],
    };
  }

  _ensurePixSprite() {
    const pal = this._pixelPalette(), p = pal.p, T = pal.tones, mode = this.shadeMode;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(this.W)); off.height = Math.max(1, Math.round(this.H));
    const o = off.getContext('2d');
    const Hs = this.floorY - this.rimY;
    const topY = this.rimY - 2, botY = this.floorY + this.r * 0.55 + 9;
    for (let y = Math.floor(topY / p) * p; y <= botY; y += p) {
      const tyc = Math.min(1, Math.max(0, (y - this.rimY) / Hs));
      const half = this._sackHalf(tyc) + 9;
      for (let x = Math.floor((this.cx - half) / p) * p; x <= this.cx + half; x += p) {
        const nx = (x - this.cx) / half;
        if (nx < -1 || nx > 1) continue;
        o.fillStyle = T[this._toneIdx(mode, nx, tyc, T.length)];
        o.fillRect(x, y, p, p);
      }
    }
    // dark pixel mouth opening baked into the sprite
    const nh = this._sackHalf(0);
    o.fillStyle = T[T.length - 1];
    for (let x = Math.floor((this.cx - nh) / p) * p; x <= this.cx + nh; x += p) {
      for (let y = Math.round((this.rimY - 4) / p) * p; y <= this.rimY + 6; y += p) {
        const ex = (x - this.cx) / nh, ey = (y - this.rimY) / 9;
        if (ex * ex + ey * ey <= 1) o.fillRect(x, y, p, p);
      }
    }
    // bottom band to finish the base (no square ending)
    o.fillStyle = T[T.length - 1];
    for (let y = Math.round((this.floorY + this.r * 0.12) / p) * p; y <= this.floorY + this.r * 0.55; y += p) {
      const tyc = Math.min(1, Math.max(0, (y - this.rimY) / Hs));
      const half = this._sackHalf(tyc) + 9;
      for (let x = Math.floor((this.cx - half) / p) * p; x <= this.cx + half; x += p) {
        const nx = (x - this.cx) / half; if (nx < -1 || nx > 1) continue;
        o.fillRect(x, y, p, p);
      }
    }
    this._pixSprite = off;
  }

  _toneIdx(mode, nx, tyc, levels) {
    let b;
    if (mode === 'dir') b = 0.52 + (-nx) * 0.42 + (0.45 - tyc) * 0.32;
    else if (mode === 'rim') { const edge = Math.max(Math.abs(nx), tyc > 0.88 ? (tyc - 0.88) * 9 : 0); b = 0.82 - edge * 0.72 + (-nx) * 0.1; }
    else { const rad = Math.hypot(nx * 0.92, (tyc - 0.4) * 1.15); b = 1 - rad; }
    b = Math.max(0, Math.min(0.999, b));
    return Math.min(levels - 1, Math.floor((1 - b) * levels));
  }

  _pixSackBack(ctx, g, fill) {
    if (!this._pixSprite) this._ensurePixSprite();
    ctx.drawImage(this._pixSprite, 0, 0);
  }

  _pixSackFront(ctx, g, fill) {
    const pal = this._pixelPalette(), p = pal.p, T = pal.tones;
    const half = this._sackHalf(0.5) * 1.04; // overhang past the sack edges on both sides
    const y0 = Math.round((g.rimY - p) / p) * p;
    ctx.fillStyle = T[T.length - 1];
    for (let x = Math.floor((g.cx - half) / p) * p; x <= g.cx + half; x += p) ctx.fillRect(x, y0, p, p * 2);
    ctx.fillStyle = T[T.length - 2];
    for (let x = Math.floor((g.cx - half) / p) * p; x <= g.cx + half; x += p) ctx.fillRect(x, y0 - p, p, p);
  }

  _pixCoin(ctx, b, now) {
    const pal = this._pixelPalette(), p = pal.p, G = pal.gold;
    const r = b.visR || b.circleRadius, pos = b.position;
    const settled = b.isSleeping || (b.speed || 0) < 0.5;
    const flip = settled ? 1 : Math.abs(Math.cos((this.simTime - b.born) * 0.001 * b.flipSpeed + b.flipPhase));
    const ry = Math.max(r * flip, p * 0.85);
    const cx = Math.round(pos.x / p) * p, cy = Math.round(pos.y / p) * p;
    const nr = Math.ceil(r / p), nry = Math.ceil(ry / p);
    for (let iy = -nry; iy <= nry; iy++) {
      for (let ix = -nr; ix <= nr; ix++) {
        const gx = ix * p, gy = iy * p;
        const nx = gx / r, ny = gy / (ry || 1);
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        const lv = (-nx - ny) * 0.5;
        let idx;
        if (d > 0.68) idx = 4;
        else if (lv > 0.42) idx = 0;
        else if (lv > 0.06) idx = 1;
        else if (lv > -0.36) idx = 2;
        else idx = 3;
        ctx.fillStyle = G[Math.min(idx, G.length - 1)];
        ctx.fillRect(cx + gx, cy + gy, p, p);
      }
    }
    if (b.glintT != null) this._pixGlint(ctx, b, now, cx, cy, r, p);
  }

  _pixGlint(ctx, b, now, cx, cy, r, p) {
    const dur = 700, el = now - b.glintT;
    if (el < 0 || el > dur) return;
    const t = el / dur, style = this.glintStyle;
    if (style === 'sweep') {
      const pos = -r + t * 2.3 * r;
      ctx.fillStyle = 'rgba(255,252,232,0.9)';
      const nr = Math.ceil(r / p);
      for (let iy = -nr; iy <= nr; iy++) for (let ix = -nr; ix <= nr; ix++) {
        const gx = ix * p, gy = iy * p, nx = gx / r, ny = gy / r;
        if (nx * nx + ny * ny > 0.9) continue;
        if (Math.abs((gx - gy * 0.5) - pos) < p * 1.1) ctx.fillRect(cx + gx, cy + gy, p, p);
      }
    } else if (style === 'flash') {
      const a = Math.sin(t * Math.PI); if (a <= 0.03) return;
      ctx.fillStyle = 'rgba(255,250,226,' + (a * 0.6).toFixed(2) + ')';
      const nr = Math.ceil(r / p);
      for (let iy = -nr; iy <= nr; iy++) for (let ix = -nr; ix <= nr; ix++) {
        const gx = ix * p, gy = iy * p, nx = gx / r, ny = gy / r, d = nx * nx + ny * ny;
        if (d > 0.85) continue; if ((-nx - ny) * 0.5 > -0.15) ctx.fillRect(cx + gx, cy + gy, p, p);
      }
    } else {
      const a = Math.sin(t * Math.PI); if (a <= 0.03) return;
      const sx = Math.round((cx - r * 0.26) / p) * p, sy = Math.round((cy - r * 0.32) / p) * p;
      const arms = Math.max(1, Math.round(1 + a * 3));
      ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + a * 0.55).toFixed(2) + ')';
      ctx.fillRect(sx, sy, p, p);
      for (let k = 1; k <= arms; k++) { ctx.fillRect(sx + k * p, sy, p, p); ctx.fillRect(sx - k * p, sy, p, p); ctx.fillRect(sx, sy + k * p, p, p); ctx.fillRect(sx, sy - k * p, p, p); }
    }
  }

  // ---- treasure chest ----
  _chestBack(ctx, g, fill) {
    const bulge = 1 + fill * 0.06;
    const x = g.left - 20 * bulge, w = g.iw + 40 * bulge;
    const top = g.rimY - 6, bottom = g.floorY + 30;
    ctx.save();
    // open lid behind
    ctx.fillStyle = '#5a3a1c';
    rr(ctx, x - 4, top - 78, w + 8, 60, 14); ctx.fill();
    ctx.fillStyle = '#734a24';
    rr(ctx, x + 6, top - 70, w - 12, 44, 10); ctx.fill();
    ctx.fillStyle = '#c9a24a';
    ctx.fillRect(g.cx - 6, top - 78, 12, 60);
    // box interior (dark) behind coins
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, '#2a1a0c'); grad.addColorStop(1, '#4e3116');
    ctx.fillStyle = grad;
    rr(ctx, x, top, w, bottom - top, 8); ctx.fill();
    ctx.restore();
  }

  _chestFront(ctx, g, fill) {
    const x = g.left - 20, w = g.iw + 40;
    const bottom = g.floorY + 30;
    const frontTop = g.rimY + (bottom - g.rimY) * 0.42; // low front so coins show
    ctx.save();
    const grad = ctx.createLinearGradient(0, frontTop, 0, bottom);
    grad.addColorStop(0, '#8a5a2c'); grad.addColorStop(1, '#5a3a1c');
    ctx.fillStyle = grad;
    rr(ctx, x, frontTop, w, bottom - frontTop, 8); ctx.fill();
    // wood plank lines
    ctx.strokeStyle = 'rgba(40,24,10,0.4)'; ctx.lineWidth = 1.5;
    for (let px = x + w * 0.28; px < x + w; px += w * 0.28) {
      ctx.beginPath(); ctx.moveTo(px, frontTop + 4); ctx.lineTo(px, bottom - 4); ctx.stroke();
    }
    // brass bands
    ctx.fillStyle = '#c9a24a';
    ctx.fillRect(x, frontTop + 2, w, 7);
    ctx.fillRect(x, bottom - 12, w, 7);
    ctx.fillRect(g.cx - 5, frontTop, 10, bottom - frontTop);
    // lock
    ctx.fillStyle = '#e6c469';
    rr(ctx, g.cx - 11, frontTop + (bottom - frontTop) / 2 - 9, 22, 18, 4); ctx.fill();
    ctx.strokeStyle = '#8a6a1e'; ctx.lineWidth = 1.5;
    rr(ctx, g.cx - 11, frontTop + (bottom - frontTop) / 2 - 9, 22, 18, 4); ctx.stroke();
    ctx.restore();
  }
}
