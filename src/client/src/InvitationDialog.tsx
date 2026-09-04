import type { Did } from '@conversensus/shared';
import { useRef, useState } from 'react';
import { DIALOG_Z_INDEX } from './ConfirmDialog';
import type { RosterAction, RosterRow, RosterStatus } from './sync/rosterView';

/**
 * 参加者一覧ダイアログ (step2 Phase 1)
 *
 * 仕様: `deepse/requirements/spec/participation.md`「参加者一覧 + 参加依頼」
 *
 * **用語は「参加依頼」である。**PDS アカウントへの招待と混同させないため、画面に
 * 「招待」を出さない。識別子 (`participation.invite`, `sent` など) は英語のまま変えて
 * いない — ATProto のレコードに載る値なので、改称すると移行が要るためである。
 *
 * **判断はここに書かない。**どの action が押せるかは `rosterView` が決めており、
 * ここは `row.available` に無いものをグレイアウトするだけである。取り消しの pre 条件と
 * 画面の活性が食い違うと、押せるのに畳み込みで捨てられるという状態が生まれる。
 */

/**
 * 状態の表示。**`revoked` と `resigned` を「離脱中」に畳む** — 仕様が
 * 「自分で辞めたか, 辞めさせられたかは問わない」と定めている。畳み込みは区別を
 * 持っているが、**画面はそれを使わない** (誰がやったかは参加履歴に出る)
 */
const STATUS_LABEL: Record<RosterStatus, string> = {
  sent: '依頼中',
  accepted: '参加中',
  revoked: '離脱中',
  resigned: '離脱中',
  invalid: '無効',
};

const ACTION_LABEL: Record<RosterAction, string> = {
  preview: '中身を見る',
  accept: '承認',
  revoke: '取り消す',
  resign: '参加をやめる',
};

/** 表示名が引けなかった DID はそのまま出る。長いので折り返せるようにする */
const ID_CELL = {
  padding: '6px',
  fontSize: 12,
  wordBreak: 'break-all',
} as const;

/** 一覧に出す action の並び。行ごとに順番が変わると押し間違える */
const ACTION_ORDER: RosterAction[] = ['preview', 'accept', 'revoke', 'resign'];

type Props = {
  fileName: string;
  rows: RosterRow[];
  /**
   * 読めなかった repo。**空でなければ「名簿が欠けているかもしれない」と伝える。**
   * 黙って隠すと「招待したのに相手が出てこない」が理由不明のまま残る
   */
  unreadable: Did[];
  /**
   * 畳み込みが捨てた判断の要約。**空でなければ出す。**捨てられた招待は行を持たない
   * ので、これが無いと「招待したのに表が空のまま」が原因不明のまま残る
   */
  rejectedNote?: string | null;
  /**
   * DID → ハンドル名。**名簿が持つのは DID、画面に出すのはハンドル名**である
   * (記録にハンドル名を持つと、付け替えられた瞬間に嘘になる)。引けなかった DID は
   * DID のまま返る
   */
  labelOf: (did: Did) => string;
  /** 参加履歴を開く。行ごとの「…」から */
  onOpenHistory: (did: Did) => void;
  /** 依頼中の行に出す参加コード。無ければ copy ボタンを出さない */
  codeFor: (did: Did) => string | null;
  onGenerate: (handle: string) => void;
  onAction: (action: RosterAction, did: Did) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
};

export function InvitationDialog({
  fileName,
  rows,
  unreadable,
  rejectedNote = null,
  labelOf,
  onOpenHistory,
  codeFor,
  onGenerate,
  onAction,
  onClose,
  busy = false,
  error = null,
}: Props) {
  const [handle, setHandle] = useState('');
  const [copied, setCopied] = useState<Did | null>(null);
  const composingRef = useRef(false);

  const submit = () => {
    const trimmed = handle.trim();
    if (!trimmed || busy) return;
    onGenerate(trimmed);
    setHandle('');
  };

  const copy = async (did: Did) => {
    const code = codeFor(did);
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(did);
    } catch {
      // クリップボードは権限で失敗しうる。**黙らない** — コードを渡せたと
      // 誤解したまま相手を待つのが最悪である
      setCopied(null);
      window.prompt('コピーできなかった。手で選んでコピーしてほしい:', code);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: モーダル背景のクリック閉じ
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: DIALOG_Z_INDEX,
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="参加者一覧"
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: 620,
          maxWidth: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>参加者一覧</h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#666' }}>
          {fileName}
        </p>

        {unreadable.length > 0 && (
          <p
            role="status"
            style={{ margin: '0 0 12px', fontSize: 12, color: '#a60' }}
          >
            {unreadable.length}{' '}
            人分の記録が読めなかった。名簿が欠けている可能性がある。
          </p>
        )}

        {rejectedNote && (
          <p
            role="status"
            style={{ margin: '0 0 12px', fontSize: 12, color: '#a60' }}
          >
            {rejectedNote}
          </p>
        )}

        <table
          style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}
        >
          <thead>
            <tr style={{ textAlign: 'left', color: '#666' }}>
              <th style={{ padding: '4px 6px' }}>参加者</th>
              <th style={{ padding: '4px 6px' }}>依頼者</th>
              <th style={{ padding: '4px 6px' }}>状態</th>
              <th style={{ padding: '4px 6px' }}>参加履歴</th>
              <th style={{ padding: '4px 6px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.did} style={{ borderTop: '1px solid #eee' }}>
                <td style={ID_CELL}>{labelOf(row.did)}</td>
                <td style={ID_CELL}>
                  {row.inviter ? labelOf(row.inviter) : '—'}
                </td>
                <td style={{ padding: '6px' }}>{STATUS_LABEL[row.status]}</td>
                <td style={{ padding: '6px' }}>
                  <button
                    type="button"
                    aria-label={`${labelOf(row.did)} の参加履歴`}
                    onClick={() => onOpenHistory(row.did)}
                    style={{ fontSize: 12 }}
                  >
                    …
                  </button>
                </td>
                <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                  {ACTION_ORDER.filter((a) => row.available.includes(a)).map(
                    (action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={busy}
                        onClick={() => onAction(action, row.did)}
                        style={{ marginRight: 4, fontSize: 12 }}
                      >
                        {ACTION_LABEL[action]}
                      </button>
                    ),
                  )}
                  {row.status === 'sent' && codeFor(row.did) && (
                    <button
                      type="button"
                      onClick={() => copy(row.did)}
                      style={{ fontSize: 12 }}
                    >
                      {copied === row.did ? 'コピーした' : 'コードをコピー'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <input
            value={handle}
            aria-label="ハンドル名"
            placeholder="ハンドル・ネーム (例: bob.test)"
            disabled={busy}
            onChange={(e) => setHandle(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(e) => {
              if (composingRef.current) return;
              if (e.key === 'Enter') submit();
            }}
            style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 13 }}
          />
          <button type="button" disabled={busy} onClick={submit}>
            参加依頼する
          </button>
        </div>

        {error && (
          <p
            role="alert"
            style={{ margin: '8px 0 0', fontSize: 12, color: '#c00' }}
          >
            {error}
          </p>
        )}

        <div style={{ marginTop: 20, textAlign: 'right' }}>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
