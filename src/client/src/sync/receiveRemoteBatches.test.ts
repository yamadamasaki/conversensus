import { describe, expect, it } from 'bun:test';
import type {
  Batch,
  FileId,
  GraphFile,
  Lamport,
  NodeId,
  SheetId,
} from '@conversensus/shared';
import {
  analyzeApplicability,
  GENESIS_ACTOR,
  graphFileToBatches,
  projectFile,
} from '@conversensus/shared';
import { filterBatchesForRemote } from '../atproto/remoteFilter';
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

  it('genesis batch を受信したら素通しで追記する (Phase 4e-0 以降は bootstrap の正規経路)', async () => {
    // Phase 4e-0 の C1 見直しで genesis は remote へ push されるようになった。
    // 受信側は特別扱いせず、べき等な追記に委ねる (判別ロジックを増やさない)。
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

/**
 * Phase 4e-1: bootstrap ギャップ (4d 設計 §1.10) が 4e-0 で塞がることの単体証明。
 *
 * 4d-6 実機で確定した構造: `sheet.create` は genesis batch にしか無く、genesis が
 * remote に載らない (旧 C1) と、受信側は op-log 経由でシートの存在を知れず、
 * 受信 content op は全件 `unknown-sheet` で落ちる (基準 6 FAIL)。
 * 4e-0 で送信フィルタが genesis を通すため、送信 → 受信 → applicability 計測を
 * PDS 非依存で結合し、drop 0 件 (基準 6 相当) を固定する。
 */
describe('bootstrap: genesis を含む受信で未知シートが立ち上がる (Phase 4e-1)', () => {
  const SHEET = '33333333-3333-4333-8333-333333333333' as SheetId;
  const NODE_A = '44444444-4444-4444-8444-444444444444' as NodeId;
  const NODE_B = '55555555-5555-4555-8555-555555555555' as NodeId;

  /** device A のローカル正典を模す: snapshot 由来の genesis + その後の編集 1 batch */
  function deviceABatches(): Batch[] {
    const file: GraphFile = {
      id: FILE,
      name: 'ブートストラップ検証',
      sheets: [
        {
          id: SHEET,
          name: 'シート1',
          nodes: [{ id: NODE_A, content: 'A' }],
          edges: [],
        },
      ],
    };
    const genesis = graphFileToBatches(file);
    // genesis 後の通常編集 (clock は genesis の連番より後)
    const edit: Batch = {
      id: 'edit-1' as Batch['id'],
      actor: 'did:plc:alice#dev-a',
      clock: genesis.length + 1,
      timestamp: 1_700_000_001_000,
      sheetId: SHEET,
      ops: [{ kind: 'node.add', target: NODE_B, content: 'B' }],
    };
    return [...genesis, edit];
  }

  /** 受信側 (device B) のローカル正典を模す in-memory store */
  function makeStore() {
    const stored: Batch[] = [];
    const deps = {
      pullRemote: async () => [] as RemoteBatch[],
      appendReceived: async (_f: FileId, batches: Batch[]) => {
        stored.push(...batches);
        return batches.length;
      },
      observeRemote: () => {},
    };
    return { stored, deps };
  }

  it('送信フィルタを通した genesis が着地し、受信 op の drop が 0 件になる (基準 6 相当)', async () => {
    // 送信側: 4e-0 のフィルタは genesis を通す
    const remote = filterBatchesForRemote(deviceABatches()).map((b) =>
      envelope(FILE, b),
    );
    const t = makeStore();
    t.deps.pullRemote = async () => remote;

    const result = await receiveRemoteBatches(FILE, t.deps);

    expect(result.appended).toBe(remote.length);
    // bootstrap 解消の核心: sheet.create が届くので unknown-sheet が 1 件も出ない
    const report = analyzeApplicability(t.stored);
    expect(report.drops).toEqual([]);
    expect(report.appliedOps).toBe(report.totalOps);
    // projection にもシートとノードが立ち上がる
    const projected = projectFile(t.stored, FILE);
    expect(projected.sheets.map((s) => s.id)).toEqual([SHEET]);
    expect(
      [...(projected.sheets[0]?.nodes ?? [])].map((n) => n.content).sort(),
    ).toEqual(['A', 'B']);
  });

  it('genesis を除外すると同じ編集が unknown-sheet で全滅する (旧 C1 のギャップ再現)', async () => {
    // 4d-6 実機で観測した構造の再現 = 回帰の対照。genesis を落とす旧フィルタを模す。
    const remote = filterBatchesForRemote(deviceABatches())
      .filter((b) => b.actor !== GENESIS_ACTOR)
      .map((b) => envelope(FILE, b));
    const t = makeStore();
    t.deps.pullRemote = async () => remote;

    await receiveRemoteBatches(FILE, t.deps);

    const report = analyzeApplicability(t.stored);
    expect(report.appliedOps).toBe(0);
    expect(report.drops.map((d) => d.reason)).toEqual(['unknown-sheet']);
    // projection は空のまま = 4d-6 で「画面も行数も PASS に見えるが基準 6 だけ落ちる」状態
    expect(projectFile(t.stored, FILE).sheets).toHaveLength(0);
  });
});
