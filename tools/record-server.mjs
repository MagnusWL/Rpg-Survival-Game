/**
 * The recording booth's back wall: serves the repo so a harness page can load
 * a vendored canvas engine, and catches the frames the page posts back.
 *
 * Part of the bake pipeline agreed for the Defold move: the canvas kits stop
 * being engines and become film studios. A harness (tools/record-*.html) runs
 * a kit on a VIRTUAL clock -- performance.now, Date.now and rAF all patched --
 * so the recording is deterministic and immune to tab throttling, and posts
 * each frame here as a PNG data URL. They land in tools/recordings/<name>/,
 * which is regenerable and ignored; a pack step turns them into tracked
 * Defold assets.
 *
 * Run: node tools/record-server.mjs   (then open /tools/record-tear.html)
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'recordings');
const PORT = 8123;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.wav': 'audio/wav',
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url.startsWith('/frame')) {
      const u = new URL(req.url, 'http://x');
      const name = (u.searchParams.get('name') || 'unnamed').replace(/[^a-z0-9-]/gi, '');
      const i = String(Number(u.searchParams.get('i') || 0)).padStart(3, '0');
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const b64 = body.replace(/^data:image\/png;base64,/, '');
      const dir = path.join(OUT, name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `frame-${i}.png`), Buffer.from(b64, 'base64'));
      res.writeHead(200).end('ok');
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/meta')) {
      const u = new URL(req.url, 'http://x');
      const name = (u.searchParams.get('name') || 'unnamed').replace(/[^a-z0-9-]/gi, '');
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const dir = path.join(OUT, name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'meta.json'), body);
      console.log(`[record] ${name}: meta modtaget -- optagelsen er faerdig`);
      res.writeHead(200).end('ok');
      return;
    }
    // Everything else: static files out of the repo.
    const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, clean);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404).end(String(err.message || err));
  }
});

server.listen(PORT, () => console.log(`[record] studiet kaerer paa http://localhost:${PORT}`));
