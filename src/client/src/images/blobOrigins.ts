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
 * blob をどの repo から引くか。
 *
 * - `repo`: その DID の repo
 * - `own`: 自分の repo (由来が分からない — 単一 actor 時代の File はすべてこれ)
 * - `awaiting`: **まだ決められない**。genesis にだけ載った画像で、File の名簿をまだ読んでいない。
 *   自分の repo に落ちると、参加者は必ず `Blob not found` を引く (#333 の実機で、名簿が届く前の
 *   最初の取得がそうなった)。名簿が届けば `repo` か `own` に変わるので、それまで取りに行かない
 */
export type BlobOrigin =
  | { kind: 'repo'; did: Did }
  | { kind: 'own' }
  | { kind: 'awaiting' };

export const OWN_REPO: BlobOrigin = { kind: 'own' };
const AWAITING_ROSTER: BlobOrigin = { kind: 'awaiting' };

/**
 * cid の由来を引く。
 *
 * `founder` は File の名簿の創設者で、**`undefined` は名簿をまだ読んでいない**、`null` は読んだが創設者が
 * いない (共有していない古い File など) を表す。
 *
 * - genesis に載った cid は**創設者を先に採る** — genesis はどの編集よりも先にあるので、「最初に載せた人」は
 *   これになる
 * - 創設者がいなければ、actor が載せた由来へ、それも無ければ自分の repo へ
 * - genesis にだけ載った cid で名簿をまだ読んでいなければ、**待つ**
 */
export function resolveBlobOrigin(
  origins: BlobOrigins,
  cid: BlobCid,
  founder: Did | null | undefined,
): BlobOrigin {
  const inGenesis = origins.genesis.has(cid);
  if (inGenesis && founder) return { kind: 'repo', did: founder };
  const authored = origins.authored.get(cid);
  if (authored !== undefined) return { kind: 'repo', did: authored };
  if (inGenesis && founder === undefined) return AWAITING_ROSTER;
  return OWN_REPO;
}
