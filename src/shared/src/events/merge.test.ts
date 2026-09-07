import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type NodeId,
  NodeIdSchema,
} from '../schemas';
import type { CascadeGraphView } from './cascade';
import { mergeBranches, requiresConfirmation } from './merge';
import { projectBatches } from './project';
import { SYSTEM_PROPERTY_PREFIX } from './properties';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());

const IMAGE_URL = `${SYSTEM_PROPERTY_PREFIX}imageUrl`;

/**
 * 分岐点の状態を使わないケースに渡す空のグラフ。
 *
 * カスケードは「グループの子孫」「端点を失うエッジ」を求めるためのものなので、
 * 対象を直接名指しする検出 (S1 / S2 / S4) は分岐点の状態が無くても成立する
 * (`cascadeOfRemoval` は対象自身を必ず返す)。**カスケードが主題のテストだけが
 * 本物の分岐点を組む**。
 */
const NO_BASE: CascadeGraphView = { nodes: new Map(), edges: new Map() };

function batch(clock: number, ops: Op[], actor = 'local'): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor,
    clock,
    timestamp: clock,
    ops,
  };
}

describe('mergeBranches', () => {
  test('content の並行変更を対立として検出し、LWW で暫定確定する', () => {
    const a = nid();
    // base: A を追加 (clock 1)
    // trunk: A を 'trunk' に (clock 2, alice)
    // branch: A を 'branch' に (clock 3, bob)
    const trunkAfterBase = [
      batch(
        2,
        [{ kind: 'node.setContent', target: a, content: 'trunk' }],
        'alice',
      ),
    ];
    const branchBatches = [
      batch(
        3,
        [{ kind: 'node.setContent', target: a, content: 'branch' }],
        'bob',
      ),
    ];
    const { merged, conflicts } = mergeBranches(
      NO_BASE,
      trunkAfterBase,
      branchBatches,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].target).toBe(a);
    expect(conflicts[0].category).toBe('content');

    // base を含めて projection すると clock 最大の 'branch' が勝つ (LWW)
    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'init' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodes.get(a)?.content).toBe('branch');
  });

  test('layout の並行変更は検出するが解決は LWW のまま (Phase 3 T3)', () => {
    // 以前は layout を対立に含めていなかった (D7)。仕様の 3 段では layout も
    // 「検出して通知する」— ただし DtR は起動しないので、**解決は静かな LWW のまま**
    const a = nid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.setLayout', target: a, x: 10, y: 10 }]),
    ];
    const branchBatches = [
      batch(3, [{ kind: 'node.setLayout', target: a, x: 99, y: 99 }]),
    ];
    const { merged, conflicts } = mergeBranches(
      NO_BASE,
      trunkAfterBase,
      branchBatches,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      category: 'layout',
      aspect: 'position',
    });
    // **確認では止めない。**layout は通知だけの段である
    expect(conflicts.filter(requiresConfirmation)).toHaveLength(0);

    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'A' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodeLayouts.get(a)).toMatchObject({ x: 99, y: 99 }); // clock 最大が勝つ
  });

  test('旧名と新名の並行変更は 1 件の対立になる (#137)', () => {
    // 移行期には片方の端末が旧名 (`imageUrl`)、もう片方が新名を書き得る。寄せずに
    // 比べると別プロパティと見なして競合を取り逃す
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [
        batch(
          2,
          [
            {
              kind: 'node.setProperty',
              target: a,
              name: 'imageUrl',
              value: 'trunk',
            },
          ],
          'alice',
        ),
      ],
      [
        batch(
          3,
          [
            {
              kind: 'node.setProperty',
              target: a,
              name: IMAGE_URL,
              value: 'branch',
            },
          ],
          'bob',
        ),
      ],
    );

    expect(conflicts).toHaveLength(1);
    // DtR graph が指すのは新名である — 旧名は同じプロパティの古い綴りに過ぎない
    expect(conflicts[0].propertyName).toBe(IMAGE_URL);
  });

  test('同じ値への並行変更は対立にしない', () => {
    const a = nid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.setContent', target: a, content: 'same' }]),
    ];
    const branchBatches = [
      batch(3, [{ kind: 'node.setContent', target: a, content: 'same' }]),
    ];
    const { conflicts } = mergeBranches(NO_BASE, trunkAfterBase, branchBatches);
    expect(conflicts).toHaveLength(0);
  });

  test('structure の新規追加はマージ後も保持される (OR-Set)', () => {
    const a = nid();
    const d = nid();
    const e = eid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.add', target: a, content: 'A' }]),
    ];
    const branchBatches = [
      batch(3, [
        { kind: 'node.add', target: d, content: 'D' },
        { kind: 'edge.add', target: e, source: a, dest: d },
      ]),
    ];
    const { merged } = mergeBranches(NO_BASE, trunkAfterBase, branchBatches);
    const g = projectBatches(merged);
    expect(g.nodes.has(a)).toBe(true);
    expect(g.nodes.has(d)).toBe(true);
    expect(g.edges.has(e)).toBe(true);
  });

  test('異なるノードへの content 変更は対立しない', () => {
    const a = nid();
    const b = nid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.setContent', target: a, content: 'a2' }]),
    ];
    const branchBatches = [
      batch(3, [{ kind: 'node.setContent', target: b, content: 'b2' }]),
    ];
    const { conflicts } = mergeBranches(NO_BASE, trunkAfterBase, branchBatches);
    expect(conflicts).toHaveLength(0);
  });
});

describe('mergeBranches — プロパティはキー単位で判定する (#208)', () => {
  test('別々のプロパティを編集しただけなら対立にせず、どちらも残す', () => {
    const a = nid();
    const trunkAfterBase = [
      batch(2, [
        { kind: 'node.setProperty', target: a, name: 'foo', value: 1 },
      ]),
    ];
    const branchBatches = [
      batch(3, [
        { kind: 'node.setProperty', target: a, name: 'bar', value: 2 },
      ]),
    ];
    const { merged, conflicts } = mergeBranches(
      NO_BASE,
      trunkAfterBase,
      branchBatches,
    );
    expect(conflicts).toHaveLength(0);

    // 触っていないプロパティが消えない — これがキー単位化の目的である
    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'init' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodes.get(a)?.properties).toEqual({ foo: 1, bar: 2 });
  });

  test('同じプロパティの並行変更は対立にし、どのプロパティかを載せる', () => {
    const a = nid();
    const trunkAfterBase = [
      batch(
        2,
        [{ kind: 'node.setProperty', target: a, name: 'foo', value: 'trunk' }],
        'alice',
      ),
    ];
    const branchBatches = [
      batch(
        3,
        [{ kind: 'node.setProperty', target: a, name: 'foo', value: 'branch' }],
        'bob',
      ),
    ];
    const { merged, conflicts } = mergeBranches(
      NO_BASE,
      trunkAfterBase,
      branchBatches,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].category).toBe('content');
    expect(conflicts[0].target).toBe(a);
    // DtR graph は「どのプロパティで揉めたか」を示す必要がある
    expect(conflicts[0].propertyName).toBe('foo');

    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'init' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodes.get(a)?.properties).toEqual({ foo: 'branch' }); // LWW
  });

  test('同じ値への並行変更は対立にしない', () => {
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [
        batch(2, [
          { kind: 'node.setProperty', target: a, name: 'foo', value: 1 },
        ]),
      ],
      [
        batch(3, [
          { kind: 'node.setProperty', target: a, name: 'foo', value: 1 },
        ]),
      ],
    );
    expect(conflicts).toHaveLength(0);
  });

  test('片方の削除ともう片方の変更は同じプロパティなら対立にする', () => {
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setProperty', target: a, name: 'foo' }])],
      [
        batch(3, [
          { kind: 'node.setProperty', target: a, name: 'foo', value: 2 },
        ]),
      ],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].propertyName).toBe('foo');
  });

  test('edge のプロパティも同じ規則で判定する', () => {
    const e = eid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [
        batch(2, [
          { kind: 'edge.setProperty', target: e, name: 'foo', value: 1 },
        ]),
      ],
      [
        batch(3, [
          { kind: 'edge.setProperty', target: e, name: 'bar', value: 2 },
        ]),
      ],
    );
    expect(conflicts).toHaveLength(0);
  });

  test('旧形式 (setProperties) もプロパティごとに割って比べる', () => {
    // 移行期は既存ログの置換 op と新形式が同じマージに混ざる。
    // 旧形式を op まるごとで比べると、別プロパティを触っただけで対立になってしまう
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [
        batch(2, [
          { kind: 'node.setProperties', target: a, properties: { foo: 1 } },
        ]),
      ],
      [
        batch(3, [
          { kind: 'node.setProperty', target: a, name: 'bar', value: 2 },
        ]),
      ],
    );
    expect(conflicts).toHaveLength(0);
  });

  test('旧形式と新形式が同じプロパティを触れば対立になる', () => {
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [
        batch(2, [
          { kind: 'node.setProperties', target: a, properties: { foo: 1 } },
        ]),
      ],
      [
        batch(3, [
          { kind: 'node.setProperty', target: a, name: 'foo', value: 2 },
        ]),
      ],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].propertyName).toBe('foo');
  });

  test('プロパティの対立は content の対立と混ざらない', () => {
    // 同じノードの content とプロパティは別の単位である
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setContent', target: a, content: 'trunk' }])],
      [
        batch(3, [
          { kind: 'node.setProperty', target: a, name: 'foo', value: 1 },
        ]),
      ],
    );
    expect(conflicts).toHaveLength(0);
  });
});

describe('mergeBranches — layout の競合 (Phase 3 T3)', () => {
  // 仕様の 3 段の一番下。**検出して通知するだけで DtR graph は起動しない。**
  // 共同編集で二人が同じノードを動かすのは日常的なので、毎回「対話して決着すべき競合」に
  // 上げると DtR がノイズで埋まる。一方で検出しないと、位置が飛んだ理由が分からない。

  test('同じノードを二人が動かすと position の対立になる', () => {
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setLayout', target: a, x: 1, y: 1 }])],
      [batch(3, [{ kind: 'node.setLayout', target: a, x: 9, y: 9 }])],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      target: a,
      category: 'layout',
      aspect: 'position',
    });
  });

  test('🔴 移動とリサイズは別の観点なので対立にしない', () => {
    // op 単位で判定すると、A が動かし B が大きさを変えただけで競合になる。
    // `setProperties` が抱えていたのと同じ粗さである (ANA-208)。projection も
    // x/y と width/height を独立に畳み込むので、両方そのまま残る
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setLayout', target: a, x: 1, y: 1 }])],
      [
        batch(3, [
          { kind: 'node.setLayout', target: a, width: 100, height: 50 },
        ]),
      ],
    );
    expect(conflicts).toEqual([]);
  });

  test('同じノードを二人がリサイズすると size の対立になる', () => {
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [
        batch(2, [
          { kind: 'node.setLayout', target: a, width: 10, height: 10 },
        ]),
      ],
      [
        batch(3, [
          { kind: 'node.setLayout', target: a, width: 99, height: 99 },
        ]),
      ],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ category: 'layout', aspect: 'size' });
  });

  test('移動とリサイズを両方触った op は 2 つの観点に割れる', () => {
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [
        batch(2, [
          {
            kind: 'node.setLayout',
            target: a,
            x: 1,
            y: 1,
            width: 10,
            height: 10,
          },
        ]),
      ],
      [
        batch(3, [
          {
            kind: 'node.setLayout',
            target: a,
            x: 9,
            y: 9,
            width: 99,
            height: 99,
          },
        ]),
      ],
    );
    expect(
      conflicts.map((c) => c.category === 'layout' && c.aspect).sort(),
    ).toEqual(['position', 'size']);
  });

  test('同じ位置へ動かしただけなら対立にしない', () => {
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setLayout', target: a, x: 5, y: 5 }])],
      [batch(3, [{ kind: 'node.setLayout', target: a, x: 5, y: 5 }])],
    );
    expect(conflicts).toEqual([]);
  });

  test('別のノードを動かしただけなら対立にしない', () => {
    const a = nid();
    const b = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setLayout', target: a, x: 1, y: 1 }])],
      [batch(3, [{ kind: 'node.setLayout', target: b, x: 9, y: 9 }])],
    );
    expect(conflicts).toEqual([]);
  });

  test('edge の経路の並行変更は route の対立になる', () => {
    const e = eid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'edge.setLayout', target: e, pathType: 'step' }])],
      [batch(3, [{ kind: 'edge.setLayout', target: e, pathType: 'bezier' }])],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ category: 'layout', aspect: 'route' });
  });

  test('🔴 layout は確認では止めない (3 段の一番下)', () => {
    // content / structure は人の判断が要るので取り込む前に問うが、layout は通知だけ。
    // **この分岐が生きるのは T3 で layout の category ができてからである**
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setLayout', target: a, x: 1, y: 1 }])],
      [batch(3, [{ kind: 'node.setLayout', target: a, x: 9, y: 9 }])],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts.filter(requiresConfirmation)).toEqual([]);
  });

  test('🔴 layout は削除依存に混ざらない', () => {
    // 消えたノードを動かしただけで DtR が起動すると、ノイズで埋まる。
    // `prerequisitesOf` が layout を対象外にしていることの裏取り
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.remove', target: a }])],
      [batch(3, [{ kind: 'node.setLayout', target: a, x: 9, y: 9 }])],
    );
    // 片側にしか layout op が無いので並行変更でもない
    expect(conflicts).toEqual([]);
  });

  test('content の対立とは別の単位である', () => {
    // 同じノードの content と layout を触っても、単位キーが違うので混ざらない
    const a = nid();
    const { conflicts } = mergeBranches(
      NO_BASE,
      [batch(2, [{ kind: 'node.setContent', target: a, content: 'trunk' }])],
      [batch(3, [{ kind: 'node.setLayout', target: a, x: 9, y: 9 }])],
    );
    expect(conflicts).toEqual([]);
  });
});

describe('mergeBranches — structure の競合', () => {
  describe('削除依存 (非対称)', () => {
    test('S1: trunk が消したノードに branch が edge を張ると競合する', () => {
      const removed = nid();
      const other = nid();
      const e = eid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.remove', target: removed }], 'alice'),
      ];
      const branchBatches = [
        batch(
          3,
          [{ kind: 'edge.add', target: e, source: other, dest: removed }],
          'bob',
        ),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: removed, // 競合の主題は「消された要素」であって edge ではない
        category: 'structure',
        kind: 'removeDependency',
      });
      // ours は常に trunk 側 = 削除した側
      expect(conflicts[0].ours.op.kind).toBe('node.remove');
      expect(conflicts[0].theirs.op.kind).toBe('edge.add');
    });

    test('S2: trunk が消したノードの内容を branch が編集すると競合する', () => {
      const removed = nid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.remove', target: removed }]),
      ];
      const branchBatches = [
        batch(3, [
          { kind: 'node.setContent', target: removed, content: 'edited' },
        ]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: removed,
        category: 'structure',
        kind: 'removeDependency',
      });
    });

    test('S4: trunk が消したグループに branch がノードを入れると競合する', () => {
      const group = nid();
      const n = nid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.remove', target: group }]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'node.setParent', target: n, parentId: group }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );

      // setParent の前提は [n, group] だが、消えているのは group だけ
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: group,
        category: 'structure',
        kind: 'removeDependency',
      });
    });

    test('branch 側が削除した場合も拾う (ours/theirs は trunk/branch のまま)', () => {
      const removed = nid();
      const trunkAfterBase = [
        batch(2, [
          { kind: 'node.setContent', target: removed, content: 'edited' },
        ]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'node.remove', target: removed }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: removed,
        category: 'structure',
        kind: 'removeDependency',
      });
      // 削除したのは branch 側なので、ours (trunk) が編集、theirs (branch) が削除
      expect(conflicts[0].ours.op.kind).toBe('node.setContent');
      expect(conflicts[0].theirs.op.kind).toBe('node.remove');
    });

    test('両側が同じノードを消しても競合にしない (どちらも消したいだけ)', () => {
      const removed = nid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.remove', target: removed }]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'node.remove', target: removed }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );
      expect(conflicts).toHaveLength(0);
    });

    test('消えたノードを動かしただけ (layout) は競合にしない', () => {
      const removed = nid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.remove', target: removed }]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'node.setLayout', target: removed, x: 5, y: 5 }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );
      // layout の競合は「通知のみで DtR を起動しない」ので削除依存には混ぜない
      expect(conflicts).toHaveLength(0);
    });
  });

  // ここが Phase 3 T1 の主眼である。判定の入力が「op に書かれた id」ではなく
  // 「分岐点の状態にカスケードを当てて求めた、実際に消える要素の集合」になる
  describe("カスケード削除の推移的な検出 (S1' / S2')", () => {
    /** g > child のグループを 1 つと、child に繋がるエッジ 1 本を持つ分岐点 */
    function baseWithGroup() {
      const g = nid();
      const child = nid();
      const outside = nid();
      const e = eid();
      const base = projectBatches([
        batch(1, [
          { kind: 'node.add', target: g, content: 'G', nodeType: 'group' },
          { kind: 'node.add', target: child, content: 'C', parentId: g },
          { kind: 'node.add', target: outside, content: 'O' },
          { kind: 'edge.add', target: e, source: child, dest: outside },
        ]),
      ]);
      return { base, g, child, outside, e };
    }

    test('🔴 グループを消すと、子への編集が削除依存として検出される', () => {
      // op に書かれた id は g だけ。child は分岐点の状態を見ないと出てこない
      const { base, g, child } = baseWithGroup();
      const trunkAfterBase = [batch(2, [{ kind: 'node.remove', target: g }])];
      const branchBatches = [
        batch(3, [{ kind: 'node.setContent', target: child, content: 'X' }]),
      ];
      const { conflicts } = mergeBranches(base, trunkAfterBase, branchBatches);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: child, // 競合の主題は「実際に消された要素」
        category: 'structure',
        kind: 'removeDependency',
      });
      // 帰属は「それを壊した削除」= グループの削除である
      expect(conflicts[0]?.ours.op).toMatchObject({
        kind: 'node.remove',
        target: g,
      });
    });

    test('🔴 グループを消すと、巻き添えで消えるエッジへの編集も検出される', () => {
      // child が消えるので、child に繋がる e も消える。2 段のカスケードである
      const { base, g, e } = baseWithGroup();
      const trunkAfterBase = [batch(2, [{ kind: 'node.remove', target: g }])];
      const branchBatches = [
        batch(3, [{ kind: 'edge.setLabel', target: e, label: 'L' }]),
      ];
      const { conflicts } = mergeBranches(base, trunkAfterBase, branchBatches);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: e,
        category: 'structure',
        kind: 'removeDependency',
      });
    });

    test('分岐点を渡さないと同じ編集を取り逃す (この機能の存在理由)', () => {
      // NO_BASE では g の子孫が分からないので child への編集が見えない。
      // **T0 以前の振舞いそのもの**を固定しておく — 退行したらここが緑に戻る
      const { g, child } = baseWithGroup();
      const trunkAfterBase = [batch(2, [{ kind: 'node.remove', target: g }])];
      const branchBatches = [
        batch(3, [{ kind: 'node.setContent', target: child, content: 'X' }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );
      expect(conflicts).toHaveLength(0);
    });

    test('branch 側がグループを消した場合も拾う (ours/theirs は trunk/branch のまま)', () => {
      const { base, g, child } = baseWithGroup();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.setContent', target: child, content: 'X' }]),
      ];
      const branchBatches = [batch(3, [{ kind: 'node.remove', target: g }])];
      const { conflicts } = mergeBranches(base, trunkAfterBase, branchBatches);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.ours.op.kind).toBe('node.setContent'); // trunk 側
      expect(conflicts[0]?.theirs.op).toMatchObject({
        kind: 'node.remove',
        target: g,
      });
    });

    test('グループの外のノードは巻き込まれない', () => {
      const { base, g, outside } = baseWithGroup();
      const trunkAfterBase = [batch(2, [{ kind: 'node.remove', target: g }])];
      const branchBatches = [
        batch(3, [{ kind: 'node.setContent', target: outside, content: 'X' }]),
      ];
      const { conflicts } = mergeBranches(base, trunkAfterBase, branchBatches);
      expect(conflicts).toHaveLength(0);
    });

    test('複数の削除が同じ要素を壊すときは、clock の小さい方に帰属する', () => {
      // 入力の並び順に依らないこと。競合の主題は「誰が最初に壊したか」である
      const { base, g, child } = baseWithGroup();
      const trunkAfterBase = [
        batch(5, [{ kind: 'node.remove', target: child }]),
        batch(2, [{ kind: 'node.remove', target: g }]),
      ];
      const branchBatches = [
        batch(6, [{ kind: 'node.setContent', target: child, content: 'X' }]),
      ];
      const { conflicts } = mergeBranches(base, trunkAfterBase, branchBatches);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.ours.op).toMatchObject({
        kind: 'node.remove',
        target: g, // clock 2。child を直接消した clock 5 ではない
      });
    });
  });

  describe('並行変更 (対称)', () => {
    test('S3: 同じ edge の端点を別々に付け替えると競合する', () => {
      const a = nid();
      const b = nid();
      const c = nid();
      const e = eid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'edge.reconnect', target: e, source: a, dest: b }]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'edge.reconnect', target: e, source: a, dest: c }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: e,
        category: 'structure',
        kind: 'parallelChange',
      });
    });

    test('S5: 同じノードを別々のグループに入れると競合する', () => {
      const n = nid();
      const g = nid();
      const h = nid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.setParent', target: n, parentId: g }]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'node.setParent', target: n, parentId: h }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        target: n,
        category: 'structure',
        kind: 'parallelChange',
      });
    });

    test('同じ値への並行変更は競合にしない', () => {
      const n = nid();
      const g = nid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.setParent', target: n, parentId: g }]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'node.setParent', target: n, parentId: g }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );
      expect(conflicts).toHaveLength(0);
    });

    test('別々のノードのグループ変更は競合しない', () => {
      const n1 = nid();
      const n2 = nid();
      const g = nid();
      const trunkAfterBase = [
        batch(2, [{ kind: 'node.setParent', target: n1, parentId: g }]),
      ];
      const branchBatches = [
        batch(3, [{ kind: 'node.setParent', target: n2, parentId: g }]),
      ];
      const { conflicts } = mergeBranches(
        NO_BASE,
        trunkAfterBase,
        branchBatches,
      );
      expect(conflicts).toHaveLength(0);
    });
  });
});
