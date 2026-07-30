/**
 * migrateRemoteRkey: PDS 上の batch レコードを新 rkey 形式へ移行する (step1 Phase 7 p7-4)
 *
 * Phase 7 設計 §3.4。p7-1 で rkey が `v1~<fileId>~<clock>~<batchId>` になり、p7-2/p7-3 で
 * 読取経路がその prefix だけを走査するようになった。旧 rkey (batchId = 小文字 hex UUID) の
 * レコードは `v1~` より小さく **新経路の走査に一切現れない** (§3.1 の分離)。放置しても
 * 邪魔にはならないが、**そのレコードにしか無い batch** — 別端末が push し、この端末が
 * まだ受信していない分 — は新経路からは永久に見えなくなる。それを取りこぼさないための移行。
 *
 * 手続きは 3 段で、**この順序が安全性そのもの** (§6.2):
 *
 *   1. **旧経路で 1 回だけ全件受信する** — `pullRemote()` (repo 全件) で旧 rkey も新 rkey も
 *      まとめて取り、fileId ごとにローカル正典へ marker 経路で追記する。ローカルに無い
 *      fileId はここで materialize される (`discoverRemoteFiles` と同じ書込口)。
 *   2. **ローカル正典を新 rkey で再 push する** — 1 の結果を含んだローカル正典が、
 *      新形式のレコードとして PDS に載る。rkey は batch の不変属性だけから決まるので
 *      **何度実行しても同じレコードに収束する** (§3.1)。書込は `applyWrites` の
 *      まとめ書きで、**すでに新 rkey で載っている分は範囲取得で除く** — まとめ書きは
 *      既存 rkey があるとチャンクごと失敗するため、この差分がやり直しを可能にする (§5.4)。
 *   3. **marker を立てる** — 以後この端末は 1 の全件 list を実行しない。
 *
 * **1 が失敗したら 2 へ進まない・marker も立てない** (例外をそのまま投げる)。2 から
 * 始めると「PDS にしか無い batch」が prefix 走査の外に取り残され、ローカル正典にも
 * 無いので**復元できない** (§6.2)。旧レコードは削除しないので、marker が立つ前なら
 * 何度でもやり直せる。
 *
 * **再 push の対象は「全件受信で remote に見えたファイル」だけ**である。ローカルにしか
 * 無いファイル (ログアウト中に作った等) は移行の対象ではない — remote に旧形式の
 * レコードが無いので移行すべきものが無く、通常の catch-up (ファイルを開いたとき) が
 * 面倒を見る。移行のついでに未送信のローカルファイルを PDS へ上げてしまわないための線引き。
 *
 * **marker は端末ローカル** (localStorage, DID 単位)。「この repo は新 rkey で揃っている」は
 * 本来 repo 単位の不変条件だが、PDS 上に marker を置いても旧版クライアントが後から
 * 旧 rkey を書く可能性は消えない (marker があっても嘘になる)。したがって marker が表すのは
 * 「**この端末は 1 回目の全件受信を済ませた**」という端末の事実だけで、全端末を更新することを
 * 運用前提とする (旧版併用は非目標, §2.2)。
 */

import type { Batch, FileId } from '@conversensus/shared';
import { filterBatchesForRemote } from '../atproto/remoteFilter';
import type { RemoteBatch } from '../atproto/types';
import { safeLocalStorage } from './safeStorage';

/** 移行済 marker の localStorage キーの前置き。DID を連結して端末 × アカウント単位にする */
export const RKEY_MIGRATION_STORAGE_PREFIX = 'conversensus_rkey_migrated_v1:';

/**
 * localStorage が使えない環境の退避先 (セッション内のみ)。
 *
 * 保存できないなら**起動のたびに移行が走る**が、手続きはべき等なので正しさは失われない
 * (失うのは 1 回分のリクエストだけ)。セッション内で 2 回走らせない程度の防御に留める。
 */
const inMemoryMigrated = new Set<string>();

export type MigrateRemoteRkeyDeps = {
  /**
   * remote の batch を**全件**取得する (旧経路)。移行がこの口の最後の消費者で、
   * p7-5 で移行コードごと退役する (§3.5)。
   */
  pullRemote: () => Promise<RemoteBatch[]>;
  /** ローカル正典へ受信追記する (marker 経路であること — `POST /files/:id/batches/received`) */
  appendReceived: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /** ローカル正典の batch を読む (再 push の元) */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  /**
   * **新形式で**そのファイルの batch を取得する (Phase 7 p7-2 の範囲取得)。
   * 「まだ新 rkey で書かれていない batch」を割り出すために使う (下の `createRemote` 参照)。
   */
  pullRemoteForFile: (fileId: FileId) => Promise<RemoteBatch[]>;
  /**
   * remote へ直接まとめて書く。**再送キューを経由しない** — キューには保持上限
   * (`REMOTE_QUEUE_MAX`) があり、溢れると「移行が完了した」という判定が嘘になる。
   * 失敗は例外で伝わり、marker が立たないことで次回起動の再試行に繋がる。
   *
   * **べき等ではない** (`applyWrites#create`)。既存の rkey が混ざるとチャンクごと
   * 失敗するので、渡す前に `pullRemoteForFile` で差分を取る。
   */
  createRemote: (entries: readonly RemoteBatch[]) => Promise<void>;
  /** 移行済か (既定は localStorage の marker) */
  hasMigrated: () => boolean;
  /** 移行済を記録する (既定は localStorage の marker) */
  markMigrated: () => void;
  /** 所要時間の計測に使う時計 (テストで固定する) */
  now?: () => number;
};

export type MigrateRemoteRkeyResult = {
  /** `already-migrated` なら marker が立っていて何もしていない (カウンタはすべて 0) */
  status: 'migrated' | 'already-migrated';
  /** 全件受信で remote に見えたファイル数 (= 再 push の対象数) */
  remoteFiles: number;
  /** 全件受信でローカル正典へ**新規に**追記された batch 数 (既知分は 0 に数えられる) */
  receivedBatches: number;
  /** 再 push したファイル数 (presentation 除外後に 1 件も残らないファイルを除く) */
  pushedFiles: number;
  /** 再 push した batch 数 (presentation 除外後) */
  pushedBatches: number;
  /** 手続き全体の所要時間 (ms)。移行コストの実測に使う (§6.3) */
  elapsedMs: number;
};

/**
 * 旧 rkey のレコードを取りこぼさずに新 rkey 形式へ移行する。
 *
 * べき等: 2 回目以降は marker で弾かれる。marker を消して再実行しても、追記は
 * `appendReceivedBatches` の (file_id, batch_id) べき等性が、再 push は rkey の
 * 決定論性が吸収するので**レコードは増えない** (§5-2 の受入基準)。
 *
 * 失敗したら例外をそのまま投げる (marker は立たない)。呼び出し側は warn に出して、
 * 次の起動契機に再試行させる — 途中まで書けていても壊れない。
 */
export async function migrateRemoteRkey(
  deps: MigrateRemoteRkeyDeps,
): Promise<MigrateRemoteRkeyResult> {
  if (deps.hasMigrated()) {
    return {
      status: 'already-migrated',
      remoteFiles: 0,
      receivedBatches: 0,
      pushedFiles: 0,
      pushedBatches: 0,
      elapsedMs: 0,
    };
  }

  const now = deps.now ?? Date.now;
  const startedAt = now();

  // --- 1. 旧経路で 1 回だけ全件受信する ---
  // 旧 rkey にしか無い batch をローカル正典へ取り込む。ここを飛ばすと 2 の再 push が
  // 「ローカルにある分」しか書かず、PDS にしか無い batch が新経路の外に取り残される (§6.2)。
  const byFile = new Map<FileId, Batch[]>();
  for (const { fileId, batch } of await deps.pullRemote()) {
    const batches = byFile.get(fileId);
    if (batches) batches.push(batch);
    else byFile.set(fileId, [batch]);
  }

  let receivedBatches = 0;
  for (const [fileId, batches] of byFile) {
    // 受信の書込口は marker 経路であること (plain append だと Phase 4d-0 §1.8 と同型の
    // 事故が起きる)。ローカルに無い fileId はここで materialize される。
    receivedBatches += await deps.appendReceived(fileId, batches);
  }

  // --- 2. ローカル正典を新 rkey で再 push する ---
  // 対象は remote に見えたファイルだけ (上のコメント: 移行はローカル専用ファイルを上げない)。
  let pushedFiles = 0;
  let pushedBatches = 0;
  for (const fileId of byFile.keys()) {
    // presentation 除外は remote leg の不変条件 (§3.2 D7)。移行でも例外にしない
    const local = filterBatchesForRemote(await deps.fetchBatches(fileId));
    if (local.length === 0) continue;

    // **すでに新 rkey で載っている分を除く**。まとめ書き (`applyWrites#create`) は
    // 既存 rkey があるとチャンクごと失敗するので、ここで差分を取ることが
    // 「やり直せる移行」(§6.2) の条件になる。範囲取得は新形式しか見ないので、
    // 旧 rkey のレコードが「載っている」と誤判定されることはない。
    const alreadyNew = new Set(
      (await deps.pullRemoteForFile(fileId)).map((e) => e.batch.id),
    );
    const missing = local.filter((b) => !alreadyNew.has(b.id));
    if (missing.length === 0) continue;

    await deps.createRemote(missing.map((batch) => ({ fileId, batch })));
    pushedFiles += 1;
    pushedBatches += missing.length;
  }

  // --- 3. marker を立てる ---
  // ここまで例外なく来たときだけ。以後この端末は全件 list を実行しない。
  deps.markMigrated();

  return {
    status: 'migrated',
    remoteFiles: byFile.size,
    receivedBatches,
    pushedFiles,
    pushedBatches,
    elapsedMs: now() - startedAt,
  };
}

/** 移行済 marker が立っているか (localStorage が使えなければセッション内の記録を見る) */
export function hasRkeyMigrated(did: string, storage?: Storage): boolean {
  const store = storage ?? safeLocalStorage();
  if (!store) return inMemoryMigrated.has(did);
  return store.getItem(RKEY_MIGRATION_STORAGE_PREFIX + did) !== null;
}

/**
 * 移行済 marker を立てる。
 *
 * 書き込みに失敗しても**例外にしない** — 移行そのものは成功しているので、marker が
 * 残らずに次回もう一度走ること (べき等なので無害) の方が、成功した移行を失敗として
 * 扱うより正しい。ただし静かには済ませない (§3.6)。
 */
export function markRkeyMigrated(did: string, storage?: Storage): void {
  inMemoryMigrated.add(did);
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(
      RKEY_MIGRATION_STORAGE_PREFIX + did,
      new Date().toISOString(),
    );
  } catch (err) {
    console.warn(
      '[sync] rkey migration marker could not be persisted; ' +
        'the migration will run again on the next start (harmless but slow):',
      err,
    );
  }
}
