import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from './securityHeaders';

const CADDYFILE = join(import.meta.dir, '../../../infra/caddy/Caddyfile');
const APP_SITE = 'app.conversensus.site';
const PDS_SITE = 'pds.conversensus.site';
const HSTS = 'Strict-Transport-Security';

/** Caddyfile の `<site> { … }` の中身 (入れ子の `{}` を数えて閉じ括弧を探す) */
function siteBlock(caddyfile: string, site: string): string {
  const start = caddyfile.indexOf(`${site} {`);
  if (start < 0) throw new Error(`${site} が Caddyfile に無い`);
  let depth = 0;
  for (let i = caddyfile.indexOf('{', start); i < caddyfile.length; i++) {
    if (caddyfile[i] === '{') depth++;
    if (caddyfile[i] === '}' && --depth === 0) return caddyfile.slice(start, i);
  }
  throw new Error(`${site} の閉じ括弧が無い`);
}

/** `header { 名前 値 }` の行と `header 名前 値` の行から、名前 → 値 (引用符を外す) */
function headersIn(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const raw of block.split('\n')) {
    const line = raw.trim().replace(/^header\s+(?=[A-Z])/, '');
    const m = /^([A-Z][A-Za-z-]+)\s+(.+)$/.exec(line);
    if (m) found.set(m[1], m[2].replace(/^"(.*)"$/, '$1'));
  }
  return found;
}

describe('セキュリティのヘッダ (#284)', () => {
  const caddyfile = readFileSync(CADDYFILE, 'utf8');
  const app = headersIn(siteBlock(caddyfile, APP_SITE));

  test('本番の配信は vite preview と同じヘッダを付ける', () => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(app.get(name)).toBe(value);
    }
  });

  test('本番の配信と PDS は HSTS を付ける', () => {
    expect(app.get(HSTS)).toBeDefined();
    expect(headersIn(siteBlock(caddyfile, PDS_SITE)).get(HSTS)).toBeDefined();
  });

  test('PDS の管理の口を外に出さない', () => {
    const pds = siteBlock(caddyfile, PDS_SITE);
    expect(pds).toContain('/xrpc/com.atproto.admin.*');
    expect(pds).toContain('/xrpc/com.atproto.server.createInviteCode ');
    expect(pds).toMatch(/respond @admin 404/);
  });

  test('CSP は文字列の eval と枠への埋め込みを許さない', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });
});
