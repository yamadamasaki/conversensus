/**
 * useSidePanels: 左右のサイドバーの幅と開閉を state として持ち、`localStorage` に写す
 * (step3 Phase 3 S3-4b)。規則 (幅の範囲・読み戻しの検め) は `layout/sidePanels.ts` にある
 */

import { useCallback, useEffect, useState } from 'react';
import {
  type PanelSide,
  parseSidePanels,
  SIDE_PANELS_STORAGE_KEY,
  type SidePanelsState,
  serializeSidePanels,
} from '../layout/sidePanels';
import { safeLocalStorage } from '../sync/safeStorage';

function restore(): SidePanelsState {
  try {
    return parseSidePanels(
      safeLocalStorage()?.getItem(SIDE_PANELS_STORAGE_KEY) ?? null,
    );
  } catch {
    return parseSidePanels(null);
  }
}

export function useSidePanels() {
  const [state, setState] = useState<SidePanelsState>(restore);

  useEffect(() => {
    try {
      safeLocalStorage()?.setItem(
        SIDE_PANELS_STORAGE_KEY,
        serializeSidePanels(state),
      );
    } catch (error) {
      // 保存できなくても幅は変えられる。再読み込みで既定に戻るだけである
      console.warn('[layout] サイドバーの幅を保存できなかった:', error);
    }
  }, [state]);

  const setWidth = useCallback(
    (side: PanelSide, width: number) =>
      setState((s) => ({ ...s, [side]: { ...s[side], width } })),
    [],
  );
  const toggle = useCallback(
    (side: PanelSide) =>
      setState((s) => ({
        ...s,
        [side]: { ...s[side], collapsed: !s[side].collapsed },
      })),
    [],
  );

  return { state, setWidth, toggle };
}
