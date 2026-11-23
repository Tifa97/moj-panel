import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * A tiny JSON store kept in the repo. The build-time pipeline only ever sees
 * the newest window of each feed, so we accumulate across refreshes: this is
 * what lets the match-result list and the Hajduk coverage grow over days
 * instead of resetting to whatever the RSS happens to hold right now.
 */
export async function loadStore(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

export async function saveStore(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Merges freshly fetched records into previously stored ones, keyed by `key`.
 * Fresh values win on conflict; the result is sorted newest-first by `dateKey`
 * and capped at `max`.
 */
export function mergeRecords(previous = [], fresh = [], { key = 'link', dateKey, max = 60 } = {}) {
  const byKey = new Map();
  for (const rec of previous) if (rec?.[key]) byKey.set(rec[key], rec);
  for (const rec of fresh) if (rec?.[key]) byKey.set(rec[key], { ...byKey.get(rec[key]), ...rec });

  const all = [...byKey.values()];
  if (dateKey) {
    all.sort((a, b) => ts(b[dateKey]) - ts(a[dateKey]));
  }
  return all.slice(0, max);
}

const ts = (iso) => (iso ? new Date(iso).getTime() : 0);
