#!/usr/bin/env node
/**
 * Static dev server for public/. A service worker needs http(s), so opening
 * index.html from the filesystem is not enough.
 *
 *   npm run serve        -> http://localhost:4173
 *   PORT=8080 npm run serve
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { networkInterfaces } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));

    let info = await stat(path).catch(() => null);
    if (info?.isDirectory()) {
      path = join(path, 'index.html');
      info = await stat(path).catch(() => null);
    }
    if (!info) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }

    res.writeHead(200, {
      'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      // Dev only: never let the browser serve a stale panel while iterating.
      'cache-control': 'no-store, must-revalidate',
    });
    createReadStream(path).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err));
  }
}).listen(PORT, () => {
  console.log(`\n  Moj panel\n  → http://localhost:${PORT}`);
  for (const addr of lanAddresses()) console.log(`  → http://${addr}:${PORT}   (mobitel na istoj Wi-Fi mreži)`);
  console.log('');
});

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}
