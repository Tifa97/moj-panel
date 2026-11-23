import { el, icon } from '../dom.js';
import { relative } from '../format.js';

/** Transparency footer: which feeds this panel was built from, and when. */
export function sourceStrip(sources = [], generatedAt) {
  const chips = sources.map((s) =>
    el(
      s.home ? 'a.src' : 'span.src',
      {
        class: s.ok === false ? 'src--down' : '',
        href: s.home || null,
        target: s.home ? '_blank' : null,
        rel: s.home ? 'noopener' : null,
        title: s.ok === false ? s.error : s.note || `${s.count} zapisa`,
      },
      el('span.src__dot'),
      s.name,
      s.ok === false ? ' · nedostupno' : ''
    )
  );

  return el(
    'footer.sources',
    null,
    el('p.sources__label', null, icon('database'), 'Izvori'),
    el('div.sources__list', null, ...chips),
    generatedAt &&
      el('p.sources__time', null, 'Podaci osvježeni ', relative(generatedAt))
  );
}

export function emptyState(title, hint) {
  return el(
    'div.empty',
    null,
    icon('inbox', 'icon empty__icon'),
    el('h2.empty__title', { text: title }),
    hint && el('p.empty__hint', { text: hint })
  );
}

export function sectionTitle(text, trailing) {
  return el('h2.group__title', null, text, trailing && el('span.group__count', null, trailing));
}
