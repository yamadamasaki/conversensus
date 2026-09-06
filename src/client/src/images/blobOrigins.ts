/**
 * 画像 blob の由来 (どの repo に上がっているか) を op-log から導く (step2 Phase 2 S5)
 *
 * 設計: `deepse/plans/step2-phase2-sync.md` §5 (案 (a) 「由来を projection が運ぶ」)
 *
 * **`ImageNode` が持つのは `cid` と `mimeType` だけである。**blob は op-log の外にあり、
 * 参照するには **repo を名指しする**必要があるが、どの repo かはノードに書かれていない。
 * 単一 actor では自分の repo で足りていたが、多アクタでは足りない。
 *
 * 答えは op-log にある — **その画像を載せた batch の `actor`** がそれである。
 *
 * ## 鍵は cid であってノードではない
 *
 * 設計は「画像ノードに残す」と書いたが、**`cid → DID` の対応で持つ**。
 * blob は content-addressed なので「その cid がどの repo にあるか」は cid の性質であり、
 * ノードの性質ではない。同じ画像を 2 つのノードが指していれば答えは 1 つで足りる。
 * ノードに持たせると `GraphNode` (= `GraphFile`) に載ることになり、**export/import で
 * 別 File に古い DID が付いて回る** — 由来は op-log から導かれるものであって、
 * 書かれた内容ではない。
 *
 * ## 画像に限る
 *
 * 「誰が書いたか」を全 op に持たせ始めると projection の出力が膨らみ、Phase 3 の
 * 競合表示が「由来はどこまで正確か」に引きずられる。**blob が op-log の外にあり、
 * 参照するのに repo を名指しする必要がある唯一のもの**だから画像だけが対象である。
 */

import type { Batch, BlobCid, Did } from '@conversensus/shared';
import { didFromActor, orderBatches } from '@conversensus/shared';
import { collectImageBlobRefs } from './imageBlob';

/** DID でない actor (genesis / 未ログインの `local`) は由来にならない */
function asDid(actor: string): Did | undefined {
  const did = didFromActor(actor);
  return did.startsWith('did:') ? (did as Did) : undefined;
}

/**
 * op-log から `cid → 載せた人の DID` を導く。
 *
 * **最初に載せた人を採る。**同じ cid を 2 人が上げていればどちらの repo からでも引ける
 * ので結果は変わらないが、**決定論**であることは要る (誰の手元でも同じ URL を叩く)。
 * `orderBatches` で並べてから先頭を採ることでそれを担保する。
 *
 * 由来が分からない cid は**入らない**。呼び出し側は自分の repo に落ちる
 * (`resolveImageUrl`) — 単一 actor 時代の File はすべてこれである。
 */
export function collectBlobOrigins(
  batches: readonly Batch[],
): Map<BlobCid, Did> {
  const origins = new Map<BlobCid, Did>();
  for (const batch of orderBatches([...batches])) {
    const did = asDid(batch.actor);
    if (!did) continue;
    for (const ref of collectImageBlobRefs(batch.ops)) {
      if (!origins.has(ref.ref.$link)) origins.set(ref.ref.$link, did);
    }
  }
  return origins;
}
