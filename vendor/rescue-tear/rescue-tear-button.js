/**
 * The RESCUE HER tear button, lifted verbatim from the kit's rescue-button.html.
 *
 * Only the class travels; the page around it was a demo frame. Nothing here is
 * edited -- the export at the foot is the one addition, so the game can import
 * it the way it imports everything else.
 *
 * Wants a canvas and the plaque PNG. Its phases, in milliseconds from fire():
 * press 110, crack 270, strain 580, snap 760, flown apart 1360. With autoReset
 * off it freezes there, which is what a real navigation wants.
 */
class RescueTearButton {
  constructor(opts) {
    this.o = opts || {};
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.mode = (opts.mode === 'vertical') ? 'v' : 'h';
    this.autoReset = opts.autoReset !== false;
    this.hintEl = opts.hintEl || null;
    this.onTear = opts.onTear || null;
    this.setup();
    if (opts.hitEl) opts.hitEl.addEventListener('click', () => this.fire());
  }

  mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  noise2(x, y) { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); }

  setup() {
    const cv = this.canvas, o = this.o;
    this.W = o.width || 380; this.H = o.height || 675;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = this.W * this.dpr; cv.height = this.H * this.dpr;
    const r = o.buttonRect || { x: 29, y: 474, w: 322, h: 115 };
    this.buttonX = r.x; this.buttonY = r.y; this.buttonW = r.w; this.buttonH = r.h;
    this.midX = this.buttonX + this.buttonW / 2; this.cy = this.buttonY + this.buttonH / 2;
    this.GRID = Math.max(1, o.grid || 3); this.dense = !!o.dense; this.driftDir = 1;
    this.logo = (o.logoRect === null) ? null : (o.logoRect || { x0: 65, y0: 60, x1: 315, y1: 168 });
    this.sparkles = [];
    this.PRESS_END = 110; this.CRACK_END = 270; this.STRAIN_END = 580; this.SNAP_END = 760; this.FLY_END = 1360; this.HOLD_END = 1780; this.RESET_END = 2200;

    this.tear = [];
    if (this.mode === 'v') {
      const tr = this.mulberry(7); const N = 18; let prev = 0;
      for (let i = 0; i <= N; i++) { const y = this.buttonY + this.buttonH * (i / N); const off = tr() * 2 - 1; prev = prev * 0.5 + off * 0.5; this.tear.push({ x: Math.round(this.midX + prev * 13), y: Math.round(y) }); }
      this.piv0 = { x: (this.buttonX + this.midX) / 2, y: this.cy };
      this.piv1 = { x: (this.midX + this.buttonX + this.buttonW) / 2, y: this.cy };
      this.normals = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
    } else {
      this.tearY0 = this.buttonY + this.buttonH * 0.56;
      const tr = this.mulberry(11); const N = 24; let prev = 0;
      for (let i = 0; i <= N; i++) { const x = this.buttonX + this.buttonW * (i / N); const off = tr() * 2 - 1; prev = prev * 0.5 + off * 0.5; this.tear.push({ x: Math.round(x), y: Math.round(this.tearY0 + prev * 7) }); }
      this.piv0 = { x: this.midX, y: (this.buttonY + this.tearY0) / 2 };
      this.piv1 = { x: this.midX, y: (this.tearY0 + this.buttonY + this.buttonH) / 2 };
      this.normals = [{ x: 0, y: -1 }, { x: 0, y: 1 }];
    }

    const sr = this.mulberry(42); this.strandDefs = []; const nS = 9;
    for (let i = 0; i < nS; i++) {
      const f = (i + 1) / (nS + 1); let sp;
      if (this.mode === 'v') { const y = this.buttonY + 8 + (this.buttonH - 16) * f; sp = { x: this.tearXAt(y), y }; }
      else { const x = this.buttonX + 16 + (this.buttonW - 32) * f; sp = { x, y: this.tearYAt(x) }; }
      const thick = (i % 3 === 0 ? 11 : i % 3 === 1 ? 7 : 5) + sr() * 2;
      this.strandDefs.push({ sp, restDist: 4 + sr() * 6, breakDist: 52 + sr() * 44, baseThick: thick, baseSag: 8 + sr() * 10 });
    }

    this.splat = document.createElement('canvas'); this.splat.width = cv.width; this.splat.height = cv.height;
    this.sctx = this.splat.getContext('2d'); this.sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.sprite = new Image(); this.spriteReady = false;
    this.sprite.onload = () => { this.spriteReady = true; };
    this.sprite.src = this.o.buttonSrc || 'assets/button.png';

    this.parts = []; this.strands = []; this.firing = false; this.started = false; this.e = 0; this.paused = false;
    this.brng = this.mulberry(123); this.sprayed = false; this.now = performance.now();
    this.resetSim();
    this.last = performance.now();
    this._loop = this._loop.bind(this);
    this.raf = requestAnimationFrame(this._loop);
  }

  tearXAt(y) { const T = this.tear; if (y <= T[0].y) return T[0].x; for (let k = 0; k < T.length - 1; k++) if (y >= T[k].y && y <= T[k + 1].y) { const f = (y - T[k].y) / (T[k + 1].y - T[k].y || 1); return T[k].x + (T[k + 1].x - T[k].x) * f; } return T[T.length - 1].x; }
  tearYAt(x) { const T = this.tear; if (x <= T[0].x) return T[0].y; for (let k = 0; k < T.length - 1; k++) if (x >= T[k].x && x <= T[k + 1].x) { const f = (x - T[k].x) / (T[k + 1].x - T[k].x || 1); return T[k].y + (T[k + 1].y - T[k].y) * f; } return T[T.length - 1].y; }

  resetSim() {
    this.parts = [];
    this.strands = this.strandDefs.map(d => ({ sp: d.sp, restDist: d.restDist, breakDist: d.breakDist, baseThick: d.baseThick, baseSag: d.baseSag, broken: false, dead: false, w0: null, w1: null, stubs: null, stubAge: 0 }));
    this.sprayed = false;
  }
  clearSplat() { this.sctx.save(); this.sctx.setTransform(1, 0, 0, 1, 0, 0); this.sctx.clearRect(0, 0, this.splat.width, this.splat.height); this.sctx.restore(); this.sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
  _setHint(v) { this.started = !v; if (this.hintEl) this.hintEl.style.opacity = v ? '1' : '0'; }

  /* ---- public API ---- */
  fire() { if (this.firing) return; this.resetSim(); this.clearSplat(); this.brng = this.mulberry(1000 + (Date.now() & 4095)); this.firing = true; this.paused = false; this.tearT0 = performance.now(); this.e = 0; this._setHint(false); if (this.onTear) this.onTear(); }
  reset() { this.firing = false; this.resetSim(); this.clearSplat(); this._setHint(true); }
  replay() { this.reset(); this.fire(); }

  sepFor(e) {
    if (e < this.PRESS_END) return 0;
    if (e < this.CRACK_END) { const p = (e - this.PRESS_END) / (this.CRACK_END - this.PRESS_END); return 18 * this.easeOutCubic(p); }
    if (e < this.STRAIN_END) { const p = (e - this.CRACK_END) / (this.STRAIN_END - this.CRACK_END); return 18 + 14 * p; }
    if (e < this.SNAP_END) { const p = (e - this.STRAIN_END) / (this.SNAP_END - this.STRAIN_END); return 32 + 46 * this.easeOutCubic(p); }
    const p = Math.min(1, (e - this.SNAP_END) / (this.FLY_END - this.SNAP_END)); return 78 + 162 * this.easeOutCubic(p);
  }
  rotFor(e) {
    if (e < this.CRACK_END) return 0;
    if (e < this.STRAIN_END) { const p = (e - this.CRACK_END) / (this.STRAIN_END - this.CRACK_END); return 0.03 * p; }
    if (e < this.SNAP_END) { const p = (e - this.STRAIN_END) / (this.SNAP_END - this.STRAIN_END); return 0.03 + 0.07 * this.easeOutCubic(p); }
    const p = Math.min(1, (e - this.SNAP_END) / (this.FLY_END - this.SNAP_END)); return 0.1 + 0.2 * this.easeOutCubic(p);
  }
  dropFor(e) { if (e < this.SNAP_END) return 0; const p = Math.min(1, (e - this.SNAP_END) / (this.FLY_END - this.SNAP_END)); return 260 * p * p; }
  shake(e) { let s = 0; if (e > this.PRESS_END) s += 5 * Math.exp(-(e - this.PRESS_END) / 220); if (e > this.STRAIN_END) s += 9 * Math.exp(-(e - this.STRAIN_END) / 130); return s; }

  transform(pi, e) {
    const sep = this.sepFor(e), ro = this.rotFor(e), dp = this.dropFor(e);
    if (this.mode === 'v') { if (pi === 0) return { ox: -sep, oy: dp, rot: -ro, pivot: this.piv0 }; return { ox: sep, oy: dp, rot: ro, pivot: this.piv1 }; }
    if (pi === 0) return { ox: 0, oy: -sep * 0.05, rot: -ro * 0.1, pivot: this.piv0 };
    return { ox: this.driftDir * dp * 0.12, oy: sep * 1.55 + dp, rot: ro * 1.35, pivot: this.piv1 };
  }
  worldPoint(p, pi, e) { const t = this.transform(pi, e), piv = t.pivot, c = Math.cos(t.rot), s = Math.sin(t.rot), vx = p.x - piv.x, vy = p.y - piv.y; return { x: piv.x + vx * c - vy * s + t.ox, y: piv.y + vx * s + vy * c + t.oy }; }

  spawn(x, y, vx, vy, s, life, c) { this.parts.push({ x, y, vx, vy, s, life, age: 0, c }); if (this.parts.length > 520) this.parts.shift(); }
  brk(strand) {
    strand.broken = true; strand.stubAge = 0;
    const A = strand.w0, B = strand.w1, mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2; strand.stubs = [];
    for (const pi of [0, 1]) { const anc = pi === 0 ? A : B; let dx = anc.x - mx, dy = anc.y - my; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; strand.stubs.push({ pi, end: { x: mx, y: my }, v: { x: dx * (130 + this.brng() * 120), y: dy * (130 + this.brng() * 120) - 40 - this.brng() * 70 } }); }
    const pts = 4;
    for (let i = 0; i <= pts; i++) { const t = i / pts, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t; const nd = (this.dense ? 3 : 2) + Math.floor(this.brng() * (this.dense ? 4 : 3)); for (let j = 0; j < nd; j++) { const dir = this.brng() > 0.5 ? 1 : -1; this.spawn(x, y, dir * (40 + this.brng() * 170), -60 - this.brng() * 150, this.GRID * (this.brng() > 0.75 ? 2 : 1), 0.6 + this.brng() * 0.5, this.brng() > 0.5 ? COL.body : COL.wet); } }
    for (let j = 0; j < 3; j++) this.spawn(mx, my, (this.brng() * 2 - 1) * 120, -this.brng() * 140, this.GRID, 0.18 + this.brng() * 0.2, COL.flash);
  }

  advance(dt) {
    const ds = dt / 1000;
    for (const s of this.strands) {
      if (s.dead) continue;
      if (!s.broken) { s.w0 = this.worldPoint(s.sp, 0, this.e); s.w1 = this.worldPoint(s.sp, 1, this.e); const dist = Math.hypot(s.w1.x - s.w0.x, s.w1.y - s.w0.y); if (dist > s.breakDist) this.brk(s); }
      else { s.stubAge += ds; for (const st of s.stubs) { const anc = this.worldPoint(s.sp, st.pi, this.e); st.v.x += (anc.x - st.end.x) * 16 * ds; st.v.y += (anc.y - st.end.y) * 16 * ds + 400 * ds; st.v.x *= 0.86; st.v.y *= 0.86; st.end.x += st.v.x * ds; st.end.y += st.v.y * ds; } if (s.stubAge > 0.5) s.dead = true; }
    }
    if (!this.sprayed && this.sepFor(this.e) > 40) { this.sprayed = true; for (let i = 0; i < (this.dense ? 40 : 24); i++) { const p = this.tear[Math.floor(this.brng() * this.tear.length)]; const dir = this.brng() > 0.5 ? 1 : -1; this.spawn(p.x, p.y, dir * (120 + this.brng() * 260), -150 + this.brng() * 130, this.GRID, 0.5 + this.brng() * 0.5, this.brng() > 0.6 ? COL.wet : COL.deep2); } }
    if (this.e > this.SNAP_END && this.e < this.FLY_END && this.brng() < (this.dense ? 0.9 : 0.6)) { const pi = this.brng() > 0.5 ? 1 : 0; const p = this.tear[Math.floor(this.brng() * this.tear.length)]; const wx = this.worldPoint(p, pi, this.e); this.spawn(wx.x, wx.y, (this.brng() * 2 - 1) * 40, 20 + this.brng() * 60, this.GRID, 0.6 + this.brng() * 0.6, COL.deep2); }
    this.updateParts(ds);
    if (this.e >= this.HOLD_END && this.autoReset) { this.sctx.save(); this.sctx.setTransform(1, 0, 0, 1, 0, 0); this.sctx.globalCompositeOperation = 'destination-out'; this.sctx.globalAlpha = 0.05; this.sctx.fillRect(0, 0, this.splat.width, this.splat.height); this.sctx.restore(); this.sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
  }
  updateParts(ds) {
    for (let i = this.parts.length - 1; i >= 0; i--) { const p = this.parts[i]; p.age += ds; p.vy += 780 * ds; p.vx *= 0.995; p.x += p.vx * ds; p.y += p.vy * ds; p.life -= ds; if (p.life <= 0 || p.y > this.H + 30 || p.x < -30 || p.x > this.W + 30) { if (p.y < this.H + 5 && p.y > 0) this.stampSplat(p.x, p.y); this.parts.splice(i, 1); } }
  }
  stampSplat(x, y) { const g = this.GRID, bx = Math.round(x / g) * g, by = Math.round(y / g) * g; this.sctx.globalAlpha = 0.85; this.sctx.fillStyle = this.brng() > 0.5 ? COL.splatA : COL.splatB; this.sctx.fillRect(bx - g, by, g * 2, g); this.sctx.fillRect(bx, by - g, g, g * 2); this.sctx.globalAlpha = 1; }

  blkW(cx, cy, s, c, a) { const g = this.GRID, x = Math.round((cx - s / 2) / g) * g, y = Math.round((cy - s / 2) / g) * g, ctx = this.ctx; ctx.globalAlpha = (a == null ? 1 : a); ctx.fillStyle = c; ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1; }

  piecePath(pi) {
    const ctx = this.ctx, T = this.tear, pad = 8;
    const x0 = this.buttonX - pad, x1 = this.buttonX + this.buttonW + pad, yT = this.buttonY - pad, yB = this.buttonY + this.buttonH + pad;
    ctx.beginPath();
    if (this.mode === 'v') { const outer = pi === 0 ? x0 : x1; ctx.moveTo(outer, yT); ctx.lineTo(T[0].x, yT); for (const p of T) ctx.lineTo(p.x, p.y); ctx.lineTo(T[T.length - 1].x, yB); ctx.lineTo(outer, yB); }
    else if (pi === 0) { ctx.moveTo(x0, yT); ctx.lineTo(x1, yT); ctx.lineTo(x1, T[T.length - 1].y); for (let k = T.length - 1; k >= 0; k--) ctx.lineTo(T[k].x, T[k].y); ctx.lineTo(x0, T[0].y); }
    else { ctx.moveTo(x0, T[0].y); for (const p of T) ctx.lineTo(p.x, p.y); ctx.lineTo(x1, T[T.length - 1].y); ctx.lineTo(x1, yB); ctx.lineTo(x0, yB); }
    ctx.closePath();
  }
  drawGore(pi) {
    const sep = this.sepFor(this.e); if (sep < 1) return;
    const depth = Math.min(12, 3 + sep * 0.35), g = this.GRID, T = this.tear, nrm = this.normals[pi];
    for (let k = 0; k < T.length - 1; k++) {
      const a = T[k], b = T[k + 1], segLen = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.round(segLen / Math.max(2, g)));
      for (let si = 0; si < steps; si++) {
        const f = si / steps, px = a.x + (b.x - a.x) * f, py = a.y + (b.y - a.y) * f;
        for (let d = 0; d < depth; d += g) { const x = px + nrm.x * (g + d), y = py + nrm.y * (g + d), n = this.noise2(x * 0.7, y * 0.7); let c; if (d < g) c = COL.edge; else if (d < g * 2) c = n > 0.5 ? COL.wet : COL.bright; else if (d < depth * 0.5) c = n > 0.6 ? COL.bright : COL.deep2; else c = n > 0.65 ? COL.deep2 : COL.deep; this.blkW(x, y, g, c, 0.92); }
        if (this.noise2(px, py * 1.7) > 0.85) this.blkW(px + nrm.x * g * 1.5, py + nrm.y * g * 1.5, g, COL.node, 0.8);
      }
    }
  }
  drawPiece(pi) { const ctx = this.ctx, t = this.transform(pi, this.e); ctx.save(); ctx.translate(t.pivot.x + t.ox, t.pivot.y + t.oy); ctx.rotate(t.rot); ctx.translate(-t.pivot.x, -t.pivot.y); this.piecePath(pi); ctx.clip(); ctx.drawImage(this.sprite, this.buttonX, this.buttonY, this.buttonW, this.buttonH); this.drawGore(pi); ctx.restore(); }

  drawSinew(A, B, ctrl, th, tension, seed, perp) {
    const segs = Math.max(6, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / this.GRID));
    for (let i = 0; i <= segs; i++) { const t = i / segs, mt = 1 - t; let x = mt * mt * A.x + 2 * mt * t * ctrl.x + t * t * B.x; let y = mt * mt * A.y + 2 * mt * t * ctrl.y + t * t * B.y; const mid = Math.sin(t * Math.PI), j = (this.noise2(seed + i * 3.1, this.now * 0.02 + i) * 2 - 1) * mid * (0.5 + tension * 2.5); x += perp.x * j; y += perp.y * j; const w = Math.max(this.GRID, th * (0.55 + 0.45 * mt)); this.blkW(x, y, w + this.GRID, COL.outline, 0.95); this.blkW(x, y, w, COL.body, 1); this.blkW(x - perp.x * Math.max(1, w * 0.28), y - perp.y * Math.max(1, w * 0.28), Math.max(this.GRID, w - this.GRID * 2), COL.wet, 0.9); }
    const mx = 0.25 * A.x + 0.5 * ctrl.x + 0.25 * B.x, my = 0.25 * A.y + 0.5 * ctrl.y + 0.25 * B.y; this.blkW(mx, my, this.GRID * 2, COL.node, 0.85);
  }
  drawStub(A, B, a) { const segs = 4; for (let i = 0; i <= segs; i++) { const t = i / segs, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t, w = Math.max(this.GRID, this.GRID * 2.2 * (1 - t)); this.blkW(x, y, w + this.GRID, COL.outline, a * 0.9); this.blkW(x, y, w, COL.body, a); } this.blkW(B.x, B.y, this.GRID * 2, COL.wet, a); }
  drawStrands() {
    for (const s of this.strands) {
      if (s.dead) continue;
      if (!s.broken) { if (!s.w0) continue; const dx = s.w1.x - s.w0.x, dy = s.w1.y - s.w0.y, dist = Math.hypot(dx, dy) || 1; const tension = Math.max(0, Math.min(1, (dist - s.restDist) / (s.breakDist - s.restDist))); const th = Math.max(this.GRID, s.baseThick * (1 - 0.7 * tension)); const sag = s.baseSag * (1 - tension) + 2; const perp = { x: -dy / dist, y: dx / dist }; const trem = (this.noise2(s.sp.x + s.sp.y, this.now * 0.03) * 2 - 1) * (1 + tension * 6); const ctrl = { x: (s.w0.x + s.w1.x) / 2 + perp.x * (sag + trem), y: (s.w0.y + s.w1.y) / 2 + perp.y * (sag + trem) }; this.drawSinew(s.w0, s.w1, ctrl, th, tension, s.sp.x + s.sp.y, perp); }
      else { const a = Math.max(0, 1 - s.stubAge / 0.5); if (a <= 0) { s.dead = true; continue; } for (const st of s.stubs) this.drawStub(this.worldPoint(s.sp, st.pi, this.e), st.end, a); }
    }
  }
  drawParticles() { for (const p of this.parts) { if (p.s >= this.GRID * 2) this.blkW(p.x, p.y, p.s + this.GRID, COL.part, 0.6); this.blkW(p.x, p.y, p.s, p.c, 1); } }

  drawIntact(now, alpha, tense) {
    const ctx = this.ctx; let sx = 1, sy = 1, dy = 0;
    if (tense) { const p = this.e / this.PRESS_END, d = Math.sin(p * Math.PI); sx = 1 - 0.03 * d; sy = 1 - 0.06 * d; dy = 3 * d; }
    else if (!this.firing) { const bob = Math.sin(now / 720); dy = -3 * bob; sy = 1 + 0.005 * bob; sx = 1 - 0.004 * bob; }
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(this.midX, this.cy + dy); ctx.scale(sx, sy); ctx.translate(-this.midX, -this.cy); ctx.drawImage(this.sprite, this.buttonX, this.buttonY, this.buttonW, this.buttonH); ctx.restore();
  }
  drawSeamCrack(e) { const a = Math.min(1, e / this.PRESS_END); for (let k = 0; k < this.tear.length - 1; k++) { const p = this.tear[k]; this.blkW(p.x, p.y, this.GRID, COL.edge, 0.8 * a); if (this.noise2(p.x, p.y) > 0.6) this.blkW(p.x, p.y, this.GRID, COL.deep2, 0.6 * a); } }
  drawFlash(e) { const a = 0.4 * Math.exp(-(e - this.PRESS_END) / 150); if (a <= 0.01) return; const ctx = this.ctx; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(this.midX, this.cy, 10, this.midX, this.cy, 220); g.addColorStop(0, 'rgba(150,25,15,' + a + ')'); g.addColorStop(1, 'rgba(150,25,15,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H); ctx.restore(); }

  tickSparkles(now) {
    if (!this.logo) return;
    const dt = Math.min(0.05, (now - (this._sparkLast || now)) / 1000); this._sparkLast = now;
    const ctx = this.ctx, L = this.logo;
    if (this.sparkles.length < 4 && Math.random() < 2.4 * dt) this.sparkles.push({ x: L.x0 + Math.random() * (L.x1 - L.x0), y: L.y0 + Math.random() * (L.y1 - L.y0), t: 0, life: 0.7 + Math.random() * 0.8, sz: Math.random() > 0.55 ? 2 : 1, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 5 });
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i]; s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; const k = s.t / s.life; if (k >= 1) { this.sparkles.splice(i, 1); continue; }
      const b = Math.sin(k * Math.PI), a = b * 0.6, g = this.GRID, arm = g * (0.5 + 2.4 * b) * s.sz, cs = Math.max(1, g * s.sz), t2 = Math.max(1, Math.round(g * 0.5 * s.sz));
      ctx.globalAlpha = a; ctx.fillStyle = COL.sparkA; ctx.fillRect(Math.round(s.x - arm), Math.round(s.y - t2 / 2), Math.round(arm * 2), t2); ctx.fillRect(Math.round(s.x - t2 / 2), Math.round(s.y - arm), t2, Math.round(arm * 2));
      ctx.globalAlpha = a * 0.95; ctx.fillStyle = COL.sparkB; ctx.fillRect(Math.round(s.x - cs / 2), Math.round(s.y - cs / 2), cs, cs); ctx.globalAlpha = 1;
    }
  }

  render(now) {
    const ctx = this.ctx, W = this.W, H = this.H; this.now = now;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (this.firing) { const sh = this.shake(this.e); if (sh > 0.1) ctx.translate(this.brng() * sh - sh / 2, this.brng() * sh - sh / 2); }
    ctx.drawImage(this.splat, 0, 0, W, H);
    this.tickSparkles(now);
    if (!this.firing) { const bob = Math.sin(now / 720), pulse = 0.5 + 0.5 * Math.sin(now / 620), gy = this.cy - 3 * bob; const gl = ctx.createRadialGradient(this.midX, gy, 6, this.midX, gy, 175); gl.addColorStop(0, 'rgba(150,26,16,' + (0.12 + 0.1 * pulse) + ')'); gl.addColorStop(0.5, 'rgba(120,18,12,' + (0.06 + 0.05 * pulse) + ')'); gl.addColorStop(1, 'rgba(120,18,12,0)'); ctx.fillStyle = gl; ctx.fillRect(0, gy - 150, W, 300); }
    if (!this.spriteReady) return;
    if (!this.firing) this.drawIntact(now, 1, false);
    else if (this.e < this.PRESS_END) { this.drawIntact(now, 1, true); this.drawSeamCrack(this.e); }
    else if (this.e < this.HOLD_END) { this.drawPiece(0); this.drawPiece(1); this.drawStrands(); }
    this.drawParticles();
    if (this.firing && this.autoReset && this.e >= this.HOLD_END) this.drawIntact(now, this.easeOutCubic((this.e - this.HOLD_END) / (this.RESET_END - this.HOLD_END)), false);
    if (this.firing && this.e >= this.PRESS_END) this.drawFlash(this.e);
  }

  _loop(now) {
    const dt = Math.min(50, now - this.last); this.last = now;
    if (!this.paused) {
      if (this.firing) {
        this.e = now - this.tearT0;
        if (!this.autoReset && this.e > this.FLY_END) this.e = this.FLY_END; // freeze torn
        this.advance(dt);
        if (this.autoReset && this.e >= this.RESET_END) { this.firing = false; this.resetSim(); this.clearSplat(); this._setHint(true); }
      }
      this.render(now);
    }
    this.raf = requestAnimationFrame(this._loop);
  }

  /* manual frame render (for testing / thumbnails) */
  seek(ms) { this.paused = true; this.firing = true; this.tearT0 = performance.now() - ms; this.resetSim(); this.clearSplat(); this.brng = this.mulberry(555); let t = 0; while (t <= ms) { this.e = t; this.advance(16.7); t += 16.7; } this.e = ms; this.render(performance.now()); }
}

export { RescueTearButton };
