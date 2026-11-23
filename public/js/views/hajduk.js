import { el, icon, groupBy } from '../dom.js';
import { relative, time, until, weekdayShort, dayMonthNumeric, plural } from '../format.js';
import { sourceStrip, emptyState, sectionTitle } from './shared.js';

const OUTCOME_LABEL = { W: 'Pobjeda', D: 'Neriješeno', L: 'Poraz' };

export function renderHajduk(data) {
  const fixtures = data?.fixtures || [];
  const standings = data?.standings || [];
  const results = data?.results || [];
  const news = data?.news || [];

  if (!fixtures.length && !standings.length && !news.length) {
    return emptyState('Nema podataka o Hajduku', 'Pokreni `npm run refresh`.');
  }

  const ourRow = standings.find((r) => r.isHajduk);

  return el(
    'div.stack',
    null,
    hero(ourRow),
    data.nextMatch && nextMatchCard(data.nextMatch),
    results.length && resultsSection(results, data.friendlies || []),
    fixtures.length > 1 && fixturesSection(fixtures.slice(1)),
    standings.length && standingsSection(standings),
    news.length && newsSection(news),
    sourceStrip(data.sources, data.generatedAt)
  );
}

function hero(row) {
  return el(
    'header.hero.hero--hajduk',
    null,
    el('p.hero__date', null, 'HNK Hajduk Split', el('span.dot'), 'Poljud, 1911.'),
    el('h1.hero__title', null, 'Hajduk'),
    row &&
      el(
        'div.hero__stats',
        null,
        stat(`${row.position}.`, 'mjesto'),
        stat(row.points, plural(row.points, 'bod', 'boda', 'bodova')),
        stat(`${row.won}-${row.drawn}-${row.lost}`, 'P-N-I'),
        stat(`${row.goalsFor}:${row.goalsAgainst}`, 'golovi')
      )
  );
}

const stat = (value, label) =>
  el('div.stat', null, el('span.stat__value', { text: String(value) }), el('span.stat__label', { text: label }));

/* ---------------------------------------------------------- next match */

function nextMatchCard(m) {
  return el(
    'section.match',
    null,
    el(
      'div.match__top',
      null,
      el('span.badge', { text: m.competitionName || m.competition }),
      m.round && el('span.match__round', { text: m.round }),
      el('span.match__countdown', { text: until(m.startsAt) })
    ),
    el(
      'div.match__teams',
      null,
      teamName(m.home, m.isHome),
      el('span.match__vs', { text: 'vs' }),
      teamName(m.away, !m.isHome)
    ),
    el(
      'div.match__facts',
      null,
      fact('calendar', m.startsAt ? `${weekdayShort(m.startsAt)}, ${dayMonthNumeric(m.startsAt)}` : m.dateText),
      fact('clock', m.timeKnown && m.startsAt ? time(m.startsAt) : 'termin nije potvrđen'),
      fact('pin', m.venue || (m.isHome ? 'Poljud' : 'gostovanje'))
    )
  );
}

const teamName = (name, highlight) =>
  el('span.match__team', { class: highlight ? 'is-us' : '', text: name || '—' });

const fact = (symbol, text) =>
  el('span.fact', null, icon(symbol), el('span', { text: String(text) }));

/* ------------------------------------------------------------- results */

function resultsSection(results, friendlies) {
  return el(
    'section.group',
    null,
    sectionTitle(
      'Rezultati',
      `${results.length} ${plural(results.length, 'utakmica', 'utakmice', 'utakmica')}`
    ),
    el('ul.results', null, ...results.map(resultRow)),
    friendlies.length
      ? el(
          'p.note',
          null,
          icon('info'),
          `Prijateljske: ${friendlies
            .map((f) => `${f.home} ${f.homeScore}:${f.awayScore} ${f.away}`)
            .join(' · ')}`
        )
      : null
  );
}

function resultRow(r) {
  const tone = r.outcome.toLowerCase();
  return el(
    'li.result',
    null,
    el(
      'a.result__link',
      { href: r.link, target: '_blank', rel: 'noopener' },
      el('span.result__dot', { class: `is-${tone}`, title: OUTCOME_LABEL[r.outcome] }),
      el(
        'span.result__body',
        null,
        el('span.result__teams', { text: `${r.home} – ${r.away}` }),
        el(
          'span.result__meta',
          null,
          el('span.result__detail', {
            text: r.detail || (r.isHome ? 'Poljud' : r.note || 'gostovanje'),
          }),
          r.playedAt && el('span.dot'),
          r.playedAt ? dayMonthNumeric(r.playedAt) : ''
        )
      ),
      // Scores follow the team order above, the colour follows Hajduk's result.
      el('span.result__score', { class: `is-${tone}`, text: `${r.homeScore}:${r.awayScore}` })
    )
  );
}

/* ------------------------------------------------------------ fixtures */

function fixturesSection(fixtures) {
  const months = groupBy(fixtures, (f) => f.monthLabel || '');
  return el(
    'section.group',
    null,
    sectionTitle('Raspored', `${fixtures.length} ${plural(fixtures.length, 'utakmica', 'utakmice', 'utakmica')}`),
    ...months.map(([label, list]) =>
      el(
        'div.month',
        null,
        el('h3.month__title', { text: label }),
        el('ul.fixtures', null, ...list.map(fixtureRow))
      )
    )
  );
}

function fixtureRow(f) {
  return el(
    'li.fixture',
    null,
    el(
      'span.fixture__when',
      null,
      el('span.fixture__day', { text: f.startsAt ? dayMonthNumeric(f.startsAt) : '—' }),
      el('span.fixture__time', {
        class: f.timeKnown ? '' : 'is-tbd',
        text: f.timeKnown && f.startsAt ? time(f.startsAt) : 'termin TBD',
      })
    ),
    el(
      'span.fixture__body',
      null,
      el('span.fixture__teams', { text: f.label }),
      el('span.fixture__meta', null, f.competitionName, f.round ? ` · ${f.round}` : '')
    ),
    el('span.fixture__where', { class: f.isHome ? 'is-home' : '', text: f.isHome ? 'DOMA' : 'GOST' })
  );
}

/* ----------------------------------------------------------- standings */

function standingsSection(rows) {
  const head = el(
    'tr',
    null,
    el('th', { text: '#' }),
    el('th.col-club', { text: 'Klub' }),
    el('th', { text: 'U', title: 'Utakmice' }),
    el('th.col-wide', { text: 'P', title: 'Pobjede' }),
    el('th.col-wide', { text: 'N', title: 'Neriješeno' }),
    el('th.col-wide', { text: 'I', title: 'Porazi' }),
    el('th', { text: '+/−', title: 'Gol razlika' }),
    el('th', { text: 'B', title: 'Bodovi' })
  );

  return el(
    'section.group',
    null,
    sectionTitle('SuperSport HNL', 'poredak'),
    el(
      'div.table-wrap',
      null,
      el(
        'table.table',
        null,
        el('thead', null, head),
        el(
          'tbody',
          null,
          ...rows.map((r) =>
            el(
              'tr',
              { class: r.isHajduk ? 'is-us' : '' },
              el('td.col-pos', { text: String(r.position) }),
              el('td.col-club', { text: r.club }),
              el('td', { text: String(r.played) }),
              el('td.col-wide', { text: String(r.won) }),
              el('td.col-wide', { text: String(r.drawn) }),
              el('td.col-wide', { text: String(r.lost) }),
              el('td', { text: r.goalDiff > 0 ? `+${r.goalDiff}` : String(r.goalDiff) }),
              el('td.col-pts', { text: String(r.points) })
            )
          )
        )
      )
    )
  );
}

/* ---------------------------------------------------------------- news */

function newsSection(news) {
  return el(
    'section.group',
    null,
    sectionTitle('Vijesti', `${news.length}`),
    el('ol.news', null, ...news.map(newsRow))
  );
}

function newsRow(item) {
  return el(
    'li.news__item',
    null,
    el(
      'a.news__link',
      { href: item.link, target: '_blank', rel: 'noopener' },
      el('time.news__time', { datetime: item.publishedAt || '', text: relative(item.publishedAt) }),
      el(
        'span.news__body',
        null,
        el('span.news__title', { text: item.title }),
        el(
          'span.news__source',
          { class: item.official ? 'is-official' : '' },
          item.official ? 'službeno · hajduk.hr' : item.source
        )
      ),
      icon('arrow', 'icon news__arrow')
    )
  );
}
