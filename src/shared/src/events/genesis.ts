/**
 * genesis: snapshot (GraphFile) → 初期 Batch 列 (§3.4)
 *
 * 既存ファイルは snapshot が正典。読み取り経路を op-log へ移行する際、
 * snapshot を初期 batch 群へ変換して op-log を bootstrap する。
 *
 * 方針 (critic H1-new / C1-new):
 *   - **local-only**: genesis はローカルだけが実行する。remote へは通常 push で送るため、
 *     跨端末で同一 batch を独立生成する完全決定論 (content-hash) には依存しない。
 *   - **同一端末べき等**: batch id を ops から決定論的に導き、再 genesis しても
 *     `appendBatch` の (file_id, batch_id) 重複排除でクリーンに吸収される。
 *   - **canonicalization**: nodes/edges/properties のシリアライズ順は不定なので、
 *     ソートして安定化する (§3.4)。これが `graphFileToBatches` の第一責務。
 *   - **presentation 保全 (H1)**: edge style / label offset も ops に含める。
 *     genesis しないと W3e の snapshot 退役で既存スタイルが永久消失する。
 */

import type {
  EdgeLayout,
  GraphFile,
  NodeLayout,
  Sheet,
  SheetId,
} from '../schemas';
import {
  type Batch,
  BatchIdSchema,
  GENESIS_ACTOR,
  GENESIS_CLOCK_START,
  GENESIS_TIMESTAMP,
  type Op,
} from './unified';

/** オブジェクトキーを再帰的にソートした安定文字列。batch id の決定論化に使う */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * 文字列から決定論的な UUID (v4 形式) を導出する。
 * local-only genesis の同一端末べき等性のためのもので、暗号学的ハッシュではない。
 * hash 入力は ops の内容 (branded UUID を含む) のみ。actor/timestamp は含めない (§3.4)。
 */
function deterministicUuid(input: string): string {
  // FNV-1a を種にして 16 バイトを撹拌生成する
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    h ^= i + 1;
    h = Math.imul(h, 0x01000193);
    bytes[i] = (h >>> ((i % 4) * 8)) & 0xff;
  }
  // Zod の .uuid() を満たすよう version=4 / variant=8 を強制する
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}

/** ops から決定論 id を導いて genesis batch を組み立てる */
function makeGenesisBatch(ops: Op[], clock: number, sheetId?: SheetId): Batch {
  return {
    id: BatchIdSchema.parse(deterministicUuid(stableStringify(ops))),
    actor: GENESIS_ACTOR,
    clock,
    timestamp: GENESIS_TIMESTAMP,
    ...(sheetId !== undefined && { sheetId }),
    ops,
  };
}

/** NodeLayout → node.setLayout op (座標・サイズが 1 つでもあれば発行) */
function nodeLayoutToOp(layout: NodeLayout): Op | null {
  const { nodeId, x, y, width, height } = layout;
  if (
    x === undefined &&
    y === undefined &&
    width === undefined &&
    height === undefined
  )
    return null;
  return {
    kind: 'node.setLayout',
    target: nodeId,
    ...(x !== undefined && { x }),
    ...(y !== undefined && { y }),
    ...(width !== undefined && { width }),
    ...(height !== undefined && { height }),
  };
}

/** EdgeLayout → edge.setLayout op (経路情報が 1 つでもあれば発行) */
function edgeLayoutToOp(layout: EdgeLayout): Op | null {
  const { edgeId, sourceHandle, targetHandle, pathType } = layout;
  if (
    sourceHandle === undefined &&
    targetHandle === undefined &&
    pathType === undefined
  )
    return null;
  return {
    kind: 'edge.setLayout',
    target: edgeId,
    ...(sourceHandle !== undefined && { sourceHandle }),
    ...(targetHandle !== undefined && { targetHandle }),
    ...(pathType !== undefined && { pathType }),
  };
}

/**
 * 1 シートの content op 列を canonical 順で生成する。
 * ノード/エッジは id 昇順、layout も対応 id 昇順に並べて決定論を担保する。
 */
function sheetContentOps(sheet: Sheet): Op[] {
  const ops: Op[] = [];
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);

  // nodes (structure/content)
  for (const n of [...sheet.nodes].sort(byId)) {
    ops.push({
      kind: 'node.add',
      target: n.id,
      content: n.content,
      ...(n.properties && { properties: n.properties }),
      ...(n.nodeType && { nodeType: n.nodeType }),
      ...(n.parentId !== undefined && { parentId: n.parentId }),
    });
  }

  // node layouts
  const nodeLayouts = [...(sheet.layouts ?? [])].sort((a, b) =>
    (a.nodeId as string).localeCompare(b.nodeId as string),
  );
  for (const l of nodeLayouts) {
    const op = nodeLayoutToOp(l);
    if (op) ops.push(op);
  }

  // edges (structure/content)
  for (const e of [...sheet.edges].sort(byId)) {
    ops.push({
      kind: 'edge.add',
      target: e.id,
      source: e.source,
      dest: e.target,
      ...(e.label !== undefined && { label: e.label }),
      ...(e.properties && { properties: e.properties }),
    });
  }

  // edge layouts + presentation (style / label offset, H1 保全)
  const edgeLayouts = [...(sheet.edgeLayouts ?? [])].sort((a, b) =>
    (a.edgeId as string).localeCompare(b.edgeId as string),
  );
  for (const el of edgeLayouts) {
    const layoutOp = edgeLayoutToOp(el);
    if (layoutOp) ops.push(layoutOp);
    if (el.labelOffsetX !== undefined || el.labelOffsetY !== undefined) {
      ops.push({
        kind: 'edge.setLabelOffset',
        target: el.edgeId,
        offsetX: el.labelOffsetX ?? 0,
        offsetY: el.labelOffsetY ?? 0,
      });
    }
    if (el.style !== undefined) {
      ops.push({ kind: 'edge.setStyle', target: el.edgeId, style: el.style });
    }
  }

  return ops;
}

/**
 * snapshot (GraphFile) を genesis batch 列へ変換する。
 * batch は一意連番 clock を持ち、file メタ → 各シート (create + content) の順に並ぶ。
 * 空 ops の batch は生成しない (`appendBatch` が空 ops を拒否する, critic L-3)。
 */
export function graphFileToBatches(file: GraphFile): Batch[] {
  const batches: Batch[] = [];
  let clock: number = GENESIS_CLOCK_START;

  const push = (ops: Op[], sheetId?: SheetId): void => {
    if (ops.length === 0) return; // 空 ops batch は作らない
    batches.push(makeGenesisBatch(ops, clock, sheetId));
    clock += 1;
  };

  // 1. ファイルメタ
  const fileMeta: Op[] = [{ kind: 'file.setName', name: file.name }];
  if (file.description !== undefined) {
    fileMeta.push({
      kind: 'file.setDescription',
      description: file.description,
    });
  }
  push(fileMeta);

  // 2. 各シート: create (file cat) + content (graph cat, sheetId 付与)
  //    file 順のまま作成することで reconcileOrder が createClock 昇順で同じ順を再現する
  for (const sheet of file.sheets) {
    push([
      {
        kind: 'sheet.create',
        target: sheet.id,
        name: sheet.name,
        ...(sheet.description !== undefined && {
          description: sheet.description,
        }),
      },
    ]);
    push(sheetContentOps(sheet), sheet.id);
  }

  return batches;
}
