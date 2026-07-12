/**
 * O3 Spike — 「ブランチ = 操作ログの分岐」の実現可能性 PoC (投棄前提)
 *
 * 検証する仮説:
 *   - ブランチ    = base offset (commit) + 追記イベント列
 *   - コミット    = 操作ログ上のラベル付きオフセット
 *   - マージ      = ブランチ ops を trunk へ追記し、D7 のルールで解決
 *       - structure (add/remove) : OR-Set (add-wins)
 *       - content   (update)     : LWW + 衝突を「対立」として検出・保持
 *       - layout                 : LWW (静かに解決、対立にしない)
 *   - 複合イベント (group/paste) : 基本 op 列へ分解して sync 語彙に乗せる
 *
 * PDS 非依存・完全ローカル。実 app 型には依存しない (spike の独立性のため)。
 */

// --- 統一イベント語彙 (スケッチ) ---

export type Lamport = number;
export type Actor = string; // DID or 'local'
export type Category = 'structure' | 'content' | 'layout' | 'presentation';

/** 全イベント共通のメタ (step1 §4「イベントの最小要件」に対応) */
export type EventMeta = {
  id: string;
  actor: Actor;
  clock: Lamport; // 論理時刻 (Lamport) — LWW の順序付けに使用
  category: Category;
};

export type Op =
  // structure
  | { kind: 'node.add'; target: string; content: string; isGroup?: boolean }
  | { kind: 'node.remove'; target: string }
  | { kind: 'node.setParent'; target: string; parent?: string }
  | { kind: 'edge.add'; target: string; source: string; dest: string }
  | { kind: 'edge.remove'; target: string }
  // content
  | { kind: 'node.setContent'; target: string; content: string }
  | { kind: 'edge.setLabel'; target: string; label: string }
  // layout
  | {
      kind: 'layout.set';
      target: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    };

export type Event = EventMeta & { op: Op };

/** コミット = 操作ログ上のラベル付きオフセット */
export type Commit = { id: string; message: string; clock: Lamport };

/** ブランチ = base コミット + そこから追記されたイベント列 */
export type Branch = { id: string; base: Commit; ops: Event[] };

// --- projection: 操作ログ → 状態 ---

export type NodeState = {
  id: string;
  content: string;
  isGroup: boolean;
  parent?: string;
};
export type EdgeState = {
  id: string;
  source: string;
  dest: string;
  label?: string;
};
export type LayoutState = { x?: number; y?: number; w?: number; h?: number };

export type GraphState = {
  nodes: Map<string, NodeState>;
  edges: Map<string, EdgeState>;
  layout: Map<string, LayoutState>;
};

const emptyState = (): GraphState => ({
  nodes: new Map(),
  edges: new Map(),
  layout: new Map(),
});

/** イベント列を clock 昇順で畳み込み、状態を導出する (fold / applyEvent の統一版) */
export function project(events: Event[]): GraphState {
  const state = emptyState();
  const ordered = [...events].sort((a, b) => a.clock - b.clock);
  for (const ev of ordered) {
    applyOp(state, ev.op);
  }
  return state;
}

function applyOp(state: GraphState, op: Op): void {
  switch (op.kind) {
    case 'node.add':
      state.nodes.set(op.target, {
        id: op.target,
        content: op.content,
        isGroup: op.isGroup ?? false,
      });
      break;
    case 'node.remove':
      state.nodes.delete(op.target);
      break;
    case 'node.setParent': {
      const n = state.nodes.get(op.target);
      if (n) n.parent = op.parent;
      break;
    }
    case 'node.setContent': {
      const n = state.nodes.get(op.target);
      if (n) n.content = op.content;
      break;
    }
    case 'edge.add':
      state.edges.set(op.target, {
        id: op.target,
        source: op.source,
        dest: op.dest,
      });
      break;
    case 'edge.remove':
      state.edges.delete(op.target);
      break;
    case 'edge.setLabel': {
      const e = state.edges.get(op.target);
      if (e) e.label = op.label;
      break;
    }
    case 'layout.set':
      state.layout.set(op.target, { x: op.x, y: op.y, w: op.w, h: op.h });
      break;
  }
}

// --- マージ ---

export type Conflict = {
  target: string;
  category: Category;
  ours: Event;
  theirs: Event;
};

export type MergeResult = {
  merged: Event[]; // trunk へ追記される、解決済みイベント列
  conflicts: Conflict[]; // content の対立 (グラフ上に可視化する候補)
};

/**
 * base 以降の trunk 変更 ( trunkAfterBase) と branch の変更をマージする。
 *
 * - structure add/remove : 両者の op を追記し clock 順に畳み込む。
 *   concurrent add/remove の add-wins OR-Set 厳密化は Phase 1 の課題 (本 spike は未検証)。
 * - content update       : 同一 target への並行変更を LWW で確定しつつ Conflict に記録。
 * - layout               : LWW (clock 大が勝つ)。Conflict には記録しない。
 */
export function merge(trunkAfterBase: Event[], branch: Branch): MergeResult {
  const merged: Event[] = [...trunkAfterBase];
  const conflicts: Conflict[] = [];

  // trunk 側の「target ごとの最後の content / layout 変更」を引く索引
  const trunkContent = lastByTarget(trunkAfterBase, 'content');
  const trunkLayout = lastByTarget(trunkAfterBase, 'layout');

  for (const ev of branch.ops) {
    if (ev.category === 'content') {
      const target = opTarget(ev.op);
      const rival = trunkContent.get(target);
      if (rival && differs(rival, ev)) {
        // 並行 content 変更 = 対立。LWW で確定しつつ可視化候補に積む
        conflicts.push({
          target,
          category: 'content',
          ours: rival,
          theirs: ev,
        });
      }
      merged.push(ev); // clock 順で project すれば LWW が成立
    } else if (ev.category === 'layout') {
      // layout は LWW のみ。対立にしない (D7)
      const target = opTarget(ev.op);
      const rival = trunkLayout.get(target);
      if (!rival || ev.clock > rival.clock) merged.push(ev);
    } else {
      // structure (add/remove/parent) : 追記して clock 順に畳み込む
      // (concurrent add/remove の add-wins 厳密化は Phase 1)
      merged.push(ev);
    }
  }

  return { merged, conflicts };
}

function lastByTarget(events: Event[], category: Category): Map<string, Event> {
  const m = new Map<string, Event>();
  for (const ev of events) {
    if (ev.category !== category) continue;
    const target = opTarget(ev.op);
    const prev = m.get(target);
    if (!prev || ev.clock > prev.clock) m.set(target, ev);
  }
  return m;
}

function opTarget(op: Op): string {
  return op.target;
}

function differs(a: Event, b: Event): boolean {
  return JSON.stringify(a.op) !== JSON.stringify(b.op);
}

// --- 複合イベントの分解 (group / paste) ---

/** グループ化 = group ノード追加 + 子の親付け替え + group の layout */
export function decomposeGroup(
  groupId: string,
  childIds: string[],
  groupLayout: LayoutState,
  meta: (category: Category) => EventMeta,
): Event[] {
  const events: Event[] = [
    {
      ...meta('structure'),
      op: { kind: 'node.add', target: groupId, content: '', isGroup: true },
    },
    {
      ...meta('layout'),
      op: { kind: 'layout.set', target: groupId, ...groupLayout },
    },
  ];
  for (const childId of childIds) {
    events.push({
      ...meta('structure'),
      op: { kind: 'node.setParent', target: childId, parent: groupId },
    });
  }
  return events;
}

/** ペースト = 複数の node.add + edge.add */
export function decomposePaste(
  nodes: Array<{ id: string; content: string }>,
  edges: Array<{ id: string; source: string; dest: string }>,
  meta: (category: Category) => EventMeta,
): Event[] {
  const events: Event[] = [];
  for (const n of nodes) {
    events.push({
      ...meta('structure'),
      op: { kind: 'node.add', target: n.id, content: n.content },
    });
  }
  for (const e of edges) {
    events.push({
      ...meta('structure'),
      op: { kind: 'edge.add', target: e.id, source: e.source, dest: e.dest },
    });
  }
  return events;
}
