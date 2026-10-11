import { useEffect, useRef, useState } from 'react';
import { isLayoutOnly, type SheetChange } from './sync/computeOperations';
import { color, font, radius } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

const COMMIT_DIALOG_WIDTH = 400;

type Props = {
  changes: SheetChange[];
  onCommit: (message: string) => void;
  onCancel: () => void;
};

export function CommitDialog({ changes, onCommit, onCancel }: Props) {
  const [message, setMessage] = useState('');
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // layout だけの変更は「変更」として数えたうえで、内訳に「移動」として出す。
  // 画面のハイライトは意味の変更と区別しないので、区別はこの内訳だけに閉じる。
  const count = (kind: string) =>
    changes.filter((c) => c.op.op === kind).length;
  const countMoved = (kind: string) =>
    changes.filter((c) => c.op.op === kind && isLayoutOnly(c)).length;

  const opSummary = {
    nodeAdd: count('node.add'),
    nodeUpdate: count('node.update'),
    nodeMoved: countMoved('node.update'),
    nodeRemove: count('node.remove'),
    edgeAdd: count('edge.add'),
    edgeUpdate: count('edge.update'),
    edgeMoved: countMoved('edge.update'),
    edgeRemove: count('edge.remove'),
  };
  const hasChanges = changes.length > 0;

  return (
    <Dialog
      kind="input"
      label="commit を作成"
      title="commit を作成"
      onDismiss={onCancel}
      width={COMMIT_DIALOG_WIDTH}
    >
      {/* 変更サマリー */}
      <div
        style={{
          background: color.bgSubtle,
          borderRadius: radius.sm,
          padding: '8px 12px',
          marginBottom: 16,
          fontSize: font.body,
          color: color.textMuted,
        }}
      >
        {!hasChanges && <span>変更なし</span>}
        {opSummary.nodeAdd > 0 && <div>node 追加: {opSummary.nodeAdd}</div>}
        {opSummary.nodeUpdate > 0 && (
          <div>
            node 変更: {opSummary.nodeUpdate}
            {opSummary.nodeMoved > 0 &&
              ` (うち移動のみ: ${opSummary.nodeMoved})`}
          </div>
        )}
        {opSummary.nodeRemove > 0 && (
          <div>node 削除: {opSummary.nodeRemove}</div>
        )}
        {opSummary.edgeAdd > 0 && <div>edge 追加: {opSummary.edgeAdd}</div>}
        {opSummary.edgeUpdate > 0 && (
          <div>
            edge 変更: {opSummary.edgeUpdate}
            {opSummary.edgeMoved > 0 &&
              ` (うち経路のみ: ${opSummary.edgeMoved})`}
          </div>
        )}
        {opSummary.edgeRemove > 0 && (
          <div>edge 削除: {opSummary.edgeRemove}</div>
        )}
      </div>

      {/* コミットメッセージ */}
      <textarea
        ref={textareaRef}
        placeholder="commit メッセージを入力…"
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
          fontSize: font.body,
          borderRadius: radius.sm,
          border: `1px solid ${color.border}`,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          fontSize: font.caption,
          color: color.textMuted,
          marginTop: 4,
        }}
      >
        Cmd+Enter で commit
      </div>

      <DialogActions>
        <Button onClick={onCancel}>キャンセル</Button>
        <Button
          variant="primary"
          onClick={() => {
            if (message.trim() && hasChanges) onCommit(message.trim());
          }}
          disabled={!message.trim() || !hasChanges}
        >
          commit
        </Button>
      </DialogActions>
    </Dialog>
  );
}
