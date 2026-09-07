import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type FileId,
  FileIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { conflictKeyOf, isFork, makeFork } from './fork';
import type { MergeConflict } from './merge';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());
const SHEET: SheetId = SheetIdSchema.parse(crypto.randomUUID());
const TRUNK: FileId = FileIdSchema.parse(crypto.randomUUID());

const bid = (seed: number) =>
  BatchIdSchema.parse(
    `${seed.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
  );

const batch = (
  id: Batch['id'],
  actor: string,
  clock: number,
  ops: Op[],
): Batch => ({ id, actor, clock, timestamp: clock, ops });

const NODE = nid();
const OURS = bid(1);
const THEIRS = bid(2);

const setContent = (content: string): Op => ({
  kind: 'node.setContent',
  target: NODE,
  content,
});

const contentConflict = (over?: Partial<MergeConflict>): MergeConflict =>
  ({
    target: NODE,
    category: 'content',
    ours: { batchId: OURS, op: setContent('私') },
    theirs: { batchId: THEIRS, op: setContent('相手') },
    ...over,
  }) as MergeConflict;

const localBatches = (): Batch[] => [
  batch(bid(9), 'did:plc:alice#dev', 3, [
    { kind: 'node.add', target: NODE, content: '初稿' },
  ]),
  batch(OURS, 'did:plc:alice#dev', 7, [setContent('私')]),
];

let idSeq = 0;
const newId = () => {
  idSeq += 1;
  return `${idSeq.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
};

const forkFrom = (
  conflict: MergeConflict,
  over: Partial<Parameters<typeof makeFork>[0]> = {},
) => {
  const local = over.localBatches ?? localBatches();
  return makeFork({
    conflict,
    targetLabel: '初稿',
    batchOf: (id) => local.find((b) => b.id === id),
    localBatches: local,
    sheetId: SHEET,
    trunkFileId: TRUNK,
    authorActor: 'did:plc:alice#dev',
    newId,
    ...over,
  });
};

describe('conflictKeyOf', () => {
  test('同じ競合からは同じ鍵が出る', () => {
    expect(conflictKeyOf(contentConflict())).toBe(
      conflictKeyOf(contentConflict()),
    );
  });

  /**
   * **ここが fork の同一性の核心である。**implicit merge は全参加者がそれぞれの手元で
   * 行う導出なので、同じ競合を全員が独立に検出する。私から見て「新着」の op は、相手から
   * 見れば「手元」である — 割り当てが入れ替わっても同じ鍵にならないと、一つの競合に
   * 参加者の数だけ fork ができる。
   */
  test('🔴 ours / theirs が入れ替わっても同じ鍵になる', () => {
    const mine = contentConflict();
    const flipped = contentConflict({
      ours: { batchId: THEIRS, op: setContent('相手') },
      theirs: { batchId: OURS, op: setContent('私') },
    });
    expect(conflictKeyOf(flipped)).toBe(conflictKeyOf(mine));
  });

  test('対象が違えば別の鍵になる', () => {
    const other = contentConflict({ target: nid() });
    expect(conflictKeyOf(other)).not.toBe(conflictKeyOf(contentConflict()));
  });

  test('揉めたプロパティが違えば別の鍵になる (#208 の粒度)', () => {
    const a = contentConflict({ propertyName: '期限' });
    const b = contentConflict({ propertyName: '色' });
    expect(conflictKeyOf(a)).not.toBe(conflictKeyOf(b));
  });

  test('layout は観点で分かれる (T3 の粒度)', () => {
    const base = {
      target: NODE,
      ours: contentConflict().ours,
      theirs: contentConflict().theirs,
    };
    const position = {
      ...base,
      category: 'layout',
      aspect: 'position',
    } as MergeConflict;
    const size = {
      ...base,
      category: 'layout',
      aspect: 'size',
    } as MergeConflict;
    expect(conflictKeyOf(position)).not.toBe(conflictKeyOf(size));
  });

  test('種別が違えば別の鍵になる', () => {
    const structure = contentConflict({
      category: 'structure',
      kind: 'removeDependency',
    });
    expect(conflictKeyOf(structure)).not.toBe(conflictKeyOf(contentConflict()));
  });
});

describe('makeFork', () => {
  test('branch として成立する (器は branch と同じ)', () => {
    const fork = forkFrom(contentConflict());
    expect(fork.status).toBe('open');
    expect(fork.trunkFileId).toBe(TRUNK);
    expect(fork.sheetId).toBe(SHEET);
    expect(fork.branchFileId).not.toBe(TRUNK);
    expect(isFork(fork)).toBe(true);
  });

  test('分岐点は検出時点のログ先端 (以後ログが伸びても動かない)', () => {
    const fork = forkFrom(contentConflict());
    expect(fork.base.at).toBe(7);
    expect(fork.origin.baseAt).toBe(7);
  });

  /**
   * 凍結する理由そのもの。畳み直しでは復元できない — fork の後も op-log は伸びるし、
   * 負けた側がその後に消えていれば競合が再現しない (`spec/merging.md`)。
   */
  test('🔴 双方の actor と clock を batch から焼き込む', () => {
    // `MergeConflict` は batchId しか持たない。後から batch を引ける保証が無いので、
    // 「誰と誰が、いつ」をここで固める
    const fork = forkFrom(contentConflict());
    expect(fork.origin.ours).toMatchObject({
      batchId: OURS,
      actor: 'did:plc:alice#dev',
      clock: 7,
    });
    // 相手の batch は手元に無い — **空で書く方が、書かないより良い**
    expect(fork.origin.theirs).toMatchObject({ batchId: THEIRS, actor: '' });
  });

  test('🔴 対象の「その時点で人間に見える形」を凍結する', () => {
    // id だけでは、後でその要素が消えていると何も分からない
    const fork = forkFrom(contentConflict());
    expect(fork.origin.target).toBe(NODE);
    expect(fork.origin.targetLabel).toBe('初稿');
  });

  test('種別を凍結する (3 段のどれとして扱われたか)', () => {
    const structure = forkFrom(
      contentConflict({ category: 'structure', kind: 'removeDependency' }),
    );
    expect(structure.origin).toMatchObject({
      category: 'structure',
      kind: 'removeDependency',
    });
    const layout = forkFrom(
      contentConflict({ category: 'layout', aspect: 'size' }),
    );
    expect(layout.origin).toMatchObject({
      category: 'layout',
      aspect: 'size',
    });
  });

  test('プロパティ名も凍結する', () => {
    const fork = forkFrom(contentConflict({ propertyName: '期限' }));
    expect(fork.origin.propertyName).toBe('期限');
  });

  test('名前は競合を一行で言い表す (人が一覧で読む)', () => {
    expect(forkFrom(contentConflict()).name).toBe('競合: 初稿 の内容');
    expect(forkFrom(contentConflict({ propertyName: '期限' })).name).toContain(
      'プロパティ「期限」',
    );
    expect(
      forkFrom(
        contentConflict({ category: 'structure', kind: 'removeDependency' }),
      ).name,
    ).toBe('競合: 初稿 が消えている');
  });

  test('名前の無い対象でも読める名前になる', () => {
    const fork = forkFrom(contentConflict(), { targetLabel: '' });
    expect(fork.name).toBe('競合: 名前のない要素 の内容');
    // ただし**記述の側は空文字のまま**残す。「名前が無い」と「引けなかった」は別である
    expect(fork.origin.targetLabel).toBe('');
  });

  test('🔴 同じ競合から作れば, 別の端末でも同じ conflictKey になる', () => {
    // id (branchId / branchFileId) は端末ごとに違ってよい。畳むのは鍵の方である
    const a = forkFrom(contentConflict());
    const b = forkFrom(
      contentConflict({
        ours: { batchId: THEIRS, op: setContent('相手') },
        theirs: { batchId: OURS, op: setContent('私') },
      }),
    );
    expect(b.conflictKey).toBe(a.conflictKey);
    expect(b.id).not.toBe(a.id);
  });

  test('edge の競合も扱える', () => {
    const edge = eid();
    const fork = forkFrom(
      contentConflict({
        target: edge,
        category: 'structure',
        kind: 'parallelChange',
      }),
      { targetLabel: 'つながり' },
    );
    expect(fork.origin.target).toBe(edge);
    expect(fork.name).toBe('競合: つながり のつなぎ方');
  });
});
