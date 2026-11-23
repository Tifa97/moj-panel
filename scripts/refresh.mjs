#!/usr/bin/env node
/**
 * Build-time data refresh.
 *
 * Pulls every source once, merges the result into the committed store (so the
 * lists grow across runs instead of mirroring whatever the RSS window holds),
 * then writes the static JSON the PWA reads.
 *
 *   npm run refresh
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { collectDubrovnik } from './sources/dubrovnik.mjs';
import { collectHajduk } from './sources/hajduk.mjs';
import { collectWeather } from './sources/weather.mjs';
import { loadStore, saveStore, mergeRecords } from './lib/store.mjs';
import { dedupeArticles } from './lib/dedupe.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data');
const STORE = join(ROOT, 'data', 'store.json');

const PUBLISH = { dubrovnikNews: 24, hajdukNews: 20, hajdukResults: 8 };
const KEEP = { dubrovnikNews: 80, hajdukNews: 80, hajdukResults: 60 };

async function main() {
  const startedAt = new Date();
  console.log(`\nOsvježavanje podataka — ${startedAt.toLocaleString('hr-HR')}\n`);

  const [dubrovnik, hajduk, weather] = await Promise.all([
    settle('Dubrovnik', collectDubrovnik),
    settle('Hajduk', collectHajduk),
    settle('Vrijeme', collectWeather),
  ]);

  const store = await loadStore(STORE);
  const generatedAt = new Date().toISOString();
  const allSources = [];

  /* ---------------------------------------------------------- Dubrovnik */
  const duNews = mergeRecords(store.dubrovnikNews, dubrovnik.data?.items || [], {
    dateKey: 'publishedAt',
    max: KEEP.dubrovnikNews,
  });
  store.dubrovnikNews = duNews;

  const duItems = dedupeArticles(duNews).slice(0, PUBLISH.dubrovnikNews);
  const duSources = dubrovnik.data?.sources || [failed('Dubrovnik feeds', dubrovnik.error)];
  allSources.push(...duSources);

  await write('dubrovnik.json', {
    generatedAt,
    city: 'Dubrovnik',
    items: duItems,
    counts: { total: duItems.length, today: duItems.filter(isToday).length },
    sources: duSources,
  });

  /* ------------------------------------------------------------- Hajduk */
  const hjNews = mergeRecords(store.hajdukNews, hajduk.data?.news || [], {
    dateKey: 'publishedAt',
    max: KEEP.hajdukNews,
  });
  store.hajdukNews = hjNews;

  const hjResults = mergeRecords(store.hajdukResults, hajduk.data?.results || [], {
    key: 'id',
    dateKey: 'playedAt',
    max: KEEP.hajdukResults,
  });
  store.hajdukResults = hjResults;

  // Fixtures and the table are complete snapshots; keep the last good one.
  if (hajduk.data?.fixtures?.length) store.hajdukFixtures = hajduk.data.fixtures;
  if (hajduk.data?.standings?.length) store.hajdukStandings = hajduk.data.standings;

  const fixtures = store.hajdukFixtures || [];
  const upcoming = fixtures.filter((f) => !f.startsAt || new Date(f.startsAt) >= new Date(Date.now() - 2 * 3600e3));
  const hjSources = hajduk.data?.sources || [failed('hajduk.hr', hajduk.error)];
  allSources.push(...hjSources);

  await write('hajduk.json', {
    generatedAt,
    club: 'HNK Hajduk Split',
    news: dedupeArticles(hjNews).slice(0, PUBLISH.hajdukNews),
    nextMatch: upcoming[0] || null,
    fixtures: upcoming,
    results: hjResults.filter((r) => !r.friendly).slice(0, PUBLISH.hajdukResults),
    friendlies: hjResults.filter((r) => r.friendly).slice(0, 3),
    standings: store.hajdukStandings || [],
    sources: hjSources,
  });

  /* ------------------------------------------------------------ Vrijeme */
  if (weather.data?.places?.length) store.weather = weather.data;
  const wx = store.weather || { places: [], endpoints: {} };
  const wxSources = weather.data?.sources || [failed('Open-Meteo', weather.error)];
  allSources.push(...wxSources);

  await write('weather.json', {
    generatedAt: weather.data ? generatedAt : store.weatherGeneratedAt || generatedAt,
    places: wx.places,
    endpoints: wx.endpoints,
    sources: wxSources,
  });
  if (weather.data) store.weatherGeneratedAt = generatedAt;

  /* --------------------------------------------------------------- meta */
  const failures = allSources.filter((s) => s && s.ok === false);
  await write('meta.json', {
    generatedAt,
    version: `${generatedAt.slice(0, 16).replace(/[-:T]/g, '')}`,
    tabs: [
      { id: 'dubrovnik', label: 'Dubrovnik', count: duItems.length },
      { id: 'hajduk', label: 'Hajduk', count: upcoming.length + hjResults.length },
      { id: 'vrijeme', label: 'Vrijeme', count: wx.places.length },
    ],
    sources: allSources,
    healthy: failures.length === 0,
  });

  await saveStore(STORE, store);

  /* ------------------------------------------------------------- report */
  console.log('Izvori:');
  for (const s of allSources) {
    console.log(
      `  ${s.ok ? 'ok  ' : 'GREŠKA'} ${String(s.name).padEnd(22)} ${
        s.ok ? `${s.count} zapisa` : s.error
      }`
    );
  }
  console.log(
    `\nZapisano u public/data: ${duItems.length} vijesti (Dubrovnik), ` +
      `${upcoming.length} utakmica + ${hjResults.length} rezultata (Hajduk), ` +
      `${wx.places.length} grada (Vrijeme).`
  );
  if (failures.length) {
    console.log(
      `\n${failures.length} izvor(a) nije odgovorio/a — objavljeni su zadnji ispravni podaci iz data/store.json.`
    );
  }
  console.log(`Trajanje: ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

  if (!duItems.length && !fixtures.length && !wx.places.length) {
    console.error('Nijedan izvor nije vratio podatke.');
    process.exit(1);
  }
}

async function settle(label, fn) {
  try {
    return { data: await fn() };
  } catch (err) {
    console.error(`  ! ${label}: ${err.message}`);
    return { error: err };
  }
}

async function write(name, payload) {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, name), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

const failed = (name, error) => ({
  name,
  ok: false,
  count: 0,
  error: String(error?.message || error || 'nepoznata greška').slice(0, 160),
});

function isToday(item) {
  if (!item.publishedAt) return false;
  const local = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' });
  return local(new Date(item.publishedAt)) === local(new Date());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
