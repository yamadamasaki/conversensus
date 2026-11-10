import { describe, expect, test } from 'bun:test';
import type { Batch, FileId, Op } from '@conversensus/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LocalBackend } from '../local/backend';
import { broadcastingBackend } from '../local/localChanges';
import { useElementAuthors } from './useElementAuthors';

const TRUNK = '11111111-1111-4111-8111-111111111111' as FileId;
const BRANCH = '22222222-2222-4222-8222-222222222222' as FileId;
const OTHER = '33333333-3333-4333-8333-333333333333' as FileId;
const NODE = '44444444-4444-4444-8444-444444444444';
const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';

const batch = (did: string, clock: number, kind: string): Batch =>
  ({
    id: `${did}-${clock}`,
    actor: `${did}#dev`,
    clock,
    seq: clock,
    deps: {},
    timestamp: clock,
    ops: [{ kind, target: NODE, content: '' } as unknown as Op],
  }) as unknown as Batch;

/** この File の書き込みを知らせる (手元の正典の書き込みと同じ道) */
const notifyWrite = (fileId: FileId) =>
  broadcastingBackend(
    { pushBatches: async () => 1 } as unknown as LocalBackend,
    null,
  ).pushBatches(fileId, []);

describe('useElementAuthors', () => {
  test('trunk と見ている branch の op-log を合わせて作者を導く', async () => {
    const logs: Record<string, Batch[]> = {
      [TRUNK]: [batch(ALICE, 1, 'node.add')],
      [BRANCH]: [batch(BOB, 2, 'node.setContent')],
    };
    const fetch = async (id: FileId) => logs[id] ?? [];
    const files = [TRUNK, BRANCH];
    const { result } = renderHook(() => useElementAuthors(files, false, fetch));
    await waitFor(() =>
      expect(result.current.authorsOf(NODE)).toEqual([ALICE, BOB]),
    );
    // ログインしていなければ表示名は引かず、DID のまま
    expect(result.current.labelOf(ALICE)).toBe(ALICE);
  });

  test('見ている File の正典が変わったら読み直す。他の File の変化では読まない', async () => {
    const logs: Record<string, Batch[]> = {
      [TRUNK]: [batch(ALICE, 1, 'node.add')],
    };
    let reads = 0;
    // 読み方は描くたびに作り直さない (App は既定の `fetchBatches` を渡す)
    const fetch = async (id: FileId) => {
      reads += 1;
      return logs[id] ?? [];
    };
    const files = [TRUNK];
    const { result } = renderHook(() => useElementAuthors(files, false, fetch));
    await waitFor(() =>
      expect(result.current.authorsOf(NODE)).toEqual([ALICE]),
    );
    const before = reads;
    await act(() => notifyWrite(OTHER));
    expect(reads).toBe(before);

    logs[TRUNK] = [...(logs[TRUNK] ?? []), batch(BOB, 2, 'node.setContent')];
    await act(() => notifyWrite(TRUNK));
    await waitFor(() =>
      expect(result.current.authorsOf(NODE)).toEqual([ALICE, BOB]),
    );
  });

  test('File が無ければ読まず、作者も無い', () => {
    let reads = 0;
    const { result } = renderHook(() =>
      useElementAuthors([], false, async () => {
        reads += 1;
        return [];
      }),
    );
    expect(result.current.authorsOf(NODE)).toEqual([]);
    expect(reads).toBe(0);
  });
});
