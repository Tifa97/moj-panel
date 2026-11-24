#!/usr/bin/env node
/**
 * Dev server for public/ plus the live data API.
 *
 *   npm run serve        -> http://localhost:4173
 *   PORT=8080 npm run serve
 *
 * Static files are served as-is. Requests under /api/ run the collectors on
 * demand, so opening or refreshing the app shows current data without anyone
 * running `npm run refresh` first. Results are cached briefly so a burst of
 * refreshes hits the sources once.
 *
 * A service worker needs http(s), so opening index.html from the filesystem
 * is not enough.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { networkInterfaces } from 'node:os';

import { buildPayloads } from './lib/pipeline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 4173;
const TTL_MS = Number(process.env.API_TTL_MS) || 3 * 60 * 1000;

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

/* ------------------------------------------------------------- live data */

const cache = { at: 0, result: null, pending: null };

/** One build at a time; everyone waiting gets the same answer. */
async function getData({ force = false } = {}) {
  const fresh = cache.result && Date.now() - cache.at < TTL_MS;
  if (fresh && !force) return cache.result;
  if (cache.pending) return cache.pending;

  cache.pending = buildPayloads({ live: true })
    .then((result) => {
      cache.result = result;
      cache.at = Date.now();
      log(
        `podaci osvježeni — ${result.counts.dubrovnik} vijesti, ` +
          `${result.counts.fixtures} utakmica, ${result.counts.places} grada` +
          (result.failures.length ? ` (${result.failures.length} izvor(a) palo)` : '')
      );
      return result;
    })
    .catch((err) => {
      log(`greška pri dohvatu: ${err.message}`);
      // Serve the previous good build rather than failing the request.
      if (cache.result) return cache.result;
      throw err;
    })
    .finally(() => {
      cache.pending = null;
    });

  return cache.pending;
}

const API_NAMES = new Set(['dubrovnik', 'hajduk', 'weather', 'meta']);

async function handleApi(req, res, url) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/\.json$/, '');

  if (!API_NAMES.has(name)) {
    send(res, 404, { error: `Nepoznat resurs: ${name}` });
    return;
  }

  try {
    const result = await getData({ force: url.searchParams.has('force') });
    send(res, 200, result.payloads[name], {
      'x-generated-at': result.payloads[name].generatedAt,
      'x-sources-down': String(result.failures.length),
    });
  } catch (err) {
    send(res, 503, { error: String(err.message || err) });
  }
}

function send(res, status, body, extraHeaders = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    ...extraHeaders,
  });
  res.end(json);
}

/* ---------------------------------------------------------- static files */

async function handleStatic(req, res, url) {
  let path = join(
    ROOT,
    normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  );

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
}

/* ------------------------------------------------------------------ main */

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await handleStatic(req, res, url);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err));
  }
}).listen(PORT, () => {
  console.log(`\n  Moj panel`);
  console.log(`  → http://localhost:${PORT}`);
  for (const addr of lanAddresses()) {
    console.log(`  → http://${addr}:${PORT}   (mobitel na istoj Wi-Fi mreži)`);
  }
  console.log(`\n  Živi podaci na /api/*.json, cache ${Math.round(TTL_MS / 1000)}s.`);
  console.log(`  Zagrijavam cache…\n`);
  // Pull once up front so the first app open does not wait on the sources.
  getData().catch(() => {});
});

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

const log = (msg) =>
  console.log(`  [${new Date().toLocaleTimeString('hr-HR')}] ${msg}`);
