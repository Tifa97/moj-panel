export const TZ = 'Europe/Zagreb';

// Nominative, as used in the "misec" headers of hajduk.hr's schedule JSON.
const MONTHS_NOM = [
  'siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj',
  'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac',
];

// Genitive, as used in the human-readable "datum" strings ("26. studenog").
const MONTHS_GEN = [
  'siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja',
  'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca',
];

const norm = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'd')
    .trim();

/** "Studeni 2026." -> { month: 11, year: 2026 } (month is 1-based). */
export function parseMonthHeader(header = '') {
  const txt = norm(header);
  const year = Number((txt.match(/\b(20\d{2})\b/) || [])[1]);
  const idx = MONTHS_NOM.findIndex((m) => txt.startsWith(norm(m)));
  if (idx < 0 || !year) return null;
  return { month: idx + 1, year };
}

/** "26. studenog u 21:00h" -> { day: 26, hour: 21, minute: 0, month: 11 } */
export function parseDayTime(text = '') {
  const txt = norm(text);
  const day = Number((txt.match(/\b(\d{1,2})\./) || [])[1]);
  // No trailing \b: the source writes "21:00h" and "0h" has no boundary.
  const time = txt.match(/(\d{1,2}):(\d{2})/);
  // The genitive month name is present too; "studenog" is a shorter variant
  // of "studenoga", so compare on prefixes.
  const monthIdx = MONTHS_GEN.findIndex((m) => {
    const stem = norm(m).slice(0, 5);
    return stem.length >= 4 && txt.includes(stem);
  });
  if (!day) return null;
  return {
    day,
    hour: time ? Number(time[1]) : null,
    minute: time ? Number(time[2]) : null,
    month: monthIdx >= 0 ? monthIdx + 1 : null,
  };
}

/**
 * Builds a correct UTC instant for a wall-clock time in Zagreb, honouring
 * CET/CEST without hardcoding an offset.
 */
export function zagrebToUtcIso(year, month, day, hour = 12, minute = 0) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Offset of the zone at (roughly) that instant, then corrected once.
  let guess = naive - offsetAt(naive);
  guess = naive - offsetAt(guess);
  return new Date(guess).toISOString();
}

function offsetAt(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second')
  );
  return asUtc - utcMs;
}
