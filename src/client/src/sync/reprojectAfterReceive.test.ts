import { describe, expect, it } from 'bun:test';
import type { GraphFile, SheetId } from '@conversensus/shared';
import { reprojectAfterReceive } from './reprojectAfterReceive';

const SHEET = '11111111-1111-4111-8111-111111111111' as SheetId;

const projected = (name: string): GraphFile =>
  ({
    id: 'f1',
    name,
    sheets: [{ id: SHEET, name: 'S1', nodes: [], edges: [] }],
  }) as unknown as GraphFile;

const emptyProjected = (): GraphFile =>
  ({ id: 'f1', name: '', sheets: [] }) as unknown as GraphFile;

/** settled / pendingCount / loadProjection を記録・制御するテスト用 deps */
function makeDeps(over: {
  /** 各呼び出し時点の pending 値の列 (足りない分は最後の値を繰り返す) */
  pendings?: number[];
  file?: GraphFile;
  isEditing?: () => boolean;
  maxAttempts?: number;
}) {
  const calls = { settled: 0, load: 0, pending: 0 };
  const pendings = over.pendings ?? [0];
  return {
    calls,
    deps: {
      settled: async () => {
        calls.settled += 1;
      },
      pendingCount: () => {
        const i = Math.min(calls.pending, pendings.length - 1);
        calls.pending += 1;
        return pendings[i] ?? 0;
      },
      loadProjection: async () => {
        calls.load += 1;
        return over.file ?? projected('v2');
      },
      ...(over.isEditing && { isEditing: over.isEditing }),
      ...(over.maxAttempts !== undefined && { maxAttempts: over.maxAttempts }),
    },
  };
}

describe('reprojectAfterReceive (Phase 4e-3)', () => {
  it('drain 後 pending が空なら projection を swap として返す', async () => {
    const t = makeDeps({ pendings: [0, 0] });
    const result = await reprojectAfterReceive(t.deps);

    expect(result).toEqual({ kind: 'swap', file: projected('v2') });
    expect(t.calls.settled).toBe(1); // 読取前に必ず drain を待つ
    expect(t.calls.load).toBe(1);
  });

  it('🔴 drain 後も pending が残るなら見送る (ローカル push 失敗 = 未 flush 編集を失わない)', async () => {
    // settled() はローカル push 失敗時も resolve する (drain は offline で throw しない)。
    // pending が残ったまま projection すると、その編集を含まない結果で上書きし編集が消える。
    const t = makeDeps({ pendings: [2] });
    const result = await reprojectAfterReceive(t.deps);

    expect(result).toEqual({ kind: 'defer', reason: 'pending-remains' });
    expect(t.calls.load).toBe(0); // 読取すら行わない
  });

  it('読取中に編集が入ったら drain からやり直す (MED4 レース)', async () => {
    // pending 呼び出し列: (2) 空 → 読取 → (4) 増えている → 再ループ → (2) 空 → (4) 空 → swap
    const t = makeDeps({ pendings: [0, 1, 0, 0] });
    const result = await reprojectAfterReceive(t.deps);

    expect(result.kind).toBe('swap');
    expect(t.calls.settled).toBe(2); // リトライで drain し直す
    expect(t.calls.load).toBe(2);
  });

  it('編集が続く間はリトライ上限で打ち切る (race-exhausted)', async () => {
    // 読取のたびに pending が増えている状態が続く
    const t = makeDeps({ pendings: [0, 1, 0, 1, 0, 1], maxAttempts: 3 });
    const result = await reprojectAfterReceive(t.deps);

    expect(result).toEqual({ kind: 'defer', reason: 'race-exhausted' });
    expect(t.calls.load).toBe(3);
  });

  it('編集中 (inline editor / ドラッグ中) は入口で見送る', async () => {
    const t = makeDeps({ isEditing: () => true });
    const result = await reprojectAfterReceive(t.deps);

    expect(result).toEqual({ kind: 'defer', reason: 'editing' });
    expect(t.calls.settled).toBe(0); // 何もしない
  });

  it('swap 直前に編集が始まっても見送る', async () => {
    let editingCalls = 0;
    // 1 回目 (入口) は false、2 回目 (swap 直前) は true
    const t = makeDeps({
      pendings: [0, 0],
      isEditing: () => {
        editingCalls += 1;
        return editingCalls >= 2;
      },
    });
    const result = await reprojectAfterReceive(t.deps);

    expect(result).toEqual({ kind: 'defer', reason: 'editing' });
    expect(t.calls.load).toBe(1); // 読取まで進んでから保留に倒れる
  });

  it('projection が 0 シートなら見送る (有効な GraphFile ではない)', async () => {
    const t = makeDeps({ pendings: [0, 0], file: emptyProjected() });
    const result = await reprojectAfterReceive(t.deps);

    expect(result).toEqual({ kind: 'defer', reason: 'empty-projection' });
  });
});
