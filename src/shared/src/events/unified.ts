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
  type NodeId,
  NodeIdSchema,
  SheetIdSchema,
  StyleSchema,
} from '../schemas';

// --- メタ ---

/** バッチ識別子 (べき等な適用・重複排除の単位) */
export const BatchIdSchema = z.string().uuid().brand<'BatchId'>();
export type BatchId = z.infer<typeof BatchIdSchema>;

/**
 * 操作の主体。`<did>#<deviceId>` の複合 (未ログインは `local#<deviceId>`)。
 * 組み立ては client の `sync/actor.ts` が行う (Phase 4d-2)。
 * Lamport の因果順序と重複排除の単位を端末まで一意に識別するための識別子。
 */
export type Actor = string;

/** 論理時刻 (Lamport)。LWW の順序付けに使用 */
export type Lamport = number;

export const EVENT_CATEGORIES = [
  'structure',
  'content',
  'layout',
  'presentation',
  'file',
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
  // file (シート/ファイル構造)。グラフ内容 op と別カテゴリで routing する
  z.object({
    kind: z.literal('sheet.create'),
    target: SheetIdSchema,
    name: z.string(),
    description: z.string().optional(),
  }),
  z.object({ kind: z.literal('sheet.remove'), target: SheetIdSchema }),
  z.object({
    kind: z.literal('sheet.setName'),
    target: SheetIdSchema,
    name: z.string(),
  }),
  z.object({
    kind: z.literal('sheet.setDescription'),
    target: SheetIdSchema,
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal('sheet.reorder'),
    order: z.array(SheetIdSchema),
  }),
  z.object({ kind: z.literal('file.setName'), name: z.string() }),
  z.object({
    kind: z.literal('file.setDescription'),
    description: z.string().optional(),
  }),
  /**
   * ファイルの削除 (ANA-127)。**target を取らない** — batch は既に fileId 単位に
   * 束ねられているので、自分が載っている op-log のファイルを指す。
   */
  z.object({ kind: z.literal('file.remove') }),
]);
export type Op = z.infer<typeof OpSchema>;
export type OpKind = Op['kind'];

/**
 * 座標・寸法を整数へ丸める (W3d5-7)。
 *
 * **ATProto のデータモデル (DAG-CBOR) には float 型が無い** — 小数を含む op を載せた batch は
 * PDS の putRecord が 400 (`Expected one of null, boolean, integer, ... got 740.5`) で弾く。
 * しかも outbox は先頭が詰まると以降が全部止まるので, **1 つの小数が同期を丸ごと殺す**。
 *
 * React Flow はドラッグ結果をサブピクセルの小数で返す。サブピクセル精度は表示上の意味を
 * 持たないので, 丸めによる情報の損失は無い。
 *
 * width/height は `number | string` (CSS 値) の union。文字列はそのまま通す。
 */
function roundLayoutValue<T extends number | string | undefined>(value: T): T {
  return (typeof value === 'number' ? Math.round(value) : value) as T;
}

/**
 * **`node.setLayout` op の唯一の生成口。**
 *
 * 整数化をここに集約し, 呼び出し側が個別に丸め忘れることを防ぐ。
 * **shared に置いてあるのは生成口が 2 つあったからである** — client の編集経路は
 * 丸めていたのに genesis (import / 新規作成) が素通しで, import した後に remote 同期が
 * 全部止まっていた (ANA-125 S4 の実機で発見)。**新しい生成口を作らずここを呼ぶこと。**
 */
export function nodeSetLayoutOp(
  target: NodeId,
  layout: {
    x?: number;
    y?: number;
    width?: number | string;
    height?: number | string;
  },
): Op {
  const { x, y, width, height } = layout;
  return {
    kind: 'node.setLayout',
    target,
    ...(x !== undefined && { x: roundLayoutValue(x) }),
    ...(y !== undefined && { y: roundLayoutValue(y) }),
    ...(width !== undefined && { width: roundLayoutValue(width) }),
    ...(height !== undefined && { height: roundLayoutValue(height) }),
  };
}

/** file カテゴリ (シート/ファイル構造) の op kind。content/structure の判別に使う */
export const FILE_OP_KINDS = [
  'sheet.create',
  'sheet.remove',
  'sheet.setName',
  'sheet.setDescription',
  'sheet.reorder',
  'file.setName',
  'file.setDescription',
  'file.remove',
] as const;
export type FileOpKind = (typeof FILE_OP_KINDS)[number];

/** シート/ファイル構造を畳み込む op (projectFile が処理) */
export type FileOp = Extract<Op, { kind: FileOpKind }>;
/** グラフ内容を畳み込む op (projectBatches / applyOp が処理) */
export type GraphOp = Exclude<Op, FileOp>;

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
  'sheet.create': 'file',
  'sheet.remove': 'file',
  'sheet.setName': 'file',
  'sheet.setDescription': 'file',
  'sheet.reorder': 'file',
  'file.setName': 'file',
  'file.setDescription': 'file',
  'file.remove': 'file',
};

export function opCategory(op: Op): Category {
  return OP_CATEGORY[op.kind];
}

/** presentation はローカル限定。structure/content/layout/file は同期対象 (D7) */
export function isSyncable(op: Op): boolean {
  return opCategory(op) !== 'presentation';
}

/** file カテゴリ (シート/ファイル構造) の op か。projection の routing に使う */
export function isFileOp(op: Op): op is FileOp {
  return opCategory(op) === 'file';
}

/** グラフ内容 (LWW + 対立検出の対象) の op */
export type ContentOp = Extract<Op, { kind: ContentOpKind }>;
type ContentOpKind =
  | 'node.setContent'
  | 'node.setProperties'
  | 'edge.setLabel'
  | 'edge.setProperties';

/**
 * content カテゴリの op か。merge の対立検出に使う。
 *
 * 判定は `OP_CATEGORY` 一本 (種別の二重定義を作らない) だが、**型の絞り込みには
 * `ContentOp` が要る** — content op は必ず `target` を持つのに対し `Op` 全体には
 * `sheet.reorder` のように持たないものが混ざるため。
 */
export function isContentOp(op: Op): op is ContentOp {
  return opCategory(op) === 'content';
}

// --- Batch: undo/redo と同期の運搬単位 ---

export const BatchSchema = z.object({
  id: BatchIdSchema,
  actor: z.string(),
  clock: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(), // wall clock (表示用。順序付けには使わない — 4d-3)
  // content batch のシート scope。1 ユーザー操作は単一シート内で完結する。
  // file 構造 batch (sheet.*/file.* のみ) は sheetId を持たない (§3.1)。
  sheetId: SheetIdSchema.optional(),
  ops: z.array(OpSchema).min(1),
});
export type Batch = z.infer<typeof BatchSchema>;

// --- genesis (snapshot → 初期 batch) の予約値 (§3.4) ---

/**
 * genesis batch の予約アクター。端末に依存しない固定値。
 * projection は actor を参照しない (`project.ts`) ため識別のみに使う。
 */
export const GENESIS_ACTOR = 'genesis' as const;

/**
 * genesis batch の clock 開始値。genesis は batch ごとに一意連番を割り当て、
 * `orderBatches` の tiebreak (Phase 4d-3 以降は actor → id) に頼らず順序を確定させる。
 * genesis は全 batch が `GENESIS_ACTOR` を共有するため、clock が一意でないと
 * 順序が id (ランダム UUID) で決まってしまう。
 * ユーザー操作は復元時に `seed(max(clock))` でこの後続から採番する。
 */
export const GENESIS_CLOCK_START = 1 as const;

/**
 * genesis batch の timestamp。決定論のため固定。
 * timestamp は表示用であり順序付けには使わない (Phase 4d-3 で tiebreak から外した)。
 */
export const GENESIS_TIMESTAMP = 0 as const;

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
