#!/usr/bin/env node
/**
 * One-off backfill of past Hajduk results.
 *
 * The official RSS only carries the last ~10 days, so a fresh clone starts
 * with one or two results. hajduk.hr article URLs resolve by numeric id alone
 * (the slug is ignored), and every match report is titled with the score —
 * so walking ids backwards from the newest one recovers the season's results.
 *
 *   npm run backfill            # 250 articles back (~4 weeks)
 *   npm run backfill -- 600     # further back
 *
 * Polite by design: small concurrency, one pass, results merged into
 * data/store.json so `npm run refresh` keeps them from then on.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getText } from './lib/http.mjs';
import { parseFeed } from './lib/xml.mjs';
import { decodeEntities, toPlainText, truncate } from './lib/text.mjs';
import { parseScoreTitle } from './sources/hajduk.mjs';
import { loadStore, saveStore, mergeRecords } from './lib/store.mjs';
import { zagrebToUtcIso } from './lib/hr-dates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'data', 'store.json');

const RSS = 'https://hajduk.hr/sadrzaj/rss/vijesti.xml';
const ARTICLE = (id) => `https://hajduk.hr/vijest/x/${id}`;
const CONCURRENCY = 4;

async function main() {
  const count = Math.min(Math.max(Number(process.argv[2]) || 250, 10), 2000);

  const newestId = await findNewestId();
  if (!newestId) {
    console.error('Ne mogu odrediti zadnji ID vijesti s hajduk.hr.');
    process.exit(1);
  }

  const ids = Array.from({ length: count }, (_, i) => newestId - i).filter((id) => id > 0);
  console.log(`\nPretražujem ${ids.length} vijesti unatrag od #${newestId} …\n`);

  const found = [];
  let done = 0;
  let failed = 0;

  await runPool(ids, CONCURRENCY, async (id) => {
    try {
      const html = await getText(ARTICLE(id), { retries: 0, timeout: 15000 });
      const title = extractTitle(html);
      const parsed = title && parseScoreTitle(title);
      if (parsed) {
        const record = {
          ...parsed,
          id: String(id),
          link: ARTICLE(id),
          playedAt: extractDate(html),
          detail: extractDetail(html),
          source: 'hajduk.hr',
          backfilled: true,
        };
        found.push(record);
        console.log(`  ${pad(record.playedAt)}  ${parsed.home} ${parsed.homeScore}:${parsed.awayScore} ${parsed.away}`);
      }
    } catch {
      failed++;
    } finally {
      done++;
      if (done % 50 === 0) process.stdout.write(`  … ${done}/${ids.length}\n`);
    }
  });

  const store = await loadStore(STORE);
  const before = (store.hajdukResults || []).length;
  store.hajdukResults = mergeRecords(store.hajdukResults, found, {
    key: 'id',
    dateKey: 'playedAt',
    max: 120,
  });
  await saveStore(STORE, store);

  console.log(
    `\nPronađeno ${found.length} utakmica; pohranjeno ukupno ${store.hajdukResults.length} ` +
      `(prije: ${before}). Neuspjelih dohvata: ${failed}.`
  );
  console.log('Pokreni "npm run refresh" da ih objaviš u public/data.\n');
}

async function findNewestId() {
  const items = parseFeed(await getText(RSS)).items;
  const ids = items
    .map((it) => Number((it.link.match(/\/(\d+)\s*$/) || [])[1]))
    .filter(Boolean);
  return ids.length ? Math.max(...ids) : null;
}

function extractTitle(html) {
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  if (og) return decodeEntities(og[1]);
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  return t ? decodeEntities(t[1].trim()) : '';
}

/**
 * Article pages carry no date markup, but the hero image is filed under its
 * upload timestamp — which for a match report is the day it was published.
 */
function extractDate(html) {
  const meta = html.match(/property=["']article:published_time["'][^>]*content=["']([^"']*)["']/i);
  if (meta) {
    const d = new Date(meta[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const img = html.match(
    /slike-za-vijesti\/\d+x\d+\/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/
  );
  if (img) {
    const [, y, mo, d, h, mi] = img;
    return zagrebToUtcIso(+y, +mo, +d, +h, +mi);
  }
  return null;
}

function extractDetail(html) {
  const og = html.match(/property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  return og ? truncate(toPlainText(decodeEntities(og[1])), 90) : '';
}

/** Bounded-concurrency map; keeps the crawl gentle on hajduk.hr. */
async function runPool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: size }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

const pad = (iso) => (iso ? iso.slice(0, 10) : '          ');

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
