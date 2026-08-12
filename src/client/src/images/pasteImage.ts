/**
 * 貼り付けた画像の振り分け (ANA-117 S6)
 *
 * 「選択中の画像ノードへ差し替え」か「新規ノード」かを決めるところである。
 * 規則は `pasteTarget.ts`, 差し替えの手続きは `replaceNodeImage.ts` にあり,
 * **両端は既にテストできる**が, その 2 つを繋ぐ分岐だけが `GraphEditor` の中に
 * 残っていた (`deepse/reports/review_2026-08-11_ana116-image.md` T2)。
 *
 * 分岐は仕様である — どちらに倒れるかで利用者の画像が消えるか増えるかが変わる —
 * 一方で `GraphEditor` を描画しないと確かめられない場所に置く理由は無い。
 * 位置決めとクリップボード API の吸収は配線として `GraphEditor` に残す。
 */

import type { NodeId } from '@conversensus/shared';
import type { SelectableNode } from './pasteTarget';

/** 差し替え先として要る最小の形 (React Flow の `Node` はこれを満たす) */
export type ImagePasteTarget = SelectableNode & {
  data?: { properties?: Record<string, unknown> };
};

export type PasteImageDeps = {
  /** 貼り付け先の画像ノード。無ければ `undefined` (規則は `pickImagePasteTarget`) */
  pickTarget: () => ImagePasteTarget | undefined;
  /** 新規ノードとして置く。**位置決めは呼び出し側が持つ** */
  addImageNode: (source: Blob) => Promise<void>;
  /** 既存ノードの画像を差し替える (手続きは `replaceNodeImage`) */
  replaceImage: (
    nodeId: NodeId,
    properties: Record<string, unknown> | undefined,
    source: Blob,
  ) => Promise<void>;
};

/**
 * 貼り付けた画像を差し替えか新規作成へ振り分ける。
 *
 * **行き先は貼り付けた時点の選択で決める。** `pickTarget` をここで呼ぶのは,
 * 貼り付けまでの間に選択が変わりうるためである (`clipboard.read()` の await を
 * 挟む経路がある)。
 */
export async function pasteImage(
  source: Blob,
  deps: PasteImageDeps,
): Promise<void> {
  const target = deps.pickTarget();
  if (!target) {
    await deps.addImageNode(source);
    return;
  }
  // React Flow の node id は素の string。ドメインの境界でキャストする (規約 2)
  await deps.replaceImage(target.id as NodeId, target.data?.properties, source);
}
