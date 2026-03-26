import { createContext, useContext } from 'react';
import type { GraphEvent } from './events/GraphEvent';

type EventStoreContextValue = {
  dispatch: (event: GraphEvent) => void;
  // ラベルドラッグ中は undo/redo を抑制するためのフラグ
  setDragging: (dragging: boolean) => void;
};

export const EventDispatchContext =
  createContext<EventStoreContextValue | null>(null);

export function useEventDispatch(): EventStoreContextValue {
  const ctx = useContext(EventDispatchContext);
  if (!ctx)
    throw new Error(
      'useEventDispatch must be used within EventDispatchContext.Provider',
    );
  return ctx;
}
