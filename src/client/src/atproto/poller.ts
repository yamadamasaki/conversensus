/**
 * ATProto PDS ポーリングによるリモート変更検出
 *
 * 検出ロジック:
 *   1. ログイン後に initCidCacheFromPds() で PDS の現在状態をキャッシュ
 *   2. startPolling() でインターバル毎に全コレクションをスキャン
 *   3. キャッシュ済み CID と異なるレコードを RemoteChange として報告
 *
 * 注意: 新規レコード (キャッシュに未登録) はコンフリクト検出の対象外。
 * 既存レコードへの同時変更のみを検出する。
 */

import { cacheResult, getCid, setCid } from './cidCache';
import { edgeLayouts, edges, nodeLayouts, nodes, sheets } from './collections';
import { NSID, type RemoteChange } from './types';

export type { RemoteChange };

// collection NSID → list 関数のマッピング (pagination 込み)
const COLLECTION_LISTS: Array<
  [string, () => Promise<Array<{ uri: string; cid: string; value: unknown }>>]
> = [
  [NSID.sheet, () => sheets.list()],
  [NSID.node, () => nodes.list()],
  [NSID.edge, () => edges.list()],
  [NSID.nodeLayout, () => nodeLayouts.list()],
  [NSID.edgeLayout, () => edgeLayouts.list()],
];

function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

/**
 * ログイン後に呼び出す。PDS の現在状態で CID キャッシュを初期化する。
 * 以降のポーリングはこの状態を baseline として差分を検出する。
 */
export async function initCidCacheFromPds(): Promise<void> {
  await Promise.all(
    COLLECTION_LISTS.map(async ([collection, list]) => {
      const records = await list();
      for (const r of records) {
        const createdAt = (r.value as { createdAt?: string }).createdAt;
        setCid(collection, rkeyFromUri(r.uri), r.cid, createdAt);
      }
    }),
  );
}

/** キャッシュ済み CID と異なるレコード、および新規レコードを収集して返す */
async function detectChanges(): Promise<RemoteChange[]> {
  const changes: RemoteChange[] = [];

  await Promise.all(
    COLLECTION_LISTS.map(async ([collection, list]) => {
      const records = await list();
      for (const r of records) {
        const rkey = rkeyFromUri(r.uri);
        const knownCid = getCid(collection, rkey);
        if (knownCid === undefined) {
          // キャッシュに未登録 → 他ユーザーが追加した新規レコード
          changes.push({
            collection,
            rkey,
            cid: r.cid,
            value: r.value,
            changeType: 'add',
          });
          cacheResult(r.uri, r.cid);
        } else if (knownCid !== r.cid) {
          // キャッシュに存在するが CID が変わった → 他ユーザーによる更新
          changes.push({
            collection,
            rkey,
            cid: r.cid,
            value: r.value,
            changeType: 'update',
          });
          cacheResult(r.uri, r.cid); // キャッシュを最新に更新
        }
      }
    }),
  );

  return changes;
}

export const POLL_INTERVAL_MS = 10_000; // 10秒 (開発環境向け)

let _timerId: ReturnType<typeof setInterval> | null = null;

export function startPolling(
  onChanges: (changes: RemoteChange[]) => void,
  intervalMs = POLL_INTERVAL_MS,
): void {
  if (_timerId !== null) return; // 多重起動防止
  _timerId = setInterval(async () => {
    try {
      const changes = await detectChanges();
      if (changes.length > 0) onChanges(changes);
    } catch (err) {
      console.warn('[atproto] polling error:', err);
    }
  }, intervalMs);
}

export function stopPolling(): void {
  if (_timerId !== null) {
    clearInterval(_timerId);
    _timerId = null;
  }
}
