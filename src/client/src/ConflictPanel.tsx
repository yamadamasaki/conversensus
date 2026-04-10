/**
 * コンフリクト可視化パネル (#59)
 *
 * ポーリングで検出されたリモート変更を一覧表示する。
 * "conflicts are consensus-building opportunities" の思想に基づき,
 * コンフリクトをエラーではなく対話・合意の起点として提示する。
 *
 * 表示の区別:
 *   - セマンティック変更 (node / edge): 内容の変更 → 合意が必要
 *   - レイアウト変更 (nodeLayout / edgeLayout): 位置/サイズの変更 → 通常は LWW で自動解決可
 */

import type { RemoteChange } from './atproto';
import { NSID } from './atproto';

type Props = {
  changes: RemoteChange[];
  onDismissAll: () => void;
  onDismiss: (change: RemoteChange) => void;
};

const COLLECTION_LABEL: Record<string, { label: string; semantic: boolean }> = {
  [NSID.node]: { label: 'ノード', semantic: true },
  [NSID.edge]: { label: 'エッジ', semantic: true },
  [NSID.nodeLayout]: { label: 'ノードレイアウト', semantic: false },
  [NSID.edgeLayout]: { label: 'エッジレイアウト', semantic: false },
  [NSID.sheet]: { label: 'シート', semantic: true },
};

function shortId(rkey: string): string {
  return rkey.slice(0, 8);
}

function ChangeItem({
  change,
  onDismiss,
}: {
  change: RemoteChange;
  onDismiss: () => void;
}) {
  const info = COLLECTION_LABEL[change.collection] ?? {
    label: change.collection,
    semantic: true,
  };
  const value = change.value as Record<string, unknown>;
  const isAdd = change.changeType === 'add';

  const borderColor = isAdd ? '#22c55e' : info.semantic ? '#f97316' : '#94a3b8';

  return (
    <li
      style={{
        borderLeft: `3px solid ${borderColor}`,
        paddingLeft: 8,
        marginBottom: 8,
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <span>
          <strong>{info.label}</strong>{' '}
          <code style={{ fontSize: 11, color: '#64748b' }}>
            {shortId(change.rkey)}
          </code>
          {isAdd ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: '#16a34a',
                fontWeight: 'bold',
              }}
            >
              追加
            </span>
          ) : info.semantic ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: '#f97316',
                fontWeight: 'bold',
              }}
            >
              要確認
            </span>
          ) : (
            <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8' }}>
              レイアウト
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#94a3b8',
            fontSize: 14,
            lineHeight: 1,
            padding: '0 2px',
          }}
          title="無視する"
        >
          ×
        </button>
      </div>
      {value.content !== undefined && (
        <div
          style={{
            marginTop: 2,
            color: '#475569',
            fontSize: 11,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 220,
          }}
        >
          → {String(value.content).slice(0, 60) || '(空)'}
        </div>
      )}
    </li>
  );
}

export function ConflictPanel({ changes, onDismissAll, onDismiss }: Props) {
  if (changes.length === 0) return null;

  const addCount = changes.filter((c) => c.changeType === 'add').length;
  const updateCount = changes.filter((c) => c.changeType === 'update').length;
  const semanticCount = changes.filter(
    (c) =>
      c.changeType === 'update' &&
      COLLECTION_LABEL[c.collection]?.semantic !== false,
  ).length;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 280,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        zIndex: 1000,
        fontFamily: 'sans-serif',
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#fff7ed',
          borderRadius: '8px 8px 0 0',
        }}
      >
        <div>
          <span style={{ fontWeight: 'bold', fontSize: 13, color: '#c2410c' }}>
            リモート変更 {changes.length} 件
          </span>
          {addCount > 0 && (
            <span style={{ fontSize: 11, color: '#16a34a', marginLeft: 6 }}>
              追加 {addCount}
            </span>
          )}
          {updateCount > 0 && (
            <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>
              変更 {updateCount}
              {semanticCount > 0 ? ` (要確認 ${semanticCount})` : ''}
            </span>
          )}
        </div>
      </div>

      {/* 説明 */}
      <div
        style={{
          padding: '8px 12px',
          fontSize: 11,
          color: '#64748b',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        他のユーザーによるリモート変更を検出しました。
        <br />
        オレンジ: 変更あり / 緑: 新規追加
      </div>

      {/* 変更一覧 */}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: '10px 12px',
          maxHeight: 220,
          overflowY: 'auto',
        }}
      >
        {changes.map((c) => (
          <ChangeItem
            key={`${c.collection}/${c.rkey}`}
            change={c}
            onDismiss={() => onDismiss(c)}
          />
        ))}
      </ul>

      {/* フッター */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #e2e8f0',
          textAlign: 'right',
        }}
      >
        <button
          type="button"
          onClick={onDismissAll}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: 4,
            cursor: 'pointer',
            color: '#475569',
          }}
        >
          すべて無視
        </button>
      </div>
    </div>
  );
}
