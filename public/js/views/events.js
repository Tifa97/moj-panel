import { el, icon, groupBy } from '../dom.js';
import { dayHeading, dayKey, time, plural } from '../format.js';
import { accordion, daySectionId } from './accordion.js';

export function eventsSection(events = []) {
  if (!events.length) return null;

  // Long-running exhibitions opened weeks ago; they belong under today.
  const key = (e) => (e.ongoing ? dayKey(new Date()) : dayKey(e.start));
  const days = groupBy(events, key);

  return accordion(
    { id: 'du:events', title: 'Događanja', count: events.length },
    ...days.map(([day, list], index) =>
      accordion(
        {
          id: daySectionId('du:events:day', day),
          title: dayHeading(day),
          count: list.length,
          // Today is open; the rest of the fortnight waits to be asked for.
          defaultOpen: index === 0,
          nested: true,
        },
        el('ul.eventlist', null, ...list.map(row))
      )
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
