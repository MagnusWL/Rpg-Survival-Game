/**
 * The animated pixel fire and its warm pulsing light, exactly as the kit shipped it.
 *
 * Lifted verbatim from campfire.html in the handoff. Do not edit: the
 * look is the design, and anything this game wants to say about it belongs
 * in the options it is constructed with.
 */
/* eslint-disable */
// @ts-nocheck
"use strict";

export class PixelCampfire {
  constructor(opts) {
    opts = opts || {};
    const D = {
      // placering/størrelse (i baggrundsbilledets native pixels)
      bgWidth: 941, bgHeight: 1672,
      fireX0: 470, fireBaseY0: 1360, fireW0: 112, fireH0: 120,
      baseCELL: 5,
      // brugerens valgte indstillinger (bagt ind som standard):
      fireSize: 1.4, fireOffsetX: 5, fireOffsetY: -12,
      glowIntensity: 0.45, glowPulse: 0.3, glowPulseSpeed: 5
    };
    this.o = Object.assign(D, opts);
    this.canvas = opts.canvas || document.getElementById('fireFx');
    this.ctx = this.canvas.getContext('2d');
    this.setup();
  }

  setup() {
    const cv = this.canvas, o = this.o;
    this.W = cv.clientWidth || 565; this.H = cv.clientHeight || 1003;
    this.S = this.W / o.bgWidth;               // canvas-px pr. baggrunds-px
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = this.W * this.dpr; cv.height = this.H * this.dpr;

    const S = this.S;
    this.fireX0 = o.fireX0 * S; this.fireBaseY0 = o.fireBaseY0 * S;
    this.fireW0 = o.fireW0 * S; this.fireH0 = o.fireH0 * S;
    this.cols = Math.max(6, Math.round(this.fireW0 / o.baseCELL));
    this.rows = Math.max(8, Math.round(this.fireH0 / o.baseCELL));
    this.fire = new Float32Array(this.cols * this.rows);

    // et par gule pixels samlet i midten LIGE under cut-linjen (bunden føles ikke flad)
    this.baseBits = [];
    const c0 = Math.round(this.cols / 2);
    for (const dx of [-2, -1, 0, 1, 2]) if (Math.random() < 0.8) this.baseBits.push({ x: c0 + dx, dy: 0, warm: Math.random() > 0.4 });

    this.embers = [];
    this.flicker = 0.8;
    this.STEP = 0.08; this.stepAcc = 0;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  geom() {
    const o = this.o;
    const size = +o.fireSize || 1, offX = (+o.fireOffsetX || 0) * this.S, offY = (+o.fireOffsetY || 0) * this.S;
    const fireW = this.fireW0 * size, fireH = this.fireH0 * size;
    const fireX = this.fireX0 + offX, fireBaseY = this.fireBaseY0 + offY;
    const CELL = Math.max(2, Math.round(fireW / this.cols));
    return { size, fireW, fireH, fireX, fireBaseY, CELL, gridLeft: fireX - this.cols * CELL / 2, gridTop: fireBaseY - this.rows * CELL };
  }

  seedAndPropagate() {
    const cols = this.cols, rows = this.rows, f = this.fire;
    const center = (cols - 1) / 2, sigma = cols * 0.26;
    for (let x = 0; x < cols; x++) {
      const d = (x - center) / sigma, bell = Math.exp(-d * d);
      let s = bell * (0.9 + 0.1 * Math.random());
      if (Math.random() < 0.05) s = Math.min(1, s + 0.2);
      f[(rows - 1) * cols + x] = s;
    }
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols; x++) {
        const below = f[(y + 1) * cols + x], r = Math.random(), decay = 0.055 + r * 0.05;
        let nx = x; if (r < 0.12) nx = x - 1; else if (r > 0.88) nx = x + 1;
        if (nx < 0) nx = 0; else if (nx >= cols) nx = cols - 1;
        let v = below - decay; if (v < 0) v = 0;
        f[y * cols + nx] = v;
      }
    }
  }

  fireColor(h) {
    if (h < 0.20) return null;
    const a = Math.min(1, (h - 0.20) / 0.14);
    let c;
    if (h < 0.36) c = '#8a4a16';
    else if (h < 0.50) c = '#b06e20';
    else if (h < 0.64) c = '#d2902e';
    else if (h < 0.78) c = '#eab446';
    else if (h < 0.90) c = '#f6d472';
    else c = '#fff2c2';
    return { c, a };
  }

  update(dt) {
    this.stepAcc += dt; let guard = 0;
    while (this.stepAcc >= this.STEP && guard++ < 5) {
      this.stepAcc -= this.STEP;
      this.flicker = this.flicker * 0.82 + (0.62 + 0.38 * Math.random()) * 0.18;
      this.seedAndPropagate();
      this.stepEmbers(this.STEP);
    }
  }
  stepEmbers(dt) {
    const G = this.geom();
    if (Math.random() < 0.32) {
      this.embers.push({ x: G.fireX + (Math.random() - 0.5) * G.fireW * 0.5, y: G.fireBaseY - G.fireH * 0.4 - Math.random() * G.fireH * 0.25, vx: (Math.random() - 0.5) * 6, vy: -9 - Math.random() * 16, age: 0, life: 1.3 + Math.random() * 1.6, ph: Math.random() * 6.28, sz: (Math.random() > 0.7 ? 2 : 1) * G.CELL, warm: Math.random() > 0.5 });
      if (this.embers.length > 32) this.embers.shift();
    }
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i]; e.age += dt; e.vy *= 0.99; e.x += (e.vx + Math.sin(e.age * 3 + e.ph) * 4) * dt; e.y += e.vy * dt;
      if (e.age >= e.life) this.embers.splice(i, 1);
    }
  }

  render() {
    const ctx = this.ctx, W = this.W, H = this.H, o = this.o;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const G = this.geom();
    const gI = +o.glowIntensity, gPulse = +o.glowPulse, gSpeed = +o.glowPulseSpeed;
    const now = performance.now() * gSpeed;
    const pulse = 1 + gPulse * (0.6 * Math.sin(now / 1600) + 0.4 * Math.sin(now / 640));
    const flick = (0.9 + 0.1 * this.flicker) * gI * pulse;

    // varmt scene-lys (screen-blend -> tilføjer kun lys), pulserer & ånder
    const gx = G.fireX, gy = G.fireBaseY - G.fireH * 0.35, R = 235 * this.S * G.size * (0.96 + 0.06 * this.flicker) * (1 + 0.06 * gPulse * Math.sin(now / 1600));
    let g = ctx.createRadialGradient(gx, gy, 8, gx, gy, R);
    g.addColorStop(0, 'rgba(255,196,120,' + (0.34 * flick).toFixed(3) + ')');
    g.addColorStop(0.34, 'rgba(226,156,78,' + (0.15 * flick).toFixed(3) + ')');
    g.addColorStop(0.72, 'rgba(150,102,52,' + (0.05 * flick).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(130,92,46,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // varm kerne ved flammerne
    const ccy = G.fireBaseY - G.fireH * 0.32;
    const cg = ctx.createRadialGradient(G.fireX, ccy, 4, G.fireX, ccy, G.fireW * 0.85);
    cg.addColorStop(0, 'rgba(255,220,140,' + (0.44 * flick).toFixed(3) + ')');
    cg.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);

    // pixel-flammer
    const cols = this.cols, rows = this.rows, f = this.fire, CELL = G.CELL, gl = G.gridLeft, gt = G.gridTop;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const col = this.fireColor(f[y * cols + x]); if (!col) continue;
        ctx.globalAlpha = col.a; ctx.fillStyle = col.c;
        ctx.fillRect(Math.round(gl + x * CELL), Math.round(gt + y * CELL), CELL, CELL);
      }
    }
    // gule pixels samlet lige under cut-linjen
    const baseY = gt + rows * CELL;
    for (const b of this.baseBits) { ctx.globalAlpha = 0.9; ctx.fillStyle = b.warm ? '#f6d472' : '#eab446'; ctx.fillRect(Math.round(gl + b.x * CELL), Math.round(baseY + b.dy * CELL), CELL, CELL); }
    ctx.globalAlpha = 1;

    // gnister
    for (const e of this.embers) {
      const k = e.age / e.life, a = (1 - k) * (0.6 + 0.4 * Math.sin(e.age * 4 + e.ph));
      if (a <= 0) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, a)); ctx.fillStyle = e.warm ? '#ffcf7a' : '#ff9a3c';
      ctx.fillRect(Math.round(e.x), Math.round(e.y), e.sz, e.sz);
    }
    ctx.globalAlpha = 1;
  }

  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.update(dt); this.render();
    this.raf = requestAnimationFrame(this.loop);
  }
  destroy() { cancelAnimationFrame(this.raf); }
}
