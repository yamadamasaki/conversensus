/**
 * アプリ内タブ (step3 Phase 3 S3-3 / S3-5)
 *
 * **タブ = pane の並び。pane = アドレス (`GraphViewAddress`)。**single のタブは pane 1 つ、multiple の
 * タブは複数 (S3-5)。そのうち 1 つがアクティブで、編集できるのはそれだけである。タブは中身を持たない — 中身は op-log にあり、
 * アドレスから projection して決める。だからタブを閉じても、同じアドレスで開き直せば同じ姿が出る
 * (仕様 design-language)。
 *
 * ここは純関数だけを置く。React の state・localStorage・画面の配線は `useTabs` と App が持つ。
 */

import {
  addressKey,
  type FileId,
  type GraphViewAddress,
  type SheetId,
} from '@conversensus/shared';

/** タブの識別子。**アドレスとは別に持つ** — 同じアドレスのタブを明示で 2 つ開けるため (Q2) */
export type TabId = string;

export type Tab = {
  id: TabId;
  /** 1 つ以上。並びは画面の左から右 */
  panes: readonly GraphViewAddress[];
  /** アクティブな pane の位置。ヘッダ・右サイドバー・画面の仕組みはこれを対象にする */
  active: number;
};

/** タブのアクティブな pane のアドレス */
export function tabAddress(tab: Tab): GraphViewAddress {
  return tab.panes[tab.active] ?? (tab.panes[0] as GraphViewAddress);
}

export function isMultiple(tab: Tab): boolean {
  return tab.panes.length > 1;
}

/** pane 1 つのタブ */
function singleTab(id: TabId, address: GraphViewAddress): Tab {
  return { id, panes: [address], active: 0 };
}

export type TabsState = {
  tabs: readonly Tab[];
  /** アクティブなタブ。タブが 0 枚なら null */
  activeId: TabId | null;
};

export const NO_TABS: TabsState = { tabs: [], activeId: null };

export function activeTab(state: TabsState): Tab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null;
}

/**
 * アドレスを開く。
 *
 * **同じアドレスのタブが既にあればそこへ移る** (Q2)。同じ branch の head を 2 つのタブで
 * 編集できても得が無く、紛らわしいだけである。`forceNew` (修飾キーでの明示の操作) のときだけ
 * 新しいタブを足す。同じかどうかは `addressKey` で決める (highlight は見ない)。
 * 既存のタブへ移るときは、highlight だけは新しい方に差し替える (検索の結果から開いた場合など)。
 *
 * **見るのは single のタブだけ** (S3-5)。multiple は特別な場合の並びなので、サイドバーから
 * 開いたものがそこへ吸い込まれると紛らわしい
 */
export function openTab(
  state: TabsState,
  address: GraphViewAddress,
  newId: () => TabId,
  { forceNew = false }: { forceNew?: boolean } = {},
): TabsState {
  if (!forceNew) {
    const key = addressKey(address);
    const existing = state.tabs.find(
      (t) => !isMultiple(t) && addressKey(tabAddress(t)) === key,
    );
    if (existing) {
      return {
        tabs: state.tabs.map((t) =>
          t.id === existing.id ? singleTab(t.id, address) : t,
        ),
        activeId: existing.id,
      };
    }
  }
  const tab = singleTab(newId(), address);
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

export function activateTab(state: TabsState, id: TabId): TabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeId: id };
}

/**
 * タブを閉じる。アクティブなタブを閉じたら、**右隣、無ければ左隣**へ移る
 * (ブラウザのタブと同じ)。アクティブでないタブを閉じてもアクティブは動かない
 */
export function closeTab(state: TabsState, id: TabId): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId };
  const next = tabs[index] ?? tabs[index - 1] ?? null;
  return { tabs, activeId: next?.id ?? null };
}

/**
 * pane を 1 つ外す。アクティブな pane を外したら右隣、無ければ左隣がアクティブになる。
 * 最後の pane を外すとタブごと閉じる
 */
export function closePane(
  state: TabsState,
  tabId: TabId,
  index: number,
): TabsState {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || !tab.panes[index]) return state;
  if (tab.panes.length === 1) return closeTab(state, tabId);
  const panes = tab.panes.filter((_, i) => i !== index);
  const active =
    index < tab.active
      ? tab.active - 1
      : index === tab.active
        ? Math.min(index, panes.length - 1)
        : tab.active;
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, panes, active } : t)),
  };
}

/**
 * 条件に合う pane をまとめて外す (File・シートの削除、開けなかったアドレス)。pane が無くなった
 * タブは閉じる。アクティブが閉じられたら、`closeTab` と同じく隣へ移る
 */
export function closeTabsWhere(
  state: TabsState,
  predicate: (address: GraphViewAddress) => boolean,
): TabsState {
  let next = state;
  for (const tab of state.tabs) {
    // 後ろから外す — 前から外すと位置がずれる
    for (let i = tab.panes.length - 1; i >= 0; i--) {
      const pane = tab.panes[i];
      if (pane && predicate(pane)) next = closePane(next, tab.id, i);
    }
  }
  return next;
}

/** アクティブなタブに pane を足す (multiple にする)。アクティブな pane は動かさない */
export function addPane(
  state: TabsState,
  address: GraphViewAddress,
): TabsState {
  const active = activeTab(state);
  if (!active) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === active.id ? { ...t, panes: [...t.panes, address] } : t,
    ),
  };
}

/** アクティブなタブの pane を前に出す */
export function activatePane(state: TabsState, index: number): TabsState {
  const active = activeTab(state);
  if (!active || !active.panes[index] || active.active === index) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === active.id ? { ...t, active: index } : t,
    ),
  };
}

/**
 * アクティブなタブの、アクティブな pane のアドレスを置き換える。
 *
 * **画面の側でアドレスが動いたとき**に使う — branch を閉じて trunk に戻った、受信で
 * シートが消えて別のシートに退避した、など。タブを足しはしない (それは `openTab`)
 */
export function retargetActive(
  state: TabsState,
  address: GraphViewAddress,
): TabsState {
  const active = activeTab(state);
  if (!active || addressKey(tabAddress(active)) === addressKey(address))
    return state;
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === active.id
        ? { ...t, panes: t.panes.map((p, i) => (i === t.active ? address : p)) }
        : t,
    ),
  };
}

/** タブ (のすべての pane) が参照している File (重複なし、並びの順)。背後のタブの同期 (Q4) が使う */
export function openFileIds(state: TabsState): FileId[] {
  return [...new Set(state.tabs.flatMap((t) => t.panes.map((p) => p.fileId)))];
}

/** 指定のシートを指すか (シートの削除で閉じるタブの判定) */
export function isOnSheet(fileId: FileId, sheetId: SheetId) {
  return (address: GraphViewAddress) =>
    address.fileId === fileId && address.sheetId === sheetId;
}

/** 指定の File を指すか (File の削除で閉じるタブの判定) */
export function isOnFile(fileId: FileId) {
  return (address: GraphViewAddress) => address.fileId === fileId;
}
