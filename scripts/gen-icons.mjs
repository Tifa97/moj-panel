#!/usr/bin/env node
/**
 * Generates the PWA icon set. Hand-rolled PNG writer so the project stays
 * dependency free: three bars in the three tab accents on a deep blue ground.
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ICONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const GROUND = [11, 46, 79, 255]; // #0B2E4F
const BARS = [
  [212, 166, 42, 255], // Dubrovnik gold  #D4A62A
  [255, 255, 255, 255], // Hajduk white on blue
  [88, 180, 236, 255], // Vrijeme light blue #58B4EC
];

const TARGETS = [
  { file: 'icon-192.png', size: 192, pad: 0.14 },
  { file: 'icon-512.png', size: 512, pad: 0.14 },
  { file: 'icon-maskable-512.png', size: 512, pad: 0.26 }, // safe zone for masks
  { file: 'apple-touch-icon.png', size: 180, pad: 0.14 },
];

async function main() {
  await mkdir(ICONS, { recursive: true });
  for (const t of TARGETS) {
    await writeFile(join(ICONS, t.file), encodePng(render(t.size, t.pad), t.size, t.size));
    console.log(`  ${t.file}  ${t.size}x${t.size}`);
  }
  await writeFile(join(ICONS, 'icon.svg'), svgIcon(), 'utf8');
  console.log('  icon.svg');
}

/** Returns an RGBA pixel buffer for one icon. */
function render(size, pad) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;

  const inset = size * pad;
  const barW = size - inset * 2;
  const gap = size * 0.055;
  const barH = (size - inset * 2 - gap * 2) / 3;
  const barR = barH * 0.32;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = inRoundRect(x, y, 0, 0, size, size, radius) ? GROUND : [0, 0, 0, 0];

      for (let b = 0; b < 3; b++) {
        const top = inset + b * (barH + gap);
        if (inRoundRect(x, y, inset, top, barW, barH, barR)) {
          color = BARS[b];
          break;
        }
      }

      const o = (y * size + x) * 4;
      px[o] = color[0];
      px[o + 1] = color[1];
      px[o + 2] = color[2];
      px[o + 3] = color[3];
    }
  }
  return px;
}

function inRoundRect(px, py, x, y, w, h, r) {
  const cx = px + 0.5;
  const cy = py + 0.5;
  if (cx < x || cy < y || cx > x + w || cy > y + h) return false;
  const nx = Math.min(Math.max(cx, x + r), x + w - r);
  const ny = Math.min(Math.max(cy, y + r), y + h - r);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r + 0.0001 || (cx >= x + r && cx <= x + w - r) || (cy >= y + r && cy <= y + h - r);
}

/* ------------------------------------------------------------ PNG writer */

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------- SVG twin */

function svgIcon() {
  const bars = BARS.map((c, i) => {
    const y = 14 + i * (24 + 5.5);
    return `  <rect x="14" y="${y}" width="72" height="24" rx="7.7" fill="rgb(${c[0]},${c[1]},${c[2]})"/>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Panel">
  <rect width="100" height="100" rx="22" fill="rgb(${GROUND[0]},${GROUND[1]},${GROUND[2]})"/>
${bars}
</svg>
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
