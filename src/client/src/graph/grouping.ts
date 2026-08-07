import type { GraphNode, NodeId, NodeLayout } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import type {
  GroupChildPlacement,
  NodesGroupedEvent,
  NodesUngroupedEvent,
} from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';
import {
  fromFlowNodes,
  GROUP_NODE_TYPE,
  GROUP_PADDING,
  GROUP_TITLE_HEIGHT,
  RF_GROUP_NODE_TYPE,
} from '../graphTransform';
import {
  absoluteBoundingBoxOf,
  absolutePositionOf,
  ancestorsOf,
  toParentRelative,
} from './coords';

const DEFAULT_GROUP_LABEL = 'グループ';

const NO_GROUPS: ReadonlySet<string> = new Set<string>();

/**
 * 選択ノードを囲む新しいグループを作る `NODES_GROUPED` を組み立てる。
 *
 * 選択が空なら undefined を返す。選択ノードの親は揃っているとは限らないので、
 * 外接矩形は絶対座標で求める (座標系の混在を避ける)。
 * 親が全て同じ場合だけ、新しいグループ自身もその親の子として作る。
 */
export function buildNodesGroupedEvent(
  selected: Node[],
  nodes: Node[],
): NodesGroupedEvent | undefined {
  const box = absoluteBoundingBoxOf(selected, nodes);
  if (!box) return undefined;

  const sharedParentId = selected.every(
    (n) => n.parentId === selected[0].parentId,
  )
    ? (selected[0].parentId as NodeId | undefined)
    : undefined;

  const parentAbsolute = {
    x: box.minX - GROUP_PADDING,
    y: box.minY - GROUP_PADDING - GROUP_TITLE_HEIGHT,
  };
  const parentId = crypto.randomUUID() as NodeId;

  const parentData: GraphNode = {
    id: parentId,
    content: DEFAULT_GROUP_LABEL,
    nodeType: GROUP_NODE_TYPE,
    ...(sharedParentId ? { parentId: sharedParentId } : {}),
  };

  // グループ自身の position は、その親 (sharedParentId) から見た相対座標である
  const parentPosition = toParentRelative(
    parentAbsolute,
    sharedParentId,
    nodes,
  );

  const parentLayout: NodeLayout = {
    nodeId: parentId,
    x: parentPosition.x,
    y: parentPosition.y,
    width: box.maxX - box.minX + GROUP_PADDING * 2,
    height: box.maxY - box.minY + GROUP_PADDING * 2 + GROUP_TITLE_HEIGHT,
  };

  const children: GroupChildPlacement[] = selected.map((n) => {
    const absolute = absolutePositionOf(n, nodes);
    return {
      nodeId: n.id as NodeId,
      outerParentId: n.parentId as NodeId | undefined,
      outerPosition: { x: n.position.x, y: n.position.y },
      innerPosition: {
        x: absolute.x - parentAbsolute.x,
        y: absolute.y - parentAbsolute.y,
      },
    };
  });

  return {
    ...makeEventBase('structure'),
    type: 'NODES_GROUPED',
    parentId,
    parentData,
    parentLayout,
    children,
  };
}

/**
 * グループを解除する `NODES_UNGROUPED` を組み立てる。group 以外を渡すと undefined。
 *
 * ペイロードは**解除時点の実状態から**構築する。子はグループの一段上のレベル
 * (グループの現在の親。無ければトップレベル) へ移すので、`outerPosition` は
 * 子の現在の絶対座標を新しい親から見た相対座標へ直した値になる。
 * グループ化した後にグループを動かしていても、子が画面上の同じ位置に留まる。
 *
 * `innerPosition` には子の現在の位置 (グループから見た相対座標) を入れる。
 * これは undo (= `NODES_GROUPED`) がグループの中の配置を復元するために使う。
 *
 * `alsoUngrouped` には同時に解除される他のグループの id を渡す。入れ子のグループを
 * まとめて解除するとき、消える予定のグループを親に指定して孤児を作らないよう、
 * 生き残る一番近い祖先まで遡る。絶対座標は解除で変わらないので、複数の解除イベントを
 * 同じスナップショットから組み立てても順序によらず結果は同じになる。
 */
export function buildNodesUngroupedEvent(
  group: Node,
  nodes: Node[],
  alsoUngrouped: ReadonlySet<string> = NO_GROUPS,
): NodesUngroupedEvent | undefined {
  if (group.type !== RF_GROUP_NODE_TYPE) return undefined;

  const { nodes: graphNodes, layouts } = fromFlowNodes([group]);
  const outerParentId = ancestorsOf(group, nodes).find(
    (a) => !alsoUngrouped.has(a.id),
  )?.id as NodeId | undefined;

  const children: GroupChildPlacement[] = nodes
    .filter((n) => n.parentId === group.id)
    .map((child) => ({
      nodeId: child.id as NodeId,
      outerParentId,
      outerPosition: toParentRelative(
        absolutePositionOf(child, nodes),
        outerParentId,
        nodes,
      ),
      innerPosition: { x: child.position.x, y: child.position.y },
    }));

  return {
    ...makeEventBase('structure'),
    type: 'NODES_UNGROUPED',
    parentId: group.id as NodeId,
    parentData: graphNodes[0],
    parentLayout: layouts[0],
    children,
  };
}
