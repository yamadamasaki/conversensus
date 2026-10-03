/**
 * conflict list (step3 Phase 5, 仕様 merger)
 *
 * 解消すべき競合の一覧。**チェックは「その競合を解消した」とユーザが理解したときに入れる** — 解消が
 * 正しいかを形式的に確かめることは難しい (仕様)。すべてにチェックが入り、コメントがあれば merge できる。
 * コメントは merge (と、解決の編集が未コミットならそのコミット) の message になる
 */

import type { MergeConflict, Op } from '@conversensus/shared';
import { useState } from 'react';
import { mergerCheckKey } from './sync/merger';

type Props = {
  conflicts: readonly MergeConflict[];
  /** 競合の対象の名前 (分岐点での名前) */
  labelOf: (target: string) => string;
  checked: readonly string[];
  onToggle: (key: string) => void;
  onMerge: (comment: string) => void;
  /** merge を実行中 (二度押しさせない) */
  busy?: boolean;
};

const CATEGORY_LABEL = {
  content: '内容',
  structure: 'つなぎ方',
  layout: '位置',
} as const;

/** 競合の片側の op を、人が読める一言にする */
export function describeSide(op: Op): string {
  switch (op.kind) {
    case 'node.setContent':
      return `本文「${op.content}」`;
    case 'node.setLabel':
    case 'edge.setLabel':
      return `名前「${op.label}」`;
    case 'node.setProperty':
    case 'edge.setProperty':
      return op.value === undefined
        ? `プロパティ ${op.name} を消す`
        : `プロパティ ${op.name} = ${JSON.stringify(op.value)}`;
    case 'node.remove':
    case 'edge.remove':
      return '削除';
    case 'node.add':
    case 'edge.add':
      return '追加';
    default:
      return op.kind;
  }
}

export function ConflictList({
  conflicts,
  labelOf,
  checked,
  onToggle,
  onMerge,
  busy = false,
}: Props) {
  const [comment, setComment] = useState('');
  const done = new Set(checked);
  const resolved = conflicts.filter((c) => done.has(mergerCheckKey(c))).length;
  const canMerge =
    !busy && resolved === conflicts.length && comment.trim() !== '';

  return (
    <section
      aria-label="conflict list"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontSize: 12,
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>
        conflict list ({resolved} / {conflicts.length})
      </h3>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          overflowY: 'auto',
          flex: 1,
        }}
      >
        {conflicts.map((c) => {
          const key = mergerCheckKey(c);
          const what = labelOf(c.target) || '(名前のない要素)';
          const about = c.propertyName
            ? ` のプロパティ「${c.propertyName}」`
            : '';
          return (
            <li
              key={key}
              style={{ borderBottom: '1px solid #eee', padding: '4px 0' }}
            >
              <label
                style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}
              >
                <input
                  type="checkbox"
                  checked={done.has(key)}
                  onChange={() => onToggle(key)}
                />
                <span>
                  <strong>
                    {what}
                    {about} ({CATEGORY_LABEL[c.category]})
                  </strong>
                  <br />
                  merge 先: {describeSide(c.ours.op)} / merge 元:{' '}
                  {describeSide(c.theirs.op)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <textarea
        aria-label="merge のコメント"
        placeholder="コメント (merge の理由)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        style={{ marginTop: 6, fontSize: 12, resize: 'vertical' }}
      />
      <button
        type="button"
        disabled={!canMerge}
        onClick={() => onMerge(comment.trim())}
        style={{
          marginTop: 6,
          alignSelf: 'flex-end',
          padding: '4px 16px',
          background: canMerge ? '#f97316' : '#ccc',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          cursor: canMerge ? 'pointer' : 'not-allowed',
        }}
      >
        merge
      </button>
    </section>
  );
}
