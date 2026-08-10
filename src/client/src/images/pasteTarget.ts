/**
 * 画像の貼り付け先を選ぶ規則 (ANA-117 S6)
 *
 * 「画像ノードが選択されているならそのノードへ, いなければ新規ノード」(設計 D6)。
 * 判断そのものを `GraphEditor` の外に出して, 規則としてテストできるようにする。
 */

import { RF_IMAGE_NODE_TYPE } from '../graphTransform';

/** 選択状態を判定するのに要る最小の形 (React Flow の `Node` はこれを満たす) */
export type SelectableNode = {
  id: string;
  type?: string;
  selected?: boolean;
};

/**
 * 貼り付けで差し替える画像ノードを選ぶ。**ちょうど 1 つ選択されているときだけ**返す。
 *
 * 複数選択で「そのうちの 1 つ」が差し替わると, どれが変わるか利用者に予測できない。
 * 0 個・複数のときは `undefined` を返し, 呼び出し側は新規ノードを作る。
 */
export function pickImagePasteTarget<T extends SelectableNode>(
  nodes: readonly T[],
): T | undefined {
  const selected = nodes.filter(
    (n) => n.selected && n.type === RF_IMAGE_NODE_TYPE,
  );
  return selected.length === 1 ? selected[0] : undefined;
}
