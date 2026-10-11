/**
 * useLocalOnlyFiles: この端末だけの File の印 (#253) を画面で読む。印が変われば描き直す
 */

import { useSyncExternalStore } from 'react';
import {
  LOCAL_ONLY_FILES_KEY,
  type LocalOnlyFiles,
  readLocalOnlyFiles,
  subscribeLocalOnlyFiles,
} from '../sync/localOnlyFiles';
import { safeLocalStorage } from '../sync/safeStorage';

/** 保存の文字列が変わらない限り同じ Map を返す (useSyncExternalStore は同じ値を要る) */
let cachedRaw: string | null | undefined;
let cached: LocalOnlyFiles = new Map();

function snapshot(): LocalOnlyFiles {
  let raw: string | null = null;
  try {
    raw = safeLocalStorage()?.getItem(LOCAL_ONLY_FILES_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = readLocalOnlyFiles();
  }
  return cached;
}

export function useLocalOnlyFiles(): LocalOnlyFiles {
  return useSyncExternalStore(subscribeLocalOnlyFiles, snapshot);
}
