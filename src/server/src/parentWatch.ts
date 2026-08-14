/**
 * 親プロセスが消えたら自分も終わる (step1 Phase 8 S2)
 *
 * **アプリが正常に終了したときは Tauri が sidecar を kill する**ので, ここは要らない。
 * 要るのは**アプリが異常終了したとき**である — 実測 (2026-08-14):
 *
 * ```
 * app=67412 daemon=67464
 * $ kill -9 67412        ← アプリを強制終了
 * 67464 …/conversensusd  ← デーモンは生き残る
 * :39847 → 200           ← 待受も続いている
 * ```
 *
 * 残った孤児は**次回の起動を壊す**。同じポートを掴んでいるので新しいデーモンは
 * `EADDRINUSE` で死に, アプリは前回の (古い設定かもしれない) プロセスと話し続ける。
 *
 * **親の死を検知して自分から終わる**のが、この形の唯一の確実な塞ぎ方である
 * (アプリ側は強制終了されたら何も実行できないため)。
 */

/** 生存確認の間隔。落ちてから消えるまでの遅れと, 常時のコストの釣り合い */
export const PARENT_CHECK_INTERVAL_MS = 2_000;

/**
 * プロセスが生きているか。
 *
 * **シグナル 0 は「送らずに存在だけ確かめる」**という POSIX の約束である。
 * 相手が居なければ throw する (ESRCH)。
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type WatchParentOptions = {
  pid: number;
  intervalMs?: number;
  /** 生存確認の実装。テストが差し込む */
  isAlive?: (pid: number) => boolean;
  /** 親が居なくなったときに呼ばれる */
  onGone: () => void;
};

/**
 * 親プロセスを見張る。**戻り値は見張りを止める関数**である。
 *
 * `unref` するので, これが動いていることを理由にプロセスが生き続けることはない。
 */
export function watchParent(options: WatchParentOptions): () => void {
  const { pid, intervalMs = PARENT_CHECK_INTERVAL_MS, onGone } = options;
  const isAlive = options.isAlive ?? isProcessAlive;

  const timer = setInterval(() => {
    if (isAlive(pid)) return;
    clearInterval(timer);
    onGone();
  }, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
