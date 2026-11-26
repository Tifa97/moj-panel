/**
 * Match-day and result notifications.
 *
 * There is no push server, so these fire when the app syncs: on open, on
 * coming back to it after a while, and on a manual refresh. That is enough
 * for "there is a match today" and "here is how it ended", which is what
 * this is for — see the README for what real Web Push would cost.
 */
import { time, dayKey } from './format.js';

const KEY = 'cip:notify';
const MAX_SEEN = 120;
/** Do not announce results older than this; they are history, not news. */
const RESULT_MAX_AGE_DAYS = 4;

const OUTCOME_TITLE = {
  W: 'Pobjeda Hajduka',
  D: 'Hajduk remizirao',
  L: 'Poraz Hajduka',
};

export const supported = () =>
  typeof Notification !== 'undefined' && 'serviceWorker' in navigator;

export const permission = () => (supported() ? Notification.permission : 'unsupported');

export const isEnabled = () =>
  supported() && Notification.permission === 'granted' && readState().enabled;

/**
 * Asks for permission and arms the checks. Past results are marked as seen
 * so switching this on does not replay the season; a match today still
 * announces itself, which doubles as confirmation that it works.
 */
export async function enable(data) {
  if (!supported()) return 'unsupported';

  const result = await Notification.requestPermission();
  if (result !== 'granted') return result;

  const state = readState();
  state.enabled = true;
  for (const message of resultMessages(data)) state.seen[message.key] = Date.now();
  writeState(state);
  return 'granted';
}

export function disable() {
  const state = readState();
  state.enabled = false;
  writeState(state);
}

/** Fires anything new in `data`. Safe to call on every sync. */
export async function check(data) {
  if (!isEnabled() || !data) return [];

  const state = readState();
  const fresh = [...matchDayMessages(data), ...resultMessages(data)].filter(
    (message) => !state.seen[message.key]
  );

  for (const message of fresh) {
    await show(message);
    state.seen[message.key] = Date.now();
  }
  if (fresh.length) writeState(state);
  return fresh;
}

/* ------------------------------------------------------------- messages */

function matchDayMessages(data) {
  const today = dayKey(new Date());

  return (data.fixtures || [])
    .filter((f) => f.startsAt && dayKey(f.startsAt) === today)
    .map((f) => ({
      key: `match:${today}:${f.label}`,
      title: 'Danas igra Hajduk',
      body: [
        f.label,
        f.timeKnown ? time(f.startsAt) : 'termin nije potvrđen',
        // The round names the competition better than the code does:
        // "Konferencijska liga" / "15. kolo" / "1/8 finala" beat "EUR".
        f.round || f.competitionName,
      ]
        .filter(Boolean)
        .join(' · '),
    }));
}

function resultMessages(data) {
  const cutoff = Date.now() - RESULT_MAX_AGE_DAYS * 86400e3;

  return (data.results || [])
    .filter((r) => r.id && r.playedAt && new Date(r.playedAt).getTime() >= cutoff)
    .map((r) => ({
      key: `result:${r.id}`,
      title: OUTCOME_TITLE[r.outcome] || 'Odigrana utakmica',
      body: `${r.home} ${r.homeScore}:${r.awayScore} ${r.away}${r.detail ? ` · ${r.detail}` : ''}`,
      url: r.link,
    }));
}

/* ---------------------------------------------------------------- show */

async function show({ key, title, body, url }) {
  const options = {
    body,
    // The key is unique per match and per result, so several notifications
    // can stand side by side instead of replacing one another.
    tag: key,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    lang: 'hr',
    data: { url: url || './#hajduk' },
  };

  try {
    // Android requires the service worker to own the notification; a plain
    // `new Notification()` throws there.
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, options);
  } catch {
    try {
      new Notification(title, options);
    } catch {
      /* the user revoked permission between the check and now */
    }
  }
}

/* --------------------------------------------------------------- state */

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { enabled: Boolean(raw.enabled), seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {} };
  } catch {
    return { enabled: false, seen: {} };
  }
}

function writeState(state) {
  // Keep the newest keys only; this grows by a handful of entries a week.
  const entries = Object.entries(state.seen)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SEEN);
  localStorage.setItem(
    KEY,
    JSON.stringify({ enabled: state.enabled, seen: Object.fromEntries(entries) })
  );
}
