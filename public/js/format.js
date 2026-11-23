export const TZ = 'Europe/Zagreb';

const fmt = (opts) => new Intl.DateTimeFormat('hr-HR', { timeZone: TZ, ...opts });

const TIME = fmt({ hour: '2-digit', minute: '2-digit' });
const WEEKDAY_LONG = fmt({ weekday: 'long' });
const WEEKDAY_SHORT = fmt({ weekday: 'short' });
const DAY_MONTH = fmt({ day: 'numeric', month: 'long' });
const DAY_MONTH_NUM = fmt({ day: 'numeric', month: 'numeric' });

export const toDate = (value) => (value instanceof Date ? value : new Date(value));

export const time = (value) => (value ? TIME.format(toDate(value)) : '');

export const weekday = (value) => capitalize(WEEKDAY_LONG.format(toDate(value)));

export const weekdayShort = (value) =>
  capitalize(WEEKDAY_SHORT.format(toDate(value)).replace(/\.$/, ''));

export const dayMonth = (value) => DAY_MONTH.format(toDate(value));

export const dayMonthNumeric = (value) =>
  DAY_MONTH_NUM.format(toDate(value)).replace(/\s/g, '');

/** "Ponedjeljak, 23. studenoga" */
export const longDate = (value = new Date()) =>
  `${weekday(value)}, ${dayMonth(value)}`;

/** Calendar day in Zagreb, as YYYY-MM-DD — safe to compare as a string. */
export const dayKey = (value) =>
  toDate(value).toLocaleDateString('sv-SE', { timeZone: TZ });

export function daysFromToday(value) {
  const a = dayKey(value);
  const b = dayKey(new Date());
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

/** "Danas" / "Jučer" / "Sutra" / "Petak, 28. studenoga" */
export function dayHeading(value) {
  const delta = daysFromToday(value);
  if (delta === 0) return 'Danas';
  if (delta === -1) return 'Jučer';
  if (delta === 1) return 'Sutra';
  return `${weekday(value)}, ${dayMonth(value)}`;
}

/** Short, human freshness label: "sada", "prije 12 min", "jučer 18:04". */
export function relative(value) {
  if (!value) return '';
  const date = toDate(value);
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);

  if (diffMin < 1) return 'upravo sada';
  if (diffMin < 60) return `prije ${diffMin} min`;

  const delta = daysFromToday(date);
  if (delta === 0) return time(date);
  if (delta === -1) return `jučer ${time(date)}`;
  if (delta === 1) return `sutra ${time(date)}`;
  return `${dayMonthNumeric(date)} ${time(date)}`;
}

/** Countdown used on the next-match card: "za 3 dana", "za 2 h". */
export function until(value) {
  if (!value) return '';
  const ms = toDate(value).getTime() - Date.now();
  if (ms < 0) return 'u tijeku ili odigrano';

  const days = daysFromToday(value);
  if (days > 1) return `za ${days} ${plural(days, 'dan', 'dana', 'dana')}`;
  if (days === 1) return 'sutra';

  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `za ${hours} ${plural(hours, 'sat', 'sata', 'sati')}`;
  return `za ${Math.max(1, Math.round(ms / 60000))} min`;
}

/** Croatian needs three forms: 1, 2–4, 5+ (with the usual teens exception). */
export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export const temp = (value) => (value == null ? '–' : `${Math.round(value)}°`);

const COMPASS = [
  'S', 'SSI', 'SI', 'ISI', 'I', 'IJI', 'JI', 'JJI',
  'J', 'JJZ', 'JZ', 'ZJZ', 'Z', 'ZSZ', 'SZ', 'SSZ',
];

export const windDirection = (deg) =>
  deg == null ? '' : COMPASS[Math.round(deg / 22.5) % 16];

export function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
