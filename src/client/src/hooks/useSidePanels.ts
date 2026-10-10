/**
 * useSidePanels: 左右のサイドバーの幅と開閉を state として持ち、`localStorage` に写す
 * (step3 Phase 3 S3-4b)。規則 (幅の範囲・読み戻しの検め) は `layout/sidePanels.ts` にある
 *
 * 画面の幅の段 (visual language §9.2) で出し方を変える。**開閉を覚えるのは広い段だけ**で、
 * 狭い段の開閉はこの画面の間だけ持ち、段を跨いだら畳んだ状態に戻す
 * (`layout/viewportTier.ts`)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  type PanelSide,
  parseSidePanels,
  SIDE_PANELS_STORAGE_KEY,
  type SidePanelState,
  type SidePanelsState,
  serializeSidePanels,
} from '../layout/sidePanels';
import {
  type PanelPresentation,
  panelPresentation,
  type ViewportTier,
} from '../layout/viewportTier';
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

/** 狭い段の開閉の初め。どちらも畳んでおく */
const NONE_OPEN: Record<PanelSide, boolean> = { left: false, right: false };

export function useSidePanels(tier: ViewportTier = 'wide') {
  const [remembered, setRemembered] = useState<SidePanelsState>(restore);
  const [compactOpen, setCompactOpen] = useState(NONE_OPEN);

  useEffect(() => {
    try {
      safeLocalStorage()?.setItem(
        SIDE_PANELS_STORAGE_KEY,
        serializeSidePanels(remembered),
      );
    } catch (error) {
      // 保存できなくても幅は変えられる。再読み込みで既定に戻るだけである
      console.warn('[layout] サイドバーの幅を保存できなかった:', error);
    }
  }, [remembered]);

  // 段を跨いだら、狭い段の開閉は畳んだ状態から始め直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: tier が変わったときだけ戻す
  useEffect(() => {
    setCompactOpen(NONE_OPEN);
  }, [tier]);

  const setWidth = useCallback(
    (side: PanelSide, width: number) =>
      setRemembered((s) => ({ ...s, [side]: { ...s[side], width } })),
    [],
  );

  const setOpen = (side: PanelSide, open: (now: boolean) => boolean) => {
    if (panelPresentation(tier, side).remembersCollapse) {
      setRemembered((s) => ({
        ...s,
        [side]: { ...s[side], collapsed: !open(!s[side].collapsed) },
      }));
    } else {
      setCompactOpen((o) => ({ ...o, [side]: open(o[side]) }));
    }
  };
  const toggle = (side: PanelSide) => setOpen(side, (now) => !now);
  const close = (side: PanelSide) => setOpen(side, () => false);

  const view = (
    side: PanelSide,
  ): { state: SidePanelState; presentation: PanelPresentation } => {
    const presentation = panelPresentation(tier, side);
    return {
      presentation,
      state: presentation.remembersCollapse
        ? remembered[side]
        : { width: remembered[side].width, collapsed: !compactOpen[side] },
    };
  };

  return { left: view('left'), right: view('right'), setWidth, toggle, close };
}
