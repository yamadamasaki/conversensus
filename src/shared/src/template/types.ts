import { z } from 'zod';
import { PropertyNameSchema } from '../events/unified';
import { TemplateIdSchema } from '../schemas';

export const NodeKindIdSchema = z.string().min(1).brand<'NodeKindId'>();
export type NodeKindId = z.infer<typeof NodeKindIdSchema>;

export const EdgeKindIdSchema = z.string().min(1).brand<'EdgeKindId'>();
export type EdgeKindId = z.infer<typeof EdgeKindIdSchema>;

/**
 * node の種別。**同一性は `id` であって `label` ではない。**
 *
 * op に載るのは `label` (人が読む文字列) だが、接続規則を label で書くと
 * 表示名を変えた瞬間に規則が外れる。**op の値は label、template 内部の参照は id** に分ける。
 */
export const NodeKindSchema = z.object({
  id: NodeKindIdSchema,
  /** ノードに書かれる種別名。`node.setLabel` の値になる */
  label: z.string().min(1),
  description: z.string().optional(),
});
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** edge の種別。接続可能な端点の種別を `from` / `to` に id で持つ */
export const EdgeKindSchema = z.object({
  id: EdgeKindIdSchema,
  /** エッジに書かれる種別名。`edge.setLabel` の値になる */
  label: z.string().min(1),
  from: z.array(NodeKindIdSchema).min(1),
  to: z.array(NodeKindIdSchema).min(1),
  /**
   * この種別のエッジが持ちうるプロパティ名。**step2 では宣言だけ**である。
   * これを食う property editor は Phase 4 が作る (設計 事実 D)。
   */
  properties: z.array(PropertyNameSchema).default([]),
});
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

/** 重複した id を返す (無ければ空) */
function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

export const TemplateSchema = z
  .object({
    id: TemplateIdSchema,
    name: z.string().min(1),
    nodeKinds: z.array(NodeKindSchema),
    edgeKinds: z.array(EdgeKindSchema),
  })
  /**
   * **参照整合性を schema で見る。**`EdgeKind.from` / `to` は `NodeKind.id` を指すが、
   * 型は「文字列の配列」としか言えない。作り込みの template は import 時にここを通るので、
   * 綴り違いはアプリの起動時点で落ちる。template がユーザ定義になる step3 では、
   * この検査がそのまま入力の検証になる。
   */
  .superRefine((t, ctx) => {
    // **逆順ドメインを要求するのは定義側だけである。**プロパティ名を id から導く
    // (`kindPropertyOf`) ので、`.` を含まないと導いた名前が custom (編集者のもの) に
    // 見えてしまう。op-log 側で強制しないのは、既に書かれた値を壊せないためである
    if (!t.id.includes('.')) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message:
          'template の id は逆順ドメインでなければならない (プロパティの名前空間を兼ねるため)',
      });
    }

    for (const [path, ids] of [
      ['nodeKinds', t.nodeKinds.map((k) => k.id)],
      ['edgeKinds', t.edgeKinds.map((k) => k.id)],
    ] as const) {
      for (const id of duplicates(ids)) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: `種別の id が重複している: ${id}`,
        });
      }
    }

    const known = new Set<string>(t.nodeKinds.map((k) => k.id));
    for (const [i, ek] of t.edgeKinds.entries()) {
      for (const side of ['from', 'to'] as const) {
        for (const [j, ref] of ek[side].entries()) {
          if (!known.has(ref)) {
            ctx.addIssue({
              code: 'custom',
              path: ['edgeKinds', i, side, j],
              message: `未定義の node 種別を参照している: ${ref}`,
            });
          }
        }
      }
    }
  });
export type Template = z.infer<typeof TemplateSchema>;
