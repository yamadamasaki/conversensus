/**
 * 統一イベント語彙 (step1 Phase 1)
 *
 * 現行の `GraphEvent` (client, undo/redo) と `CommitOperation` (ATProto 同期) を
 * 1 つの語彙へ統合する正典。O3 spike (deepse/spikes/o3-report.md) の Go 判定に基づく。
 *
 * モデル: **バッチ**
 *   - 1 ユーザー操作 = `Op` (atomic 操作) の Batch。Batch が undo/redo の単位。
 *   - 単一操作は「op 1 件の Batch」として統一的に扱う。
 *   - 同期・マージの解決単位は Batch 内の各 Op (OR-Set / LWW)。
 *
 * カテゴリと同期 (step1 §4, D7):
 *   - structure / content / layout = 同期対象
 *   - presentation                 = ローカル限定 (システムがルールで導出、再導出可能)
 */

import { z } from 'zod';
import {
  EdgeIdSchema,
  EdgePathTypeSchema,
  NodeIdSchema,
  StyleSchema,
} from '../schemas';

// --- メタ ---

/** バッチ識別子 (べき等な適用・重複排除の単位) */
export const BatchIdSchema = z.string().uuid().brand<'BatchId'>();
export type BatchId = z.infer<typeof BatchIdSchema>;

/** 操作の主体。DID または未接続時の 'local' */
export const LOCAL_ACTOR = 'local' as const;
export type Actor = string;

/** 論理時刻 (Lamport)。LWW の順序付けに使用 */
export type Lamport = number;

export const EVENT_CATEGORIES = [
  'structure',
  'content',
  'layout',
  'presentation',
] as const;
export type Category = (typeof EVENT_CATEGORIES)[number];

// --- Op: atomic 操作 ---

const NodePropertiesSchema = z.record(z.string(), z.unknown());

export const OpSchema = z.discriminatedUnion('kind', [
  // structure
  z.object({
    kind: z.literal('node.add'),
    target: NodeIdSchema,
    content: z.string(),
    properties: NodePropertiesSchema.optional(),
    nodeType: z.enum(['group', 'image']).optional(),
    parentId: NodeIdSchema.optional(),
  }),
  z.object({ kind: z.literal('node.remove'), target: NodeIdSchema }),
  z.object({
    kind: z.literal('node.setParent'),
    target: NodeIdSchema,
    parentId: NodeIdSchema.optional(),
  }),
  z.object({
    kind: z.literal('edge.add'),
    target: EdgeIdSchema,
    source: NodeIdSchema,
    dest: NodeIdSchema,
    label: z.string().optional(),
    properties: NodePropertiesSchema.optional(),
  }),
  z.object({ kind: z.literal('edge.remove'), target: EdgeIdSchema }),
  z.object({
    kind: z.literal('edge.reconnect'),
    target: EdgeIdSchema,
    source: NodeIdSchema,
    dest: NodeIdSchema,
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
  }),
  // content
  z.object({
    kind: z.literal('node.setContent'),
    target: NodeIdSchema,
    content: z.string(),
  }),
  z.object({
    kind: z.literal('node.setProperties'),
    target: NodeIdSchema,
    properties: NodePropertiesSchema,
  }),
  z.object({
    kind: z.literal('edge.setLabel'),
    target: EdgeIdSchema,
    label: z.string(),
  }),
  z.object({
    kind: z.literal('edge.setProperties'),
    target: EdgeIdSchema,
    properties: NodePropertiesSchema,
  }),
  // layout
  z.object({
    kind: z.literal('node.setLayout'),
    target: NodeIdSchema,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
  }),
  z.object({
    kind: z.literal('edge.setLayout'),
    target: EdgeIdSchema,
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    pathType: EdgePathTypeSchema.optional(),
  }),
  // presentation (ローカル限定)
  z.object({
    kind: z.literal('node.setStyle'),
    target: NodeIdSchema,
    style: StyleSchema,
  }),
  z.object({
    kind: z.literal('edge.setStyle'),
    target: EdgeIdSchema,
    style: StyleSchema,
  }),
  z.object({
    kind: z.literal('edge.setLabelOffset'),
    target: EdgeIdSchema,
    offsetX: z.number(),
    offsetY: z.number(),
  }),
]);
export type Op = z.infer<typeof OpSchema>;
export type OpKind = Op['kind'];

/** op の種別 → カテゴリ。同期対象の振り分け (structure/content/layout=同期, presentation=ローカル) に使う */
export const OP_CATEGORY: Record<OpKind, Category> = {
  'node.add': 'structure',
  'node.remove': 'structure',
  'node.setParent': 'structure',
  'edge.add': 'structure',
  'edge.remove': 'structure',
  'edge.reconnect': 'structure',
  'node.setContent': 'content',
  'node.setProperties': 'content',
  'edge.setLabel': 'content',
  'edge.setProperties': 'content',
  'node.setLayout': 'layout',
  'edge.setLayout': 'layout',
  'node.setStyle': 'presentation',
  'edge.setStyle': 'presentation',
  'edge.setLabelOffset': 'presentation',
};

export function opCategory(op: Op): Category {
  return OP_CATEGORY[op.kind];
}

/** presentation はローカル限定。structure/content/layout は同期対象 (D7) */
export function isSyncable(op: Op): boolean {
  return opCategory(op) !== 'presentation';
}

// --- Batch: undo/redo と同期の運搬単位 ---

export const BatchSchema = z.object({
  id: BatchIdSchema,
  actor: z.string(),
  clock: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(), // wall clock (表示・tiebreak 用)
  ops: z.array(OpSchema).min(1),
});
export type Batch = z.infer<typeof BatchSchema>;

// --- Lamport clock ---

/**
 * 論理時刻の発番器。
 * ローカル操作では tick()、リモート受信では observe(remoteClock) を呼び、
 * clock = max(local, remote) + 1 を維持する。
 */
export class LamportClock {
  private value: Lamport;

  constructor(initial: Lamport = 0) {
    this.value = initial;
  }

  /** 次のローカル論理時刻を発番する */
  tick(): Lamport {
    this.value += 1;
    return this.value;
  }

  /** リモートの論理時刻を観測し、自身を追随させる (max+1) */
  observe(remote: Lamport): Lamport {
    this.value = Math.max(this.value, remote) + 1;
    return this.value;
  }

  /**
   * 復元用: これまで割り当て済みの最大論理時刻を下限として取り込む。
   * `observe` と違い +1 しないので、次の `tick()` は `floor + 1` になる。
   * 再起動後に永続ログの max(clock) を渡して発番を再開するために使う。
   */
  seed(floor: Lamport): Lamport {
    this.value = Math.max(this.value, floor);
    return this.value;
  }

  current(): Lamport {
    return this.value;
  }
}
