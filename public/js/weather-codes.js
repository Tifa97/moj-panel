/**
 * WMO weather interpretation codes, as returned by Open-Meteo, mapped to a
 * Croatian label and one of the sprite symbols in index.html.
 */
const CODES = {
  0: ['Vedro', 'clear'],
  1: ['Pretežno vedro', 'clear'],
  2: ['Djelomično oblačno', 'partly'],
  3: ['Oblačno', 'cloudy'],
  45: ['Magla', 'fog'],
  48: ['Magla s injem', 'fog'],
  51: ['Slaba rosulja', 'drizzle'],
  53: ['Rosulja', 'drizzle'],
  55: ['Jaka rosulja', 'drizzle'],
  56: ['Ledena rosulja', 'sleet'],
  57: ['Jaka ledena rosulja', 'sleet'],
  61: ['Slaba kiša', 'rain'],
  63: ['Kiša', 'rain'],
  65: ['Jaka kiša', 'rain'],
  66: ['Ledena kiša', 'sleet'],
  67: ['Jaka ledena kiša', 'sleet'],
  71: ['Slab snijeg', 'snow'],
  73: ['Snijeg', 'snow'],
  75: ['Jak snijeg', 'snow'],
  77: ['Snježna zrnca', 'snow'],
  80: ['Slabi pljuskovi', 'showers'],
  81: ['Pljuskovi', 'showers'],
  82: ['Jaki pljuskovi', 'showers'],
  85: ['Slabi snježni pljuskovi', 'snow'],
  86: ['Snježni pljuskovi', 'snow'],
  95: ['Grmljavina', 'thunder'],
  96: ['Grmljavina s tučom', 'thunder'],
  99: ['Jaka grmljavina s tučom', 'thunder'],
};

export function describe(code, isDay = true) {
  const [label, symbol] = CODES[code] || ['Nepoznato', 'cloudy'];
  if (!isDay && symbol === 'clear') return { label, symbol: 'clear-night' };
  if (!isDay && symbol === 'partly') return { label, symbol: 'partly-night' };
  return { label, symbol };
}

/** Rough severity, used to pick the headline day in the forecast list. */
export const isWet = (code) => code >= 51 && code !== 77;
