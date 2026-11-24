import { el, $, replaceChildren, icon } from './dom.js';
import { relative, longDate } from './format.js';
import { CITIES, forecastUrl, normalise } from './openmeteo.js';
import { renderDubrovnik } from './views/dubrovnik.js';
import { renderHajduk } from './views/hajduk.js';
import { renderWeather } from './views/weather.js';

const TABS = [
  { id: 'dubrovnik', label: 'Dubrovnik', api: 'dubrovnik', file: 'data/dubrovnik.json', theme: '#B8902B', symbol: 'city' },
  { id: 'hajduk', label: 'Hajduk', api: 'hajduk', file: 'data/hajduk.json', theme: '#014EA2', symbol: 'ball' },
  { id: 'vrijeme', label: 'Vrijeme', api: 'weather', file: 'data/weather.json', theme: '#2D8FD5', symbol: 'sun' },
];

/** Coming back to the app after this long triggers a silent refresh. */
const STALE_AFTER = 5 * 60 * 1000;
/** The API runs the collectors live, so give it room before giving up. */
const API_TIMEOUT = 25000;

const state = {
  tab: null,
  data: {},
  meta: null,
  /** null = not probed yet, true = server has /api, false = static hosting. */
  liveApi: null,
  /** Did the panel on screen come straight off the network this load? */
  servedLive: false,
  weatherLive: false,
  lastLoadedAt: 0,
  activeCity: localStorage.getItem('cip:city') || 'dubrovnik',
  loading: new Set(),
};

const panels = {};

function init() {
  buildTabBar();
  TABS.forEach((t) => {
    panels[t.id] = $(`#panel-${t.id}`);
  });

  $('#refresh').addEventListener('click', () => refresh({ force: true }));
  window.addEventListener('hashchange', () => showTab(tabFromHash()));
  window.addEventListener('online', () => {
    updateConnection();
    refresh({ force: true });
  });
  window.addEventListener('offline', updateConnection);

  // Reopening the installed app should not show yesterday's news.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - state.lastLoadedAt > STALE_AFTER) refresh();
  });

  $('#today').textContent = longDate();
  updateConnection();

  showTab(tabFromHash());
  loadMeta();
  registerServiceWorker();
}

/* -------------------------------------------------------------- routing */

function tabFromHash() {
  const fromHash = location.hash.replace('#', '');
  if (TABS.some((t) => t.id === fromHash)) return fromHash;
  const saved = localStorage.getItem('cip:tab');
  return TABS.some((t) => t.id === saved) ? saved : TABS[0].id;
}

function showTab(id) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  state.tab = tab.id;
  localStorage.setItem('cip:tab', tab.id);
  if (location.hash !== `#${tab.id}`) history.replaceState(null, '', `#${tab.id}`);

  document.body.dataset.tab = tab.id;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', tab.theme);

  for (const t of TABS) {
    const active = t.id === tab.id;
    panels[t.id].hidden = !active;
    const btn = $(`#tab-${t.id}`);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }

  if (!state.data[tab.id]) load(tab.id);
  if (tab.id === 'vrijeme') refreshWeatherLive();
  stampUpdated();
}

function buildTabBar() {
  const bar = $('#tabbar');
  bar.append(
    ...TABS.map((t) =>
      el(
        `button#tab-${t.id}.tab`,
        {
          type: 'button',
          role: 'tab',
          'aria-controls': `panel-${t.id}`,
          dataset: { tab: t.id },
          onclick: () => showTab(t.id),
        },
        icon(t.symbol, 'icon tab__icon'),
        el('span.tab__label', { text: t.label })
      )
    )
  );
}

/* ----------------------------------------------------------------- data */

async function loadMeta() {
  try {
    state.meta = await fetchPanel({ api: 'meta', file: 'data/meta.json' }, false);
    stampUpdated();
  } catch {
    /* meta is advisory only */
  }
}

async function load(id, { force = false } = {}) {
  const tab = TABS.find((t) => t.id === id);
  if (!tab || state.loading.has(id)) return;
  state.loading.add(id);
  if (!state.data[id]) showSkeleton(id);

  try {
    state.data[id] = await fetchPanel(tab, force);
    state.lastLoadedAt = Date.now();
    render(id);
    stampUpdated();
  } catch (err) {
    if (!state.data[id]) showError(id, err);
  } finally {
    state.loading.delete(id);
  }
}

/**
 * Live first: `npm run serve` exposes /api/*.json, which runs the collectors
 * per request. On a static host (or when that server is gone) fall back to
 * the JSON committed by `npm run refresh`.
 */
async function fetchPanel(tab, force) {
  if (state.liveApi !== false) {
    try {
      const data = await fetchJson(
        `api/${tab.api}.json${force ? '?force=1' : ''}`,
        { timeout: API_TIMEOUT, noStore: true }
      );
      state.liveApi = true;
      state.servedLive = true;
      return data;
    } catch (err) {
      // A 404 means this host has no API at all; stop asking. Anything else
      // (server stopped, offline) may recover, so keep trying next time.
      if (err.status === 404) state.liveApi = false;
    }
  }
  state.servedLive = false;
  return fetchJson(tab.file, { force });
}

async function fetchJson(url, { force = false, timeout = 15000, noStore = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(force ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url, {
      cache: noStore ? 'no-store' : force ? 'reload' : 'default',
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function refresh({ force = false } = {}) {
  const btn = $('#refresh');
  btn.classList.add('is-spinning');
  try {
    // Refresh the open panel first so the user sees movement immediately.
    const ordered = [state.tab, ...TABS.map((t) => t.id).filter((id) => id !== state.tab)];
    for (const id of ordered) delete state.data[id];
    await load(ordered[0], { force });
    await Promise.all(ordered.slice(1).map((id) => load(id, { force: false })));
    await loadMeta();
    if (state.tab === 'vrijeme') await refreshWeatherLive(true);
  } finally {
    btn.classList.remove('is-spinning');
  }
}

/**
 * Open-Meteo is CORS-enabled, so the forecast does not have to wait for the
 * server at all: ask it directly and fall back to whatever we were served.
 */
async function refreshWeatherLive(force = false) {
  if (!navigator.onLine) return;
  if (state.weatherLive && !force) return;

  try {
    const places = await Promise.all(
      CITIES.map(async (city) => {
        const res = await fetch(forecastUrl(city));
        if (!res.ok) throw new Error(String(res.status));
        return normalise(city, await res.json());
      })
    );
    state.data.vrijeme = {
      ...(state.data.vrijeme || {}),
      places,
      generatedAt: new Date().toISOString(),
      sources: [
        { name: 'Open-Meteo (uživo)', home: 'https://open-meteo.com', ok: true, count: places.length },
      ],
    };
    state.weatherLive = true;
    if (state.tab === 'vrijeme') render('vrijeme');
  } catch {
    state.weatherLive = false; // keep what we have on screen
  }
}

/* ------------------------------------------------------------ rendering */

function render(id) {
  const data = state.data[id];
  if (!data) return;

  if (id === 'dubrovnik') replaceChildren(panels[id], renderDubrovnik(data));
  else if (id === 'hajduk') replaceChildren(panels[id], renderHajduk(data));
  else
    replaceChildren(
      panels[id],
      renderWeather(data, {
        live: state.weatherLive,
        activeCity: state.activeCity,
        onCityChange: (city) => {
          state.activeCity = city;
          localStorage.setItem('cip:city', city);
          render('vrijeme');
        },
      })
    );
}

function showSkeleton(id) {
  replaceChildren(
    panels[id],
    el(
      'div.stack',
      null,
      el('div.skeleton.skeleton--hero'),
      ...Array.from({ length: 5 }, () => el('div.skeleton.skeleton--row'))
    )
  );
}

function showError(id, err) {
  replaceChildren(
    panels[id],
    el(
      'div.empty',
      null,
      icon('warning', 'icon empty__icon'),
      el('h2.empty__title', { text: 'Podaci nisu dostupni' }),
      el('p.empty__hint', {
        text: navigator.onLine
          ? `Ne mogu učitati ${id} (${err.message}). Pokreni "npm run refresh".`
          : 'Nema veze s internetom, a ovaj panel još nije spremljen offline.',
      })
    )
  );
}

function stampUpdated() {
  const when = state.data[state.tab]?.generatedAt || state.meta?.generatedAt;
  $('#updated').textContent = when ? `osvježeno ${relative(when)}` : '';
  $('#live').hidden = !state.servedLive;
}

function updateConnection() {
  document.body.classList.toggle('is-offline', !navigator.onLine);
  $('#offline').hidden = navigator.onLine;
}

/* ------------------------------------------------------------------ PWA */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // needs http(s)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is a progressive enhancement */
    });
  });
}

// Last: every helper above must be initialised before init() touches it.
init();
