import { describe, expect, test } from 'bun:test';
import {
  CURRENT_BUILD_ID,
  fetchLatestBuildId,
  VERSION_PATH,
} from './appUpdate';

/** 決まった応答を返す fetch。呼ばれた引数を残す */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('fetchLatestBuildId (#262)', () => {
  test('配信の印を読み、HTTP のキャッシュを通さない', async () => {
    const { fetcher, calls } = fakeFetch(() =>
      Response.json({ build: '1.2.0+abc.k1' }),
    );
    expect(await fetchLatestBuildId(fetcher)).toBe('1.2.0+abc.k1');
    expect(calls).toEqual([{ url: VERSION_PATH, init: { cache: 'no-store' } }]);
  });

  test.each([
    [
      '404 (開発サーバ・配信の入れ替え中)',
      () => new Response('', { status: 404 }),
    ],
    ['JSON でない (画面が返った)', () => new Response('<!doctype html>')],
    ['build が無い', () => Response.json({ version: '1' })],
    ['build が空', () => Response.json({ build: '' })],
    ['build が文字列でない', () => Response.json({ build: 3 })],
    ['null', () => Response.json(null)],
  ])('%s なら null (新しい版は無いと扱う)', async (_name, respond) => {
    expect(await fetchLatestBuildId(fakeFetch(respond).fetcher)).toBeNull();
  });

  test('回線が無い (fetch が投げる) なら null', async () => {
    const { fetcher } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchLatestBuildId(fetcher)).toBeNull();
  });
});

describe('CURRENT_BUILD_ID', () => {
  test('build で埋められていない所 (テスト) では dev', () => {
    expect(CURRENT_BUILD_ID).toBe('dev');
  });
});
