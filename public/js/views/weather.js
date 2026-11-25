import { el, icon } from '../dom.js';
import { describe } from '../weather-codes.js';
import {
  longDate, time, weekdayShort, dayMonthNumeric, dayHeading,
  daysFromToday, temp, windDirection, relative,
} from '../format.js';
import { describePlace, isFull, PERMANENT } from '../places.js';
import { sourceStrip, emptyState } from './shared.js';

const HOURS_AHEAD = 14;
const SEARCH_DEBOUNCE = 350;

export function renderWeather(data, handlers = {}) {
  const { live = false, activeCity, onCityChange, onSearch, onAdd, onRemove } = handlers;
  const places = data?.places || [];

  if (!places.length) {
    return emptyState('Nema prognoze', 'Pokreni `npm run refresh` ili provjeri vezu.');
  }

  const current = places.some((p) => p.id === activeCity) ? activeCity : places[0].id;
  const search = searchPanel({ onSearch, onAdd });

  return el(
    'div.stack',
    null,
    el(
      'header.hero.hero--wx',
      null,
      el('p.hero__date', { text: longDate() }),
      el('h1.hero__title', null, 'Vrijeme'),
      el(
        'p.hero__sub',
        null,
        live
          ? el('span.pill.pill--live', null, el('span.pill__dot'), 'uživo')
          : el('span.pill', { text: 'spremljeno' }),
        el('span.dot'),
        `${places.length} ${places.length === 1 ? 'mjesto' : 'mjesta'}`
      )
    ),
    el(
      'div.wx-actions',
      null,
      el(
        'div.citybar',
        { role: 'tablist', 'aria-label': 'Mjesto' },
        ...places.map((p) =>
          el('button.citybar__btn', {
            type: 'button',
            role: 'tab',
            'aria-selected': String(p.id === current),
            class: p.id === current ? 'is-active' : '',
            text: p.name,
            onclick: () => onCityChange?.(p.id),
          })
        )
      ),
      el(
        'button.addbtn',
        {
          type: 'button',
          disabled: isFull(),
          title: isFull() ? 'Dosegnut je maksimalan broj mjesta' : 'Dodaj mjesto',
          onclick: () => search.toggle(),
        },
        icon('plus'),
        el('span', { text: 'Dodaj mjesto' })
      )
    ),
    search.node,
    el(
      'div.wx-grid',
      { dataset: { activeCity: current } },
      ...places.map((p) => cityCard(p, onRemove, p.id === current))
    ),
    sourceStrip(data.sources, data.generatedAt)
  );
}

/* --------------------------------------------------------- add a place */

function searchPanel({ onSearch, onAdd }) {
  const input = el('input.placesearch__input', {
    type: 'search',
    placeholder: 'Npr. Split, Beč, Lisabon…',
    'aria-label': 'Traži mjesto',
    autocomplete: 'off',
  });
  const results = el('div.placesearch__results');
  const node = el('div.placesearch', { hidden: true }, el(
    'div.placesearch__row',
    null,
    icon('search', 'icon placesearch__icon'),
    input
  ), results);

  let timer = null;
  let inflight = null;

  const status = (text, kind = '') =>
    results.replaceChildren(el('p.placesearch__status', { class: kind, text }));

  const run = async () => {
    const query = input.value.trim();
    if (query.length < 2) {
      results.replaceChildren();
      return;
    }
    // One request at a time; typing cancels the previous one.
    inflight?.abort();
    inflight = new AbortController();
    status('Tražim…', 'is-muted');

    try {
      const found = await onSearch(query, { signal: inflight.signal });
      if (!found.length) {
        status('Ništa nije pronađeno. Pokušaj s punim imenom mjesta.');
        return;
      }
      results.replaceChildren(
        ...found.map((place) =>
          el(
            'button.placeresult',
            {
              type: 'button',
              onclick: () => {
                onAdd?.(place);
                input.value = '';
                results.replaceChildren();
                node.hidden = true;
              },
            },
            el('span.placeresult__name', { text: place.name }),
            el('span.placeresult__where', { text: describePlace(place) }),
            icon('plus', 'icon placeresult__icon')
          )
        )
      );
    } catch (err) {
      if (err.name === 'AbortError') return;
      status(`Pretraga nije uspjela: ${err.message}`, 'is-error');
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, SEARCH_DEBOUNCE);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      run();
    }
    if (e.key === 'Escape') node.hidden = true;
  });

  return {
    node,
    toggle() {
      node.hidden = !node.hidden;
      if (!node.hidden) input.focus();
    },
  };
}

/* ---------------------------------------------------------- city cards */

function cityCard(place, onRemove, isActive) {
  if (place.error) return unavailableCard(place, onRemove, isActive);

  const now = place.current || {};
  const cond = describe(now.code, now.isDay);
  const today = place.days?.[0];

  return el(
    'article.wx',
    { dataset: { city: place.id, active: String(isActive) } },
    el(
      'div.wx__now',
      null,
      el('div.wx__symbol', null, icon(`wx-${cond.symbol}`, 'icon wx__icon')),
      el(
        'div.wx__reading',
        null,
        el(
          'h2.wx__city',
          null,
          place.name,
          place.region ? el('span.wx__region', { text: describePlace(place) }) : null
        ),
        el('p.wx__temp', { text: temp(now.temp) }),
        el('p.wx__cond', { text: cond.label }),
        now.feelsLike != null && el('p.wx__feels', { text: `osjet ${temp(now.feelsLike)}` })
      ),
      removeButton(place, onRemove)
    ),
    el(
      'div.wx__metrics',
      null,
      metric('wind', 'Vjetar', now.wind != null ? `${now.wind} ${place.units?.wind || 'km/h'}` : '–', windDirection(now.windDir)),
      metric('drop', 'Vlaga', now.humidity != null ? `${now.humidity}%` : '–'),
      metric('umbrella', 'Oborine danas', today?.precipProb != null ? `${today.precipProb}%` : '–', today?.precipSum ? `${today.precipSum} mm` : ''),
      metric('sunrise', 'Izlaz / zalaz', today ? `${time(today.sunrise)} / ${time(today.sunset)}` : '–')
    ),
    hourStrip(place),
    forecastList(place)
  );
}

function unavailableCard(place, onRemove, isActive) {
  return el(
    'article.wx.wx--error',
    { dataset: { city: place.id, active: String(isActive) } },
    el(
      'div.wx__now',
      null,
      el('div.wx__symbol', null, icon('warning', 'icon wx__icon')),
      el(
        'div.wx__reading',
        null,
        el('h2.wx__city', null, place.name, place.region ? el('span.wx__region', { text: describePlace(place) }) : null),
        el('p.wx__cond', { text: 'Prognoza trenutno nije dostupna' }),
        el('p.wx__feels', { text: 'Pokušaj osvježiti kad budeš online.' })
      ),
      removeButton(place, onRemove)
    )
  );
}

// Places served from the build snapshot carry no `permanent` flag, so decide
// by id: Dubrovnik and Zagreb are never removable, wherever the data came from.
const PERMANENT_IDS = new Set(PERMANENT.map((p) => p.id));

function removeButton(place, onRemove) {
  if (place.permanent || PERMANENT_IDS.has(place.id) || !onRemove) return null;
  return el(
    'button.wx__remove',
    {
      type: 'button',
      title: `Ukloni ${place.name}`,
      'aria-label': `Ukloni ${place.name}`,
      onclick: () => onRemove(place),
    },
    icon('close')
  );
}

/** Two lines exactly, so the four tiles line up across the city cards. */
const metric = (symbol, label, value, note) =>
  el(
    'div.metric',
    null,
    icon(symbol, 'icon metric__icon'),
    el(
      'div.metric__text',
      null,
      el('span.metric__label', { text: label }),
      el(
        'span.metric__value',
        null,
        value,
        note ? el('span.metric__note', { text: note }) : null
      )
    )
  );

function hourStrip(place) {
  const upcoming = (place.hours || [])
    .filter((h) => new Date(h.time).getTime() >= Date.now() - 3600e3)
    .slice(0, HOURS_AHEAD);
  if (!upcoming.length) return null;

  return el(
    'div.hours',
    null,
    el('h3.wx__sub', { text: 'Po satima' }),
    el(
      'div.hours__scroll',
      null,
      ...upcoming.map((h, i) => {
        const cond = describe(h.code, isDaylight(h.time, place.days?.[0]));
        return el(
          'div.hour',
          { class: i === 0 ? 'is-now' : '' },
          el('span.hour__time', { text: i === 0 ? 'sad' : time(h.time) }),
          icon(`wx-${cond.symbol}`, 'icon hour__icon'),
          el('span.hour__temp', { text: temp(h.temp) }),
          el('span.hour__rain', { class: h.precipProb >= 30 ? 'is-wet' : '', text: h.precipProb != null ? `${h.precipProb}%` : '' })
        );
      })
    )
  );
}

function isDaylight(iso, today) {
  if (!today?.sunrise || !today?.sunset) return true;
  const t = new Date(iso).getHours();
  return t >= new Date(today.sunrise).getHours() && t < new Date(today.sunset).getHours();
}

function forecastList(place) {
  const days = place.days || [];
  if (!days.length) return null;

  const floor = Math.min(...days.map((d) => d.min).filter((v) => v != null));
  const ceil = Math.max(...days.map((d) => d.max).filter((v) => v != null));
  const span = Math.max(1, ceil - floor);

  return el(
    'div.forecast',
    null,
    el('h3.wx__sub', { text: '7 dana' }),
    el(
      'ul.days',
      null,
      ...days.map((d) => {
        const cond = describe(d.code, true);
        const offset = ((d.min - floor) / span) * 100;
        const width = ((d.max - d.min) / span) * 100;
        return el(
          'li.day',
          { class: daysFromToday(d.date) === 0 ? 'is-today' : '' },
          el(
            'span.day__name',
            null,
            el('span.day__wd', { text: daysFromToday(d.date) === 0 ? 'Danas' : weekdayShort(d.date) }),
            el('span.day__date', { text: dayMonthNumeric(d.date) })
          ),
          el('span.day__icon', { title: cond.label }, icon(`wx-${cond.symbol}`, 'icon')),
          el('span.day__rain', { class: d.precipProb >= 30 ? 'is-wet' : '', text: d.precipProb ? `${d.precipProb}%` : '' }),
          el('span.day__min', { text: temp(d.min) }),
          el('span.day__bar', null, el('span.day__range', { style: `left:${offset}%;width:${Math.max(width, 6)}%` })),
          el('span.day__max', { text: temp(d.max) })
        );
      })
    ),
    el('p.note', null, icon('info'), `Prognoza: Open-Meteo · ${dayHeading(days[0].date)} – ${dayMonthNumeric(days.at(-1).date)}`)
  );
}
