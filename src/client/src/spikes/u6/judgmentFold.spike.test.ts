/**
 * U6-P2 スパイクの実証テスト (投棄前提)
 *
 * Go 判定基準を 1 本ずつ確認する:
 *   1. 判断の畳み込みが pre 条件で op を捨てる (グラフ側には無い意味論)
 *   2. 再 merge の可否が**述語**として表せ、出した本人の手元でも捨てられる
 *   3. **本物の `projectFile` を、分岐を足さずにそのまま使える**
 *   4. 依存が一方向 (判断 → グラフ) で循環しない
 *   5. 「より前」が決まるには**両者が同じ clock 空間を共有している**必要がある
 */

import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  type BatchId,
  type FileId,
  projectFile,
  type SheetId,
} from '@conversensus/shared';
import {
  admissible,
  foldJudgments,
  type JudgmentBatch,
  type RemergeMark,
} from './judgmentFold';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const SHEET = '22222222-2222-4222-8222-222222222222' as SheetId;
const A = 'did:plc:alice';
const B = 'did:plc:bob';
const C = 'did:plc:carol';
const DTR = 'dtr-1';

let seq = 0;
const bid = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

/** 判断 batch */
const jb = (
  actor: string,
  clock: number,
  ops: JudgmentBatch['ops'],
): JudgmentBatch => ({ id: bid(), actor, clock, ops });

/** グラフ batch (シートを 1 枚作り、ノードを 1 つ足す) */
const sheetBatch = (clock: number): Batch => ({
  id: bid(),
  actor: A,
  clock,
  timestamp: 0,
  ops: [{ kind: 'sheet.create', target: SHEET, name: 'S' }],
});

const nodeBatch = (actor: string, clock: number, content: string): Batch => ({
  id: bid(),
  actor,
  clock,
  timestamp: 0,
  sheetId: SHEET,
  ops: [
    { kind: 'node.add', target: `node-${content}`, content },
  ] as Batch['ops'],
});

describe('U6-P2: 判断の畳み込みをグラフの projection から分離できるか', () => {
  test('1. 呼ばれていない actor の承認は捨てられる', () => {
    const j = foldJudgments([
      jb(A, 1, [{ kind: 'dtr.open', dtrId: DTR, callees: [A, B] }]),
      jb(C, 2, [{ kind: 'dtr.approve', dtrId: DTR }]), // C は呼ばれていない
      jb(A, 3, [{ kind: 'dtr.approve', dtrId: DTR }]),
      jb(B, 4, [{ kind: 'dtr.approve', dtrId: DTR }]),
    ]);

    expect(j.approvals.get(DTR)).toEqual(new Set([A, B]));
    // C の承認が数えられていたら、B を待たずに 3 で揃ってしまっていた
    expect(j.satisfiedAt.get(DTR)).toBe(4);
  });

  test('1b. 起動されていない DtR への承認も捨てられる', () => {
    const j = foldJudgments([
      jb(A, 1, [{ kind: 'dtr.approve', dtrId: DTR }]), // open より前
      jb(A, 2, [{ kind: 'dtr.open', dtrId: DTR, callees: [A] }]),
    ]);
    // 起動前の承認は消えるので、まだ揃っていない
    expect(j.satisfiedAt.has(DTR)).toBe(false);
  });

  test('2. pre 条件を満たさない再 merge は、出した本人の手元でも捨てられる', () => {
    // a の手元: a だけが承認し、b はまだ。それでも a が再 merge を出した
    const j = foldJudgments([
      jb(A, 1, [{ kind: 'dtr.open', dtrId: DTR, callees: [A, B] }]),
      jb(A, 2, [{ kind: 'dtr.approve', dtrId: DTR }]),
    ]);

    const remerge = nodeBatch(A, 3, 'remerged');
    const marks = new Map<BatchId, RemergeMark>([[remerge.id, { dtrId: DTR }]]);
    const ok = admissible(j, (b) => marks.get(b.id));

    expect(ok(remerge)).toBe(false);
    // 名簿への生きた問い合わせではなく、記録された集合への判定なので、
    // 「a の手元では通るが b の手元では落ちる」が起こらない (S1)
  });

  test('3. 本物の projectFile を、分岐を足さずにそのまま使える', () => {
    const j = foldJudgments([
      jb(A, 1, [{ kind: 'dtr.open', dtrId: DTR, callees: [A, B] }]),
      jb(A, 2, [{ kind: 'dtr.approve', dtrId: DTR }]),
      jb(B, 3, [{ kind: 'dtr.approve', dtrId: DTR }]), // ここで揃う
    ]);

    const early = nodeBatch(A, 2, 'early'); // 承認が揃う前の再 merge
    const late = nodeBatch(A, 9, 'late'); // 揃った後の再 merge
    const plain = nodeBatch(B, 5, 'plain'); // 再 merge ではない普通の編集
    const marks = new Map<BatchId, RemergeMark>([
      [early.id, { dtrId: DTR }],
      [late.id, { dtrId: DTR }],
    ]);

    const all = [sheetBatch(0), early, plain, late];
    const ok = admissible(j, (b) => marks.get(b.id));

    // ★ ここが答え: 畳み込みに入れる前に落とす。projectFile は何も知らない
    const file = projectFile(all.filter(ok), FILE);

    const contents = file.sheets[0]?.nodes.map((n) => n.content).sort();
    expect(contents).toEqual(['late', 'plain']);
  });

  test('4. 判断の畳み込みはグラフを一切参照しない (一方向)', () => {
    // 型で示す: foldJudgments の引数に Batch も GraphFile も現れない。
    // 実行時にも、グラフを渡さずに完全な結論が出ることを確かめる
    const j = foldJudgments([
      jb(A, 1, [{ kind: 'dtr.open', dtrId: DTR, callees: [A] }]),
      jb(A, 2, [{ kind: 'dtr.approve', dtrId: DTR }]),
    ]);
    expect(j.satisfiedAt.get(DTR)).toBe(2);
  });

  test('5. clock 空間を共有していないと「より前」が決まらない', () => {
    // 判断ログが独立した clock を持っていた場合を模す。承認は「先に」起きているのに、
    // 数として比較すると再 merge の方が小さくなる
    const j = foldJudgments([
      jb(A, 100, [{ kind: 'dtr.open', dtrId: DTR, callees: [A] }]),
      jb(A, 101, [{ kind: 'dtr.approve', dtrId: DTR }]),
    ]);

    const remerge = nodeBatch(A, 7, 'remerged'); // グラフ側の clock は別空間
    const marks = new Map<BatchId, RemergeMark>([[remerge.id, { dtrId: DTR }]]);

    expect(admissible(j, (b) => marks.get(b.id))(remerge)).toBe(false);
    // 承認は済んでいるのに落ちる。**同じ Lamport clock を共有することが前提**である
  });
});
