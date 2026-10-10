import {
  DERIVED_FROM_SHEET_PROPERTY,
  hasTemplateKind,
  type NodeId,
  type SheetId,
} from '@conversensus/shared';
import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEventDispatch } from './EventDispatchContext';
import { makeEventBase } from './events/GraphEvent';
import { useGraphNodeHandlers } from './graph/graphNodeContext';
import { useInlineEdit } from './hooks/useInlineEdit';
import { MARKDOWN_COMPONENTS } from './markdownComponents';
import { useReadOnly } from './readOnlyContext';
import { color, font, monospace, radius } from './theme';

/** ラベルの見た目。空のとき (ラベルを付ける口) は破線の枠だけにする */
function chipStyle(label: string, editable: boolean): React.CSSProperties {
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

export function EditableNode({ id, data, selected }: NodeProps) {
  const { getNode } = useReactFlow();
  const { dispatch } = useEventDispatch();

  // onResizeStart で現在のサイズを保存
  const preSizeRef = useRef({ width: 0, height: 0 });

  const onResizeStart = useCallback(() => {
    const node = getNode(id);
    if (node) {
      preSizeRef.current = {
        width: Number(node.measured?.width ?? node.style?.width ?? 0),
        height: Number(node.measured?.height ?? node.style?.height ?? 0),
      };
    }
  }, [getNode, id]);

  const onResizeEnd = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      const from = preSizeRef.current;
      if (from.width !== params.width || from.height !== params.height) {
        dispatch({
          ...makeEventBase('layout'),
          type: 'NODE_RESIZED',
          nodeId: id as NodeId,
          from,
          to: {
            width: params.width,
            height: params.height,
          },
        });
      }
    },
    [dispatch, id],
  );

  const content = String(data.content ?? '');
  /**
   * 種別名 (Phase 5)。**本文 (`content`) とは別物**である — `content` は markdown の
   * 本文で、`label` は template が与える「主張」「反論」などの種別名。
   * template が当たっていないシートでは空なので、その場合は何も描かない
   */
  const label = String(data.label ?? '');
  /**
   * この node の種別が template のものか (Phase 5)。
   *
   * **これがラベルを編集させるかの分かれ目である** — template の種別は作成時に決まり
   * 変更できない (仕様 OnMutation) が、**その他の node のラベルは自由**である
   * (「五種類以外の node を自由に作り、ラベルを付け、変更することができる」)。
   */
  const kindFromTemplate = hasTemplateKind(
    data.properties as Record<string, unknown> | undefined,
  );
  /**
   * metagraph の graph node なら、そのシート (step3 Phase 4)。ダブルクリックは文字の編集ではなく
   * シートを開く (Q6)。名前の変更 (= 本文の編集) は選んで Enter / F2 で始まる
   */
  const graphNodes = useGraphNodeHandlers();
  /**
   * 読み取り専用の画面 (見るだけの pane・同期待ちの File) では文字の編集を始めさせない。ラベルの口も
   * 変更できないラベルと同じく出さない — merger の見るだけの pane は選択が連動する (step3 Phase 5) ので、
   * 選択中にだけ出る「ラベル」の口が、押しても何も起きない形で現れていた (実機で発覚)
   */
  const readOnly = useReadOnly();
  const labelLocked = kindFromTemplate || readOnly;
  const derivedFrom = (
    data.properties as Record<string, unknown> | undefined
  )?.[DERIVED_FROM_SHEET_PROPERTY];
  const graphNodeSheet =
    typeof derivedFrom === 'string' ? (derivedFrom as SheetId) : undefined;
  const diffType = data.diffType as 'add' | 'update' | undefined;
  const ghost = data.ghost === true;

  const labelEdit = useInlineEdit(label, (value) => {
    if (value !== label) {
      dispatch({
        ...makeEventBase('content'),
        type: 'NODE_LABEL_CHANGED',
        nodeId: id as NodeId,
        from: label,
        to: value,
      });
    }
  });

  const { editing, inputValue, setInputValue, startEdit, confirm, cancel } =
    useInlineEdit(content, (value) => {
      if (value !== content) {
        dispatch({
          ...makeEventBase('content'),
          type: 'NODE_CONTENT_CHANGED',
          nodeId: id as NodeId,
          from: content,
          to: value,
        });
      }
    });

  // 選んで Enter / F2 で名前の変更を始める (graph node, step3 Phase 4)。合図は 1 度使ったら消す
  useEffect(() => {
    if (graphNodes?.renameRequest !== id) return;
    startEdit();
    graphNodes.clearRenameRequest();
  }, [graphNodes, id, startEdit]);

  if (ghost) {
    // ghost のハンドルは ghost エッジの端点として座標を提供するだけで、
    // ここから新しいエッジを引くことはできない (ANA-121)
    return (
      <>
        <Handle
          type="source"
          position={Position.Top}
          id="source-top"
          isConnectable={false}
        />
        <div
          style={{
            padding: '8px 12px',
            borderRadius: radius.md,
            border: `1px dashed ${color.borderStrong}`,
            background: color.bgSubtle,
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            overflow: 'auto',
            cursor: 'default',
          }}
        >
          <div
            style={{
              fontSize: font.body,
              lineHeight: 1.6,
              textDecoration: 'line-through',
              color: color.textMuted,
            }}
            className="markdown-body"
          >
            {content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                {content}
              </ReactMarkdown>
            ) : (
              <span style={{ color: color.textMuted }}>(空)</span>
            )}
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          id="source-bottom"
          isConnectable={false}
        />
        <Handle
          type="source"
          position={Position.Left}
          id="source-left"
          isConnectable={false}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="source-right"
          isConnectable={false}
        />
      </>
    );
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={40}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
      <Handle type="source" position={Position.Top} id="source-top" />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: ノードコンテナはダブルクリックで編集を開始する */}
      <div
        data-node-body
        style={{
          padding: '8px 12px',
          borderRadius: radius.md,
          border: diffType
            ? diffType === 'add'
              ? `2px solid ${color.diffAdd}`
              : `2px solid ${color.diffUpdate}`
            : `1px solid ${color.border}`,
          background: diffType
            ? diffType === 'add'
              ? color.diffAddBg
              : color.diffUpdateBg
            : color.bg,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          overflow: 'auto',
          cursor: 'default',
        }}
        onDoubleClick={
          editing
            ? undefined
            : graphNodeSheet && graphNodes
              ? () => graphNodes.openSheet(graphNodeSheet)
              : readOnly
                ? undefined
                : startEdit
        }
      >
        {/*
          ラベル。**template の種別なら変更できない** (仕様 OnMutation) ので編集の口を
          出さない。その他の node のラベルは自由なので、ダブルクリックで編集に入る。
          ラベルを持たない node では**選択中だけ**付ける口を出す — 常に出すと、
          ラベルを使わない普通のグラフが賑やかになる
        */}
        {labelEdit.editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: 編集開始時に即座に入力できるよう必要
            autoFocus
            className="nodrag nopan"
            data-node-label-input
            value={labelEdit.inputValue}
            onChange={(e) => labelEdit.setInputValue(e.target.value)}
            onBlur={labelEdit.confirm}
            onCompositionStart={() => labelEdit.setComposing(true)}
            onCompositionEnd={() => labelEdit.setComposing(false)}
            onKeyDown={(e) => {
              if (labelEdit.composingRef.current) return; // IME 変換中は無視
              if (e.key === 'Enter') labelEdit.confirm();
              if (e.key === 'Escape') labelEdit.cancel();
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
        ) : (
          (label || (selected && !labelLocked)) &&
          // **編集できるかで要素そのものを変える。**変更できないラベルを button に
          // すると、押せそうに見えて押せない要素になる (仕様 OnMutation)
          (labelLocked ? (
            <div data-node-label style={chipStyle(label, false)}>
              {label}
            </div>
          ) : (
            <button
              type="button"
              data-node-label
              data-editable="true"
              className="nodrag nopan"
              // **クリック 1 回で編集に入る。**本文のダブルクリックと違い、これは
              // 「ラベルを付ける」と書かれた明示的な口である。しかもラベルの無い node
              // では**選択中しか出ない**ので、ダブルクリックの途中で選択が外れると
              // 口ごと消えてしまう (実機で踏んだ)
              onClick={(e) => {
                e.stopPropagation();
                labelEdit.startEdit();
              }}
              style={chipStyle(label, true)}
            >
              {label || 'ラベル'}
            </button>
          ))
        )}
        {editing ? (
          <textarea
            // biome-ignore lint/a11y/noAutofocus: ノード編集開始時に即座に入力できるよう autoFocus が必要
            autoFocus
            className="nodrag nopan"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={confirm}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
            }}
            style={{
              fontSize: font.body,
              padding: '2px 4px',
              borderRadius: radius.sm,
              border: `1px solid ${color.primary}`,
              outline: 'none',
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
              resize: 'none',
              fontFamily: monospace,
            }}
          />
        ) : (
          <div
            style={{
              fontSize: font.body,
              lineHeight: 1.6,
            }}
            className="markdown-body"
          >
            {content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                {content}
              </ReactMarkdown>
            ) : (
              <span style={{ color: color.textMuted }}>
                ダブルクリックで編集
              </span>
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
    </>
  );
}
