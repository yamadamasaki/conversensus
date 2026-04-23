import type { Branch, Commit } from './atproto';

type Props = {
  branch: Branch;
  commits: Commit[];
  onConfirm: () => void;
  onCancel: () => void;
};

export function MergeDialog({ branch, commits, onConfirm, onCancel }: Props) {
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
        aria-label="branch をマージ"
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: 440,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>branch をマージ</h3>

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
        </div>

        {/* commit 一覧 */}
        <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
          マージされる commit ({commits.length} 件)
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            border: '1px solid #eee',
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          {commits.length === 0 ? (
            <div style={{ padding: '12px', color: '#999', fontSize: 12 }}>
              commit がありません
            </div>
          ) : (
            commits.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 2 }}>
                  {c.message}
                </div>
                <div style={{ color: '#999' }}>
                  {new Date(c.createdAt).toLocaleString('ja-JP')} &nbsp;·&nbsp;
                  {c.authorDid.length > 20
                    ? `${c.authorDid.slice(0, 20)}…`
                    : c.authorDid}
                </div>
              </div>
            ))
          )}
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
            disabled={commits.length === 0}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              cursor: commits.length > 0 ? 'pointer' : 'not-allowed',
              background: commits.length > 0 ? '#e67e22' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
            }}
          >
            マージ
          </button>
        </div>
      </div>
    </div>
  );
}
