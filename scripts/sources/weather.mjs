import { getJson } from '../lib/http.mjs';
// The browser re-fetches the same endpoint live, so the shapes must not drift:
// both sides share one module.
import { CITIES, forecastUrl, normalise } from '../../public/js/openmeteo.js';

export { CITIES, forecastUrl };

export async function collectWeather() {
  const settled = await Promise.allSettled(
    CITIES.map((c) => getJson(forecastUrl(c)))
  );

  const places = [];
  const sources = [];

  settled.forEach((res, i) => {
    const city = CITIES[i];
    const base = { name: `Open-Meteo (${city.name})`, home: 'https://open-meteo.com' };
    if (res.status !== 'fulfilled') {
      sources.push({
        ...base,
        ok: false,
        count: 0,
        error: String(res.reason?.message || res.reason).slice(0, 160),
      });
      return;
    }
    const place = normalise(city, res.value);
    places.push(place);
    sources.push({ ...base, ok: true, count: place.days.length });
  });

  return {
    places,
    sources,
    endpoints: Object.fromEntries(CITIES.map((c) => [c.id, forecastUrl(c)])),
  };
}
