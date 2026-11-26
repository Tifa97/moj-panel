import { el, $, replaceChildren, icon } from './dom.js';
import { relative, longDate } from './format.js';
import { forecastUrl, normalise } from './openmeteo.js';
import { allPlaces, addPlace, removePlace, searchPlaces } from './places.js';
import * as notify from './notify.js';
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
  /**
   * Live forecasts live in their own slot. The weather payload only ever
   * carries the two built-in cities, so letting it land in state.data would
   * wipe the places the user added whenever a panel load finished last.
   */
  weatherPlaces: null,
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
  // Match-day alerts must not depend on which panel happens to be open.
  if (notify.isEnabled() && state.tab !== 'hajduk') load('hajduk');
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
    // Every sync is a chance to spot a match today or a fresh result.
    if (id === 'hajduk') notify.check(state.data[id]);
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
 * server at all: ask it directly for every configured place. The two built-in
 * cities also exist in the build snapshot; places the user added live only
 * here, so a failed fetch falls back to whatever is already on screen.
 */
async function refreshWeatherLive(force = false) {
  const wanted = allPlaces();
  const known = state.weatherPlaces || [];
  const sameSet = known.map((p) => p.id).join(',') === wanted.map((p) => p.id).join(',');

  if (!navigator.onLine) {
    if (!sameSet) {
      state.weatherPlaces = wanted.map((p) => knownOr(p, { ...p, error: true }));
      if (state.tab === 'vrijeme') render('vrijeme');
    }
    return;
  }
  if (state.weatherLive && sameSet && !force) return;

  const settled = await Promise.allSettled(
    wanted.map(async (place) => {
      const res = await fetch(forecastUrl(place));
      if (!res.ok) throw new Error(String(res.status));
      return { ...place, ...normalise(place, await res.json()) };
    })
  );

  const places = settled.map((result, i) =>
    result.status === 'fulfilled'
      ? result.value
      : knownOr(wanted[i], { ...wanted[i], error: true })
  );
  const failed = places.filter((p) => p.error).length;

  state.weatherPlaces = places;
  state.weatherLive = failed < places.length;
  state.weatherGeneratedAt = new Date().toISOString();
  state.weatherFailed = failed;
  if (state.tab === 'vrijeme') render('vrijeme');
}

/** Keep the last good forecast for a place rather than blanking the card. */
function knownOr(place, fallback) {
  const previous = (state.weatherPlaces || []).find((p) => p.id === place.id);
  return previous?.days?.length ? previous : fallback;
}

/** Live forecasts win; the build snapshot is the cold-start fallback. */
function weatherViewData() {
  const payload = state.data.vrijeme || {};
  if (!state.weatherPlaces) return payload;

  const failed = state.weatherFailed || 0;
  return {
    ...payload,
    places: state.weatherPlaces,
    generatedAt: state.weatherGeneratedAt || payload.generatedAt,
    sources: [
      {
        name: 'Open-Meteo (uživo)',
        home: 'https://open-meteo.com',
        ok: failed === 0,
        count: state.weatherPlaces.length - failed,
        error: failed ? `${failed} mjesto/a nije odgovorilo` : undefined,
      },
    ],
  };
}

/* ------------------------------------------------------------ rendering */

function render(id) {
  const data = state.data[id];
  if (!data) return;

  if (id === 'dubrovnik') replaceChildren(panels[id], renderDubrovnik(data));
  else if (id === 'hajduk')
    replaceChildren(
      panels[id],
      renderHajduk(data, {
        notify: {
          supported: notify.supported(),
          permission: notify.permission(),
          enabled: notify.isEnabled(),
        },
        onNotifyToggle: toggleNotifications,
      })
    );
  else
    replaceChildren(
      panels[id],
      renderWeather(weatherViewData(), {
        live: state.weatherLive,
        activeCity: state.activeCity,
        onCityChange: selectCity,
        onSearch: searchPlaces,
        onAdd: (place) => {
          addPlace(place);
          selectCity(place.id, { rerender: false });
          refreshWeatherLive(true);
        },
        onRemove: (place) => {
          removePlace(place.id);
          state.weatherPlaces = (state.weatherPlaces || []).filter((p) => p.id !== place.id);
          if (state.activeCity === place.id) {
            state.activeCity = allPlaces()[0]?.id || '';
            localStorage.setItem('cip:city', state.activeCity);
          }
          render('vrijeme');
        },
      })
    );
}

async function toggleNotifications(turnOn) {
  if (turnOn) {
    const outcome = await notify.enable(state.data.hajduk);
    render('hajduk');
    if (outcome === 'granted') notify.check(state.data.hajduk);
  } else {
    notify.disable();
    render('hajduk');
  }
}

function selectCity(id, { rerender = true } = {}) {
  state.activeCity = id;
  localStorage.setItem('cip:city', id);
  if (rerender) render('vrijeme');
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
