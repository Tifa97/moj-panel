#!/usr/bin/env node
/**
 * Build-time data refresh: runs the pipeline once and writes the static JSON
 * the PWA falls back to (and the only JSON it has on a static host).
 *
 *   npm run refresh
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { buildPayloads, OUT_DIR } from './lib/pipeline.mjs';

async function main() {
  const startedAt = Date.now();
  console.log(`\nOsvježavanje podataka — ${new Date().toLocaleString('hr-HR')}\n`);

  const result = await buildPayloads();

  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, payload] of Object.entries(result.payloads)) {
    const file = name === 'weather' ? 'weather.json' : `${name}.json`;
    await writeFile(join(OUT_DIR, file), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  console.log('Izvori:');
  for (const s of result.sources) {
    console.log(
      `  ${s.ok ? 'ok  ' : 'GREŠKA'} ${String(s.name).padEnd(22)} ${
        s.ok ? `${s.count} zapisa` : s.error
      }`
    );
  }

  const { dubrovnik, fixtures, results, places } = result.counts;
  console.log(
    `\nZapisano u public/data: ${dubrovnik} vijesti (Dubrovnik), ` +
      `${fixtures} utakmica + ${results} rezultata (Hajduk), ${places} grada (Vrijeme).`
  );
  if (result.failures.length) {
    console.log(
      `\n${result.failures.length} izvor(a) nije odgovorio/a — objavljeni su zadnji ispravni podaci iz data/store.json.`
    );
  }
  console.log(`Trajanje: ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

  if (result.empty) {
    console.error('Nijedan izvor nije vratio podatke.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
