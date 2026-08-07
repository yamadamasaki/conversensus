import type { Node } from '@xyflow/react';
import { DEFAULT_NODE_STYLE, RF_GROUP_NODE_TYPE } from '../graphTransform';

export type Position = { x: number; y: number };
export type NodeDepth = number;
export type GroupBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// 親子チェーンを辿るループの上限。データ破損で循環参照ができても停止させる
const MAX_ANCESTOR_HOPS = 100;

// 幅・高さが未測定かつ未指定のグループに使う既定値
const FALLBACK_GROUP_WIDTH = 300;
const FALLBACK_GROUP_HEIGHT = 200;

const ZERO_BUFFER: Position = { x: 0, y: 0 };

const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

function findById(nodes: Node[], id: string | undefined): Node | undefined {
  if (!id) return undefined;
  return nodes.find((n) => n.id === id);
}

/**
 * 祖先チェーンを再帰的に畳んで絶対座標を求める。
 *
 * React Flow の `node.positionAbsolute` は非同期に更新されるため、ドラッグ中は
 * stale でありうる。ここでは一切依存せず、`node.position` (親からの相対座標) と
 * 祖先の位置だけから計算する。
 *
 * 親が見つからない場合 (孤児ノード) はそこで打ち切る。React Flow は親不在の子の
 * 相対座標をそのまま絶対座標として扱うため、その挙動に合わせる。
 */
export function absolutePositionOf(node: Node, nodes: Node[]): Position {
  let { x, y } = node.position;
  let parentId = node.parentId;

  for (let hop = 0; parentId && hop < MAX_ANCESTOR_HOPS; hop++) {
    const parent = findById(nodes, parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
}

/** 絶対座標を、指定した親から見た相対座標へ変換する。親が無ければ絶対座標のまま */
export function toParentRelative(
  absolute: Position,
  parentId: string | undefined,
  nodes: Node[],
): Position {
  const parent = findById(nodes, parentId);
  if (!parent) return { ...absolute };

  const parentAbsolute = absolutePositionOf(parent, nodes);
  return {
    x: absolute.x - parentAbsolute.x,
    y: absolute.y - parentAbsolute.y,
  };
}

/** 入れ子の深さ。トップレベルのノードは 0 */
export function depthOf(node: Node, nodes: Node[]): NodeDepth {
  let depth = 0;
  let parentId = node.parentId;

  for (let hop = 0; parentId && hop < MAX_ANCESTOR_HOPS; hop++) {
    const parent = findById(nodes, parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parentId;
  }

  return depth;
}

/** candidateId が targetId の祖先か */
export function isAncestorOf(
  candidateId: string,
  targetId: string,
  nodes: Node[],
): boolean {
  let parentId = findById(nodes, targetId)?.parentId;

  for (let hop = 0; parentId && hop < MAX_ANCESTOR_HOPS; hop++) {
    if (parentId === candidateId) return true;
    parentId = findById(nodes, parentId)?.parentId;
  }

  return false;
}

/**
 * グループの絶対座標での境界。
 *
 * 幅・高さは measured と style の大きい方を採る。recalculateParentBounds が style を
 * 更新した直後は DOM の再測定が追いつかず measured が小さいままになるため、
 * 大きい方を採ることで境界値が安定する。
 */
export function groupBoundsOf(group: Node, nodes: Node[]): GroupBounds {
  const styleWidth =
    typeof group.style?.width === 'number' ? group.style.width : 0;
  const styleHeight =
    typeof group.style?.height === 'number' ? group.style.height : 0;
  const { x, y } = absolutePositionOf(group, nodes);

  return {
    x,
    y,
    width:
      Math.max(group.measured?.width ?? 0, styleWidth) || FALLBACK_GROUP_WIDTH,
    height:
      Math.max(group.measured?.height ?? 0, styleHeight) ||
      FALLBACK_GROUP_HEIGHT,
  };
}

/** 絶対座標の点がグループの内側にあるか。buffer は境界を外側に広げる余裕 */
export function pointInGroup(
  point: Position,
  group: Node,
  nodes: Node[],
  buffer: Position = ZERO_BUFFER,
): boolean {
  const { x, y, width, height } = groupBoundsOf(group, nodes);

  return (
    point.x >= x - buffer.x &&
    point.x <= x + width + buffer.x &&
    point.y >= y - buffer.y &&
    point.y <= y + height + buffer.y
  );
}

/** ノードの表示サイズ。未測定なら既定値にフォールバックする */
export function nodeSizeOf(node: Node): { width: number; height: number } {
  return {
    width: Number(
      node.measured?.width ?? node.style?.width ?? DEFAULT_NODE_STYLE.width,
    ),
    height: Number(
      node.measured?.height ?? node.style?.height ?? DEFAULT_NODE_STYLE.height,
    ),
  };
}

/** ノードの絶対座標での中心点 */
export function absoluteCenterOf(node: Node, nodes: Node[]): Position {
  const { x, y } = absolutePositionOf(node, nodes);
  const { width, height } = nodeSizeOf(node);

  return { x: x + width / 2, y: y + height / 2 };
}

export type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * 対象ノード群を絶対座標で囲む外接矩形。
 *
 * `node.position` は各ノードの親からの相対座標なので、親が揃っていないノードを
 * そのまま比較すると異なる座標系を混ぜることになる。必ず絶対座標に揃えてから求める。
 */
export function absoluteBoundingBoxOf(
  targets: Node[],
  nodes: Node[],
): BoundingBox | undefined {
  if (targets.length === 0) return undefined;

  const corners = targets.map((target) => {
    const { x, y } = absolutePositionOf(target, nodes);
    const { width, height } = nodeSizeOf(target);
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
  });

  return {
    minX: Math.min(...corners.map((c) => c.minX)),
    minY: Math.min(...corners.map((c) => c.minY)),
    maxX: Math.max(...corners.map((c) => c.maxX)),
    maxY: Math.max(...corners.map((c) => c.maxY)),
  };
}

/** nodeId の子孫すべての id (自身は含まない) */
export function descendantIdsOf(nodeId: string, nodes: Node[]): Set<string> {
  return new Set(
    nodes.filter((n) => isAncestorOf(nodeId, n.id, nodes)).map((n) => n.id),
  );
}

/**
 * 点を含むグループのうち最も内側のものを返す。
 *
 * 候補が複数あるときは深さが最大のものを選び、同じ深さなら面積が小さい方を選ぶ。
 * 配列順には依存しない。React Flow は「親は配列上で子より前」を要求するため、
 * 配列順の最初の一致を採ると入れ子では必ず外側のグループが勝ってしまう。
 */
export function innermostGroupAt(
  point: Position,
  nodes: Node[],
  excludeIds: ReadonlySet<string> = EMPTY_ID_SET,
): Node | undefined {
  let best: Node | undefined;
  let bestDepth = -1;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const candidate of nodes) {
    if (candidate.type !== RF_GROUP_NODE_TYPE) continue;
    if (excludeIds.has(candidate.id)) continue;
    if (!pointInGroup(point, candidate, nodes)) continue;

    const depth = depthOf(candidate, nodes);
    const { width, height } = groupBoundsOf(candidate, nodes);
    const area = width * height;

    if (depth > bestDepth || (depth === bestDepth && area < bestArea)) {
      best = candidate;
      bestDepth = depth;
      bestArea = area;
    }
  }

  return best;
}

/**
 * ドラッグされたノードの新しい親グループを解決する。undefined はトップレベルを意味する。
 *
 * `node` にはドラッグ中の最新の位置を持つノードを渡す (`nodes` 内の同じノードは stale で
 * ありうる)。ハイライト (onNodeDrag) と確定 (onNodeDragStop) の両方がこの関数を共用し、
 * 画面に見えているハイライトと実際の移動先が食い違わないようにする。
 */
export function resolveDropTarget(node: Node, nodes: Node[]): Node | undefined {
  const center = absoluteCenterOf(node, nodes);

  // 自分自身と自分の子孫は候補から外す (子孫を親にすると循環する)
  const excluded = descendantIdsOf(node.id, nodes);
  excluded.add(node.id);

  const target = innermostGroupAt(center, nodes, excluded);
  if (target) return target;

  // どのグループにも入っていないときだけ、現在の親に留まる余裕を見る。
  // ノード自身の幅・高さの半分をバッファに使い、ほぼ完全に出たときだけ離脱とみなす
  const parent = findById(nodes, node.parentId);
  if (!parent) return undefined;

  const { width, height } = nodeSizeOf(node);
  return pointInGroup(center, parent, nodes, { x: width / 2, y: height / 2 })
    ? parent
    : undefined;
}
