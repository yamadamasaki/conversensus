/**
 * reprojectAfterReceive: 受信着地後の再 projection と activeFile 差し替えの可否判定
 * (step1 Phase 4e-3, 4e 設計 §3.3)
 *
 * 受信がローカル正典へ着地しても、画面 (`activeFile` = React state) は自動では
 * 変わらない (§1.3: 読取は openFile の 1 回きり)。開いているファイルを再 projection して
 * 差し替えるのが本関数の役目。**不変条件は「編集中の未 flush 状態を失わない」**。
 *
 * 対策 α (critic MED3): ローカル drain 待ち → 全再 projection。差分適用 (案 β) は
 * 構造 op の適用ロジックを React state 側に二重実装することになるため採らない。
 * `projectFile` は実測 <1ms (W3d-3 ベンチ) なので全再 projection のコストは無視できる。
 *
 * 順序保証 (critic MED4): drain → 読取 → pending 再確認 → swap。
 * - `settled()` は**ローカル push 失敗時も resolve する** (drain は offline で throw せず
 *   return)。失敗した編集は pending に残るので、**pending が空でなければ差し替えを見送る**
 *   (見送った分は次の受信契機が拾う。べき等なので取りこぼさない)。
 * - 読取中に新規 record が入る (pending が増える) と、その編集を含まない projection で
 *   上書きして編集が消える。→ 読取後に pending を再確認し、増えていたら drain からやり直す。
 *   規定回数で打ち切り (編集が連続している間は差し替えない方が安全)。
 * - 編集中 (inline editor / ドラッグ中) は swap を保留する (§3.3 React Flow 整合)。
 */

import type { GraphFile } from '@conversensus/shared';

/** MED4 レースのリトライ上限。編集が連続する間は差し替えを諦め次の契機に譲る */
const DEFAULT_MAX_ATTEMPTS = 3;

export type ReprojectDeps = {
  /** ローカル drain (flushChain) の完了を待つ (`EventSyncTap.settled`) */
  settled: () => Promise<void>;
  /** tap の未 push 件数 (`EventSyncTap.pending`)。0 = ローカル正典が編集に追いついた */
  pendingCount: () => number;
  /** ローカル正典から projection を読む (fetchBatches → projectFile) */
  loadProjection: () => Promise<GraphFile>;
  /** 編集中 (ノードの inline editor / ドラッグ中) なら true。未指定 = 編集中でない */
  isEditing?: () => boolean;
  /** MED4 リトライ上限 (テスト用) */
  maxAttempts?: number;
};

export type ReprojectResult =
  /** 差し替えてよい projection が得られた */
  | { kind: 'swap'; file: GraphFile }
  /** 差し替えを見送った (次の受信契機・編集確定後に再試行される) */
  | {
      kind: 'defer';
      reason: /** 編集中 (React Flow 整合, §3.3) */
        | 'editing'
        /** ローカル push 失敗で pending が残っている — projection が編集を含まない */
        | 'pending-remains'
        /** 読取中に編集が続き、リトライ上限に達した (MED4) */
        | 'race-exhausted'
        /** projection が 0 シート — 有効な GraphFile ではない (W3d-2 と同じ基準) */
        | 'empty-projection';
    };

/**
 * 受信後の再 projection を安全に行い、差し替え可否と projection を返す。
 * React state (`activeFile`) への反映は呼び出し側 (useFileSheetOperations) が行う。
 */
export async function reprojectAfterReceive(
  deps: ReprojectDeps,
): Promise<ReprojectResult> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (deps.isEditing?.()) return { kind: 'defer', reason: 'editing' };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // (1) ローカル drain を待つ — 未 flush 編集が op-log に載ってから projection する
    await deps.settled();
    // (2) それでも pending が残る = ローカル push 失敗。projection は編集を含まないので見送る
    if (deps.pendingCount() > 0)
      return { kind: 'defer', reason: 'pending-remains' };
    // (3) 読取
    const file = await deps.loadProjection();
    if (file.sheets.length === 0) {
      return { kind: 'defer', reason: 'empty-projection' };
    }
    // (4) 読取中に新規編集が入っていないか再確認 (MED4)。入っていたら drain からやり直す
    if (deps.pendingCount() > 0) continue;
    // (5) swap 直前の編集開始も保留に倒す
    if (deps.isEditing?.()) return { kind: 'defer', reason: 'editing' };
    return { kind: 'swap', file };
  }
  return { kind: 'defer', reason: 'race-exhausted' };
}
