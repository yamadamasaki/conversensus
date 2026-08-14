import { describe, expect, test } from 'bun:test';
import { allowedOrigin } from './corsOrigin';

const VPS = 'https://app.conversensus.site';

describe('allowedOrigin', () => {
  test('Tauri アプリ (tauri://localhost) を通す', () => {
    // 通さないと配布物は全リクエストが落ちる。**画面は出るのに一覧が空**になる形なので
    // 「アプリが壊れている」と誤診しやすい (Phase 8a spike の申し送り)
    expect(allowedOrigin('tauri://localhost', null)).toBe('tauri://localhost');
  });

  test('開発用の localhost はポートを問わず通す', () => {
    expect(allowedOrigin('http://localhost:5173', null)).toBe(
      'http://localhost:5173',
    );
    // E2E は専用ポートを使う (playwright.config.ts)
    expect(allowedOrigin('http://localhost:5174', null)).toBe(
      'http://localhost:5174',
    );
  });

  test('ALLOWED_ORIGIN に一致するものを通す', () => {
    expect(allowedOrigin(VPS, VPS)).toBe(VPS);
  });

  test('ALLOWED_ORIGIN が無ければ VPS の origin も通さない', () => {
    // 開発機のデーモンが本番クライアントからの要求を受けない, ということでもある
    expect(allowedOrigin(VPS, null)).toBeNull();
  });

  test('見知らぬ origin は通さない', () => {
    expect(allowedOrigin('https://example.com', VPS)).toBeNull();
  });

  test('tauri を騙る別 origin は通さない', () => {
    // **完全一致で見ていること。** 前方一致だとこれが通ってしまう
    expect(allowedOrigin('tauri://localhost.example.com', null)).toBeNull();
  });

  test('localhost を騙る別ホストは通さない', () => {
    // 前綴りが `http://localhost:` (コロンまで) であることの確認。
    // `http://localhost.example.com` はコロンが無いので一致しない
    expect(allowedOrigin('http://localhost.example.com', null)).toBeNull();
  });

  test('Origin が無い要求は通さない', () => {
    // 同一オリジンや curl などヘッダを持たない要求。CORS ヘッダを返す相手が居ない
    expect(allowedOrigin(undefined, VPS)).toBeNull();
  });
});
