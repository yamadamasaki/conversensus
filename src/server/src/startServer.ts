/**
 * デーモンの待受開始 (step1 Phase 8 S1)
 *
 * **「起動した」と名乗るのは bind に成功した後でなければならない。**
 *
 * 以前は `export default { port, fetch }` を bun に渡して起動を任せ,
 * `console.log('server running on ...')` はモジュール評価の時点で出していた。
 * 実際の bind はその後なので, **ポートが埋まっていると「起動した」と言ってから落ちる**:
 *
 * ```
 * server running on http://localhost:3000      ← 先にこれが出る
 * error: Failed to start server. Is port 3000 in use?
 * ```
 *
 * Tauri 配布では利用者がログしか手掛かりを持たないので, ここが嘘だと診断できない
 * (`deepse/plans/step1-phase8-tauri.md` §2.3 / D5)。
 *
 * **気をつけるのではなく構造で塞ぐ。** この関数は bind を終えてから
 * **実際に掴んだポート**を返し, 呼び出し側はその値を使って初めてメッセージを組める。
 * 順序を間違えようがない。
 */

/** 起動したサーバ。`port` は**実際に掴んだ**ポートである (0 を渡した場合は割当結果) */
export type RunningServer = {
  port: number;
  stop: () => void;
};

export type ServeOptions = {
  port: number;
  fetch: (request: Request) => Response | Promise<Response>;
};

/** ポートが使用中であることを表す Bun のエラーコード */
const PORT_IN_USE = 'EADDRINUSE';

/**
 * 待受を開始する。**bind に失敗したら理由の分かる例外を投げる**。
 *
 * 素の例外は `Failed to start server. Is port 3000 in use?` のように**推測形**で,
 * しかもどのプロセスと衝突したかは分からない。ここでは断定形にし,
 * **開発中の dev サーバと衝突しているという最も多い原因**を書き添える。
 */
export function startServer(options: ServeOptions): RunningServer {
  try {
    const server = Bun.serve({ port: options.port, fetch: options.fetch });
    // `Server.port` は unix socket で待受する場合を含むため型上は optional である。
    // **握り潰して要求値で埋めない** — ポート 0 (OS 任せ) のとき嘘の番号を名乗ることになる
    if (server.port === undefined) {
      server.stop(true);
      throw new Error('待受は始まったがポート番号が取れませんでした');
    }
    return { port: server.port, stop: () => server.stop(true) };
  } catch (error) {
    if ((error as { code?: string })?.code === PORT_IN_USE) {
      throw new Error(
        `ポート ${options.port} は既に使われているため起動できません。` +
          `開発用のデーモン (bun run dev:server) が動いていないか確認してください。`,
        { cause: error },
      );
    }
    throw error;
  }
}
