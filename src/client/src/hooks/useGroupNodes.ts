import type { Node } from '@xyflow/react';
import { useCallback, useEffect } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import {
  buildNodesGroupedEvent,
  buildNodesUngroupedEvent,
} from '../graph/grouping';
import { RF_GROUP_NODE_TYPE } from '../graphTransform';

const GROUP_KEY = 'g';

/** ヘッダの「group にまとめる / 解く」を押せるか (#269)。下の 2 つの操作と同じ条件で決める */
export type GroupAbility = { canGroup: boolean; canUngroup: boolean };

export const NO_GROUP_ABILITY: GroupAbility = {
  canGroup: false,
  canUngroup: false,
};

/** まとめられるのは node を 1 つ以上選んだとき、解けるのは group を選んだとき */
export function groupAbilityOf(nodes: readonly Node[]): GroupAbility {
  const selected = nodes.filter((n) => n.selected);
  return {
    canGroup: selected.length >= 1,
    canUngroup: selected.some((n) => n.type === RF_GROUP_NODE_TYPE),
  };
}

export function useGroupNodes(
  getNodes: () => Node[],
  dispatch: (event: GraphEvent) => void,
): { groupSelectedNodes: () => void; ungroupSelectedNodes: () => void } {
  const groupSelectedNodes = useCallback(() => {
    const ns = getNodes();
    if (!groupAbilityOf(ns).canGroup) return;
    const selected = ns.filter((n) => n.selected);

    const event = buildNodesGroupedEvent(selected, ns);
    if (event) dispatch(event);
  }, [getNodes, dispatch]);

  // 選択されたグループを解除する。中身は一段上のレベルへ移り、画面上の位置は変わらない。
  // dispatch した結果は getNodes() に即座には反映されないため、全イベントを
  // 同じスナップショットから組み立てる。入れ子のグループを同時に選んだ場合に
  // 消える側を親に指定しないよう、解除するグループの id をまとめて渡す。
  const ungroupSelectedNodes = useCallback(() => {
    const ns = getNodes();
    const groups = ns.filter(
      (n) => n.selected && n.type === RF_GROUP_NODE_TYPE,
    );
    const groupIds = new Set(groups.map((g) => g.id));

    for (const group of groups) {
      const event = buildNodesUngroupedEvent(group, ns, groupIds);
      if (event) dispatch(event);
    }
  }, [getNodes, dispatch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // Shift を伴うと e.key は 'G' になるため、大文字小文字を無視して比べる
      if (e.key.toLowerCase() !== GROUP_KEY) return;
      e.preventDefault();
      if (e.shiftKey) ungroupSelectedNodes();
      else groupSelectedNodes();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [groupSelectedNodes, ungroupSelectedNodes]);

  return { groupSelectedNodes, ungroupSelectedNodes };
}
