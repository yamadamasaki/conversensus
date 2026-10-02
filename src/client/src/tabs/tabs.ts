/**
 * アプリ内タブ (step3 Phase 3 S3-3)
 *
 * **タブ = アドレス (`GraphViewAddress`) の並び。**タブは中身を持たない — 中身は op-log にあり、
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
  address: GraphViewAddress;
};

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
 * 既存のタブへ移るときは、highlight だけは新しい方に差し替える (検索の結果から開いた場合など)
 */
export function openTab(
  state: TabsState,
  address: GraphViewAddress,
  newId: () => TabId,
  { forceNew = false }: { forceNew?: boolean } = {},
): TabsState {
  if (!forceNew) {
    const key = addressKey(address);
    const existing = state.tabs.find((t) => addressKey(t.address) === key);
    if (existing) {
      return {
        tabs: state.tabs.map((t) =>
          t.id === existing.id ? { ...t, address } : t,
        ),
        activeId: existing.id,
      };
    }
  }
  const tab: Tab = { id: newId(), address };
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
 * 条件に合うタブをまとめて閉じる (File・シートの削除、開けなかったアドレス)。
 * アクティブが閉じられたら、`closeTab` と同じく隣へ移る
 */
export function closeTabsWhere(
  state: TabsState,
  predicate: (address: GraphViewAddress) => boolean,
): TabsState {
  return state.tabs
    .filter((t) => predicate(t.address))
    .reduce((s, t) => closeTab(s, t.id), state);
}

/**
 * アクティブなタブのアドレスを置き換える。
 *
 * **画面の側でアドレスが動いたとき**に使う — branch を閉じて trunk に戻った、受信で
 * シートが消えて別のシートに退避した、など。タブを足しはしない (それは `openTab`)
 */
export function retargetActive(
  state: TabsState,
  address: GraphViewAddress,
): TabsState {
  const active = activeTab(state);
  if (!active || addressKey(active.address) === addressKey(address))
    return state;
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === active.id ? { ...t, address } : t)),
  };
}

/** タブが参照している File (重複なし、並びの順)。背後のタブの同期 (Q4) が使う */
export function openFileIds(state: TabsState): FileId[] {
  return [...new Set(state.tabs.map((t) => t.address.fileId))];
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
