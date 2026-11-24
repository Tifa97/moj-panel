/**
 * The data pipeline, shared by the two things that need it:
 *
 *   refresh.mjs  — runs it once and writes public/data/*.json
 *   serve.mjs    — runs it on demand behind /api/*.json, so opening or
 *                  refreshing the app pulls fresh data
 *
 * Both go through the same store, so whichever one runs keeps accumulating
 * the same history.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { collectDubrovnik } from '../sources/dubrovnik.mjs';
import { collectHajduk } from '../sources/hajduk.mjs';
import { collectWeather } from '../sources/weather.mjs';
import { loadStore, saveStore, mergeRecords } from './store.mjs';
import { dedupeArticles } from './dedupe.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STORE_PATH = join(ROOT, 'data', 'store.json');
export const OUT_DIR = join(ROOT, 'public', 'data');

const PUBLISH = { dubrovnikNews: 24, hajdukNews: 20, hajdukResults: 8 };
const KEEP = { dubrovnikNews: 80, hajdukNews: 80, hajdukResults: 60 };

/** Serialises store writes so a manual refresh and a request can overlap. */
let inFlight = Promise.resolve();

export function buildPayloads(options = {}) {
  const run = inFlight.then(
    () => build(options),
    () => build(options)
  );
  inFlight = run.catch(() => {});
  return run;
}

async function build({ live = false, storePath = STORE_PATH } = {}) {
  const [dubrovnik, hajduk, weather] = await Promise.all([
    settle(collectDubrovnik),
    settle(collectHajduk),
    settle(collectWeather),
  ]);

  const store = await loadStore(storePath);
  const generatedAt = new Date().toISOString();
  const allSources = [];

  /* ------------------------------------------------------------ Dubrovnik */
  store.dubrovnikNews = mergeRecords(store.dubrovnikNews, dubrovnik.data?.items || [], {
    dateKey: 'publishedAt',
    max: KEEP.dubrovnikNews,
  });
  const duItems = dedupeArticles(store.dubrovnikNews).slice(0, PUBLISH.dubrovnikNews);
  const duSources = dubrovnik.data?.sources || [failed('Dubrovnik feeds', dubrovnik.error)];
  allSources.push(...duSources);

  /* --------------------------------------------------------------- Hajduk */
  store.hajdukNews = mergeRecords(store.hajdukNews, hajduk.data?.news || [], {
    dateKey: 'publishedAt',
    max: KEEP.hajdukNews,
  });
  store.hajdukResults = mergeRecords(store.hajdukResults, hajduk.data?.results || [], {
    key: 'id',
    dateKey: 'playedAt',
    max: KEEP.hajdukResults,
  });

  // Fixtures and the table are complete snapshots; keep the last good one.
  if (hajduk.data?.fixtures?.length) store.hajdukFixtures = hajduk.data.fixtures;
  if (hajduk.data?.standings?.length) store.hajdukStandings = hajduk.data.standings;

  const fixtures = store.hajdukFixtures || [];
  const upcoming = fixtures.filter(
    (f) => !f.startsAt || new Date(f.startsAt) >= new Date(Date.now() - 2 * 3600e3)
  );
  const hjSources = hajduk.data?.sources || [failed('hajduk.hr', hajduk.error)];
  allSources.push(...hjSources);

  /* -------------------------------------------------------------- Vrijeme */
  if (weather.data?.places?.length) {
    store.weather = weather.data;
    store.weatherGeneratedAt = generatedAt;
  }
  const wx = store.weather || { places: [], endpoints: {} };
  const wxSources = weather.data?.sources || [failed('Open-Meteo', weather.error)];
  allSources.push(...wxSources);

  await saveStore(storePath, store);

  const failures = allSources.filter((s) => s && s.ok === false);

  const payloads = {
    dubrovnik: {
      generatedAt,
      live,
      city: 'Dubrovnik',
      items: duItems,
      counts: { total: duItems.length, today: duItems.filter(isToday).length },
      sources: duSources,
    },
    hajduk: {
      generatedAt,
      live,
      club: 'HNK Hajduk Split',
      news: dedupeArticles(store.hajdukNews).slice(0, PUBLISH.hajdukNews),
      nextMatch: upcoming[0] || null,
      fixtures: upcoming,
      results: store.hajdukResults.filter((r) => !r.friendly).slice(0, PUBLISH.hajdukResults),
      friendlies: store.hajdukResults.filter((r) => r.friendly).slice(0, 3),
      standings: store.hajdukStandings || [],
      sources: hjSources,
    },
    weather: {
      generatedAt: weather.data ? generatedAt : store.weatherGeneratedAt || generatedAt,
      live,
      places: wx.places,
      endpoints: wx.endpoints,
      sources: wxSources,
    },
    meta: {
      generatedAt,
      live,
      version: generatedAt.slice(0, 16).replace(/[-:T]/g, ''),
      tabs: [
        { id: 'dubrovnik', label: 'Dubrovnik', count: duItems.length },
        { id: 'hajduk', label: 'Hajduk', count: upcoming.length + store.hajdukResults.length },
        { id: 'vrijeme', label: 'Vrijeme', count: wx.places.length },
      ],
      sources: allSources,
      healthy: failures.length === 0,
    },
  };

  return {
    payloads,
    sources: allSources,
    failures,
    counts: {
      dubrovnik: duItems.length,
      fixtures: upcoming.length,
      results: store.hajdukResults.length,
      places: wx.places.length,
    },
    empty: !duItems.length && !fixtures.length && !wx.places.length,
  };
}

async function settle(fn) {
  try {
    return { data: await fn() };
  } catch (error) {
    return { error };
  }
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
