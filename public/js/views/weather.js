import { el, icon } from '../dom.js';
import { describe } from '../weather-codes.js';
import {
  longDate, time, weekdayShort, dayMonthNumeric, dayHeading,
  daysFromToday, temp, windDirection, relative,
} from '../format.js';
import { sourceStrip, emptyState } from './shared.js';

const HOURS_AHEAD = 14;

export function renderWeather(data, { live = false, onCityChange, activeCity } = {}) {
  const places = data?.places || [];
  if (!places.length) {
    return emptyState('Nema prognoze', 'Pokreni `npm run refresh` ili provjeri vezu.');
  }

  const current = activeCity && places.some((p) => p.id === activeCity) ? activeCity : places[0].id;

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
        places.map((p) => p.name).join(' i ')
      )
    ),
    el(
      'div.citybar',
      { role: 'tablist', 'aria-label': 'Grad' },
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
    el('div.wx-grid', { dataset: { activeCity: current } }, ...places.map(cityCard)),
    sourceStrip(data.sources, data.generatedAt)
  );
}

function cityCard(place) {
  const now = place.current || {};
  const cond = describe(now.code, now.isDay);
  const today = place.days?.[0];

  return el(
    'article.wx',
    { dataset: { city: place.id } },
    el(
      'div.wx__now',
      null,
      el('div.wx__symbol', null, icon(`wx-${cond.symbol}`, 'icon wx__icon')),
      el(
        'div.wx__reading',
        null,
        el('h2.wx__city', { text: place.name }),
        el('p.wx__temp', { text: temp(now.temp) }),
        el('p.wx__cond', { text: cond.label }),
        now.feelsLike != null && el('p.wx__feels', { text: `osjet ${temp(now.feelsLike)}` })
      )
    ),
    el(
      'div.wx__metrics',
      null,
      metric('wind', 'Vjetar', now.wind != null ? `${now.wind} ${place.units.wind}` : '–', windDirection(now.windDir)),
      metric('drop', 'Vlaga', now.humidity != null ? `${now.humidity}%` : '–'),
      metric('umbrella', 'Oborine danas', today?.precipProb != null ? `${today.precipProb}%` : '–', today?.precipSum ? `${today.precipSum} mm` : ''),
      metric('sunrise', 'Izlaz / zalaz', today ? `${time(today.sunrise)} / ${time(today.sunset)}` : '–')
    ),
    hourStrip(place),
    forecastList(place)
  );
}

/** Two lines exactly, so the four tiles line up across both city cards. */
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

  const lows = days.map((d) => d.min).filter((v) => v != null);
  const highs = days.map((d) => d.max).filter((v) => v != null);
  const floor = Math.min(...lows);
  const ceil = Math.max(...highs);
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
          el(
            'span.day__bar',
            null,
            el('span.day__range', { style: `left:${offset}%;width:${Math.max(width, 6)}%` })
          ),
          el('span.day__max', { text: temp(d.max) })
        );
      })
    ),
    el('p.note', null, icon('info'), `Prognoza: Open-Meteo · ${dayHeading(days[0].date)} – ${dayMonthNumeric(days.at(-1).date)}`)
  );
}
