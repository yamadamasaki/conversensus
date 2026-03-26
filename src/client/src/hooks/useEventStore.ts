import type { Edge, Node } from '@xyflow/react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvent } from '../events/applyEvent';
import type { GraphEvent } from '../events/GraphEvent';
import { invertEvent } from '../events/invertEvent';

const MAX_UNDO_STACK = 50;

export function useEventStore(
  nodes: Node[],
  edges: Edge[],
  setNodes: Dispatch<SetStateAction<Node[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
): {
  dispatch: (event: GraphEvent) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  eventLog: GraphEvent[];
  setDragging: (dragging: boolean) => void;
} {
  const eventLogRef = useRef<GraphEvent[]>([]);
  const undoStackRef = useRef<GraphEvent[]>([]);
  const redoStackRef = useRef<GraphEvent[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const stateRef = useRef({ nodes, edges });
  stateRef.current = { nodes, edges };
  const isDraggingRef = useRef(false);
  const setDragging = useCallback((dragging: boolean) => {
    isDraggingRef.current = dragging;
  }, []);

  const dispatch = useCallback(
    (event: GraphEvent) => {
      const { nodes: currentNodes, edges: currentEdges } = stateRef.current;
      const inverse = invertEvent(event);
      const { nodes: newNodes, edges: newEdges } = applyEvent(
        event,
        currentNodes,
        currentEdges,
      );
      stateRef.current = { nodes: newNodes, edges: newEdges };
      setNodes(newNodes);
      setEdges(newEdges);
      eventLogRef.current = [...eventLogRef.current, event];
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_UNDO_STACK - 1)),
        inverse,
      ];
      redoStackRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
    },
    [setNodes, setEdges],
  );

  const undo = useCallback(() => {
    const inverseEvent = undoStackRef.current.pop();
    if (!inverseEvent) return;
    const { nodes: currentNodes, edges: currentEdges } = stateRef.current;
    redoStackRef.current.push(invertEvent(inverseEvent));
    const { nodes: newNodes, edges: newEdges } = applyEvent(
      inverseEvent,
      currentNodes,
      currentEdges,
    );
    stateRef.current = { nodes: newNodes, edges: newEdges };
    setNodes(newNodes);
    setEdges(newEdges);
    eventLogRef.current = [...eventLogRef.current, inverseEvent];
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    const redoEvent = redoStackRef.current.pop();
    if (!redoEvent) return;
    const { nodes: currentNodes, edges: currentEdges } = stateRef.current;
    undoStackRef.current.push(invertEvent(redoEvent));
    const { nodes: newNodes, edges: newEdges } = applyEvent(
      redoEvent,
      currentNodes,
      currentEdges,
    );
    stateRef.current = { nodes: newNodes, edges: newEdges };
    setNodes(newNodes);
    setEdges(newEdges);
    eventLogRef.current = [...eventLogRef.current, redoEvent];
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, [setNodes, setEdges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (isDraggingRef.current) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  return {
    dispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    eventLog: eventLogRef.current,
    setDragging,
  };
}
