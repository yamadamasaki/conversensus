import type { Did } from '@conversensus/shared';
import { Check, Copy, History } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMessages } from './i18n/messages';
import type { RosterAction, RosterRow } from './sync/rosterView';
import { actionLabel } from './sync/rosterView';
import { color, font, radius, space } from './theme';
import { Button, IconButton } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

const ROSTER_DIALOG_WIDTH = 620;

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

/** 表示名が引けなかった DID はそのまま出る。長いので折り返せるようにする */
const ID_CELL = {
  padding: '6px',
  fontSize: font.body,
  wordBreak: 'break-all',
} as const;

/** 一覧に出す action の並び。行ごとに順番が変わると押し間違える */
/**
 * 操作ボタンの並び順。
 *
 * **配列ではなく `Record` にしてある。**配列で並べると、`RosterAction` に種類を足した
 * ときに**足し忘れてもコンパイルが通り、ボタンが黙って出ない**。`Record` なら型が
 * 網羅を強制する (`reopen` を足したときに実際に出かかった)。
 */
const ACTION_ORDER: Record<RosterAction, number> = {
  preview: 0,
  accept: 1,
  revoke: 2,
  resign: 3,
  reinvite: 4,
  reopen: 5,
};

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
  /** 参加依頼を出す。**複数まとめて渡す** (`,` 区切りの入力) */
  onGenerate: (handles: string[]) => void;
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
  const t = useMessages();
  const [handle, setHandle] = useState('');
  const [copied, setCopied] = useState<Did | null>(null);
  const composingRef = useRef(false);

  const submit = () => {
    // 仕様: ハンドル名を `,` 区切りで並べて依頼する。空欄は落とす —
    // 末尾の `,` や打ち間違いで空の依頼を書きに行かない
    const handles = handle
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (handles.length === 0 || busy) return;
    onGenerate(handles);
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
      window.prompt(t.invitation.copyFailed, code);
    }
  };

  return (
    <Dialog
      kind="input"
      label={t.invitation.title}
      title={t.invitation.title}
      onDismiss={onClose}
      width={ROSTER_DIALOG_WIDTH}
      scroll
    >
      <p
        style={{
          margin: '0 0 16px',
          fontSize: font.body,
          color: color.textMuted,
        }}
      >
        {fileName}
      </p>

      {unreadable.length > 0 && (
        <p
          role="status"
          style={{
            margin: '0 0 12px',
            fontSize: font.body,
            color: color.warningText,
          }}
        >
          {t.invitation.unreadable(unreadable.length)}
        </p>
      )}

      {rejectedNote && (
        <p
          role="status"
          style={{
            margin: '0 0 12px',
            fontSize: font.body,
            color: color.warningText,
          }}
        >
          {rejectedNote}
        </p>
      )}

      <table
        style={{
          width: '100%',
          fontSize: font.body,
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left', color: color.textMuted }}>
            <th style={{ padding: '4px 6px' }}>
              {t.invitation.columns.participant}
            </th>
            <th style={{ padding: '4px 6px' }}>
              {t.invitation.columns.inviter}
            </th>
            <th style={{ padding: '4px 6px' }}>
              {t.invitation.columns.status}
            </th>
            <th style={{ padding: '4px 6px' }}>
              {t.invitation.columns.history}
            </th>
            <th style={{ padding: '4px 6px' }}>
              {t.invitation.columns.actions}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.did}
              style={{ borderTop: `1px solid ${color.borderSubtle}` }}
            >
              <td style={ID_CELL}>{labelOf(row.did)}</td>
              <td style={ID_CELL}>
                {row.inviter ? labelOf(row.inviter) : '—'}
              </td>
              <td style={{ padding: '6px' }}>
                {
                  // `revoked` と `resigned` を「離脱中」に畳む (仕様: 自分で辞めたか, 辞めさせられたかは問わない)
                  t.invitation.status[row.status]
                }
              </td>
              <td style={{ padding: '6px' }}>
                <IconButton
                  icon={History}
                  small
                  label={t.invitation.historyOf(labelOf(row.did))}
                  onClick={() => onOpenHistory(row.did)}
                />
              </td>
              <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                {[...row.available]
                  .sort((a, b) => ACTION_ORDER[a] - ACTION_ORDER[b])
                  .map((action) => (
                    <Button
                      key={action}
                      className="cs-btn--sm"
                      disabled={busy}
                      onClick={() => onAction(action, row.did)}
                      style={{ marginRight: space[1] }}
                    >
                      {actionLabel(action, row.status)}
                    </Button>
                  ))}
                {row.status === 'sent' && codeFor(row.did) && (
                  <Button
                    className="cs-btn--sm"
                    icon={copied === row.did ? Check : Copy}
                    onClick={() => copy(row.did)}
                  >
                    {copied === row.did
                      ? t.invitation.copied
                      : t.invitation.copyCode}
                  </Button>
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
          aria-label={t.invitation.handles}
          placeholder={t.invitation.handlesPlaceholder}
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
          style={{
            flex: 1,
            minWidth: 0,
            padding: `${space[1]}px ${space[2]}px`,
            fontSize: font.body,
            borderRadius: radius.sm,
            border: `1px solid ${color.border}`,
          }}
        />
        <Button variant="primary" disabled={busy} onClick={submit}>
          {t.invitation.invite}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            margin: '8px 0 0',
            fontSize: font.body,
            color: color.dangerText,
          }}
        >
          {error}
        </p>
      )}

      <DialogActions>
        <Button onClick={onClose}>{t.common.close}</Button>
      </DialogActions>
    </Dialog>
  );
}
