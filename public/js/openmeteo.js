/**
 * Shared between the build-time refresh script and the browser: Open-Meteo
 * needs no API key and sends CORS headers, so the app can re-fetch live and
 * fall back to the cached snapshot when offline.
 */
export const CITIES = [
  { id: 'dubrovnik', name: 'Dubrovnik', lat: 42.6507, lon: 18.0944 },
  { id: 'zagreb', name: 'Zagreb', lat: 45.815, lon: 15.9819 },
];

const CURRENT = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'is_day',
  'precipitation',
];
const HOURLY = ['temperature_2m', 'weather_code', 'precipitation_probability'];
const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min',
  'precipitation_probability_max', 'precipitation_sum',
  'wind_speed_10m_max', 'sunrise', 'sunset',
];

export function forecastUrl(city) {
  const q = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: CURRENT.join(','),
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    timezone: 'Europe/Zagreb',
    forecast_days: '7',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Reshapes Open-Meteo's parallel arrays into per-day / per-hour records. */
export function normalise(city, raw) {
  const d = raw.daily || {};
  const h = raw.hourly || {};
  const u = raw.current_units || {};

  return {
    id: city.id,
    name: city.name,
    lat: city.lat,
    lon: city.lon,
    units: {
      temperature: u.temperature_2m || '°C',
      wind: u.wind_speed_10m || 'km/h',
    },
    current: {
      time: raw.current?.time ?? null,
      temp: round(raw.current?.temperature_2m),
      feelsLike: round(raw.current?.apparent_temperature),
      humidity: raw.current?.relative_humidity_2m ?? null,
      code: raw.current?.weather_code ?? null,
      wind: round(raw.current?.wind_speed_10m),
      windDir: raw.current?.wind_direction_10m ?? null,
      isDay: raw.current?.is_day === 1,
      precipitation: raw.current?.precipitation ?? null,
    },
    days: (d.time || []).map((date, i) => ({
      date,
      code: d.weather_code?.[i] ?? null,
      max: round(d.temperature_2m_max?.[i]),
      min: round(d.temperature_2m_min?.[i]),
      precipProb: d.precipitation_probability_max?.[i] ?? null,
      precipSum: d.precipitation_sum?.[i] ?? null,
      windMax: round(d.wind_speed_10m_max?.[i]),
      sunrise: d.sunrise?.[i] ?? null,
      sunset: d.sunset?.[i] ?? null,
    })),
    hours: (h.time || []).map((time, i) => ({
      time,
      temp: round(h.temperature_2m?.[i]),
      code: h.weather_code?.[i] ?? null,
      precipProb: h.precipitation_probability?.[i] ?? null,
    })),
  };
}

const round = (v) => (typeof v === 'number' ? Math.round(v) : null);
