import { el, icon } from '../dom.js';
import { dayKey } from '../format.js';

const KEY = 'cip:sections';

/**
 * A collapsible section built on <details>, so keyboard, screen readers and
 * find-in-page work without any of our own code. Open/closed state is
 * remembered per id.
 */
export function accordion({ id, title, count, defaultOpen = true, nested = false }, ...children) {
  const open = readOpen(id, defaultOpen);

  const node = el(
    `details.acc${nested ? '.acc--nested' : ''}`,
    { open: open || null, dataset: { section: id } },
    el(
      'summary.acc__head',
      null,
      el('span.acc__title', { text: title }),
      count != null ? el('span.acc__count', { text: String(count) }) : null,
      icon('chevron-down', 'icon acc__chev')
    ),
    el('div.acc__body', null, ...children)
  );

  node.addEventListener('toggle', () => writeOpen(id, node.open));
  return node;
}

/** Stable id for a day group, so "today" keeps its own memory per date. */
export const daySectionId = (prefix, day) => `${prefix}:${dayKey(day)}`;

/* --------------------------------------------------------------- state */

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function readOpen(id, fallback) {
  const state = readState();
  return id in state ? Boolean(state[id]) : fallback;
}

function writeOpen(id, open) {
  const state = readState();
  state[id] = open ? 1 : 0;
  localStorage.setItem(KEY, JSON.stringify(prune(state)));
}

/**
 * Day sections are dated, so yesterday's entries are dead weight. Everything
 * else is a fixed handful of section names and stays.
 */
function prune(state) {
  const today = dayKey(new Date());
  return Object.fromEntries(
    Object.entries(state).filter(([id]) => {
      const match = id.match(/:(\d{4}-\d{2}-\d{2})$/);
      return !match || match[1] >= today;
    })
  );
}
