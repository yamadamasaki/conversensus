/**
 * useGraphPanels: ヘッダが開閉する窓 (検索・property editor) と、canvas の口・選択の写し
 * (step3 Phase 3 S3-4a)
 *
 * 以前はこれらを `GraphEditor` が持っていた。ヘッダと右サイドバーが `GraphEditor` の外に
 * 出たので、状態も外に置く。
 *
 * **検索の結果は view が変わると捨てる。**以前は `GraphEditor` の再マウントで初期値に戻っていた
 * (利用者判断 2026-09-20: 別のグラフへ移った時点で結果は無効)。外へ出したので、view の同一性
 * (`viewKey` = `addressKey`) が変わったら明示に戻す。窓も閉じる。property editor の on/off は
 * ヘッダのオプションなので、view をまたいで保つ
 */

import type { Sheet } from '@conversensus/shared';
import { useCallback, useEffect, useState } from 'react';
import type {
  GraphEditorControls,
  PropertyTarget,
} from '../graph/editorControls';
import { type SearchHit, searchSheet } from '../search/searchSheet';
import { safeLocalStorage } from '../sync/safeStorage';
import { type GroupAbility, NO_GROUP_ABILITY } from './useGroupNodes';

/** map の on/off を覚えておく所 (#182)。端末ごと */
export const MAP_VISIBLE_STORAGE_KEY = 'conversensus.mapVisible';

/** 既定は出す。消したことだけを覚える */
function restoreMapVisible(): boolean {
  try {
    return safeLocalStorage()?.getItem(MAP_VISIBLE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function useGraphPanels(viewKey: string | null) {
  const [controls, setControls] = useState<GraphEditorControls | null>(null);
  const [selection, setSelection] = useState<PropertyTarget | undefined>();
  const [groupAbility, setGroupAbility] =
    useState<GroupAbility>(NO_GROUP_ABILITY);
  const [propertyOpen, setPropertyOpen] = useState(false);
  // map の on/off は property editor と同じくヘッダのオプションで、view をまたいで保つ。
  // 再読み込みの後も保つ (#182)
  const [mapOpen, setMapOpen] = useState(restoreMapVisible);
  useEffect(() => {
    try {
      safeLocalStorage()?.setItem(MAP_VISIBLE_STORAGE_KEY, String(mapOpen));
    } catch {
      // 覚えられなくても切り替えは効く。再読み込みで出す側に戻るだけである
    }
  }, [mapOpen]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  // 「まだ引いていない」と「引いて 0 件」を分ける。同じ見た目にすると、開いた
  // 瞬間に「見つかりません」と出る
  const [searched, setSearched] = useState(false);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchHits([]);
    setSearched(false);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewKey の変化だけを契機にする
  useEffect(() => {
    closeSearch();
  }, [viewKey]);

  /**
   * **いま表示しているシートだけを引く** (仕様 searching.md「グラフ: 現在表示している sheet,
   * あるいは branch」)。branch を見ていれば呼び出し側が branch の姿を渡す
   */
  const search = useCallback(
    (sheet: Sheet, query: string, caseSensitive: boolean) => {
      setSearchHits(searchSheet(sheet, query, { caseSensitive }));
      setSearched(query !== '');
    },
    [],
  );

  return {
    controls,
    setControls,
    selection,
    setSelection,
    groupAbility,
    setGroupAbility,
    propertyOpen,
    toggleProperty: useCallback(() => setPropertyOpen((open) => !open), []),
    closeProperty: useCallback(() => setPropertyOpen(false), []),
    mapOpen,
    toggleMap: useCallback(() => setMapOpen((open) => !open), []),
    searchOpen,
    toggleSearch: useCallback(() => {
      if (searchOpen) closeSearch();
      else setSearchOpen(true);
    }, [searchOpen, closeSearch]),
    closeSearch,
    searchHits,
    searched,
    search,
  };
}
