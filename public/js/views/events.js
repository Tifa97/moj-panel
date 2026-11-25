import { el, icon, groupBy } from '../dom.js';
import { dayHeading, dayKey, time, plural } from '../format.js';
import { sectionTitle } from './shared.js';

/** How many events to show before the "show all" toggle. */
const PREVIEW = 6;

export function eventsSection(events = []) {
  if (!events.length) return null;

  const body = el('div.events');
  const toggle = el('button.more', { type: 'button' });

  let expanded = false;
  const paint = () => {
    const shown = expanded ? events : events.slice(0, PREVIEW);
    body.replaceChildren(...byDay(shown));
    toggle.replaceChildren(
      document.createTextNode(
        expanded
          ? 'Prikaži manje'
          : `Prikaži sve (${events.length})`
      ),
      icon(expanded ? 'chevron-up' : 'chevron-down', 'icon more__icon')
    );
  };

  toggle.addEventListener('click', () => {
    expanded = !expanded;
    paint();
  });
  paint();

  return el(
    'section.group',
    null,
    sectionTitle(
      'Događanja',
      `${events.length} ${plural(events.length, 'događanje', 'događanja', 'događanja')}`
    ),
    body,
    events.length > PREVIEW ? toggle : null
  );
}

function byDay(events) {
  // Long-running exhibitions opened weeks ago; they belong under today.
  const key = (e) => (e.ongoing ? dayKey(new Date()) : dayKey(e.start));

  return groupBy(events, key).map(([day, list]) =>
    el(
      'div.eventday',
      null,
      el('h3.eventday__title', { text: dayHeading(day) }),
      el('ul.eventlist', null, ...list.map(row))
    )
  );
}

function row(event) {
  const when = event.ongoing
    ? 'u tijeku'
    : hasClock(event.start)
      ? time(event.start)
      : 'cijeli dan';

  return el(
    'li.event',
    null,
    el(
      event.url ? 'a.event__link' : 'div.event__link',
      event.url ? { href: event.url, target: '_blank', rel: 'noopener' } : null,
      el('span.event__when', { class: event.ongoing ? 'is-ongoing' : '', text: when }),
      el(
        'span.event__body',
        null,
        el('span.event__title', { text: event.title }),
        el(
          'span.event__meta',
          null,
          event.venue && el('span.event__venue', { text: event.venue }),
          event.category && el('span.event__cat', { text: event.category })
        )
      ),
      event.price
        ? el('span.event__price', { text: `${event.price} ${event.currency === 'EUR' ? '€' : event.currency}` })
        : el('span.event__price.is-free', { text: 'besplatno' })
    )
  );
}

/** Some entries carry a date only; those are all-day listings. */
const hasClock = (iso) => typeof iso === 'string' && iso.length > 10;
