/**
 * useTabs: タブの並びを React の state として持ち、`localStorage` に写す (step3 Phase 3 S3-3)
 *
 * 規則 (同じアドレスは既存のタブへ、閉じたら隣へ、など) は `tabs/tabs.ts` の純関数にあり、
 * ここは state と保存だけを持つ。画面をアドレスへ持っていくのは App (`useTabNavigation`)。
 */

import type { GraphViewAddress } from '@conversensus/shared';
import { useCallback, useEffect, useState } from 'react';
import { safeLocalStorage } from '../sync/safeStorage';
import { parseTabs, serializeTabs, TABS_STORAGE_KEY } from '../tabs/tabStorage';
import {
  activatePane,
  activateTab,
  addPane,
  closePane,
  closeTab,
  closeTabsWhere,
  openTab,
  retargetActive,
  type TabId,
  type TabsState,
} from '../tabs/tabs';
import { generateId } from '../uuid';

/** 保存しておいた並び。読めなければ空 (Q3) */
function restoreTabs(): TabsState {
  try {
    return parseTabs(safeLocalStorage()?.getItem(TABS_STORAGE_KEY) ?? null);
  } catch {
    return parseTabs(null);
  }
}

export function useTabs() {
  const [state, setState] = useState<TabsState>(restoreTabs);

  useEffect(() => {
    try {
      safeLocalStorage()?.setItem(TABS_STORAGE_KEY, serializeTabs(state));
    } catch (error) {
      // 保存できなくてもタブは使える。再読み込みで消えるだけである
      console.warn('[tabs] タブの並びを保存できなかった:', error);
    }
  }, [state]);

  const open = useCallback(
    (address: GraphViewAddress, options?: { forceNew?: boolean }) =>
      setState((s) => openTab(s, address, generateId, options)),
    [],
  );
  const activate = useCallback(
    (id: TabId) => setState((s) => activateTab(s, id)),
    [],
  );
  const close = useCallback(
    (id: TabId) => setState((s) => closeTab(s, id)),
    [],
  );
  const closeWhere = useCallback(
    (predicate: (address: GraphViewAddress) => boolean) =>
      setState((s) => closeTabsWhere(s, predicate)),
    [],
  );
  const retarget = useCallback(
    (address: GraphViewAddress) => setState((s) => retargetActive(s, address)),
    [],
  );

  // multiple モード (S3-5): アクティブなタブの pane を足す・前に出す・外す
  const addPaneToActive = useCallback(
    (address: GraphViewAddress) => setState((s) => addPane(s, address)),
    [],
  );
  const activatePaneOfActive = useCallback(
    (index: number) => setState((s) => activatePane(s, index)),
    [],
  );
  const closePaneOf = useCallback(
    (id: TabId, index: number) => setState((s) => closePane(s, id, index)),
    [],
  );

  return {
    state,
    open,
    activate,
    close,
    closeWhere,
    retarget,
    addPane: addPaneToActive,
    activatePane: activatePaneOfActive,
    closePane: closePaneOf,
  };
}
