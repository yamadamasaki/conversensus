/**
 * multiple モードの pane 1 つの枠 (step3 Phase 3 S3-5)。名前・前に出す・閉じるを持つ帯と、中身。
 *
 * アクティブな pane は枠の色で分ける — ヘッダと右サイドバーが対象にしているのはこの pane である (Q5)
 */

import type { ReactNode } from 'react';

const ACTIVE_BORDER = '#7c9ef8';
const PASSIVE_BORDER = '#ddd';

type Props = {
  label: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function PaneFrame({
  label,
  active,
  onActivate,
  onClose,
  children,
}: Props) {
  return (
    <section
      aria-label={`pane: ${label}`}
      aria-current={active}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `2px solid ${active ? ACTIVE_BORDER : PASSIVE_BORDER}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          fontSize: 12,
          background: active ? '#eef2fe' : '#f5f5f5',
        }}
      >
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: active ? 600 : 400,
          }}
        >
          {label}
        </span>
        {/* 見るだけの pane を編集するには前に出す。押すと画面の仕組みがこの pane のアドレスへ移る */}
        {!active && (
          <button type="button" onClick={onActivate} style={BUTTON}>
            前に出す
          </button>
        )}
        <button
          type="button"
          aria-label={`${label} の pane を閉じる`}
          onClick={onClose}
          style={BUTTON}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {children}
      </div>
    </section>
  );
}

const BUTTON = {
  background: 'none',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  padding: '0 6px',
} as const;
