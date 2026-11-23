import { getText } from '../lib/http.mjs';
import { parseFeed } from '../lib/xml.mjs';
import { truncate } from '../lib/text.mjs';
import { dedupeArticles } from '../lib/dedupe.mjs';

const FEEDS = [
  { name: 'DuList', home: 'https://dulist.hr', url: 'https://dulist.hr/feed/' },
  {
    name: 'DubrovnikNet',
    home: 'https://www.dubrovniknet.hr',
    url: 'https://www.dubrovniknet.hr/feed/',
  },
];

const MAX_ITEMS = 24;

export async function collectDubrovnik() {
  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => parseFeed(await getText(f.url)))
  );

  const sources = [];
  const pool = [];

  settled.forEach((res, i) => {
    const feed = FEEDS[i];
    if (res.status !== 'fulfilled') {
      sources.push({
        name: feed.name,
        home: feed.home,
        ok: false,
        count: 0,
        error: String(res.reason?.message || res.reason).slice(0, 160),
      });
      return;
    }
    const mapped = res.value.items
      .filter((it) => it.title && it.link)
      .map((it) => ({
        title: it.title,
        link: it.link,
        source: feed.name,
        sourceHome: feed.home,
        publishedAt: it.publishedAt,
        summary: truncate(it.summary, 190),
        image: it.image || '',
      }));
    sources.push({ name: feed.name, home: feed.home, ok: true, count: mapped.length });
    pool.push(...mapped);
  });

  pool.sort((a, b) => ts(b.publishedAt) - ts(a.publishedAt));
  const items = dedupeArticles(pool).slice(0, MAX_ITEMS);

  return {
    city: 'Dubrovnik',
    sources,
    items,
    counts: { total: items.length, today: items.filter(isToday).length },
  };
}

const ts = (iso) => (iso ? new Date(iso).getTime() : 0);

function isToday(it) {
  if (!it.publishedAt) return false;
  const local = (x) => x.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' });
  return local(new Date(it.publishedAt)) === local(new Date());
}
