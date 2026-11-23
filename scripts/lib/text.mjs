const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', laquo: '\u00ab',
  raquo: '\u00bb', bdquo: '\u201e', ldquo: '\u201c', rdquo: '\u201d',
  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201a', deg: '\u00b0',
  eacute: '\u00e9', egrave: '\u00e8', iacute: '\u00ed', oacute: '\u00f3',
  uacute: '\u00fa', aacute: '\u00e1', ccedil: '\u00e7', euro: '\u20ac',
  middot: '\u00b7', bull: '\u2022', prime: '\u2032', times: '\u00d7',
};

/** Decodes numeric and the common named HTML entities. */
export function decodeEntities(input = '') {
  return String(input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : m
    );
}

const safeChar = (cp) => (Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : '');

/** Strips tags, decodes entities, collapses whitespace. */
export function toPlainText(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(str = '', max = 180) {
  // Feeds often already end in "..."; one ellipsis is enough.
  const s = String(str).trim().replace(/\s*(\.{2,}|…)$/, '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '') + '\u2026';
}

/** Normalised form for loose matching: lowercase, no diacritics. */
export function fold(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/[\u0107\u0109]/g, 'c')
    .replace(/\u010d/g, 'c')
    .replace(/\u0111/g, 'd')
    .replace(/\u017e/g, 'z')
    .replace(/\u0161/g, 's')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
