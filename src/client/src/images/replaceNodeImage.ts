/**
 * 既存の画像ノードの画像を差し替える手続き (ANA-117)
 *
 * 差し替えを起こす経路は 2 つある — ノードへの drop (`ImageNode`) と,
 * 画像ノードを選んだ状態での貼り付け (`GraphEditor`) — が, **やることは同じ**である:
 * 画像を保存し, 置き換え後の properties を載せた op を投げ, 失敗を伝える。
 *
 * この手続きが 2 箇所に散っていると, **op に何を載せるかの判断が片方だけ直る**。
 * 実際に S6 では `to` から旧形式キーを落とす配慮が `commitUrl` に及んでおらず,
 * 旧データのノードで base64 が op へ復活する穴が残った
 * (`deepse/reports/review_2026-08-11_ana116-image.md` R3)。**載せる形を決める場所は
 * 1 つ**にする。
 */

import type { NodeId } from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';
import { imagePropertiesChange, saveImageBlob } from './imageBlob';
import { imageErrorMessage } from './imageErrorContext';

export type ReplaceNodeImageDeps = {
  dispatch: (event: GraphEvent) => void;
  /** 失敗の伝え先。`ImageNode` は context 経由, `GraphEditor` は自身の state */
  reportError: (message: string) => void;
  save?: typeof saveImageBlob;
};

/**
 * 画像を保存し, ノードの properties を差し替える op を投げる。
 *
 * **投げない場合も含めて例外を外へ出さない。** 呼び出し元はどちらもイベント
 * ハンドラ (drop / paste) で, 投げても拾う相手がいない。失敗は `reportError` で
 * 利用者に見せる (設計 D7: 握り潰さない)。
 */
export async function replaceNodeImage(
  nodeId: NodeId,
  properties: Record<string, unknown> | undefined,
  source: Blob,
  deps: ReplaceNodeImageDeps,
): Promise<void> {
  const save = deps.save ?? saveImageBlob;
  try {
    const ref = await save(source);
    deps.dispatch({
      ...makeEventBase('content'),
      type: 'NODE_PROPERTIES_CHANGED',
      nodeId,
      ...imagePropertiesChange(properties, ref),
    });
  } catch (err) {
    deps.reportError(imageErrorMessage(err));
  }
}
