import { describe, expect, test } from 'bun:test';
import type {
  Batch,
  Did,
  EdgeId,
  NodeId,
  Op,
  SheetId,
} from '@conversensus/shared';
import {
  accumulateOverwrites,
  detectOverwrites,
  NO_OVERWRITE_NOTICE,
  overwriteKeyOf,
} from './overwrites';

const SHEET = 'sheet-1' as SheetId;
const A = 'aaaaaaaa-0000-4000-8000-000000000000' as NodeId;
const B = 'bbbbbbbb-0000-4000-8000-000000000000' as NodeId;
const E = 'eeeeeeee-0000-4000-8000-000000000000' as EdgeId;

const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;
const CAROL = 'did:plc:carol' as Did;

const batch = (id: string, actor: string, clock: number, ops: Op[]): Batch => ({
  id: id as Batch['id'],
  actor,
  clock,
  timestamp: clock,
  sheetId: SHEET,
  ops,
});

/** alice (= 私) が A と B を作ったところまで */
const localLog = (): Batch[] => [
  batch('l1', `${ALICE}#dev`, 1, [
    { kind: 'node.add', target: A, content: 'A' },
    { kind: 'node.add', target: B, content: 'B' },
  ]),
];

describe('detectOverwrites', () => {
  test('新着が無ければ報告もしない (毎サイクル走るので空振りを軽くする)', () => {
    expect(detectOverwrites(localLog(), [], ALICE).reports).toEqual([]);
  });

  test('🔴 相手が見ていた私の編集を書き換えたら報告になる', () => {
    // 私の編集 (clock 2) < 新着 (clock 5) = bob は私の編集を見ていたかもしれない。
    // T5 は検出しない側であり、ここが**その補集合**である
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setContent', target: A, content: '私が書いた' },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: 'bob が直した' },
      ]),
    ];
    const { reports, labels } = detectOverwrites(local, incoming, ALICE);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      target: A,
      category: 'content',
      by: BOB,
      mine: 'l2',
      theirs: 'r1',
    });
    // 名前は分岐点 (受信前の手元) から引く。適用後では相手の値になっている
    expect(labels.get(A)).toBe('私が書いた');
  });

  test('🔴 相手に見えていなかったなら報告しない (そちらは競合として出る)', () => {
    // 私の編集 (clock 5) >= 新着 (clock 5) = 並行と言い切れる。T5 の担当区間である
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: '私が書いた' },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: 'bob が書いた' },
      ]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toEqual([]);
  });

  test('🔴 同じ単位に古い編集と新しい編集があるとき, 競合と二重に出さない', () => {
    // 私は A を 2 回書いた。2 度目 (clock 5) は新着以上なので T5 が競合として出す。
    // 1 度目 (clock 2) を拾ってしまうと、同じ単位が両方の系列に出る
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setContent', target: A, content: '一度目' },
      ]),
      batch('l3', `${ALICE}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: '二度目' },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: 'bob が書いた' },
      ]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toEqual([]);
  });

  test('🔴 私の最後の値が相手と同じなら, 何も上書きされていない', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setContent', target: A, content: '古い値' },
      ]),
      batch('l3', `${ALICE}#dev`, 3, [
        { kind: 'node.setContent', target: A, content: '同じ値' },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: '同じ値' },
      ]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toEqual([]);
  });

  test('🔴 他人どうしの上書きは報告しない (「あなたが書いた」ではない)', () => {
    const local = [
      ...localLog(),
      batch('l2', `${CAROL}#dev`, 2, [
        { kind: 'node.setContent', target: A, content: 'carol が書いた' },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: 'bob が直した' },
      ]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toEqual([]);
  });

  test('同じ人の別端末が書いた分も「あなたが書いた」に含める (判定は DID 単位)', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#phone`, 2, [
        { kind: 'node.setContent', target: A, content: '携帯で書いた' },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: 'bob が直した' },
      ]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toHaveLength(1);
  });

  test('🔴 layout も報告する (fork にならないので他に伝える道が無い)', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setLayout', target: A, x: 10, y: 10 },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setLayout', target: A, x: 90, y: 90 },
      ]),
    ];
    const { reports } = detectOverwrites(local, incoming, ALICE);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      category: 'layout',
      aspect: 'position',
    });
  });

  test('動かしただけと大きさを変えただけは別の単位なので、上書きにならない', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setLayout', target: A, x: 10, y: 10 },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setLayout', target: A, width: 200, height: 100 },
      ]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toEqual([]);
  });

  test('🔴 削除は報告しない (「別の値になった」の言い方に乗らない)', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setContent', target: A, content: '私が書いた' },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [{ kind: 'node.remove', target: A }]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toEqual([]);
  });

  test('🔴 相手が同じところを何度も直しても、報告は 1 件に畳む', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setContent', target: A, content: '私が書いた' },
      ]),
    ];
    // **並び順を clock 順にしない。**受信は repo ごとに読んだ順で積むので、配列の
    // 並びは clock 順とは限らない。並び順に依存する畳み方 (「最後に見たものを採る」) は
    // ここで落ちる
    const incoming = [
      batch('r2', `${BOB}#dev`, 7, [
        { kind: 'node.setContent', target: A, content: '最後' },
      ]),
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setContent', target: A, content: '途中' },
      ]),
    ];
    const { reports } = detectOverwrites(local, incoming, ALICE);
    expect(reports).toHaveLength(1);
    // 残るのは**最後にどうなったか** (clock の大きい方) である
    expect(reports[0]?.theirs).toBe('r2' as Batch['id']);
  });

  test('プロパティは 1 つずつが単位である (別のキーを触っただけでは報告しない)', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 2, [
        { kind: 'node.setProperty', target: A, name: 'foo', value: 1 },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'node.setProperty', target: A, name: 'bar', value: 2 },
      ]),
    ];
    expect(detectOverwrites(local, incoming, ALICE).reports).toEqual([]);
  });

  test('エッジのつなぎ替えは structure の報告になる', () => {
    const local = [
      ...localLog(),
      batch('l2', `${ALICE}#dev`, 1, [
        { kind: 'edge.add', target: E, source: A, dest: B },
      ]),
      batch('l3', `${ALICE}#dev`, 2, [
        { kind: 'edge.reconnect', target: E, source: B, dest: A },
      ]),
    ];
    const incoming = [
      batch('r1', `${BOB}#dev`, 5, [
        { kind: 'edge.reconnect', target: E, source: A, dest: B },
      ]),
    ];
    const { reports } = detectOverwrites(local, incoming, ALICE);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ target: E, category: 'structure' });
  });
});

describe('accumulateOverwrites', () => {
  const report = (target: string, content: string) => ({
    target,
    category: 'content' as const,
    by: BOB,
    mine: 'l2' as Batch['id'],
    theirs: content as Batch['id'],
  });

  test('🔴 検出のたびに溜まる (自動では開かないので、上書きすると人が見る前に消える)', () => {
    const first = accumulateOverwrites(NO_OVERWRITE_NOTICE, {
      reports: [report(A, 'r1')],
      labels: new Map([[A, 'A の名前']]),
    });
    const second = accumulateOverwrites(first, {
      reports: [report(B, 'r2')],
      labels: new Map([[B, 'B の名前']]),
    });
    expect(second.reports).toHaveLength(2);
    // 前の受信で引けた名前も残す (分岐点は受信のたびに進むので後からは引けない)
    expect(second.labels.get(A)).toBe('A の名前');
    expect(second.labels.get(B)).toBe('B の名前');
  });

  test('🔴 同じ単位の報告は後から来た方で置き換える (いまどうなっているかを見せる)', () => {
    const first = accumulateOverwrites(NO_OVERWRITE_NOTICE, {
      reports: [report(A, 'r1')],
      labels: new Map(),
    });
    const second = accumulateOverwrites(first, {
      reports: [report(A, 'r9')],
      labels: new Map(),
    });
    expect(second.reports).toHaveLength(1);
    expect(second.reports[0]?.theirs).toBe('r9' as Batch['id']);
  });

  test('0 件なら束をそのまま返す (人が読んでいる一覧を空で潰さない)', () => {
    const first = accumulateOverwrites(NO_OVERWRITE_NOTICE, {
      reports: [report(A, 'r1')],
      labels: new Map(),
    });
    expect(
      accumulateOverwrites(first, { reports: [], labels: new Map() }),
    ).toBe(first);
  });
});

describe('overwriteKeyOf', () => {
  test('同じ対象でも観点が違えば別の報告である', () => {
    const base = {
      target: A,
      by: BOB,
      mine: 'l' as Batch['id'],
      theirs: 'r' as Batch['id'],
    };
    expect(
      overwriteKeyOf({ ...base, category: 'layout', aspect: 'position' }),
    ).not.toBe(overwriteKeyOf({ ...base, category: 'layout', aspect: 'size' }));
    expect(overwriteKeyOf({ ...base, category: 'content' })).not.toBe(
      overwriteKeyOf({ ...base, category: 'layout', aspect: 'position' }),
    );
  });
});
