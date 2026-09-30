/**
 * batch レコードの rkey スキーム (step3 Phase 1 S1-3 / 設計 D9。v1 は step1 Phase 7 p7-1)
 *
 * PDS の collection は **repo 全体で 1 つ**なので、rkey の構造だけが「ファイル単位に
 * 範囲取得する」手掛かりになる。
 *
 *     <fileId>~<actor の # を : にしたもの>~<seq を 12 桁ゼロ詰め>
 *
 * - **fileId が先頭**: 同じファイルの rkey が辞書順で連続する = prefix 範囲取得できる。
 *   fileId は UUID 固定長なので、ある fileId が別の fileId の prefix になることはない
 * - **点 `(actor, seq)` で一意**: batch の点は因果の範囲 (trunk の File) の中で一意なので、
 *   batchId を rkey に入れなくてよい。id はレコードの本文に持つ
 * - **actor ごとに連続する**: 同じ actor の batch は seq 順に並ぶ。**actor ごとの cursor**
 *   (設計の非目標、後の Phase) を持つときに、形式を変えずに範囲取得できる
 * - **決定論的**: 同じ batch は必ず同じ rkey になる。`putRecord` のべき等性 (outbox の再送) が
 *   これに依存している
 * - **actor の `#` を `:` にする**: rkey に `#` は使えない。deviceId (UUID) は `:` を含まないので、
 *   最後の `:` で元に戻せる (単射)。`local#dev` と `did#dev` のように同じ端末の別 actor も
 *   別の rkey になる
 *
 * **v1 (`v1~<fileId>~<clock>~<batchId>`) との互換は持たない** (設計 §0)。v1 のレコードは
 * 別の collection (`app.conversensus.graph.batch`) に残り、v2 の読み手からは見えない。
 */

import type { Actor, FileId, Seq } from '@conversensus/shared';

/** rkey のセグメント区切り */
const SEPARATOR = '~';

/** actor の `#` の代わりに置く文字 (rkey に `#` は使えない) */
const ACTOR_HASH_REPLACEMENT = ':';
const ACTOR_HASH = '#';

/** seq のゼロ詰め桁数。辞書順 = 数値順にするために固定幅にする */
const SEQ_DIGITS = 12;
const MAX_SEQ = 10 ** SEQ_DIGITS - 1;

/** `<fileId>~<actor>~<seq>` のセグメント数 */
const SEGMENT_COUNT = 3;

export type ParsedBatchRkey = { fileId: FileId; actor: Actor; seq: Seq };

function encodeActor(actor: Actor): string {
  return actor.replace(ACTOR_HASH, ACTOR_HASH_REPLACEMENT);
}

/** `encodeActor` の逆。**最後の** `:` を `#` に戻す (DID 自体が `:` を含むため) */
function decodeActor(encoded: string): Actor {
  const at = encoded.lastIndexOf(ACTOR_HASH_REPLACEMENT);
  // `genesis` のように区切りを持たない actor はそのまま。actor は常に
  // `<did>#<deviceId>` か `genesis` なので、`:` を含むなら必ず `#` を持っていた
  if (at < 0) return encoded;
  return `${encoded.slice(0, at)}${ACTOR_HASH}${encoded.slice(at + 1)}`;
}

/**
 * batch レコードの rkey を組み立てる。
 *
 * seq が 12 桁を超える場合は throw する — 静かに桁あふれさせると、その batch だけ
 * actor 内の順序が狂う上に、同じ batch を再 push したときに別の rkey になる。
 */
export function batchRkey(fileId: FileId, actor: Actor, seq: Seq): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    throw new Error(
      `batchRkey: seq が ${SEQ_DIGITS} 桁の非負整数に収まらない (${seq})`,
    );
  }
  const paddedSeq = String(seq).padStart(SEQ_DIGITS, '0');
  return `${fileId}${SEPARATOR}${encodeActor(actor)}${SEPARATOR}${paddedSeq}`;
}

/** このファイルの rkey が共有する prefix。範囲取得の**停止条件**に使う */
export function batchRkeyPrefix(fileId: FileId): string {
  return fileId + SEPARATOR;
}

/**
 * このファイルの rkey の**すぐ手前**。昇順 (`reverse: true`, `rkey > cursor`) ならそのファイルの
 * 先頭へ飛び、降順 (`rkey < cursor`) ならそのファイルを丸ごと飛び越す
 */
export function batchRkeyFileCursor(fileId: FileId): string {
  return fileId;
}

/** AT-URI (`at://<did>/<collection>/<rkey>`) の末尾から rkey を取り出す */
export function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

/** rkey を割る。形式を満たさなければ null (他種・壊れたレコード) */
export function parseBatchRkey(rkey: string): ParsedBatchRkey | null {
  const segments = rkey.split(SEPARATOR);
  if (segments.length !== SEGMENT_COUNT) return null;
  const [fileId, encodedActor, seqText] = segments as [string, string, string];
  if (fileId === '' || encodedActor === '') return null;
  // 固定幅の数字列だけを受ける。`padStart` の出力と厳密に対応させる
  if (seqText.length !== SEQ_DIGITS || !/^\d+$/.test(seqText)) return null;
  return {
    fileId: fileId as FileId,
    actor: decodeActor(encodedActor),
    seq: Number(seqText),
  };
}
