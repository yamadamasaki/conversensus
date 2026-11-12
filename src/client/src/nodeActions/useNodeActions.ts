/**
 * node の操作を画面につなぐ (計画 N2、Q1 案 a)
 *
 * - **node のそば**: node を 1 つだけ選んでいるとき、その node に使える操作を出す (`toolbar`)
 * - **右クリックのメニュー**: 同じ操作を、右クリックした node について出す (`menu`)
 * - **押したとき**: 引数が無ければすぐ実行し、あれば dialog を開く (`dialog`)
 *
 * 何を出すかと実行の判断は `registry.ts` (純粋な関数) にあり、ここは React Flow の state から
 * 文脈を作って渡すだけである。実行は GraphEvent 1 つを dispatch する (1 回の undo で戻る)。
 */

import type { Edge, Node } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import type { DispatchOptions } from '../hooks/useEventStore';
import { useLocale } from '../i18n/messages';
import { type ActionEnv, actionContextOf } from './flowContext';
import { type ActionArgs, NodeActionError } from './nodeAction';
import {
  type AvailableAction,
  normalizeInitialArgs,
  runNodeAction,
} from './registry';
import { useNodeActionRegistry } from './registryContext';

/** メニューの幅の見込み (画面の右端からはみ出さないように寄せる) */
const MENU_WIDTH = 180;
/** メニューの 1 行の高さの見込み (下端からはみ出さないように寄せる) */
const MENU_ROW_HEIGHT = 32;
/** 画面の端との間 */
const MENU_MARGIN = 8;

export type NodeActionMenuState = {
  nodeId: string;
  actions: AvailableAction[];
  x: number;
  y: number;
};

export type NodeActionDialogState = {
  nodeId: string;
  found: AvailableAction;
  initial: ActionArgs;
};

type Deps = {
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** 実行の直前の今の姿 (dialog を開いている間に変わりうる) */
  getNodes: () => Node[];
  getEdges: () => Edge[];
  env: ActionEnv;
  readOnly: boolean;
  dispatch: (event: GraphEvent, options?: DispatchOptions) => void;
  /** 選ぶ (実行の後に対象の node を選び直す) */
  select: (ids: readonly string[]) => void;
};

export function useNodeActions({
  nodes,
  edges,
  getNodes,
  getEdges,
  env,
  readOnly,
  dispatch,
  select,
}: Deps) {
  const registry = useNodeActionRegistry();
  const locale = useLocale();
  // 操作が書く文言は、操作する人の言語にする
  const ctxEnv = useMemo(() => ({ ...env, locale }), [env, locale]);
  const [menu, setMenu] = useState<NodeActionMenuState | null>(null);
  const [dialog, setDialog] = useState<NodeActionDialogState | null>(null);

  const actionsOf = useCallback(
    (nodeId: string, ns: readonly Node[], es: readonly Edge[]) => {
      const ctx = actionContextOf(nodeId, ns, es, ctxEnv);
      return ctx ? registry.actionsFor(ctx, { readOnly }) : [];
    },
    [registry, ctxEnv, readOnly],
  );

  /** node のそばに出す操作: 1 つだけ選んでいる、ゴーストでない node について */
  const toolbar = useMemo(() => {
    const selected = nodes.filter((n) => n.selected && !n.data?.ghost);
    const only = selected.length === 1 ? selected[0] : undefined;
    if (!only) return undefined;
    const actions = actionsOf(only.id, nodes, edges);
    return actions.length > 0 ? { nodeId: only.id, actions } : undefined;
  }, [nodes, edges, actionsOf]);

  /** 実行する。できなければ理由を返す */
  const execute = useCallback(
    (nodeId: string, key: string, args: ActionArgs): string | undefined => {
      const ctx = actionContextOf(nodeId, getNodes(), getEdges(), ctxEnv);
      if (!ctx) return `node ${nodeId} が無い`;
      try {
        const event = runNodeAction(registry, key, ctx, args, { readOnly });
        // 相手に届く行為は undo に積まない (`NodeAction.undoable`)
        dispatch(event, {
          undoable: registry.find(key)?.action.undoable !== false,
        });
        // node を足す操作 (依頼の「答える」など) は貼り付けと同じく選択を外す。対象の node を選んだままにして、
        // 続けて操作できるようにする
        select([nodeId]);
        return undefined;
      } catch (error) {
        if (!(error instanceof NodeActionError)) throw error;
        return error.message;
      }
    },
    [registry, ctxEnv, readOnly, dispatch, select, getNodes, getEdges],
  );

  /** 操作を押した: 引数が無ければすぐ実行、あれば dialog を開く */
  const pick = useCallback(
    (nodeId: string, found: AvailableAction) => {
      setMenu(null);
      const params = found.action.params ?? [];
      if (params.length === 0) {
        const reason = execute(nodeId, found.key, {});
        // 押した時点では使えたので、ここに来るのは直前に他の人が書いたときだけ
        if (reason) console.warn('[nodeActions] 実行できなかった:', reason);
        return;
      }
      const ctx = actionContextOf(nodeId, getNodes(), getEdges(), ctxEnv);
      if (!ctx) return;
      setDialog({
        nodeId,
        found,
        // 宣言に合わない初めの値 (選択肢に無い値など) は直してから出す (#393)
        initial: normalizeInitialArgs(
          params,
          found.action.initial?.(ctx) ?? {},
        ),
      });
    },
    [execute, ctxEnv, getNodes, getEdges],
  );

  const onNodeContextMenu = useCallback(
    (e: MouseEvent, node: Node) => {
      const actions = actionsOf(node.id, getNodes(), getEdges());
      // 使える操作が無ければ、ブラウザのメニューを止めない
      if (actions.length === 0) return;
      e.preventDefault();
      const height = MENU_ROW_HEIGHT * (actions.length + 1);
      setMenu({
        nodeId: node.id,
        actions,
        x: Math.min(e.clientX, window.innerWidth - MENU_WIDTH - MENU_MARGIN),
        y: Math.min(e.clientY, window.innerHeight - height - MENU_MARGIN),
      });
    },
    [actionsOf, getNodes, getEdges],
  );

  // メニューの外のクリック / Esc で閉じる (edge のメニューと同じ)
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  return {
    toolbar,
    menu,
    dialog,
    pick,
    onNodeContextMenu,
    /** dialog の「実行」。できれば閉じ、できなければ理由を返す */
    submitDialog: (args: ActionArgs) => {
      if (!dialog) return undefined;
      const reason = execute(dialog.nodeId, dialog.found.key, args);
      if (!reason) setDialog(null);
      return reason;
    },
    closeDialog: () => setDialog(null),
  };
}
