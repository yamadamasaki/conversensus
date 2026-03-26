import { createContext, useContext } from 'react';
import type { GraphEvent } from './events/GraphEvent';

export const EventDispatchContext = createContext<
  ((event: GraphEvent) => void) | null
>(null);

export function useEventDispatch(): (
  event: GraphEvent,
) => void {
  const dispatch = useContext(EventDispatchContext);
  if (!dispatch)
    throw new Error(
      'useEventDispatch must be used within EventDispatchContext.Provider',
    );
  return dispatch;
}
