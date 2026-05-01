import type { CommitOperation } from '@conversensus/shared';
import { useEffect, useRef, useState } from 'react';
import { DIALOG_Z_INDEX } from './ConfirmDialog';

type Props = {
  operations: CommitOperation[];
  onCommit: (message: string) => void;
  onCancel: () => void;
};

export function CommitDialog({ operations, onCommit, onCancel }: Props) {
  const [message, setMessage] = useState('');
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const opSummary = {
    nodeAdd: operations.filter((o) => o.op === 'node.add').length,
    nodeUpdate: operations.filter((o) => o.op === 'node.update').length,
    nodeRemove: operations.filter((o) => o.op === 'node.remove').length,
    edgeAdd: operations.filter((o) => o.op === 'edge.add').length,
    edgeUpdate: operations.filter((o) => o.op === 'edge.update').length,
    edgeRemove: operations.filter((o) => o.op === 'edge.remove').length,
  };
  const hasChanges = operations.length > 0;

  const handleBackdropClick = () => onCancel();

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
        zIndex: DIALOG_Z_INDEX,
      }}
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="コミットを作成"
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
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>コミットを作成</h3>

        {/* 変更サマリー */}
        <div
          style={{
            background: '#f5f5f5',
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 16,
            fontSize: 12,
            color: '#555',
          }}
        >
          {!hasChanges && <span>変更なし</span>}
          {opSummary.nodeAdd > 0 && <div>ノード追加: {opSummary.nodeAdd}</div>}
          {opSummary.nodeUpdate > 0 && (
            <div>ノード変更: {opSummary.nodeUpdate}</div>
          )}
          {opSummary.nodeRemove > 0 && (
            <div>ノード削除: {opSummary.nodeRemove}</div>
          )}
          {opSummary.edgeAdd > 0 && <div>エッジ追加: {opSummary.edgeAdd}</div>}
          {opSummary.edgeUpdate > 0 && (
            <div>エッジ変更: {opSummary.edgeUpdate}</div>
          )}
          {opSummary.edgeRemove > 0 && (
            <div>エッジ削除: {opSummary.edgeRemove}</div>
          )}
        </div>

        {/* コミットメッセージ */}
        <textarea
          ref={textareaRef}
          placeholder="コミットメッセージを入力..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (composingRef.current) return;
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              if (message.trim() && hasChanges) onCommit(message.trim());
            }
          }}
          rows={3}
          style={{
            width: '100%',
            padding: '8px',
            fontSize: 13,
            borderRadius: 4,
            border: '1px solid #ccc',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
          Cmd+Enter でコミット
        </div>

        {/* ボタン */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '6px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              if (message.trim() && hasChanges) onCommit(message.trim());
            }}
            disabled={!message.trim() || !hasChanges}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              cursor: hasChanges && message.trim() ? 'pointer' : 'not-allowed',
              background: hasChanges && message.trim() ? '#4f6ef7' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
            }}
          >
            コミット
          </button>
        </div>
      </div>
    </div>
  );
}
