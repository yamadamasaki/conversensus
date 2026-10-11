/**
 * 保存領域が守られているか (#263、step3 Phase 2 U1)
 *
 * Safari (特に iOS) は、しばらく使われない Web サイトの保存領域を消すことがある (ITP)。
 * `navigator.storage.persist()` が認められれば消されない。**認められなかったことを覚えておき**、
 * 消えると取り戻せないもの (この端末だけの File、#253) があるときに画面で知らせる。
 * アカウントに保存した File は、消えても PDS から戻る。
 */

import { useSyncExternalStore } from 'react';

/**
 * - `unknown`: まだ訊いていない (起動の途中・テスト)。知らせない
 * - `persisted`: 消されない
 * - `notPersisted`: 断られた、または訊く口が無い。消されうる
 */
export type PersistenceState = 'unknown' | 'persisted' | 'notPersisted';

/** 使う口だけ (`StorageManager` の一部)。テストで差し替える */
export type PersistenceApi = Pick<StorageManager, 'persist' | 'persisted'>;

let state: PersistenceState = 'unknown';
const listeners = new Set<() => void>();

function setState(next: PersistenceState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

/**
 * 消さないよう求め、その答えを覚える。**既に認められていれば訊き直さない** (`persisted()`)。
 * 口が無い・投げたときは `notPersisted` — 守られている証拠が無い限り、守られていないと扱う
 */
export async function requestPersistence(
  api: PersistenceApi | undefined,
): Promise<PersistenceState> {
  let next: PersistenceState = 'notPersisted';
  try {
    if (api) {
      const granted = (await api.persisted()) || (await api.persist());
      next = granted ? 'persisted' : 'notPersisted';
    }
  } catch {
    next = 'notPersisted';
  }
  setState(next);
  return next;
}

export function persistenceState(): PersistenceState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePersistenceState(): PersistenceState {
  return useSyncExternalStore(subscribe, persistenceState);
}

/** テストの間で状態を持ち越さない */
export function resetPersistenceStateForTest(): void {
  state = 'unknown';
}
