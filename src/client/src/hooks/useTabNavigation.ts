/**
 * useTabNavigation: 画面をアクティブなタブのアドレスへ持っていく (step3 Phase 3 S3-3)
 *
 * 向きは 2 つある。
 *
 * - **タブ → 画面**: タブを切り替えた・サイドバーから開いた。画面を段ごとに行き先へ進める
 *   (`nextNavigationStep`)。File の読み込みと branch の読み込みは非同期なので、state が
 *   動くたびに次の 1 段を頼む
 * - **画面 → タブ**: 着いた後で画面の側が動いた (branch を閉じて trunk に戻った、受信で
 *   シートが消えて退避した、File を作った・削除した)。タブを画面に合わせる
 *
 * 2 つを分けるのは「**このタブのこのアドレスに一度着いたか**」である。着く前に画面と
 * タブが食い違うのは移動の途中、着いた後に食い違うのは画面の側が動いたからである。
 */

import type { BranchMeta } from '@conversensus/shared';
import {
  addressKey,
  type FileId,
  type GraphFile,
  type GraphViewAddress,
  HEAD_CUT,
  type SheetId,
} from '@conversensus/shared';
import { useEffect, useMemo, useRef } from 'react';
import {
  nextNavigationStep,
  stepKey,
  type ViewedPlace,
} from '../tabs/navigation';
import { isOnFile, isOnSheet, type Tab, type TabId } from '../tabs/tabs';

type Params = {
  tab: Tab | null;
  viewed: ViewedPlace;
  activeFile: GraphFile | null;
  sheetBranches: ReadonlyMap<string, readonly BranchMeta[]>;
  openFile: (
    id: FileId,
    options: { sheetId: SheetId; quiet: boolean },
  ) => Promise<GraphFile | null>;
  selectSheet: (sheetId: SheetId) => void;
  selectBranch: (sheetId: SheetId, branch: BranchMeta | null) => void;
  tabs: {
    open: (address: GraphViewAddress) => void;
    close: (id: TabId) => void;
    closeWhere: (predicate: (address: GraphViewAddress) => boolean) => void;
    retarget: (address: GraphViewAddress) => void;
  };
};

export function useTabNavigation({
  tab,
  viewed,
  activeFile,
  sheetBranches,
  openFile,
  selectSheet,
  selectBranch,
  tabs,
}: Params) {
  /** 着いたタブとそのアドレス (`<tabId>@<addressKey>`) */
  const arrivedRef = useRef<string | null>(null);
  /** 頼んで、まだ結果が画面に出ていない段 (同じ段を 2 度頼まない) */
  const requestedRef = useRef<string | null>(null);

  const { fileId, sheetId, branchId } = viewed;
  /** 画面に出ているもののアドレス。File かシートが無ければ null */
  const viewedAddress = useMemo<GraphViewAddress | null>(
    () =>
      fileId && sheetId ? { fileId, sheetId, branchId, cut: HEAD_CUT } : null,
    [fileId, sheetId, branchId],
  );

  useEffect(() => {
    if (!tab) {
      // タブが無いのに画面が何かを出している (File を作った・取り込んだ)。タブにする
      if (viewedAddress) tabs.open(viewedAddress);
      return;
    }
    const target = tab.address;
    const here = `${tab.id}@${addressKey(target)}`;
    const step = nextNavigationStep(target, { fileId, sheetId, branchId });
    if (step.kind === 'arrived') {
      arrivedRef.current = here;
      requestedRef.current = null;
      return;
    }

    if (arrivedRef.current === here) {
      // 着いた後で画面が動いた。タブを画面に合わせる
      requestedRef.current = null;
      if (!viewedAddress) tabs.close(tab.id);
      else if (viewedAddress.fileId !== target.fileId) tabs.open(viewedAddress);
      else tabs.retarget(viewedAddress);
      return;
    }

    const key = stepKey(step);
    if (requestedRef.current === key) return;

    switch (step.kind) {
      case 'openFile':
        requestedRef.current = key;
        void openFile(step.fileId, { sheetId: step.sheetId, quiet: true }).then(
          (file) => {
            // 開けない File (消された) を指すタブは、すべて閉じる
            if (!file) tabs.closeWhere(isOnFile(step.fileId));
          },
        );
        return;
      case 'selectSheet':
        if (!activeFile?.sheets.some((s) => s.id === step.sheetId)) {
          // シートが消えている。そのシートを指すタブを閉じる
          tabs.closeWhere(isOnSheet(target.fileId, step.sheetId));
          return;
        }
        requestedRef.current = key;
        selectSheet(step.sheetId);
        return;
      case 'selectBranch': {
        // branch の一覧はシートを開いてから非同期に読まれる。読まれるまで待つ
        const list = sheetBranches.get(step.sheetId);
        if (!list) return;
        const branch = list.find((b) => b.id === step.branchId);
        if (!branch) {
          // branch が消えている (削除された)。同じシートの trunk に置き換える
          tabs.retarget({ ...target, branchId: null });
          return;
        }
        requestedRef.current = key;
        selectBranch(step.sheetId, branch);
        return;
      }
      case 'toTrunk':
        requestedRef.current = key;
        selectBranch(step.sheetId, null);
        return;
    }
  }, [
    tab,
    fileId,
    sheetId,
    branchId,
    viewedAddress,
    activeFile,
    sheetBranches,
    openFile,
    selectSheet,
    selectBranch,
    tabs,
  ]);
}
