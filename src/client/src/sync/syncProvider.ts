/**
 * sync-provider 境界 (step1 Phase 4a, architecture §6 / D3)
 *
 * ATProto を全体に load-bearing させないための**単一インターフェース**。
 * 外の層はこの `SyncProvider` だけに依存し、`null` (完全ローカル) / ATProto を
 * 差し替え可能にする。ATProto 実装 (collections/sync/mapper/poller) は本境界の
 * 内部実装として後続スライス (4c) で封じ込める。
 *
 * 運搬単位は統一語彙の `Batch` (step1 Phase 1 で正典化)。
 * architecture §6 の擬似コードは旧 `GraphEvent[]` だったが、正典一本化に伴い
 * `Batch[]` へ更新する (Batch = undo/redo・同期・マージの運搬単位)。
 */

import type { Batch } from '@conversensus/shared';

/**
 * remote 上の位置を指す不透明トークン。
 * 中身は provider 定義 (ATProto の rev/seq、Lamport 値など)。
 * 呼び出し側は解釈せず、次回 `pull` にそのまま渡し、永続化するだけ。
 */
export type Cursor = string;

/** 最初から (まだ何も pull していない) を表す初期カーソル */
export const INITIAL_CURSOR: Cursor = '';

/** `pull` の結果。次回に渡すカーソルを同梱する (cursor-pagination) */
export type PullResult = {
  /** since より後に remote で追記された batches */
  batches: Batch[];
  /** 次回 `pull` に渡す位置。batches が空でも前進しうる */
  cursor: Cursor;
};

/** `subscribe` の解除ハンドル */
export type Unsubscribe = () => void;

/** remote batches を受け取るコールバック */
export type OnRemote = (batches: Batch[]) => void;

/**
 * ローカル正典 (操作ログ) と remote の同期境界。
 * - オフライン時は push をスキップし outbox に積む (4b)。UI は常にローカルを読むので編集は途切れない。
 * - subscribe は firehose/jetstream 購読で手動 polling を卒業する (4d)。
 */
export interface SyncProvider {
  /** ローカルの batches を remote へ送る (outbox flush) */
  push(batches: Batch[]): Promise<void>;

  /** since より後の remote 変更を取得する */
  pull(since: Cursor): Promise<PullResult>;

  /** remote 追記を購読する。返り値で購読解除する */
  subscribe(onRemote: OnRemote): Unsubscribe;
}
