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
import { AuthorAvatars, NODE_AVATAR_CORNER } from './graph/AuthorAvatars';
import { DiffMark } from './graph/DiffMark';
import { useGraphNodeHandlers } from './graph/graphNodeContext';
import { FloatingNodeLabel, NodeLabel } from './graph/NodeLabel';
import { useInlineEdit } from './hooks/useInlineEdit';
import { useMessages } from './i18n/messages';
import { MARKDOWN_COMPONENTS } from './markdownComponents';
import { NodeBadges } from './nodeActions/NodeBadges';
import { useReadOnly } from './readOnlyContext';
import { color, font, monospace, radius } from './theme';

export function EditableNode({ id, data, selected }: NodeProps) {
  const t = useMessages();
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
   * LPG の label。**本文 (`content`) とは別物**である — `content` は markdown の本文で、
   * `label` は利用者が自由に付ける名前か、template が与える「主張」「反論」などの種別名、
   * metagraph の graph node なら `graph` (step4)。空なら何も描かない
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
  const derivedFrom = (
    data.properties as Record<string, unknown> | undefined
  )?.[DERIVED_FROM_SHEET_PROPERTY];
  const graphNodeSheet =
    typeof derivedFrom === 'string' ? (derivedFrom as SheetId) : undefined;
  /** graph node の label (`graph`) は導出で、保存しないので変えられない (step4) */
  const labelLocked =
    kindFromTemplate || readOnly || graphNodeSheet !== undefined;
  const diffType = data.diffType as 'add' | 'update' | undefined;
  const ghost = data.ghost === true;

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
              <span style={{ color: color.textMuted }}>
                {t.graph.emptyNode}
              </span>
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

  /*
   * label (#326 で `NodeLabel` に切り出した)。**label の無い node では、口を本文の外 (上辺の上) に
   * 浮かせる** (#272, visual language §8.1)。本文の中に置くと、選んだだけで本文が下へずれる。
   * label があれば本文の一部として中に置く
   */
  const labelSlot = (
    <NodeLabel
      nodeId={id}
      label={label}
      selected={selected}
      locked={labelLocked}
      properties={data.properties as Record<string, unknown> | undefined}
    />
  );

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
      {!label && <FloatingNodeLabel>{labelSlot}</FloatingNodeLabel>}
      {/* 書いた人 (#354)。右下の角に重ねる (左上は種別の label が浮く) */}
      <AuthorAvatars elementId={id} style={NODE_AVATAR_CORNER} />
      {diffType && <DiffMark diffType={diffType} />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: ノードコンテナはダブルクリックで編集を開始する */}
      <div
        data-node-body
        data-node-frame
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
        {label && labelSlot}
        {/* 印は module が決める (依頼の状態など、計画 node-actions-request-module.md N3) */}
        <NodeBadges
          nodeId={id}
          content={content}
          properties={data.properties as Record<string, unknown> | undefined}
        />
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
              <span style={{ color: color.textMuted }}>{t.graph.editHint}</span>
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
