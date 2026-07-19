/**
 * SyncStatusIndicator: remote (ATProto) 同期ステータス表示 + 手動再送 (step1 W3d5-6)
 *
 * 設計 §3.7。remote への送信は best-effort (非ブロッキング) なので、失敗しても編集は
 * 途切れない代わりに**ユーザが気づけない**。未送信件数を可視化し、「今すぐ同期」で能動的に
 * 回復できるようにするのがこのコンポーネントの役割 — 純 fire-and-forget を採らない設計
 * (§3.1) の UI 側の半分。
 *
 * - **未ログイン (remoteQueue=null) では何も描画しない**。remote 経路が無いので同期概念が無い。
 * - ロジックはキュー側 (`RemoteSyncQueue`) に置き、ここは pending の購読・表示・手動 flush の
 *   トリガのみ。
 * - 上限超過 (overflowed, D1) 時は「N 件以上」と頭打ちで見せる。溢れた分はローカル正典に
 *   残っており、起動時 catch-up で回収される。
 */

import { useCallback, useEffect, useState } from 'react';
import type { RemoteSyncQueue } from './atproto/remoteSyncQueue';

type Props = {
  /** remote 送信キュー。null (未ログイン / SYNC_TO_REMOTE=false) なら非表示 */
  remoteQueue: RemoteSyncQueue | null;
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 4,
  marginTop: 4,
  fontSize: 11,
};

const syncNowBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#4f6ef7',
  fontSize: 11,
  padding: '2px 4px',
};

export function SyncStatusIndicator({ remoteQueue }: Props) {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  /** 直近の手動同期が失敗したか。控えめな警告色に切り替える */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!remoteQueue) return;
    // 登録直後に現在値が 1 回届く (RemoteSyncQueue.subscribe の契約)
    return remoteQueue.subscribe(setPending);
  }, [remoteQueue]);

  const handleSyncNow = useCallback(async () => {
    if (!remoteQueue || syncing) return;
    setSyncing(true);
    try {
      const result = await remoteQueue.flush();
      setFailed(!result.ok);
    } finally {
      setSyncing(false);
    }
  }, [remoteQueue, syncing]);

  if (!remoteQueue) return null;

  if (pending === 0) {
    return (
      <div style={{ ...containerStyle, color: '#999' }} role="status">
        <span>クラウド同期済み</span>
      </div>
    );
  }

  // 上限に達していると実際の未送信はこれ以上ある (溢れた分は catch-up で回収, D1)
  const count = remoteQueue.overflowed ? `${pending} 件以上` : `${pending} 件`;

  return (
    <div
      style={{ ...containerStyle, color: failed ? '#c47f00' : '#777' }}
      role="status"
    >
      <span>クラウド未同期: {count}</span>
      <button
        type="button"
        onClick={handleSyncNow}
        disabled={syncing}
        style={{ ...syncNowBtnStyle, ...(syncing && { color: '#aaa' }) }}
      >
        {syncing ? '同期中…' : '今すぐ同期'}
      </button>
    </div>
  );
}
