/**
 * The monster's glowing green eyes, exactly as the kit shipped it.
 *
 * Lifted verbatim from monster.html in the handoff. Do not edit: the
 * look is the design, and anything this game wants to say about it belongs
 * in the options it is constructed with.
 */
/* eslint-disable */
// @ts-nocheck
"use strict";

export class MonsterEyes {
  constructor(opts) {
    opts = opts || {};
    const D = {
      bgWidth: 941, bgHeight: 1672,
      eyes: [ { x: 621, y: 457, r: 4.5 }, { x: 670, y: 476, r: 5.5 } ],
      // brugerens valgte indstillinger (bagt ind som standard):
      eyesOn: true, eyeColor: '#a6ff6b', glowIntensity: 0.25, glowSize: 2.5,
      pulseAmount: 0.45, pulseSpeed: 1.6
    };
    this.o = Object.assign(D, opts);
    this.canvas = opts.canvas || document.getElementById('eyesFx');
    this.ctx = this.canvas.getContext('2d');
    this.setup();
  }

  setup() {
    const cv = this.canvas, o = this.o;
    this.W = cv.clientWidth || 565; this.H = cv.clientHeight || 1003;
    this.S = this.W / o.bgWidth;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = this.W * this.dpr; cv.height = this.H * this.dpr;
    this.seed = Math.random() * 1000;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
    if (!m) return [166, 255, 107];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }

  render(now) {
    const ctx = this.ctx, W = this.W, H = this.H, S = this.S, o = this.o;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!o.eyesOn) return;

    const base = this.hexRgb(o.eyeColor);
    const intensity = +o.glowIntensity, sizeK = +o.glowSize, pulseAmt = +o.pulseAmount, pulseSpd = +o.pulseSpeed;
    const t = (now / 1000) * pulseSpd + this.seed;
    const waver = 0.55 * Math.sin(t * 2.1) + 0.28 * Math.sin(t * 5.3 + 1.7) + 0.17 * Math.sin(t * 11.0 + 0.5);
    const dip = 0.9 + 0.1 * Math.sin(t * 0.7);
    const lvl = Math.max(0, dip * intensity * (1 + pulseAmt * waver));

    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
    const white = this.mix(base, [235, 255, 225], 0.8);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of o.eyes) {
      const cx = e.x * S, cy = e.y * S, er = e.r * S;
      const R = er * 9 * sizeK;
      let g = ctx.createRadialGradient(cx, cy, 1, cx, cy, R);
      g.addColorStop(0, rgba(base, 0.55 * lvl));
      g.addColorStop(0.25, rgba(base, 0.22 * lvl));
      g.addColorStop(0.6, rgba(base, 0.07 * lvl));
      g.addColorStop(1, rgba(base, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();

      const R2 = er * 3.2 * (0.9 + 0.1 * sizeK);
      let g2 = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, R2);
      g2.addColorStop(0, rgba(white, 0.95 * lvl));
      g2.addColorStop(0.4, rgba(base, 0.7 * lvl));
      g2.addColorStop(1, rgba(base, 0));
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cx, cy, R2, 0, 6.2832); ctx.fill();

      ctx.fillStyle = rgba(white, Math.min(1, 0.9 * lvl));
      ctx.fillRect(Math.round(cx - er * 0.5), Math.round(cy - er * 0.5), Math.max(1, Math.round(er)), Math.max(1, Math.round(er)));
    }
    ctx.restore();
  }

  loop(now) { this.render(now); this.raf = requestAnimationFrame(this.loop); }
  destroy() { cancelAnimationFrame(this.raf); }
}
