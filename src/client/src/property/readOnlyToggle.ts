/**
 * property の欄で、読み取り専用の property (system と template の種別) を出すかどうか (#357)
 *
 * **透明性のため**に、アプリや template が要素に付けた値も見られるようにする。ふだんは編集できるものだけを並べる
 * (既定は off)。オン/オフは**この端末に覚える** — 見え方の好みであって、ほかの参加者には関わらない。
 * 欄は同じ画面に 2 つ出ることがある (merger) ので、どちらで切り替えても揃うよう 1 か所で持つ
 */

import { useSyncExternalStore } from 'react';
import { safeLocalStorage } from '../sync/safeStorage';

export const SHOW_READ_ONLY_PROPERTIES_STORAGE_KEY =
  'conversensus.showReadOnlyProperties';
/** 覚えるときの値。これ以外 (無い・読めない) は off */
const STORED_ON = 'true';

function initial(): boolean {
  try {
    return (
      safeLocalStorage()?.getItem(SHOW_READ_ONLY_PROPERTIES_STORAGE_KEY) ===
      STORED_ON
    );
  } catch {
    return false;
  }
}

let current = initial();
const listeners = new Set<() => void>();

export function getShowReadOnlyProperties(): boolean {
  return current;
}

/** 切り替えて端末に覚える。覚えられなくても切り替えは効く (再読み込みで off に戻るだけ) */
export function setShowReadOnlyProperties(show: boolean): void {
  if (show === current) return;
  current = show;
  try {
    const storage = safeLocalStorage();
    if (show)
      storage?.setItem(SHOW_READ_ONLY_PROPERTIES_STORAGE_KEY, STORED_ON);
    else storage?.removeItem(SHOW_READ_ONLY_PROPERTIES_STORAGE_KEY);
  } catch {
    // 覚えられなくてもよい
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShowReadOnlyProperties(): boolean {
  return useSyncExternalStore(subscribe, getShowReadOnlyProperties);
}
