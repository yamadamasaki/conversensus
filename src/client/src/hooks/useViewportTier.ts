/**
 * useViewportTier: 画面の幅の段 (visual language §9.2)。幅が段を跨いだときだけ描き直す
 */

import { useSyncExternalStore } from 'react';
import { tierOf, type ViewportTier } from '../layout/viewportTier';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

export function useViewportTier(): ViewportTier {
  return useSyncExternalStore(subscribe, () => tierOf(window.innerWidth));
}
