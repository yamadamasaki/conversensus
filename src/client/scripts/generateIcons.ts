/**
 * PWA のアイコン (仮) を生成する (step3 Phase 2 S2-5)
 *
 * **仮のアイコンである。**青の角丸の地に、辺で結んだ 2 つの白い node を描く。正式なアイコンが
 * できたら `public/` の PNG / SVG を差し替え、このスクリプトは消してよい。
 *
 * 実行: `bun run src/client/scripts/generateIcons.ts`
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const PUBLIC_DIR = join(import.meta.dir, '../public');
const SIZES = [192, 512] as const;
const BACKGROUND = [0x4f, 0x6e, 0xf7] as const;
const FOREGROUND = [0xff, 0xff, 0xff] as const;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** (x, y) の色。地は角丸、前景は 2 つの円と、それを結ぶ太線 */
function pixel(x: number, y: number, size: number): readonly number[] | null {
  const radius = size * 0.18;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) return null; // 角丸の外は透明
  const a = { x: size * 0.32, y: size * 0.62 };
  const b = { x: size * 0.68, y: size * 0.38 };
  const node = size * 0.12;
  const inCircle = (p: { x: number; y: number }) =>
    (x - p.x) ** 2 + (y - p.y) ** 2 <= node ** 2;
  // 線分 ab への距離
  const t = Math.max(
    0,
    Math.min(
      1,
      ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) /
        ((b.x - a.x) ** 2 + (b.y - a.y) ** 2),
    ),
  );
  const onEdge =
    (x - (a.x + t * (b.x - a.x))) ** 2 + (y - (a.y + t * (b.y - a.y))) ** 2 <=
    (size * 0.035) ** 2;
  return inCircle(a) || inCircle(b) || onEdge ? FOREGROUND : BACKGROUND;
}

function png(size: number): Uint8Array {
  const raw = new Uint8Array(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const color = pixel(x + 0.5, y + 0.5, size);
      const at = row + 1 + x * 4;
      if (color) raw.set([...color, 0xff], at);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8); // 8bit RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

for (const size of SIZES) {
  writeFileSync(join(PUBLIC_DIR, `icon-${size}.png`), png(size));
}
console.log(`icons: ${SIZES.join(', ')}`);
