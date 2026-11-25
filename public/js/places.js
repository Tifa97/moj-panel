import { CITIES } from './openmeteo.js';

const KEY = 'cip:places';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const MAX_CUSTOM = 6;

/** Dubrovnik and Zagreb are built in and cannot be removed. */
export const PERMANENT = CITIES.map((c) => ({ ...c, permanent: true }));

export function customPlaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(isValid).slice(0, MAX_CUSTOM) : [];
  } catch {
    return [];
  }
}

export const allPlaces = () => [...PERMANENT, ...customPlaces()];

export const isFull = () => customPlaces().length >= MAX_CUSTOM;

export function addPlace(place) {
  const list = customPlaces();
  if (list.some((p) => p.id === place.id)) return list;
  if (PERMANENT.some((p) => p.id === place.id)) return list;
  const next = [...list, place].slice(0, MAX_CUSTOM);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function removePlace(id) {
  const next = customPlaces().filter((p) => p.id !== id);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/**
 * Open-Meteo's geocoder: same family as the forecast API, no key, CORS open.
 * Returns a few candidates because names repeat across countries.
 */
export async function searchPlaces(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const url = `${GEOCODE}?${new URLSearchParams({
    name: q,
    count: '6',
    language: 'hr',
    format: 'json',
  })}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Geokodiranje nije uspjelo (${res.status})`);
  const data = await res.json();

  return (data.results || []).map(toPlace).filter(isValid);
}

function toPlace(result) {
  return {
    id: String(result.id ?? `${result.latitude},${result.longitude}`),
    name: result.name,
    lat: result.latitude,
    lon: result.longitude,
    region: result.admin1 || '',
    country: result.country || '',
    countryCode: result.country_code || '',
  };
}

/** "Split · Splitsko-dalmatinska županija, Hrvatska" */
export const describePlace = (place) =>
  [place.region, place.country].filter(Boolean).join(', ');

const isValid = (p) =>
  p && typeof p.id === 'string' && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon);
