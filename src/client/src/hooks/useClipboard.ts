import type { Edge, Node } from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';
import {
  buildPastedData,
  collectCopyData,
  fromFlowEdges,
  fromFlowNodes,
} from '../graphTransform';

const PASTE_OFFSET_PX = 20;

export function useClipboard(
  getNodes: () => Node[],
  getEdges: () => Edge[],
  dispatch: (event: GraphEvent) => void,
): { copySelectedNodes: () => void; pasteNodes: () => void } {
  const clipboard = useRef<{
    nodes: Node[];
    edges: Edge[];
  } | null>(null);

  const copySelectedNodes = useCallback(() => {
    const copied = collectCopyData(getNodes(), getEdges());
    if (copied.nodes.length > 0) clipboard.current = copied;
  }, [getNodes, getEdges]);

  const pasteNodes = useCallback(() => {
    if (!clipboard.current) return;
    const { nodes: newNodes, edges: newEdges } =
      buildPastedData(clipboard.current, PASTE_OFFSET_PX);
    dispatch({
      ...makeEventBase('structure'),
      type: 'NODES_PASTED',
      nodes: fromFlowNodes(newNodes),
      edges: fromFlowEdges(newEdges),
    });
    // 次の貼り付けがさらにオフセットされるようクリップボードを更新
    clipboard.current = { nodes: newNodes, edges: newEdges };
  }, [dispatch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'c') {
        e.preventDefault();
        copySelectedNodes();
      } else if (e.key === 'v') {
        e.preventDefault();
        pasteNodes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [copySelectedNodes, pasteNodes]);

  return { copySelectedNodes, pasteNodes };
}
