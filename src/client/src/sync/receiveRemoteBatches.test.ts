import { describe, expect, it } from 'bun:test';
import type { Batch, FileId, Lamport, NodeId } from '@conversensus/shared';
import { GENESIS_ACTOR } from '@conversensus/shared';
import type { RemoteBatch } from '../atproto/types';
import { receiveRemoteBatches } from './receiveRemoteBatches';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const OTHER = '22222222-2222-4222-8222-222222222222' as FileId;

const batch = (
  id: string,
  clock: number,
  over: Partial<Batch> = {},
): Batch => ({
  id: id as Batch['id'],
  actor: 'did:plc:alice#dev-a',
  clock,
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
  ...over,
});

const envelope = (fileId: FileId, b: Batch): RemoteBatch => ({
  fileId,
  batch: b,
});

/** pullRemote / appendReceived / observeRemote を記録するテスト用 deps */
function makeDeps(entries: RemoteBatch[]) {
  const appendCalls: Array<{ fileId: FileId; batches: Batch[] }> = [];
  const observed: Lamport[] = [];
  let appendFails: Error | null = null;
  return {
    appendCalls,
    observed,
    failAppendWith(e: Error) {
      appendFails = e;
    },
    deps: {
      pullRemote: async () => entries,
      appendReceived: async (fileId: FileId, batches: Batch[]) => {
        if (appendFails) throw appendFails;
        appendCalls.push({ fileId, batches });
        return batches.length; // 全件新規として扱う
      },
      observeRemote: (clock: Lamport) => {
        observed.push(clock);
      },
    },
  };
}

describe('receiveRemoteBatches (Phase 4d-5)', () => {
  it('自ファイル宛の batch をローカル正典へ取り込む', async () => {
    const t = makeDeps([
      envelope(FILE, batch('a', 3)),
      envelope(FILE, batch('b', 5)),
    ]);
    const result = await receiveRemoteBatches(FILE, t.deps);

    expect(result).toEqual({ received: 2, appended: 2, skippedOtherFile: 0 });
    expect(t.appendCalls).toHaveLength(1);
    expect(t.appendCalls[0]?.fileId).toBe(FILE);
    expect(t.appendCalls[0]?.batches.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('他ファイル宛の batch は捨てて数える (repo 全体 pull の副産物)', async () => {
    // remote の batch コレクションは repo 全体で 1 つなので他ファイル分も返る。
    // 未知の fileId を書くと孤児 batch になる (§1.11 D-4) ので、ここが防御を兼ねる。
    const t = makeDeps([
      envelope(FILE, batch('a', 1)),
      envelope(OTHER, batch('x', 2)),
      envelope(OTHER, batch('y', 3)),
    ]);
    const result = await receiveRemoteBatches(FILE, t.deps);

    expect(result.received).toBe(1);
    expect(result.skippedOtherFile).toBe(2);
    expect(t.appendCalls[0]?.batches.map((b) => b.id)).toEqual(['a']);
  });

  it('自ファイル宛が 0 件なら書き込まず clock も動かさない', async () => {
    const t = makeDeps([envelope(OTHER, batch('x', 9))]);
    const result = await receiveRemoteBatches(FILE, t.deps);

    expect(result).toEqual({ received: 0, appended: 0, skippedOtherFile: 1 });
    expect(t.appendCalls).toHaveLength(0);
    // 受信 0 件で clock を進めない = 正典宣言 marker も立たない (4d-0 と整合)
    expect(t.observed).toHaveLength(0);
  });

  it('受信 clock の最大値で observe する (不変条件 c, §3.2a)', async () => {
    const t = makeDeps([
      envelope(FILE, batch('a', 3)),
      envelope(FILE, batch('b', 11)),
      envelope(FILE, batch('c', 7)),
    ]);
    await receiveRemoteBatches(FILE, t.deps);

    expect(t.observed).toEqual([11]);
  });

  it('書き込みが失敗したら clock を進めない', async () => {
    // 取り込めていないのに clock だけ進むと、次に発番する batch が
    // 「取り込めなかった編集より後」を騙ることになる。
    const t = makeDeps([envelope(FILE, batch('a', 5))]);
    t.failAppendWith(new Error('daemon down'));

    await expect(receiveRemoteBatches(FILE, t.deps)).rejects.toThrow(
      'daemon down',
    );
    expect(t.observed).toHaveLength(0);
  });

  it('べき等: 2 回呼んでも appended が 0 になるだけ (受入基準 2)', async () => {
    // server 側 appendBatch の batch_id べき等性を模す
    const stored = new Set<string>();
    const entries = [
      envelope(FILE, batch('a', 1)),
      envelope(FILE, batch('b', 2)),
    ];
    const deps = {
      pullRemote: async () => entries,
      appendReceived: async (_f: FileId, batches: Batch[]) => {
        let appended = 0;
        for (const b of batches) {
          if (!stored.has(b.id)) {
            stored.add(b.id);
            appended += 1;
          }
        }
        return appended;
      },
      observeRemote: () => {},
    };

    const first = await receiveRemoteBatches(FILE, deps);
    const second = await receiveRemoteBatches(FILE, deps);

    expect(first.appended).toBe(2);
    expect(second.appended).toBe(0); // op-log は増えない
    expect(second.received).toBe(2); // 取得自体は毎回全件 (4d-4: cursor 廃止)
    expect(stored.size).toBe(2);
  });

  it('genesis batch を受信しても素通しする (remote には載らない前提, C1)', async () => {
    // genesis は remote へ push されない (remoteFilter) ので通常は届かない。
    // 万一届いても受信側で特別扱いはせず、べき等な追記に委ねる (判別ロジックを増やさない)。
    const t = makeDeps([
      envelope(FILE, batch('g', 1, { actor: GENESIS_ACTOR })),
    ]);
    const result = await receiveRemoteBatches(FILE, t.deps);

    expect(result.received).toBe(1);
    expect(t.appendCalls[0]?.batches.map((b) => b.actor)).toEqual([
      GENESIS_ACTOR,
    ]);
  });
});
