import { describe, expect, test } from 'bun:test';
import {
  addressKey,
  BranchIdSchema,
  FileIdSchema,
  type GraphViewAddress,
  HEAD_CUT,
  NodeIdSchema,
  SheetIdSchema,
} from '@conversensus/shared';
import fc from 'fast-check';
import { nextNavigationStep } from './navigation';
import { parseTabs, serializeTabs } from './tabStorage';
import {
  activateTab,
  activeTab,
  closeTab,
  closeTabsWhere,
  isOnFile,
  isOnSheet,
  NO_TABS,
  openFileIds,
  openTab,
  retargetActive,
  type Tab,
  type TabsState,
} from './tabs';

const FILE_A = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f1');
const FILE_B = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f2');
const SHEET_1 = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const SHEET_2 = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a2');
const BRANCH = BranchIdSchema.parse('00000000-0000-4000-8000-0000000000b1');
const NODE = NodeIdSchema.parse('00000000-0000-4000-8000-000000000001');

/**
 * アドレスの小さなプール (2 File × 2 シート × trunk/branch × head/vector)。
 * 広いと同じアドレスを引かず、「同じアドレスは既存のタブへ」に当たらない
 */
const arbAddress: fc.Arbitrary<GraphViewAddress> = fc.record({
  fileId: fc.constantFrom(FILE_A, FILE_B),
  sheetId: fc.constantFrom(SHEET_1, SHEET_2),
  branchId: fc.constantFrom(null, BRANCH),
  cut: fc.constantFrom<GraphViewAddress['cut']>(HEAD_CUT, { alice: 3 }),
});

/** 連番の id。テストの中で一意であればよい */
function idSource() {
  let n = 0;
  return () => `tab-${++n}`;
}

type Action =
  | { kind: 'open'; address: GraphViewAddress }
  | { kind: 'activate'; index: number }
  | { kind: 'close'; index: number };

const arbAction: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant('open' as const), address: arbAddress }),
  fc.record({
    kind: fc.constant('activate' as const),
    index: fc.nat({ max: 5 }),
  }),
  fc.record({ kind: fc.constant('close' as const), index: fc.nat({ max: 5 }) }),
);

/** 操作の列を流す。activate / close の index は、いまのタブの並びに対する位置 */
function run(actions: Action[]): TabsState {
  const newId = idSource();
  return actions.reduce<TabsState>((state, action) => {
    if (action.kind === 'open') return openTab(state, action.address, newId);
    const tab = state.tabs[action.index % Math.max(state.tabs.length, 1)];
    if (!tab) return state;
    return action.kind === 'activate'
      ? activateTab(state, tab.id)
      : closeTab(state, tab.id);
  }, NO_TABS);
}

const keysOf = (state: TabsState) =>
  state.tabs.map((t) => addressKey(t.address));

describe('タブ: 性質', () => {
  test('アクティブは常に並びの中にあり、並びが空のときだけ null', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 30 }), (actions) => {
        const state = run(actions);
        if (state.tabs.length === 0) expect(state.activeId).toBeNull();
        else expect(activeTab(state)).not.toBeNull();
      }),
    );
  });

  test('明示しない限り、同じアドレスのタブは 2 つできない (Q2)', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 30 }), (actions) => {
        const keys = keysOf(run(actions));
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  test('開いたアドレスがアクティブになる', () => {
    fc.assert(
      fc.property(
        fc.array(arbAction, { maxLength: 20 }),
        arbAddress,
        (actions, address) => {
          const state = openTab(run(actions), address, () => 'fresh');
          const active = activeTab(state);
          expect(active && addressKey(active.address)).toBe(
            addressKey(address),
          );
        },
      ),
    );
  });

  test('閉じたタブだけが消え、残りの並びは変わらない', () => {
    fc.assert(
      fc.property(
        fc.array(arbAction, { maxLength: 20 }),
        fc.nat(),
        (actions, pick) => {
          const before = run(actions);
          const target = before.tabs[pick % Math.max(before.tabs.length, 1)];
          if (!target) return;
          const after = closeTab(before, target.id);
          expect(after.tabs).toEqual(
            before.tabs.filter((t) => t.id !== target.id),
          );
        },
      ),
    );
  });

  test('保存して読み戻すと同じ並びになる (Q3)', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 20 }), (actions) => {
        const state = run(actions);
        expect(parseTabs(serializeTabs(state))).toEqual(state);
      }),
    );
  });

  test('移る手順を最後まで踏むと行き先に着く', () => {
    // 画面の動きを模す: 段ごとに画面を 1 段だけ進める。File を開くと
    // そのシートの trunk に着き、シートを選ぶと trunk に戻る (いまの App と同じ)
    fc.assert(
      fc.property(arbAddress, arbAddress, (from, target) => {
        let viewed = {
          fileId: from.fileId,
          sheetId: from.sheetId,
          branchId: from.branchId,
        };
        for (let i = 0; i < 4; i++) {
          const step = nextNavigationStep(target, viewed);
          if (step.kind === 'arrived') return;
          if (step.kind === 'openFile')
            viewed = {
              fileId: step.fileId,
              sheetId: step.sheetId,
              branchId: null,
            };
          else if (step.kind === 'selectSheet')
            viewed = { ...viewed, sheetId: step.sheetId, branchId: null };
          else if (step.kind === 'selectBranch')
            viewed = { ...viewed, branchId: step.branchId };
          else viewed = { ...viewed, branchId: null };
        }
        throw new Error('4 段で着かなかった');
      }),
    );
  });
});

describe('タブ: 例', () => {
  const trunkA1: GraphViewAddress = {
    fileId: FILE_A,
    sheetId: SHEET_1,
    branchId: null,
    cut: HEAD_CUT,
  };
  const trunkA2: GraphViewAddress = { ...trunkA1, sheetId: SHEET_2 };
  const branchA1: GraphViewAddress = { ...trunkA1, branchId: BRANCH };
  const trunkB1: GraphViewAddress = { ...trunkA1, fileId: FILE_B };

  function three(): TabsState {
    const newId = idSource();
    return [trunkA1, trunkA2, trunkB1].reduce<TabsState>(
      (s, a) => openTab(s, a, newId),
      NO_TABS,
    );
  }

  test('アクティブなタブを閉じると右隣へ、右端なら左隣へ移る', () => {
    const state = activateTab(three(), 'tab-2');
    expect(closeTab(state, 'tab-2').activeId).toBe('tab-3');
    const last = activateTab(three(), 'tab-3');
    expect(closeTab(last, 'tab-3').activeId).toBe('tab-2');
  });

  test('アクティブでないタブを閉じてもアクティブは動かない', () => {
    const state = activateTab(three(), 'tab-1');
    expect(closeTab(state, 'tab-3').activeId).toBe('tab-1');
  });

  test('明示 (forceNew) なら同じアドレスでも新しいタブを足す', () => {
    const state = openTab(three(), trunkA1, () => 'dup', { forceNew: true });
    expect(state.tabs).toHaveLength(4);
    expect(state.activeId).toBe('dup');
  });

  test('既存のタブへ移るとき、highlight は新しい方に差し替える', () => {
    const highlighted = {
      ...trunkA1,
      highlight: { nodeIds: [NODE], edgeIds: [] },
    };
    const state = openTab(three(), highlighted, () => 'unused');
    expect(state.tabs).toHaveLength(3);
    expect(activeTab(state)?.address).toEqual(highlighted);
  });

  test('アクティブなタブのアドレスを置き換える (branch を閉じて trunk へ戻った等)', () => {
    const newId = idSource();
    const state = openTab(NO_TABS, branchA1, newId);
    const retargeted = retargetActive(state, trunkA1);
    expect(retargeted.tabs).toHaveLength(1);
    expect(activeTab(retargeted)?.address).toEqual(trunkA1);
  });

  test('シート・File を消すと、それを指すタブが閉じる', () => {
    const state = three();
    expect(keysOf(closeTabsWhere(state, isOnSheet(FILE_A, SHEET_1)))).toEqual(
      [trunkA2, trunkB1].map(addressKey),
    );
    expect(keysOf(closeTabsWhere(state, isOnFile(FILE_A)))).toEqual([
      addressKey(trunkB1),
    ]);
  });

  test('タブが参照する File は重複なく並びの順に出る', () => {
    expect(openFileIds(three())).toEqual([FILE_A, FILE_B]);
  });
});

describe('タブ: 復元 (Q3)', () => {
  const valid: Tab = {
    id: 'tab-1',
    address: {
      fileId: FILE_A,
      sheetId: SHEET_1,
      branchId: null,
      cut: HEAD_CUT,
    },
  };

  test('無い・JSON でない・形が違う値は、空の並びになる', () => {
    expect(parseTabs(null)).toEqual(NO_TABS);
    expect(parseTabs('{')).toEqual(NO_TABS);
    expect(parseTabs('{"tabs":3}')).toEqual(NO_TABS);
  });

  test('壊れたタブだけを捨て、残りは復元する', () => {
    const raw = JSON.stringify({
      tabs: [valid, { id: 'tab-2', address: { fileId: 'not-a-uuid' } }],
      activeId: 'tab-1',
    });
    expect(parseTabs(raw)).toEqual({ tabs: [valid], activeId: 'tab-1' });
  });

  test('アクティブが捨てられたら先頭をアクティブにする', () => {
    const raw = JSON.stringify({
      tabs: [valid, { id: 'tab-2', address: null }],
      activeId: 'tab-2',
    });
    expect(parseTabs(raw).activeId).toBe('tab-1');
  });
});
