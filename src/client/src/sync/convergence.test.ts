import { describe, expect, test } from 'bun:test';
import type {
  Batch,
  BatchId,
  Did,
  EdgeId,
  JudgmentBatch,
  JudgmentOp,
  NodeId,
  Op,
} from '@conversensus/shared';
import {
  didFromActor,
  foldParticipation,
  projectBatches,
  wasParticipatingAt,
} from '@conversensus/shared';
import fc from 'fast-check';
import { filterByParticipation } from './participationFilter';

const A = 'did:plc:alice' as Did;
const B = 'did:plc:bob' as Did;
const C = 'did:plc:carol' as Did;

let seq = 0;
const nextId = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

const jb = (did: Did, clock: number, ops: JudgmentOp[]): JudgmentBatch => ({
  id: nextId(),
  actor: `${did}#dev-1`,
  clock,
  timestamp: 0,
  ops,
});
const gb = (did: Did, clock: number, ops: Op[]): Batch =>
  ({
    id: nextId(),
    actor: `${did}#dev-1`,
    clock,
    timestamp: 0,
    ops,
  }) as unknown as Batch;

/**
 * 受け取った側の projection。**自分の batch にはフィルタをかけない** —
 * ローカル正典は権威であって同期の対象ではない (`participationFilter`)
 */
function projectionAt(
  judgments: readonly JudgmentBatch[],
  batches: readonly Batch[],
  viewer: Did,
) {
  const p = foldParticipation(judgments, { isLocalDid: () => true });
  const mine = batches.filter((b) => didFromActor(b.actor) === viewer);
  const others = filterByParticipation(
    p,
    batches.filter((b) => didFromActor(b.actor) !== viewer),
  );
  return projectBatches([...mine, ...others]);
}

/**
 * 比較できる形にする。Map の反復順に結論を依存させない。
 *
 * **tombstone (`removed`) も比べる** (Phase 3 T2)。add-wins で削除が「消滅」から
 * 「消えているが在る」に変わったので、live だけを見ると **removed 側のずれが
 * 見えない** — 「両方の手元で消えて見える」だけでは収束の証明にならない。
 */
const shape = (g: ReturnType<typeof projectBatches>) => {
  const byId = <T extends { id: string }>(m: Map<string, T>) =>
    [...m.values()].sort((x, y) => x.id.localeCompare(y.id));
  return {
    nodes: byId(g.nodes as Map<string, { id: string }>),
    edges: byId(g.edges as Map<string, { id: string }>),
    layouts: [...g.nodeLayouts.values()].sort((x, y) =>
      x.nodeId.localeCompare(y.nodeId),
    ),
    removedNodes: byId(g.removed.nodes as Map<string, { id: string }>),
    removedEdges: byId(g.removed.edges as Map<string, { id: string }>),
  };
};

// --- 生成器 ---
//
// **小さなプールから引く。**広く振ると同じノードへの add / setContent / remove が
// 並ばず、畳み込みの衝突 (LWW / カスケード削除) に当たらない。何を引かないかは
// 何を検証しないかと同じ意味を持つ (CLAUDE.md)

const did = fc.constantFrom(A, B, C);
const nodeId = fc.constantFrom('n1', 'n2', 'n3').map((s) => s as NodeId);
const edgeId = fc.constantFrom('e1', 'e2').map((s) => s as EdgeId);
const clock = fc.integer({ min: 0, max: 12 });

/**
 * **削除を厚く引く** (Phase 3 T2 の受入基準)。
 *
 * add-wins は削除の意味論を変えるので、削除がまばらにしか出ない生成器では
 * 「add-wins にしても ∀ 配送順で同じ projection になる」を確かめたことにならない。
 * `node.remove` / `edge.remove` に重みを付け、さらに **`node.setParent` を入れて
 * グループを作る** — カスケード削除と、その tombstone を解く経路は、親子関係が
 * 無いと 1 度も通らない。
 *
 * 重みは「削除 : それ以外」がおよそ 1 : 2 になるようにしてある。削除だけを厚くすると
 * 今度はグラフが空のままになり、tombstone を解く側 (add-wins の本体) を引かない。
 */
const graphOp: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .tuple(nodeId, fc.constantFrom('あ', 'い'))
      .map(
        ([target, content]) => ({ kind: 'node.add', target, content }) as Op,
      ),
  },
  {
    weight: 3,
    arbitrary: fc
      .tuple(nodeId, fc.constantFrom('あ', 'い'))
      .map(
        ([target, content]) =>
          ({ kind: 'node.setContent', target, content }) as Op,
      ),
  },
  {
    // グループを作る。カスケード削除とその復帰は親子関係が無いと 1 度も通らない
    weight: 3,
    arbitrary: fc
      .tuple(nodeId, fc.option(nodeId, { nil: undefined }))
      .map(
        ([target, parentId]) =>
          ({ kind: 'node.setParent', target, parentId }) as Op,
      ),
  },
  {
    weight: 4,
    arbitrary: nodeId.map((target) => ({ kind: 'node.remove', target }) as Op),
  },
  {
    weight: 3,
    arbitrary: fc
      .tuple(edgeId, nodeId, nodeId)
      .map(
        ([target, source, dest]) =>
          ({ kind: 'edge.add', target, source, dest }) as Op,
      ),
  },
  {
    weight: 2,
    arbitrary: edgeId.map((target) => ({ kind: 'edge.remove', target }) as Op),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        nodeId,
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
      )
      .map(
        ([target, x, y]) => ({ kind: 'node.setLayout', target, x, y }) as Op,
      ),
  },
);

const judgmentOp: fc.Arbitrary<JudgmentOp> = fc.oneof(
  fc.constant({ kind: 'participation.genesis' } as JudgmentOp),
  did.map((target) => ({ kind: 'participation.invite', target }) as JudgmentOp),
  did.map(
    (inviter) => ({ kind: 'participation.accept', inviter }) as JudgmentOp,
  ),
  did.map((target) => ({ kind: 'participation.revoke', target }) as JudgmentOp),
  fc.constant({ kind: 'participation.resign' } as JudgmentOp),
  fc.constant({ kind: 'participation.reopen' } as JudgmentOp),
);

/**
 * **共同作業が成立しているところから始める。**
 *
 * 判断 op を一様に引くと、`genesis → invite → accept` の並びを乱数が引き当てないので
 * 名簿がほとんど空のままになる。実測で **500 回中 3 回しか参加者が 2 人以上にならな
 * かった** — 多アクタの収束を述べたい命題が、ほぼ単独 actor だけを見ていた。
 *
 * そこで**先頭に有効な導入部を固定**し、その後ろに乱数の尾を付ける。導入部の clock を
 * 0-2、尾を 3 以降にするのは、尾が導入部より前に割り込んで名簿を空に戻さないためである
 * (割り込みの検証は clock の話ではなく**配送順**の話で、それは性質の側が担う)。
 *
 * 尾には取り消し・参加取りやめ・引き取り・再依頼が入るので、**離脱と再参加は尾が作る**。
 */
const judgmentLog = fc
  .array(
    fc.tuple(
      did,
      fc.integer({ min: 3, max: 12 }),
      fc.array(judgmentOp, { minLength: 1, maxLength: 2 }),
    ),
    { maxLength: 6 },
  )
  .map(
    (tail) =>
      [
        [A, 0, [{ kind: 'participation.genesis' }]],
        [A, 1, [{ kind: 'participation.invite', target: B }]],
        [B, 2, [{ kind: 'participation.accept', inviter: A }]],
        ...tail,
      ] as [Did, number, JudgmentOp[]][],
  );
/**
 * **描かれたグラフがあるところから始める** (Phase 3 T2)。
 *
 * 判断ログと同じ問題がグラフ側にもある。op を一様に引くと `node.add` より前に
 * `node.remove` や `setContent` が来て無言の no-op になり、**削除も復活も引き当てない**。
 * 実測で tombstone が出るのは 100 回中 10 回、グループができるのは 2 回だった —
 * add-wins の収束を述べたい命題が、ほとんど空のグラフを見ていた。
 *
 * そこで**先頭に有効な導入部を固定する**: A が n1/n2/n3 を作り、n2 を n1 の子にして
 * (カスケードの起点)、e1 で n2 と n3 を結ぶ。尾の clock を 3 以降にするのは導入部より
 * 前に割り込ませないためで、判断ログと同じ判断である (**割り込みの検証は clock では
 * なく配送順の話**で、それは性質の側が担う)。
 */
const graphLog = fc
  .array(
    fc.tuple(
      did,
      fc.integer({ min: 3, max: 12 }),
      fc.array(graphOp, { minLength: 1, maxLength: 2 }),
    ),
    { minLength: 2, maxLength: 8 },
  )
  .map(
    (tail) =>
      [
        [
          A,
          0,
          [
            { kind: 'node.add', target: 'n1' as NodeId, content: 'あ' },
            { kind: 'node.add', target: 'n2' as NodeId, content: 'い' },
            { kind: 'node.add', target: 'n3' as NodeId, content: 'あ' },
          ],
        ],
        [
          A,
          1,
          [
            {
              kind: 'node.setParent',
              target: 'n2' as NodeId,
              parentId: 'n1' as NodeId,
            },
          ],
        ],
        [
          A,
          2,
          [
            {
              kind: 'edge.add',
              target: 'e1' as EdgeId,
              source: 'n2' as NodeId,
              dest: 'n3' as NodeId,
            },
          ],
        ],
        ...tail,
      ] as [Did, number, Op[]][],
  );

/** 生成した種から batch を組む。**id は組むたびに新しい** ので順序の混同を防ぐ */
const buildJ = (seeds: [Did, number, JudgmentOp[]][]) =>
  seeds.map(([d, c, ops]) => jb(d, c, ops));
const buildG = (seeds: [Did, number, Op[]][]) =>
  seeds.map(([d, c, ops]) => gb(d, c, ops));

/** 決定論的に並べ替える (種で回す) */
const shuffled = <T>(xs: readonly T[], seed: number) =>
  [...xs].sort(
    (a, b) =>
      ((xs.indexOf(a) * 31 + seed) % 7) - ((xs.indexOf(b) * 31 + seed) % 7),
  );

describe('多アクタの収束 (step2 Phase 2 S7)', () => {
  test('∀ 配送順. 同じ op 集合を見た 2 つの手元は同じ projection を出す', () => {
    fc.assert(
      fc.property(
        judgmentLog,
        graphLog,
        fc.integer(),
        fc.integer(),
        (jSeeds, gSeeds, s1, s2) => {
          // **同じ batch を渡す。**組み直すと id が変わり、tiebreak が動いて
          // 「順序の違い」ではなく「別の集合」を比べることになる
          const judgments = buildJ(jSeeds as [Did, number, JudgmentOp[]][]);
          const batches = buildG(gSeeds as [Did, number, Op[]][]);

          const one = projectionAt(
            shuffled(judgments, s1),
            shuffled(batches, s1),
            A,
          );
          const other = projectionAt(
            shuffled(judgments, s2).reverse(),
            shuffled(batches, s2).reverse(),
            A,
          );
          expect(shape(one)).toEqual(shape(other));
        },
      ),
    );
  });

  test('∀ 参加期間の外の op. 足しても受け取った側の projection は変わらない', () => {
    // **完了基準 3 を全称で述べたもの**である。「取り消した後に 1 回編集してみる」の
    // 例では、取り消しと編集の並びが 1 通りしか確かめられない
    fc.assert(
      fc.property(
        judgmentLog,
        graphLog,
        did,
        clock,
        graphOp,
        (jSeeds, gSeeds, author, at, op) => {
          const judgments = buildJ(jSeeds as [Did, number, JudgmentOp[]][]);
          const batches = buildG(gSeeds as [Did, number, Op[]][]);
          const p = foldParticipation(judgments, { isLocalDid: () => true });

          // 前提: その actor はその時点で参加していない。**自分自身は除く** —
          // ローカル正典にフィルタはかからないので、命題の対象外である
          fc.pre(author !== A && !wasParticipatingAt(p, author, at));

          const extra = gb(author, at, [op]);
          expect(
            shape(projectionAt(judgments, [...batches, extra], A)),
          ).toEqual(shape(projectionAt(judgments, batches, A)));
        },
      ),
    );
  });

  test('∀ 配送順. 名簿そのものも配送順に依らない', () => {
    // 上の 2 つの土台。名簿が揺れれば projection も揺れるので、先に固定しておく
    fc.assert(
      fc.property(judgmentLog, fc.integer(), (jSeeds, s) => {
        const judgments = buildJ(jSeeds as [Did, number, JudgmentOp[]][]);
        const deps = { isLocalDid: () => true };
        const one = foldParticipation(judgments, deps);
        const other = foldParticipation(shuffled(judgments, s).reverse(), deps);
        expect([...one.participating].sort()).toEqual(
          [...other.participating].sort(),
        );
        expect([...one.invited.entries()].sort()).toEqual(
          [...other.invited.entries()].sort(),
        );
      }),
    );
  });
});
