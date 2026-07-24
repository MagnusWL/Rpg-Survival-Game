/**
 * The pixelated fog drifting across the valley, exactly as the kit shipped it.
 *
 * Lifted verbatim from fog.html in the handoff. Do not edit: the
 * look is the design, and anything this game wants to say about it belongs
 * in the options it is constructed with.
 */
/* eslint-disable */
// @ts-nocheck
"use strict";

export class PixelFog {
  constructor(opts) {
    opts = opts || {};
    const D = {
      bgWidth: 941, bgHeight: 1672,
      // brugerens valgte indstillinger (bagt ind som standard):
      fogOn: true, fogOpacity: 0.15, fogSpeed: 0.2, fogDensity: 0.3,
      pixelSize: 5, fogColor: '#9aa7ba', fogCenterY: 620, fogHeight: 820
    };
    this.o = Object.assign(D, opts);
    this.canvas = opts.canvas || document.getElementById('fogFx');
    this.ctx = this.canvas.getContext('2d');
    this.setup();
  }

  setup() {
    const cv = this.canvas, o = this.o;
    this.W = cv.clientWidth || 565; this.H = cv.clientHeight || 1003;
    this.S = this.W / o.bgWidth;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = this.W * this.dpr; cv.height = this.H * this.dpr;
    this.drift = 0; this.tsec = 0;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
    if (!m) return [154, 167, 186];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  hash(ix, iy) { let n = (ix * 374761393 + iy * 668265263) | 0; n = (n ^ (n >> 13)) * 1274126177 | 0; return ((n ^ (n >> 16)) >>> 0) / 4294967296; }
  vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = this.hash(ix, iy), b = this.hash(ix + 1, iy), c = this.hash(ix, iy + 1), d = this.hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  fbm(x, y) { return this.vnoise(x, y) * 0.62 + this.vnoise(x * 2.1 + 5.3, y * 2.1 - 3.7) * 0.30; }
  smooth(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

  render(dt) {
    const ctx = this.ctx, W = this.W, H = this.H, S = this.S, o = this.o;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!o.fogOn) return;

    const opacity = +o.fogOpacity, speed = +o.fogSpeed, density = +o.fogDensity;
    const px = Math.max(3, +o.pixelSize);
    const centerY = (+o.fogCenterY) * S, bandH = (+o.fogHeight) * S;
    const col = this.hexRgb(o.fogColor);

    this.drift += speed * dt * 2.2;
    this.tsec += dt;
    const t = this.tsec, drift = this.drift, half = bandH / 2;
    const lo = 0.72 - density * 0.64, hi = lo + 0.26;
    const cols = Math.ceil(W / px), rows = Math.ceil(H / px);
    const cbase = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',';

    for (let ry = 0; ry < rows; ry++) {
      const cyPx = ry * px + px / 2;
      const dy = Math.abs(cyPx - centerY) / half;
      if (dy >= 1) continue;
      const wy = Math.pow(1 - dy * dy, 1.3);
      const ny = ry * (px / 7);
      for (let rx = 0; rx < cols; rx++) {
        const nx = rx * (px / 7);
        let v = this.fbm(nx * 0.11 + drift * 0.6, ny * 0.26 + t * 0.05) * 0.6
              + this.fbm(nx * 0.055 + drift * 0.32 + 40, ny * 0.17 - t * 0.03) * 0.4;
        v = (v - 0.10) * 3.2;
        const cov = this.smooth(lo, hi, v);
        const a = cov * wy * opacity;
        if (a < 0.012) continue;
        ctx.fillStyle = cbase + (a > 1 ? 1 : a).toFixed(3) + ')';
        ctx.fillRect(rx * px, ry * px, px, px);
      }
    }
  }

  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.render(dt);
    this.raf = requestAnimationFrame(this.loop);
  }
  destroy() { cancelAnimationFrame(this.raf); }
}
