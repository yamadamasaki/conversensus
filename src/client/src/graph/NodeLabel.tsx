/**
 * node の LPG の label を描き、編集させる口 (#326)
 *
 * markdown の node (`EditableNode`) だけが持っていたものを、画像 (`ImageNode`) と group (`GroupNode`) でも
 * 使えるように切り出した。label は**本文 (`content`) とは別物**で、利用者が自由に付ける名前か、template が
 * 与える「主張」「反論」などの種別名である。
 *
 * - **変更できない label は button にしない** (仕様 OnMutation)。押せそうに見えて押せない要素になる
 * - label の無い node では**選択中だけ**付ける口を出す。常に出すと、label を使わない普通のグラフが賑やかになる
 * - 置き場所は呼び出し側が決める (`FloatingNodeLabel` は node の上辺の上に浮かせる)
 */

import type { NodeId } from '@conversensus/shared';
import type { CSSProperties, ReactNode } from 'react';
import { useEventDispatch } from '../EventDispatchContext';
import { makeEventBase } from '../events/GraphEvent';
import { useInlineEdit } from '../hooks/useInlineEdit';
import { color, font, radius } from '../theme';
import { useKindLabel } from './kindLabelContext';

/** label の見た目。空のとき (label を付ける口) は破線の枠だけにする */
function chipStyle(label: string, editable: boolean): CSSProperties {
  return {
    fontSize: font.caption,
    color: label ? color.primary : color.textMuted,
    background: label ? color.selectionBg : 'transparent',
    border: label ? 'none' : `1px dashed ${color.border}`,
    borderRadius: radius.sm,
    padding: '1px 5px',
    marginBottom: 4,
    display: 'inline-block',
    cursor: editable ? 'text' : 'default',
  };
}

/** label の口を node の上辺の上に浮かせる (本文を押し下げない) */
const FLOATING_LABEL = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: 2,
  zIndex: 1,
} as const;

/** 空の口に出す字 (label という語そのもの。訳さない — LPG の用語である) */
const EMPTY_LABEL_SLOT = 'label';

type Props = {
  nodeId: string;
  label: string;
  selected: boolean;
  /** 変更できないか (template の種別・読み取り専用の画面・graph node) */
  locked: boolean;
  /** node の property。種類の名前を見る人の言語で表示するのに使う (#356) */
  properties?: Readonly<Record<string, unknown>>;
};

/** label の口。出すものが無ければ null */
export function NodeLabel({
  nodeId,
  label,
  selected,
  locked,
  properties,
}: Props) {
  const { dispatch } = useEventDispatch();
  // 表示だけを見る人の言語にする (#356)。編集は生の label を扱う
  const shown = useKindLabel()('node', properties, label);
  const edit = useInlineEdit(label, (value) => {
    if (value === label) return;
    dispatch({
      ...makeEventBase('content'),
      type: 'NODE_LABEL_CHANGED',
      nodeId: nodeId as NodeId,
      from: label,
      to: value,
    });
  });

  if (edit.editing)
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: 編集開始時に即座に入力できるよう必要
        autoFocus
        className="nodrag nopan"
        data-node-label-input
        value={edit.inputValue}
        onChange={(e) => edit.setInputValue(e.target.value)}
        onBlur={edit.confirm}
        onCompositionStart={() => edit.setComposing(true)}
        onCompositionEnd={() => edit.setComposing(false)}
        onKeyDown={(e) => {
          if (edit.composingRef.current) return; // IME 変換中は無視
          if (e.key === 'Enter') edit.confirm();
          if (e.key === 'Escape') edit.cancel();
        }}
        style={{
          fontSize: font.caption,
          padding: '1px 4px',
          marginBottom: 4,
          borderRadius: radius.sm,
          border: `1px solid ${color.primary}`,
          outline: 'none',
          width: '60%',
        }}
      />
    );
  if (!label && (!selected || locked)) return null;
  if (locked)
    return (
      <div data-node-label style={chipStyle(shown, false)}>
        {shown}
      </div>
    );
  return (
    <button
      type="button"
      data-node-label
      data-editable="true"
      className="nodrag nopan"
      // **クリック 1 回で編集に入る。**本文のダブルクリックと違い、これは「label を付ける」と
      // 書かれた明示的な口である。しかも label の無い node では**選択中しか出ない**ので、
      // ダブルクリックの途中で選択が外れると口ごと消えてしまう (実機で踏んだ)
      onClick={(e) => {
        e.stopPropagation();
        edit.startEdit();
      }}
      style={chipStyle(label, true)}
    >
      {shown || EMPTY_LABEL_SLOT}
    </button>
  );
}

/** node の上辺の上に浮かせて置く (#272, visual language §8.1)。本文や見出しを押し下げない */
export function FloatingNodeLabel({ children }: { children: ReactNode }) {
  return <div style={FLOATING_LABEL}>{children}</div>;
}
