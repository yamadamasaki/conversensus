import { describe, expect, it } from 'bun:test';
import type { Batch, FileId, NodeId } from '@conversensus/shared';
import type { RemoteBatch } from '../atproto/types';
import { discoverRemoteFiles } from './discoverRemoteFiles';

const KNOWN = '11111111-1111-4111-8111-111111111111' as FileId;
const NEW_A = '22222222-2222-4222-8222-222222222222' as FileId;
const NEW_B = '33333333-3333-4333-8333-333333333333' as FileId;

const batch = (id: string, clock: number): Batch => ({
  id: id as Batch['id'],
  actor: 'did:plc:alice#dev-a',
  clock,
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
});

const envelope = (fileId: FileId, b: Batch): RemoteBatch => ({
  fileId,
  batch: b,
});

/** pullRemote / listLocalFileIds / appendReceived を記録するテスト用 deps */
function makeDeps(entries: RemoteBatch[], localIds: FileId[]) {
  const appendCalls: Array<{ fileId: FileId; batches: Batch[] }> = [];
  let failOn: FileId | null = null;
  return {
    appendCalls,
    failAppendFor(fileId: FileId) {
      failOn = fileId;
    },
    deps: {
      pullRemote: async () => entries,
      listLocalFileIds: async () => localIds,
      appendReceived: async (fileId: FileId, batches: Batch[]) => {
        if (fileId === failOn) throw new Error(`append failed: ${fileId}`);
        appendCalls.push({ fileId, batches });
        return batches.length; // 全件新規として扱う
      },
    },
  };
}

describe('discoverRemoteFiles (Phase 4e-2b)', () => {
  it('未知ファイルの batch を fileId ごとに束ねて materialize する', async () => {
    const t = makeDeps(
      [
        envelope(NEW_A, batch('a1', 1)),
        envelope(NEW_B, batch('b1', 1)),
        envelope(NEW_A, batch('a2', 2)),
      ],
      [KNOWN],
    );
    const result = await discoverRemoteFiles(t.deps);

    expect(result.discovered).toEqual([NEW_A, NEW_B]); // 発見順
    expect(result.appended).toBe(3);
    expect(result.skippedKnown).toBe(0);
    // fileId ごとに 1 回の書き込みへ束ねる
    expect(t.appendCalls).toHaveLength(2);
    expect(t.appendCalls[0]?.fileId).toBe(NEW_A);
    expect(t.appendCalls[0]?.batches.map((b) => b.id)).toEqual(['a1', 'a2']);
    expect(t.appendCalls[1]?.fileId).toBe(NEW_B);
  });

  it('既知ファイルの batch は書かずに数える (受信 (a) との二重責務を避ける)', async () => {
    const t = makeDeps(
      [envelope(KNOWN, batch('k1', 1)), envelope(NEW_A, batch('a1', 1))],
      [KNOWN],
    );
    const result = await discoverRemoteFiles(t.deps);

    expect(result.discovered).toEqual([NEW_A]);
    expect(result.skippedKnown).toBe(1);
    expect(t.appendCalls.map((c) => c.fileId)).toEqual([NEW_A]);
  });

  it('未知ファイルが無ければ何も書かない', async () => {
    const t = makeDeps([envelope(KNOWN, batch('k1', 1))], [KNOWN]);
    const result = await discoverRemoteFiles(t.deps);

    expect(result).toEqual({ discovered: [], appended: 0, skippedKnown: 1 });
    expect(t.appendCalls).toHaveLength(0);
  });

  it('remote が空でも安全 (何も起きない)', async () => {
    const t = makeDeps([], []);
    const result = await discoverRemoteFiles(t.deps);
    expect(result).toEqual({ discovered: [], appended: 0, skippedKnown: 0 });
  });

  it('途中のファイルで書き込みが失敗したら throw する (残りは次回契機が拾う)', async () => {
    // べき等な追記なので、途中まで書けていても再実行で壊れない。
    // 静かに握り潰すと発見漏れが恒久化する (W3d5-7 の「400 が無言」事故の反省)。
    const t = makeDeps(
      [envelope(NEW_A, batch('a1', 1)), envelope(NEW_B, batch('b1', 1))],
      [],
    );
    t.failAppendFor(NEW_B);

    await expect(discoverRemoteFiles(t.deps)).rejects.toThrow(
      `append failed: ${NEW_B}`,
    );
    // NEW_A は書けている (部分成功は許容 — べき等性が再実行を無害化する)
    expect(t.appendCalls.map((c) => c.fileId)).toEqual([NEW_A]);
  });
});
