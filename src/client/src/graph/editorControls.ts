/**
 * `GraphEditor` の外から呼べる口と、外へ知らせる選択 (step3 Phase 3 S3-4a)
 *
 * ヘッダ (undo・グループ化・PNG など) と右サイドバー (property editor) は `GraphEditor` の外にある
 * (仕様 design-language のヘッダ・右サイドバー)。どれも React Flow の state (nodes / edges / 選択) と
 * `useEventStore` に触れるので、中身は `GraphEditor` に残し、外へは口だけを出す。
 */

import type { SearchHit } from '../search/searchSheet';

/** 外から呼ぶ操作。`GraphEditor` が描かれている間だけ渡される */
export type GraphEditorControls = {
  undo: () => void;
  redo: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  exportPng: () => void;
  /** 検索の結果 1 件をグラフで示す (選んで、そこへ寄せる) */
  reveal: (hit: SearchHit) => void;
  /** 選ばれている要素のプロパティを 1 つ設定する。値の省略 (undefined) は削除 */
  setProperty: (name: string, value: unknown) => void;
  /**
   * 要素を外から選ぶ (step3 Phase 5 S5-1b)。merger で、見るだけの pane で選んだ要素を merge 後でも
   * 選ばせる (Phase 3 U1: 選択の正は React Flow に置いたまま、外から選ばせる口を足す)
   */
  select: (ids: readonly string[]) => void;
};

/**
 * property editor の対象 (選ばれている要素)。**node を優先する** — 両方選ばれていることが
 * あり得るが、editor は 1 つの要素の表である。ゴーストは対象外
 */
export type PropertyTarget = {
  kind: 'node' | 'edge';
  id: string;
  /** 人が読める名前。**id をそのまま出さない** (UUID は読めない) */
  title: string;
  properties: Record<string, unknown> | undefined;
  /** 追加できる名前の候補 (template の宣言から)。候補は edge にしか無い */
  addable: readonly string[];
};

/**
 * 対象の同一性。**中身が同じなら同じ文字列になる** — 知らせるのは変わったときだけにする
 * (nodes はドラッグの間じゅう変わる)
 */
export function propertyTargetKey(target: PropertyTarget | undefined): string {
  if (!target) return '';
  return JSON.stringify([
    target.kind,
    target.id,
    target.title,
    target.properties ?? null,
    target.addable,
  ]);
}
