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
import {
  didFromActor,
  GENESIS_ACTOR,
  orderBatches,
} from '@conversensus/shared';
import { collectImageBlobRefs } from './imageBlob';

/** DID でない actor (genesis / 未ログインの `local`) は、それだけでは由来にならない */
function asDid(actor: string): Did | undefined {
  const did = didFromActor(actor);
  return did.startsWith('did:') ? (did as Did) : undefined;
}

/**
 * op-log から導いた画像 blob の由来。
 *
 * **genesis に載った画像は別に持つ** (#333)。genesis の batch の actor (`GENESIS_ACTOR`) は
 * DID ではないが、その batch を PDS に書くのは File の**創設者**である — 受信も genesis を
 * 創設者の repo からだけ採る (`receiveParticipantBatches`)。ところが創設者は名簿
 * (`participation.founder`) にあって op-log には無く、名簿は op-log を読んだ後から届く。
 * そこで cid だけを控えておき、創設者が分かった時点で `resolveBlobOrigin` が引く。
 * import した File の画像はすべて genesis に載るので、これが無いと参加者は自分の repo に
 * 取りに行き `Blob not found` になっていた
 */
export type BlobOrigins = {
  /** 画像を載せた batch の actor が DID のもの: `cid → DID` */
  readonly authored: ReadonlyMap<BlobCid, Did>;
  /** genesis の batch に載った cid (創設者の repo にある) */
  readonly genesis: ReadonlySet<BlobCid>;
};

export const NO_BLOB_ORIGINS: BlobOrigins = {
  authored: new Map(),
  genesis: new Set(),
};

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
export function collectBlobOrigins(batches: readonly Batch[]): BlobOrigins {
  const authored = new Map<BlobCid, Did>();
  const genesis = new Set<BlobCid>();
  for (const batch of orderBatches([...batches])) {
    if (batch.actor === GENESIS_ACTOR) {
      for (const ref of collectImageBlobRefs(batch.ops))
        genesis.add(ref.ref.$link);
      continue;
    }
    const did = asDid(batch.actor);
    if (!did) continue;
    for (const ref of collectImageBlobRefs(batch.ops)) {
      if (!authored.has(ref.ref.$link)) authored.set(ref.ref.$link, did);
    }
  }
  return { authored, genesis };
}

/**
 * cid の由来の DID を引く。genesis に載った cid は**創設者を先に採る** — genesis は
 * どの編集よりも先にあるので、「最初に載せた人」はこれになる。創設者がまだ分からない
 * (名簿を読んでいない・共有していない) ときは、actor が載せた由来へ、それも無ければ
 * `undefined` (呼び出し側が自分の repo に落ちる) へ進む
 */
export function resolveBlobOrigin(
  origins: BlobOrigins,
  cid: BlobCid,
  founder: Did | undefined,
): Did | undefined {
  if (founder !== undefined && origins.genesis.has(cid)) return founder;
  return origins.authored.get(cid);
}
