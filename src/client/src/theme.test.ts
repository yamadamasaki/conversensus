import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { color, shadow } from './theme';

const SRC = import.meta.dir;
const css = readFileSync(join(SRC, 'index.css'), 'utf8');

/** `index.css` の `:root` に書かれた `--cs-*` の値 */
function tokenValues(): Map<string, string> {
  const values = new Map<string, string>();
  for (const m of css.matchAll(/(--cs-[a-z-]+):\s*([^;]+);/g)) {
    values.set(m[1], m[2].trim());
  }
  return values;
}

const tokens = tokenValues();

function hexOf(token: string): string {
  const v = tokens.get(token);
  if (!v?.startsWith('#'))
    throw new Error(`${token} は hex の色ではない: ${v}`);
  return v;
}

/** WCAG 2.x の相対輝度とコントラスト比 */
function luminance(hex: string): number {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme の変数', () => {
  test('theme.ts が参照する変数はすべて index.css にある', () => {
    for (const ref of [...Object.values(color), ...Object.values(shadow)]) {
      const name = ref.match(/var\((--cs-[a-z-]+)\)/)?.[1];
      expect(name && tokens.has(name) ? name : `未定義: ${ref}`).toBe(
        name ?? '',
      );
    }
  });
});

describe('コントラスト (visual language の下限 = WCAG AA)', () => {
  // [前景, 背景] — 文字は 4.5:1、意味を持つ図形 (線・枠・アイコン) は 3:1
  const TEXT: [string, string][] = [
    ['--cs-text', '--cs-bg'],
    ['--cs-text', '--cs-bg-subtle'],
    ['--cs-text-muted', '--cs-bg'],
    ['--cs-text-muted', '--cs-bg-subtle'],
    ['--cs-text-on-primary', '--cs-primary'],
    ['--cs-text-on-primary', '--cs-primary-hover'],
    ['--cs-primary', '--cs-bg'],
    ['--cs-primary', '--cs-selection-bg'],
    ['--cs-diff-add-text', '--cs-diff-add-bg'],
    ['--cs-diff-update-text', '--cs-diff-update-bg'],
    ['--cs-conflict-text', '--cs-conflict-bg'],
    ['--cs-danger-text', '--cs-danger-bg'],
    ['--cs-danger-text', '--cs-bg'],
    ['--cs-warning-text', '--cs-warning-bg'],
    ['--cs-success-text', '--cs-bg'],
  ];
  const GRAPHIC: [string, string][] = [
    ['--cs-selection', '--cs-bg'],
    ['--cs-focus', '--cs-bg'],
    ['--cs-diff-add', '--cs-bg'],
    ['--cs-diff-update', '--cs-bg'],
    ['--cs-conflict', '--cs-bg'],
    ['--cs-danger', '--cs-bg'],
    ['--cs-text-muted', '--cs-bg-hover'],
  ];

  test.each(TEXT)('文字 %s on %s は 4.5:1 以上', (fg, bg) => {
    expect(contrast(hexOf(fg), hexOf(bg))).toBeGreaterThanOrEqual(4.5);
  });
  test.each(GRAPHIC)('図形 %s on %s は 3:1 以上', (fg, bg) => {
    expect(contrast(hexOf(fg), hexOf(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('部品に色を直書きしない (#267)', () => {
  /** 色を値で持ってよいもの: 変数の置き場と、CSS 変数を読めない描画先 */
  const ALLOWED = new Set(['theme.ts', 'graph/exportPng.ts']);

  function sources(dir: string, base = ''): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      const rel = base ? `${base}/${name}` : name;
      if (statSync(path).isDirectory()) return sources(path, rel);
      if (!/\.tsx?$/.test(name) || /\.(test|app-test)\.tsx?$/.test(name))
        return [];
      return [rel];
    });
  }

  test('文字列の中の #rgb・#rrggbb・rgb()・rgba() が無い', () => {
    const found: string[] = [];
    for (const rel of sources(SRC)) {
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(join(SRC, rel), 'utf8').split('\n');
      lines.forEach((l, i) => {
        // 文字列リテラル ('…' "…" `…`) の中だけを見る — コメントの issue 番号 (#202) を拾わない
        for (const s of l.match(/'[^']*'|"[^"]*"|`[^`]*`/g) ?? []) {
          if (/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b|rgba?\(/.test(s)) {
            found.push(`${rel}:${i + 1} ${s}`);
          }
        }
      });
    }
    expect(found).toEqual([]);
  });
});
