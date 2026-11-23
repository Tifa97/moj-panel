import { fold } from './text.mjs';

const STOP = new Set([
  'ovaj', 'ovog', 'kojeg', 'koja', 'koje', 'koji', 'nakon', 'zbog', 'protiv',
  'danas', 'jucer', 'sutra', 'godine', 'preko', 'kako', 'sada', 'jedan',
  'prema', 'vise', 'samo', 'ipak', 'biti', 'bilo', 'nije', 'svoje', 'svoju',
]);

/** Significant words of a headline, folded and without stopwords. */
function signature(title) {
  return new Set(
    fold(title)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !STOP.has(w))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Drops repeats of the same story. Local portals routinely run the same wire
 * item under slightly reworded headlines, so exact matching is not enough.
 */
export function dedupeArticles(items, { threshold = 0.5 } = {}) {
  const seenLinks = new Set();
  const kept = [];
  for (const it of items) {
    const link = (it.link || '').replace(/[?#].*$/, '');
    if (seenLinks.has(link)) continue;
    const sig = signature(it.title || '');
    if (kept.some((k) => jaccard(k.sig, sig) >= threshold)) continue;
    seenLinks.add(link);
    kept.push({ sig, item: it });
  }
  return kept.map((k) => k.item);
}
