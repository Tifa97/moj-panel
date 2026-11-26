import { el, icon, groupBy } from '../dom.js';
import { longDate, dayHeading, dayKey, time, relative, plural, hostname } from '../format.js';
import { sourceStrip, emptyState } from './shared.js';
import { eventsSection } from './events.js';
import { accordion } from './accordion.js';

export function renderDubrovnik(data) {
  const items = data?.items || [];
  const events = data?.events || [];
  if (!items.length && !events.length) {
    return emptyState('Nema dohvaćenih vijesti', 'Pokreni `npm run refresh` da povučeš svježe vijesti.');
  }

  const [lead, ...rest] = items;
  const todayCount = data.counts?.today ?? 0;

  return el(
    'div.stack',
    null,
    hero(items.length, todayCount, data.counts?.eventsToday ?? 0),
    lead && leadCard(lead),
    el(
      'div.sections',
      null,
      eventsSection(events),
      rest.length ? newsSection(rest) : null
    ),
    sourceStrip(data.sources, data.generatedAt)
  );
}

function hero(total, today, eventsToday) {
  return el(
    'header.hero',
    null,
    el('p.hero__date', { text: longDate() }),
    el('h1.hero__title', null, 'Dubrovnik ', el('span.hero__accent', { text: 'danas' })),
    el(
      'p.hero__sub',
      null,
      `${today} ${plural(today, 'nova vijest', 'nove vijesti', 'novih vijesti')}`,
      el('span.dot'),
      `${eventsToday} ${plural(eventsToday, 'događanje', 'događanja', 'događanja')} u gradu`,
      el('span.dot'),
      `${total} vijesti u panelu`
    )
  );
}

function leadCard(item) {
  return el(
    'a.lead',
    { href: item.link, target: '_blank', rel: 'noopener', class: item.image ? '' : 'lead--text' },
    item.image &&
      el('div.lead__media', null, el('img', { src: item.image, alt: '', loading: 'lazy' })),
    el(
      'div.lead__body',
      null,
      el('div.lead__meta', null, el('span.chip.chip--accent', { text: item.source }), relative(item.publishedAt)),
      el('h2.lead__title', { text: item.title }),
      item.summary && el('p.lead__summary', { text: item.summary }),
      el('span.lead__cta', null, 'Pročitaj na ' + hostname(item.link), icon('arrow'))
    )
  );
}

function newsSection(items) {
  return accordion(
    { id: 'du:news', title: 'Vijesti', count: items.length },
    ...groupBy(items, (it) => dayKey(it.publishedAt)).map(([day, group]) =>
      el(
        'div.newsday',
        null,
        el(
          'h3.newsday__title',
          null,
          dayHeading(day),
          el('span.newsday__count', {
            text: `${group.length} ${plural(group.length, 'vijest', 'vijesti', 'vijesti')}`,
          })
        ),
        el('ol.news', null, ...group.map(newsRow))
      )
    )
  );
}

function newsRow(item) {
  return el(
    'li.news__item',
    null,
    el(
      'a.news__link',
      { href: item.link, target: '_blank', rel: 'noopener' },
      el('time.news__time', { datetime: item.publishedAt || '', text: time(item.publishedAt) }),
      el(
        'span.news__body',
        null,
        el('span.news__title', { text: item.title }),
        el('span.news__source', { text: item.source })
      ),
      icon('arrow', 'icon news__arrow')
    )
  );
}
