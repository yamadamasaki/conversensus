import { describe, expect, test } from 'bun:test';
import { startServer } from './startServer';

/** 中身を問わない最小のハンドラ。ここで見たいのは bind の成否だけである */
const ok = () => new Response('ok');

/** OS に空きポートを割り当てさせる (0 を渡すと実際の番号が返る) */
const EPHEMERAL = 0;

describe('startServer', () => {
  test('実際に掴んだポートを返す', () => {
    // **戻り値が bind の後にしか存在しない**ことが, ログの嘘を構造的に防いでいる。
    // 呼び出し側はこの値を使わないとメッセージを組めない
    const server = startServer({ port: EPHEMERAL, fetch: ok });

    expect(server.port).toBeGreaterThan(0);
    server.stop();
  });

  test('掴んだポートで実際に応答する', async () => {
    // 「起動した」と名乗る資格があるかを, 名乗る側と同じ根拠 (実際の応答) で確かめる。
    // **`Bun.fetch` を使う** — グローバルの `fetch` は happy-dom のもので,
    // 実プロセスの HTTP サーバには届かない (`Parse Error` になる)
    const server = startServer({ port: EPHEMERAL, fetch: ok });

    const res = await Bun.fetch(`http://localhost:${server.port}/`);

    expect(res.status).toBe(200);
    server.stop();
  });

  test('使用中のポートでは理由の分かる例外になる', () => {
    const first = startServer({ port: EPHEMERAL, fetch: ok });

    // 素の例外は「Is port N in use?」という推測形で, 原因も書かれていない
    expect(() => startServer({ port: first.port, fetch: ok })).toThrow(
      `ポート ${first.port} は既に使われているため起動できません`,
    );

    first.stop();
  });

  test('例外は元の原因を捨てない', () => {
    // 文面を差し替えるときに元のエラーを落とすと, 想定外の失敗が追えなくなる
    const first = startServer({ port: EPHEMERAL, fetch: ok });

    try {
      startServer({ port: first.port, fetch: ok });
      throw new Error('例外が投げられなかった');
    } catch (error) {
      expect((error as Error).cause).toBeDefined();
    } finally {
      first.stop();
    }
  });

  test('停止したポートは再び掴める', () => {
    // stop() が本当に解放していること。孤児プロセスが残ると次の起動が死ぬ (D1)
    const first = startServer({ port: EPHEMERAL, fetch: ok });
    const port = first.port;
    first.stop();

    const second = startServer({ port, fetch: ok });

    expect(second.port).toBe(port);
    second.stop();
  });
});
