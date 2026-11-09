/**
 * React Flow の node・edge から、module に渡す `NodeActionContext` を作る (計画 N2)
 *
 * module は React Flow を知らない (計画 §3.2) ので、画面の側でここを通して Sheet の形にする。
 * **ゴースト (消す予定の表示) は数えない** — 操作の対象にも、状態の導出にも、答えの置き場所にも。
 */

import type { Did, Sheet } from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';
import { fromFlowEdges, fromFlowNodes } from '../graphTransform';
import type { ActionActor, NodeActionContext } from './nodeAction';

/** 操作する人と、引数の候補 (画面の外 = App が持つもの) */
export type ActionEnv = {
  me: Did | undefined;
  participants: readonly ActionActor[];
};

const live = <T extends { data?: Record<string, unknown> }>(
  items: readonly T[],
) => items.filter((i) => i.data?.ghost !== true);

/** 今の canvas を Sheet の形にする (id と名前は module に要らないので空) */
export function sheetOfFlow(
  nodes: readonly Node[],
  edges: readonly Edge[],
): Sheet {
  const { nodes: graphNodes, layouts } = fromFlowNodes(live(nodes));
  const { edges: graphEdges } = fromFlowEdges(live(edges));
  return {
    id: '' as Sheet['id'],
    name: '',
    nodes: graphNodes,
    edges: graphEdges,
    layouts,
  };
}

/** この node への操作の文脈。node が無い・ゴーストなら undefined */
export function actionContextOf(
  nodeId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
  env: ActionEnv,
): NodeActionContext | undefined {
  const sheet = sheetOfFlow(nodes, edges);
  const node = sheet.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  return { node, sheet, me: env.me, participants: env.participants };
}
