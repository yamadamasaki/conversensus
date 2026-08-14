/**
 * SyncStatusIndicator: remote (ATProto) 同期ステータス表示 + 手動同期 (step1 W3d5-6)
 *
 * 設計 §3.7。remote への送信は best-effort (非ブロッキング) なので、失敗しても編集は
 * 途切れない代わりに**ユーザが気づけない**。未送信件数を可視化し、「今すぐ同期」で能動的に
 * 回復できるようにするのがこのコンポーネントの役割 — 純 fire-and-forget を採らない設計
 * (§3.1) の UI 側の半分。
 *
 * **「今すぐ同期」は送信と受信の両方を行い、ログイン中は常に出す** (GitHub #202)。
 * かつては送信だけで、しかも未送信が 1 件以上あるときしか出なかった。しかし
 *
 * - 送信は編集のたびに走って普通は即成功するので、**正常に動いているほどボタンに出会わない**
 * - **受信の契機は「ファイルを開いたとき」と `online` の 2 つしかない**ので、開いたまま
 *   待っていても他所 (他端末・他ウィンドウ) の変更は入ってこない
 *
 * という組み合わせで、「反映されないので同期したい」ときに押す口が存在しなかった。
 * 自動反映が入るまでの間、**人が要求したときに取りに行ける**ようにしておく。
 *
 * - **未ログイン (remoteQueue=null) では何も描画しない**。remote 経路が無いので同期概念が無い。
 * - ロジックはキュー側 (`RemoteSyncQueue`) と tap 側 (`useEventSyncTap` の `syncNow`) に置き、
 *   ここは pending の購読・表示・トリガのみ。
 * - 上限超過 (overflowed, D1) 時は「N 件以上」と頭打ちで見せる。溢れた分はローカル正典に
 *   残っており、起動時 catch-up で回収される。
 */

import { useCallback, useEffect, useState } from 'react';
import type { RemoteSyncQueue } from './atproto/remoteSyncQueue';

type Props = {
  /** remote 送信キュー。null (未ログイン / SYNC_TO_REMOTE=false) なら非表示 */
  remoteQueue: RemoteSyncQueue | null;
  /**
   * 送信の catch-up と受信 (`useEventSyncTap` の `syncNow`)。
   *
   * **キューの flush とは別物である** — flush は未送信を送るだけで、
   * 他所の変更を取りに行かない。
   */
  onSyncNow: () => Promise<void>;
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

export function SyncStatusIndicator({ remoteQueue, onSyncNow }: Props) {
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
      // **送信を先に、受信を後に。** 逆にすると、こちらの編集を送る前に相手の変更で
      // 画面が差し替わりうる (再 projection は未 flush があれば見送るので実害は
      // 出ないが、押した人から見て「自分の変更が消えた」ように見える瞬間を作らない)
      const result = await remoteQueue.flush();
      // 送信が失敗しても受信は試す — 落ちている理由が別かもしれない
      await onSyncNow();
      setFailed(!result.ok);
    } finally {
      setSyncing(false);
    }
  }, [remoteQueue, syncing, onSyncNow]);

  if (!remoteQueue) return null;

  // 上限に達していると実際の未送信はこれ以上ある (溢れた分は catch-up で回収, D1)
  const status =
    pending === 0
      ? 'クラウド同期済み'
      : `クラウド未同期: ${remoteQueue.overflowed ? `${pending} 件以上` : `${pending} 件`}`;

  return (
    <div
      style={{
        ...containerStyle,
        color: failed ? '#c47f00' : pending === 0 ? '#999' : '#777',
      }}
      role="status"
    >
      <span>{status}</span>
      {/* **未送信が無くても出す。** 受信 (他所の変更を取りに行く) はここにしか口が無い */}
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
