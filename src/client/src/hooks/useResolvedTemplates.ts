/**
 * useResolvedTemplates: シートに当てた template を解決する (step3 Phase 4 S4-1b)
 *
 * template graph の切断面 (`{ sheet, at }`) は、同じ File の trunk の op-log を**その時点で**読んで
 * 求める (`resolveTemplates`)。**読むのは 1 度でよい** — 切断面の中身は後から変わらない
 * (切断面に入る batch は、切断面を作ったときに手元にあったものだけである)。作り込みの id だけなら
 * op-log を読まずにその場で引く
 */

import {
  type FileId,
  resolveTemplates,
  type Template,
  type TemplateRef,
} from '@conversensus/shared';
import { useEffect, useMemo, useState } from 'react';
import { fetchBatches } from '../api';

const NONE: Template[] = [];

export function useResolvedTemplates(
  fileId: FileId | null,
  refs: readonly TemplateRef[] | undefined,
): Template[] {
  const key = JSON.stringify(refs ?? []);
  const needsLog =
    fileId !== null && (refs ?? []).some((ref) => typeof ref !== 'string');
  // 作り込みの id だけなら、op-log を読まずに引ける
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs の中身 (key) が変わったときだけ引き直す
  const builtins = useMemo(
    () =>
      needsLog || fileId === null ? NONE : resolveTemplates(refs, [], fileId),
    [key, needsLog, fileId],
  );
  const [resolved, setResolved] = useState<{
    key: string;
    templates: Template[];
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs の中身 (key) が変わったときだけ読み直す
  useEffect(() => {
    if (!needsLog || fileId === null) return;
    let cancelled = false;
    fetchBatches(fileId)
      .then((trunk) => {
        if (!cancelled)
          setResolved({
            key,
            templates: resolveTemplates(refs, trunk, fileId),
          });
      })
      .catch((error) =>
        console.warn('[template] 当てた template を読めなかった:', error),
      );
    return () => {
      cancelled = true;
    };
  }, [fileId, key, needsLog]);

  if (!needsLog) return builtins;
  // 読み終わるまでは「template を当てていないシート」として描く (種類のメニューが出ないだけ)
  return resolved?.key === key ? resolved.templates : NONE;
}
