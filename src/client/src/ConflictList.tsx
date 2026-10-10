import { color, font, radius } from './theme';
/**
 * conflict list (step3 Phase 5, 仕様 merger)
 *
 * 解消すべき競合の一覧。**チェックは「その競合を解消した」とユーザが理解したときに入れる** — 解消が
 * 正しいかを形式的に確かめることは難しい (仕様)。すべてにチェックが入り、コメントがあれば merge できる。
 * コメントは merge (と、解決の編集が未コミットならそのコミット) の message になる
 */

import type { MergeConflict, Op } from '@conversensus/shared';
import { useState } from 'react';
import { mergerCheckKey, type SideLabels } from './sync/merger';

type Props = {
  conflicts: readonly MergeConflict[];
  /** 競合の対象の名前 (分岐点での名前) */
  labelOf: (target: string) => string;
  checked: readonly string[];
  onToggle: (key: string) => void;
  onMerge: (comment: string) => void;
  /** merge を実行中 (二度押しさせない) */
  busy?: boolean;
  /**
   * 競合の両側の呼び名。既定は merge 先 (trunk) と merge 元 (branch)。fork (保留した競合, S5-3) の
   * 両側は trunk と branch ではなく、並行に書いた 2 人である
   */
  sideLabels?: SideLabels;
};

const BRANCH_SIDE_LABELS: SideLabels = {
  ours: 'merge 先',
  theirs: 'merge 元',
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
  sideLabels = BRANCH_SIDE_LABELS,
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
        fontSize: font.body,
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      <h3 style={{ margin: '0 0 6px', fontSize: font.body }}>
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
              style={{
                borderBottom: `1px solid ${color.borderSubtle}`,
                padding: '4px 0',
              }}
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
                  {sideLabels.ours}: {describeSide(c.ours.op)} /{' '}
                  {sideLabels.theirs}: {describeSide(c.theirs.op)}
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
        style={{ marginTop: 6, fontSize: font.body, resize: 'vertical' }}
      />
      <button
        type="button"
        disabled={!canMerge}
        onClick={() => onMerge(comment.trim())}
        style={{
          marginTop: 6,
          alignSelf: 'flex-end',
          padding: '4px 16px',
          background: canMerge ? color.primary : color.border,
          color: color.textOnPrimary,
          border: 'none',
          borderRadius: radius.md,
          cursor: canMerge ? 'pointer' : 'not-allowed',
        }}
      >
        merge
      </button>
    </section>
  );
}
