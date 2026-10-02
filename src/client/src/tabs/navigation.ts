/**
 * アドレスへ移る手順 (step3 Phase 3 S3-3)
 *
 * タブを切り替える・サイドバーから開く、はどちらも「画面をそのアドレスへ持っていく」ことである。
 * 画面の state は File → シート → branch の順に段で動き、段ごとに非同期 (File の読み込み、
 * branch の op-log の読み込み) なので、**一度に全部は動かせない**。
 *
 * そこで「いまの画面」と「行き先」を比べて**次の 1 段だけ**を返す。App は state が動くたびに
 * これを呼び、`arrived` になるまで繰り返す。段を飛ばさないので、途中の姿 (File は開いたが
 * branch はまだ) が行き先と食い違っても、次に何をすべきかは常に 1 つに決まる。
 */

import type {
  BranchId,
  FileId,
  GraphViewAddress,
  SheetId,
} from '@conversensus/shared';

/** いま画面に出ているもの。何も開いていなければ fileId / sheetId は null */
export type ViewedPlace = {
  fileId: FileId | null;
  sheetId: SheetId | null;
  /** branch を表示していればその id、trunk なら null */
  branchId: BranchId | null;
};

export type NavigationStep =
  | { kind: 'openFile'; fileId: FileId; sheetId: SheetId }
  | { kind: 'selectSheet'; sheetId: SheetId }
  | { kind: 'selectBranch'; sheetId: SheetId; branchId: BranchId }
  | { kind: 'toTrunk'; sheetId: SheetId }
  | { kind: 'arrived' };

export function nextNavigationStep(
  target: GraphViewAddress,
  viewed: ViewedPlace,
): NavigationStep {
  if (viewed.fileId !== target.fileId) {
    return { kind: 'openFile', fileId: target.fileId, sheetId: target.sheetId };
  }
  if (viewed.sheetId !== target.sheetId) {
    return { kind: 'selectSheet', sheetId: target.sheetId };
  }
  if (viewed.branchId !== target.branchId) {
    return target.branchId === null
      ? { kind: 'toTrunk', sheetId: target.sheetId }
      : {
          kind: 'selectBranch',
          sheetId: target.sheetId,
          branchId: target.branchId,
        };
  }
  return { kind: 'arrived' };
}

/** 段を識別する文字列。同じ段を 2 度頼まない (非同期の段が終わる前に再び呼ばれる) ために使う */
export function stepKey(step: NavigationStep): string {
  switch (step.kind) {
    case 'openFile':
      return `openFile/${step.fileId}/${step.sheetId}`;
    case 'selectSheet':
      return `selectSheet/${step.sheetId}`;
    case 'selectBranch':
      return `selectBranch/${step.sheetId}/${step.branchId}`;
    case 'toTrunk':
      return `toTrunk/${step.sheetId}`;
    case 'arrived':
      return 'arrived';
  }
}
