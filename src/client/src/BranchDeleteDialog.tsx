import type { Branch, Commit } from './atproto';

type Props = {
  branch: Branch;
  commits: Commit[];
  hasPendingChanges: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function BranchDeleteDialog({
  branch,
  commits,
  hasPendingChanges,
  onConfirm,
  onCancel,
}: Props) {
  const hasUnmergedCommits = commits.length > 0 && branch.status !== 'merged';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: モーダル背景のクリック閉じ
    // biome-ignore lint/a11y/useKeyWithClickEvents: モーダル背景のクリック閉じ
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="branch を削除"
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: 400,
          maxWidth: '90vw',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>branch を削除</h3>

        {/* branch 情報 */}
        <div
          style={{
            background: '#f5f5f5',
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
            ⎇ {branch.name}
          </div>
          {branch.description && (
            <div style={{ marginTop: 4, color: '#666', fontSize: 12 }}>
              {branch.description}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
            {commits.length} コミット &nbsp;·&nbsp; 状態:{' '}
            {statusLabel(branch.status)}
          </div>
        </div>

        {/* 警告 */}
        {(hasPendingChanges || hasUnmergedCommits) && (
          <div
            style={{
              background: '#fff8e1',
              border: '1px solid #f9a825',
              borderRadius: 4,
              padding: '8px 12px',
              marginBottom: 16,
              fontSize: 12,
              color: '#7a5c00',
            }}
          >
            {hasPendingChanges && <div>⚠ 未コミットの変更があります</div>}
            {hasUnmergedCommits && (
              <div>⚠ 未マージのコミットが {commits.length} 件あります</div>
            )}
          </div>
        )}

        <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
          この操作は取り消せません。branch とすべての commit が削除されます。
        </div>

        {/* ボタン */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '6px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              cursor: 'pointer',
              background: '#e53935',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
            }}
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: Branch['status']): string {
  switch (status) {
    case 'open':
      return 'オープン';
    case 'merged':
      return 'マージ済み';
    case 'closed':
      return 'クローズ済み';
  }
}
