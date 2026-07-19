/**
 * W3d-3 レイテンシ実測 (投棄可ベンチ, step1-w3d-read-cutover.md §3.5)
 *
 * op-log 読取 cutover の受け入れゲート。`projectFile(batches)` の実行時間を
 * 合成 batch (genesis + 増分編集) の規模 N = 100/500/1,000/5,000 で計測する。
 * マルチシート (5 シート) 構成も含める。
 *
 * 予算 (§3.5): 典型ファイル (数百 batch) で projectFile < 50ms。
 * 超過したら §3.6 の projection cache を W3d 内で導入する判断材料にする。
 *
 * 実行: `bun run src/shared/src/events/projectFile.bench.ts`
 * (プロダクトコードではない。CI にも載せない。数値を PR に貼るための使い捨て。)
 */

import type { EdgeId, FileId, GraphFile, NodeId, SheetId } from '../schemas';
import { graphFileToBatches } from './genesis';
import { projectFile } from './project';
import type { Batch, Op } from './unified';

const uuid = (): string => crypto.randomUUID();

/** N 個の node と概ね N 本の edge を持つシートを sheetCount 枚組み立てる */
function buildGraphFile(
  nodesPerSheet: number,
  sheetCount: number,
): { file: GraphFile; sheetNodeIds: NodeId[][]; sheetIds: SheetId[] } {
  const sheetNodeIds: NodeId[][] = [];
  const sheetIds: SheetId[] = [];
  const sheets = [];
  for (let s = 0; s < sheetCount; s++) {
    const sheetId = uuid() as SheetId;
    sheetIds.push(sheetId);
    const nodeIds: NodeId[] = [];
    const nodes = [];
    const layouts = [];
    for (let i = 0; i < nodesPerSheet; i++) {
      const id = uuid() as NodeId;
      nodeIds.push(id);
      nodes.push({ id, content: `node ${i}` });
      layouts.push({ nodeId: id, x: i * 10, y: i * 5, width: 120, height: 40 });
    }
    // 隣接ノードを繋ぐ edge を N-1 本
    const edges = [];
    for (let i = 0; i + 1 < nodesPerSheet; i++) {
      edges.push({
        id: uuid() as EdgeId,
        source: nodeIds[i],
        target: nodeIds[i + 1],
        label: `e${i}`,
      });
    }
    sheetNodeIds.push(nodeIds);
    sheets.push({
      id: sheetId,
      name: `Sheet ${s + 1}`,
      nodes,
      edges,
      layouts,
      edgeLayouts: [],
    });
  }
  return {
    file: { id: uuid() as FileId, name: 'bench file', sheets },
    sheetNodeIds,
    sheetIds,
  };
}

/**
 * genesis batch に、実運用相当の増分編集 batch (1 op/batch) を追記して
 * 合計 batch 数を targetTotal にする。編集はノード移動/内容変更を巡回で当てる。
 */
function synthBatches(
  targetTotal: number,
  nodesPerSheet: number,
  sheetCount: number,
): { batches: Batch[]; fileId: FileId } {
  const { file, sheetNodeIds, sheetIds } = buildGraphFile(
    nodesPerSheet,
    sheetCount,
  );
  const genesis = graphFileToBatches(file);
  const batches: Batch[] = [...genesis];
  let clock = genesis.reduce((m, b) => Math.max(m, b.clock), 0) + 1;

  // 残りを 1 op の増分編集 batch で埋める (既存ノードを巡回で編集)
  let n = 0;
  while (batches.length < targetTotal) {
    const s = n % sheetCount;
    const nodeIds = sheetNodeIds[s];
    const nodeId = nodeIds[n % nodeIds.length];
    const op: Op =
      n % 2 === 0
        ? {
            kind: 'node.setLayout',
            target: nodeId,
            x: n % 500,
            y: (n * 3) % 500,
          }
        : { kind: 'node.setContent', target: nodeId, content: `edit ${n}` };
    batches.push({
      id: uuid(),
      actor: 'bench-actor',
      clock: clock++,
      timestamp: Date.now(),
      sheetId: sheetIds[s],
      ops: [op],
    } as Batch);
    n++;
  }
  return { batches, fileId: file.id };
}

/** median を返す (外れ値に強い代表値) */
function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function bench(
  label: string,
  batches: Batch[],
  fileId: FileId,
  iterations: number,
): void {
  // ウォームアップ (JIT)
  for (let i = 0; i < 5; i++) projectFile(batches, fileId);
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    projectFile(batches, fileId);
    samples.push(performance.now() - t0);
  }
  const med = median(samples);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const verdict = med < 50 ? 'OK' : 'OVER';
  console.log(
    `${label.padEnd(34)} median=${med.toFixed(2)}ms  min=${min.toFixed(2)}ms  max=${max.toFixed(2)}ms  [<50ms: ${verdict}]`,
  );
}

const Ns = [100, 500, 1_000, 5_000];
const ITER = 50;

console.log('=== W3d-3 projectFile latency (single sheet, 200 nodes base) ===');
for (const N of Ns) {
  const { batches, fileId } = synthBatches(N, 200, 1);
  bench(`N=${N} batches, 1 sheet`, batches, fileId, ITER);
}

console.log(
  '\n=== W3d-3 projectFile latency (5 sheets, 100 nodes/sheet base) ===',
);
for (const N of Ns) {
  const { batches, fileId } = synthBatches(N, 100, 5);
  bench(`N=${N} batches, 5 sheets`, batches, fileId, ITER);
}

console.log(
  `\n(iterations=${ITER}/case, warmup=5, median reported. 予算 §3.5: projectFile < 50ms)`,
);
