import { el, $, replaceChildren, icon } from './dom.js';
import { relative, longDate } from './format.js';
import { CITIES, forecastUrl, normalise } from './openmeteo.js';
import { renderDubrovnik } from './views/dubrovnik.js';
import { renderHajduk } from './views/hajduk.js';
import { renderWeather } from './views/weather.js';

const TABS = [
  { id: 'dubrovnik', label: 'Dubrovnik', file: 'data/dubrovnik.json', theme: '#B8902B', symbol: 'city' },
  { id: 'hajduk', label: 'Hajduk', file: 'data/hajduk.json', theme: '#014EA2', symbol: 'ball' },
  { id: 'vrijeme', label: 'Vrijeme', file: 'data/weather.json', theme: '#2D8FD5', symbol: 'sun' },
];

const state = {
  tab: null,
  data: {},
  meta: null,
  weatherLive: false,
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
    state.meta = await fetchJson('data/meta.json');
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
    state.data[id] = await fetchJson(tab.file, force);
    render(id);
    stampUpdated();
  } catch (err) {
    if (!state.data[id]) showError(id, err);
  } finally {
    state.loading.delete(id);
  }
}

const fetchJson = async (url, force = false) => {
  const res = await fetch(force ? `${url}?t=${Date.now()}` : url, {
    cache: force ? 'reload' : 'default',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

async function refresh({ force = false } = {}) {
  const btn = $('#refresh');
  btn.classList.add('is-spinning');
  state.data = {};
  await Promise.all(TABS.map((t) => load(t.id, { force })));
  await loadMeta();
  if (state.tab === 'vrijeme') await refreshWeatherLive(true);
  btn.classList.remove('is-spinning');
}

/**
 * Open-Meteo is CORS-enabled, so the forecast does not have to wait for the
 * next build: ask it directly and fall back to the cached snapshot.
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
      sources: [{ name: 'Open-Meteo (uživo)', home: 'https://open-meteo.com', ok: true, count: places.length }],
    };
    state.weatherLive = true;
    if (state.tab === 'vrijeme') render('vrijeme');
  } catch {
    state.weatherLive = false; // keep the snapshot on screen
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
          ? `Ne mogu učitati ${id}.json (${err.message}). Pokreni "npm run refresh".`
          : 'Nema veze s internetom, a ovaj panel još nije spremljen offline.',
      })
    )
  );
}

function stampUpdated() {
  const when = state.meta?.generatedAt || state.data[state.tab]?.generatedAt;
  $('#updated').textContent = when ? `osvježeno ${relative(when)}` : '';
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
