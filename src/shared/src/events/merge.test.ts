import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type NodeId,
  NodeIdSchema,
} from '../schemas';
import { mergeBranches } from './merge';
import { projectBatches } from './project';
import { SYSTEM_PROPERTY_PREFIX } from './properties';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());

const IMAGE_URL = `${SYSTEM_PROPERTY_PREFIX}imageUrl`;

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
    const { merged, conflicts } = mergeBranches(trunkAfterBase, branchBatches);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].target).toBe(a);
    expect(conflicts[0].category).toBe('content');

    // base を含めて projection すると clock 最大の 'branch' が勝つ (LWW)
    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'init' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodes.get(a)?.content).toBe('branch');
  });

  test('layout の並行変更は対立にしない (静かな LWW)', () => {
    const a = nid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.setLayout', target: a, x: 10, y: 10 }]),
    ];
    const branchBatches = [
      batch(3, [{ kind: 'node.setLayout', target: a, x: 99, y: 99 }]),
    ];
    const { merged, conflicts } = mergeBranches(trunkAfterBase, branchBatches);

    expect(conflicts).toHaveLength(0); // layout は対立に含めない (D7)

    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'A' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodeLayouts.get(a)).toMatchObject({ x: 99, y: 99 }); // clock 最大が勝つ
  });

  test('旧名と新名の並行変更は 1 件の対立になる (#137)', () => {
    // 移行期には片方の端末が旧名 (`imageUrl`)、もう片方が新名を書き得る。寄せずに
    // 比べると別プロパティと見なして競合を取り逃す
    const a = nid();
    const { conflicts } = mergeBranches(
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
    const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
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
    const { merged } = mergeBranches(trunkAfterBase, branchBatches);
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
    const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
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
    const { merged, conflicts } = mergeBranches(trunkAfterBase, branchBatches);
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
    const { merged, conflicts } = mergeBranches(trunkAfterBase, branchBatches);

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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);

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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);

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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);

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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);

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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
      // layout の競合は「通知のみで DtR を起動しない」ので削除依存には混ぜない
      expect(conflicts).toHaveLength(0);
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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);

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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);

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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
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
      const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
      expect(conflicts).toHaveLength(0);
    });
  });
});
