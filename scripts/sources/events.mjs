import { getText } from '../lib/http.mjs';
import { decodeEntities, toPlainText, truncate } from '../lib/text.mjs';
import { TZ } from '../lib/hr-dates.mjs';

const CALENDAR = 'https://dubrovnikdanas.com/kalendar-dogadanja-dubrovnik/';

const MAX_EVENTS = 40;

/**
 * dubrovnikdanas.com publishes its calendar as a schema.org ItemList of
 * Event objects, so there is no HTML to scrape — the structured data has
 * everything: time, venue, category and price. The events themselves come
 * from the tourist board (experiencedubrovnik.com), which is where the
 * links point.
 */
export async function collectEvents() {
  const html = await getText(CALENDAR);
  const graph = extractGraph(html);

  const list = graph.find((node) => node['@type'] === 'ItemList');
  const raw = (list?.itemListElement || [])
    .map((entry) => entry.item)
    .filter((item) => item && item['@type'] === 'Event');

  const events = raw.map(toEvent).filter(Boolean);
  const upcoming = events
    .filter(isUpcoming)
    .sort((a, b) => sortKey(a) - sortKey(b))
    .slice(0, MAX_EVENTS);

  return {
    city: 'Dubrovnik',
    events: upcoming,
    sources: [
      {
        name: 'Kalendar događanja',
        home: CALENDAR,
        ok: true,
        count: upcoming.length,
        note: `${raw.length} u kalendaru, ${upcoming.length} od danas nadalje`,
      },
    ],
  };
}

function extractGraph(html) {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];
  for (const [, body] of blocks) {
    try {
      const parsed = JSON.parse(body.trim());
      const graph = parsed['@graph'] || (Array.isArray(parsed) ? parsed : [parsed]);
      if (graph.some((n) => n['@type'] === 'ItemList')) return graph;
    } catch {
      /* not the block we want */
    }
  }
  return [];
}

function toEvent(item) {
  const title = clean(item.name);
  const start = item.startDate || null;
  if (!title || !start) return null;

  const price = Number(item.offers?.price);
  const end = item.endDate || null;

  return {
    title,
    url: item.url || '',
    start,
    end,
    // The description is "Category, Venue, date at time" — the category is
    // the only part not already present as a field.
    category: clean(String(item.description || '').split(',')[0]),
    venue: clean(item.location?.name) || '',
    free: Number.isFinite(price) && price === 0,
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: item.offers?.priceCurrency || 'EUR',
    cancelled: String(item.eventStatus || '').includes('Cancelled'),
    // Long-running exhibitions started weeks ago but are still on today.
    ongoing: startedBeforeToday(start),
    summary: truncate(clean(item.description), 120),
  };
}

/**
 * Keep anything that has not finished yet, in Zagreb local days.
 *
 * Long-running exhibitions are a special case: the structured data gives
 * them an endDate equal to their opening day even though the page lists
 * them as running "do 19.1.". The calendar only carries current and future
 * entries, so an item that started earlier and is still listed is still on.
 */
function isUpcoming(event) {
  if (event.ongoing) return true;
  const today = dayKey(new Date());
  return dayKey(new Date(event.end || event.start)) >= today;
}

/** Ongoing exhibitions sort by today, not by the day they opened. */
function sortKey(event) {
  const start = new Date(event.start).getTime();
  return event.ongoing ? Date.now() : start;
}

const startedBeforeToday = (start) => dayKey(new Date(start)) < dayKey(new Date());

const dayKey = (date) => date.toLocaleDateString('sv-SE', { timeZone: TZ });

const clean = (value) => toPlainText(decodeEntities(String(value ?? '')));
