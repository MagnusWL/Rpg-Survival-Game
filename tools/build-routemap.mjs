/**
 * Reads the hand-drawn route map and turns it into data the game can walk.
 *
 * Nicolai paints the world (Routemap - World 1.png) and, beside it, a guide
 * in flat colours saying where things are:
 *
 *   yellow square  the doorstep -- stage 0, where a run opens
 *   pink squares   the stages, one per place drawn in the painting
 *   green lines    the roads between them, straight or curved
 *
 * This mill reads the guide rather than anyone measuring by hand, so moving
 * a square in the drawing moves the node in the game. It writes:
 *
 *   assets/sprites/routemap/world1.jpg   the painting, milled for the game
 *   main/tiles/routemap_world1.atlas     its atlas
 *   game/routemap.lua                    the graph: nodes, roads, stages
 *
 * Coordinates are normalised (0..1 across the painting), so the game can
 * place nodes whatever size it draws the map at.
 *
 * Roads are found by walking the ink, not by assuming straight lines: from
 * every place a road leaves a square, the walk follows the green while
 * keeping its heading, and stops when it reaches another square. That is
 * what lets a curved road be read, and it is also why a crossing does not
 * fool it -- switching lines at a crossing would need a sharp turn, and the
 * walk will not make one.
 *
 * Run: node tools/build-routemap.mjs
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Raw_Assets', 'Grafik', 'Routemap');
const ART = path.join(SRC, 'Routemap - World 1.png');
const GUIDE = path.join(SRC, 'Routemap - World 1 Guide.png');
const OUT_IMG = path.join(ROOT, 'assets', 'sprites', 'routemap');
const OUT_ATLAS = path.join(ROOT, 'main', 'tiles', 'routemap_world1.atlas');
const OUT_LUA = path.join(ROOT, 'game', 'routemap.lua');

const MIN_BLOB = 400;      // pixels; smaller specks are not squares
const STEP = 3;            // pixels per stride while walking a road
const MAX_TURN = Math.cos((42 * Math.PI) / 180); // how sharp a road may bend
const SIMPLIFY = 5;        // px; how far a road point may stray before it counts

const { data, info } = await sharp(GUIDE).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};
const isYellow = ([r, g, b, a]) => a > 128 && r > 200 && g > 200 && b < 120;
const isPink = ([r, g, b, a]) => a > 128 && r > 200 && g < 110 && b > 60 && b < 150;
const isGreen = ([r, g, b, a]) => a > 128 && g > 170 && r < 200 && b < 140;
const green = (x, y) => x >= 0 && y >= 0 && x < W && y < H && isGreen(px(x | 0, y | 0));

// --- The squares ----------------------------------------------------------
const seen = new Uint8Array(W * H);
const squares = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (seen[i]) continue;
    const c = px(x, y);
    const kind = isYellow(c) ? 'start' : (isPink(c) ? 'stage' : null);
    if (!kind) continue;
    let minx = x, maxx = x, miny = y, maxy = y, n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      const cx = p % W, cy = (p - cx) / W;
      n++;
      if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
      if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (seen[q]) continue;
        const cc = px(nx, ny);
        const k = isYellow(cc) ? 'start' : (isPink(cc) ? 'stage' : null);
        if (k === kind) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n >= MIN_BLOB) {
      squares.push({
        kind, x: (minx + maxx) / 2, y: (miny + maxy) / 2,
        half: Math.max(maxx - minx, maxy - miny) / 2,
      });
    }
  }
}
if (!squares.some((s) => s.kind === 'start')) {
  throw new Error('ingen gul firkant: guiden mangler stage 0');
}
// Left to right, top to bottom -- reading order, and the start comes first.
squares.sort((a, b) => (a.kind === b.kind ? a.x - b.x || a.y - b.y : (a.kind === 'start' ? -1 : 1)));

const inSquare = (x, y, except) => squares.findIndex((s, i) =>
  i !== except && Math.abs(x - s.x) <= s.half + 3 && Math.abs(y - s.y) <= s.half + 3);

// --- The roads, walked rather than guessed --------------------------------
// From a starting point just outside a square, keep stepping along the green
// in as near a straight line as the ink allows.
function walk(from, sx, sy, dx, dy) {
  const pts = [[sx, sy]];
  let x = sx, y = sy, ux = dx, uy = dy;
  for (let step = 0; step < 900; step++) {
    let best = null, bestDot = MAX_TURN;
    for (let a = -40; a <= 40; a += 4) {
      const r = (a * Math.PI) / 180;
      const nx2 = ux * Math.cos(r) - uy * Math.sin(r);
      const ny2 = ux * Math.sin(r) + uy * Math.cos(r);
      const cx = x + nx2 * STEP, cy = y + ny2 * STEP;
      if (!green(cx, cy) && !green(cx + nx2, cy + ny2)) continue;
      const dot = nx2 * ux + ny2 * uy;
      if (dot > bestDot || (best && dot > best.dot)) {
        if (!best || dot > best.dot) best = { x: cx, y: cy, ux: nx2, uy: ny2, dot };
      }
    }
    if (!best) return null;
    x = best.x; y = best.y; ux = best.ux; uy = best.uy;
    pts.push([x, y]);
    const hit = inSquare(x, y, from);
    if (hit >= 0) return { to: hit, pts };
  }
  return null;
}

// Douglas-Peucker, so a straight road ships as two points and a curve keeps
// only the bends that matter.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let idx = 0, far = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > far) { far = d; idx = i; }
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

const roads = new Map(); // "a-b" -> points
for (let i = 0; i < squares.length; i++) {
  const s = squares[i];
  const r = s.half + 4;
  // Every green pixel just outside the square is a road leaving it. The scan
  // follows the square's OUTLINE rather than a circle around it: a road that
  // leaves by a corner sits a corner's distance out, and a circle drawn at
  // the side's distance passes inside it and misses the road entirely.
  const ports = [];
  const port_at = (x, y) => {
    if (!green(x, y)) return;
    const dx = x - s.x, dy = y - s.y, len = Math.hypot(dx, dy) || 1;
    ports.push({ x, y, ux: dx / len, uy: dy / len });
  };
  for (let t = -r; t <= r; t += 2) {
    port_at(s.x + t, s.y - r);
    port_at(s.x + t, s.y + r);
    port_at(s.x - r, s.y + t);
    port_at(s.x + r, s.y + t);
  }
  for (const p of ports) {
    const found = walk(i, p.x, p.y, p.ux, p.uy);
    if (!found || found.to === i) continue;
    const key = i < found.to ? `${i}-${found.to}` : `${found.to}-${i}`;
    if (roads.has(key)) continue;
    const pts = i < found.to ? found.pts : [...found.pts].reverse();
    roads.set(key, simplify(pts, SIMPLIFY));
  }
}

// --- Stage numbers: how many steps from the doorstep ----------------------
const adj = squares.map(() => []);
for (const key of roads.keys()) {
  const [a, b] = key.split('-').map(Number);
  adj[a].push(b); adj[b].push(a);
}
const stage = squares.map(() => -1);
stage[0] = 0;
const queue = [0];
for (let h = 0; h < queue.length; h++) {
  for (const n of adj[queue[h]]) {
    if (stage[n] === -1) { stage[n] = stage[queue[h]] + 1; queue.push(n); }
  }
}
const orphans = stage.filter((s) => s === -1).length;

// --- The painting ---------------------------------------------------------
mkdirSync(OUT_IMG, { recursive: true });
const artMeta = await sharp(ART).metadata();
await sharp(ART).jpeg({ quality: 88, mozjpeg: true })
  .toFile(path.join(OUT_IMG, 'world1.jpg'));
writeFileSync(OUT_ATLAS,
  'images {\n  image: "/assets/sprites/routemap/world1.jpg"\n}\nmargin: 2\nextrude_borders: 2\n');

// --- The graph ------------------------------------------------------------
const n3 = (v) => Number(v.toFixed(4));
let lua = '';
lua += '-- The world map, read from the drawing by tools/build-routemap.mjs.\n';
lua += '-- Do not edit: move a square in Raw_Assets/Grafik/Routemap and run the\n';
lua += '-- mill again. Coordinates are fractions of the painting, x from the\n';
lua += '-- left and y DOWN from the top, the way the picture is drawn.\n';
lua += 'return {\n';
lua += `\tart = { w = ${artMeta.width}, h = ${artMeta.height} },\n`;
lua += '\tnodes = {\n';
squares.forEach((s, i) => {
  lua += `\t\t{ x = ${n3(s.x / W)}, y = ${n3(s.y / H)}, stage = ${stage[i]}, `
    + `size = ${n3((s.half * 2) / W)} },\n`;
});
lua += '\t},\n';
lua += '\troads = {\n';
for (const [key, pts] of [...roads.entries()].sort()) {
  const [a, b] = key.split('-').map(Number);
  const flat = pts.map(([x, y]) => `${n3(x / W)}, ${n3(y / H)}`).join(', ');
  lua += `\t\t{ from = ${a + 1}, to = ${b + 1}, points = { ${flat} } },\n`;
}
lua += '\t},\n';
lua += '}\n';
writeFileSync(OUT_LUA, lua);

// --- What the drawing turned out to say -----------------------------------
const byStage = {};
stage.forEach((s) => { byStage[s] = (byStage[s] || 0) + 1; });
console.log(`knuder: ${squares.length}  (stage 0 + ${squares.length - 1} stages)`);
console.log(`veje:   ${roads.size}`);
console.log('stages og hvor mange knuder de har:');
for (const s of Object.keys(byStage).sort((a, b) => a - b)) {
  console.log(`  stage ${s}: ${byStage[s]} knude${byStage[s] > 1 ? 'r' : ''}`
    + (s === '-1' ? '  <-- UDEN VEJ TIL STAGE 0' : ''));
}
if (orphans) console.log(`ADVARSEL: ${orphans} knude(r) har ingen vej hjem til stage 0`);
console.log(`dybde:  ${Math.max(...stage)} stages fra doerstenen`);
console.log(`skrev:  ${path.relative(ROOT, OUT_LUA)}`);
