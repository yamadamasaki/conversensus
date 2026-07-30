/**
 * batch レコードの rkey スキーム (step1 Phase 7 p7-1)
 *
 * PDS の batch コレクションは **repo 全体で 1 つ**なので、rkey の構造だけが
 * 「ファイル単位に範囲取得する」手掛かりになる。設計 `step1-phase7-range-fetch.md` §3.1。
 *
 *     v1~<fileId>~<clock を 12 桁ゼロ詰め>~<batchId>
 *
 * この形にする理由 (どれか 1 つでも崩すと範囲取得が成立しない):
 *
 * - **`v1~` 前置**: 旧 rkey (= batchId 単体の小文字 hex UUID, Phase 4c〜6) は PDS 上に
 *   放置する決定なので、走査がそれらを踏まないよう rkey 空間ごと分離する。`v` (0x76) は
 *   hex の先頭文字 `0-9a-f` より大きいので、**旧レコードはすべて `v1~…` より小さい**。
 *   形式バージョンでもあり、次に rkey を変えるときも `v2~` で同じ論法が使える。
 * - **fileId が先頭**: 同じファイルの rkey が辞書順で連続する = prefix 範囲取得できる。
 *   fileId は UUID 固定長なので、ある fileId が別の fileId の prefix になることはない。
 * - **決定論的** (時刻を混ぜない): 同じ batch は必ず同じ rkey になる。`putRecord` が
 *   PDS レベルでべき等なまま保たれ、outbox の再送と移行の再 push がそれに依存している。
 *   ATProto 標準の TID は生成時刻依存でこれを満たさない (かつ端末間のクロックずれで
 *   順序が壊れ、Phase 4d-4 が捨てた clock cursor と同型のバグになる)。
 * - **clock を挟む**: ファイル内をおおむね書込順に並べる。ただし**順序の正しさは
 *   rkey に依存していない** — 受信側は `(clock, actor, id)` で正規化ソートする
 *   (`atprotoSyncProvider.pullRemote` / 正典の `orderBatches` と同一規則)。
 * - **batchId が末尾**: `batch.id` をここから復元する。レコードボディに `id` を持たないので
 *   lexicon (`batch.json` は `"key": "any"`) の変更が要らない。
 *
 * rkey の長さは 3+36+1+12+1+36 = 89 文字で、ATProto の上限 512 に収まる。区切りの `~` は
 * rkey の許容文字 (英数と `.-_:~`)。実 PDS で受理されることは p7-0 で実測済 (設計 §5.1)。
 */

import type { BatchId, FileId, Lamport } from '@conversensus/shared';

/** rkey 形式のバージョン前置。旧 rkey (hex UUID) と rkey 空間を分ける役目も持つ */
export const RKEY_VERSION_PREFIX = 'v1~';

/** rkey のセグメント区切り。UUID に現れない文字であること (英数・ハイフン以外) */
const SEPARATOR = '~';

/** clock のゼロ詰め桁数。辞書順 = 数値順にするために固定幅にする */
const CLOCK_DIGITS = 12;

/** `v1~<fileId>~<clock12>~<batchId>` のセグメント数 */
const SEGMENT_COUNT = 4;

/** clock が 12 桁に収まる上限 (超えると辞書順と数値順が食い違う) */
const MAX_CLOCK = 10 ** CLOCK_DIGITS - 1;

export type ParsedBatchRkey = {
  fileId: FileId;
  clock: Lamport;
  batchId: BatchId;
};

/**
 * batch レコードの rkey を組み立てる。
 *
 * clock が 12 桁を超える場合は throw する — 静かに桁あふれさせると、その batch だけ
 * ファイル内の順序が狂う (辞書順と数値順が食い違う) 上に、同じ batch を再 push した
 * ときに別の rkey になってべき等性まで壊れる。実際には Lamport clock が 10^12 に
 * 達する前に別の限界が来るので、これは「起きないことの明示」に近い。
 */
export function batchRkey(
  fileId: FileId,
  clock: Lamport,
  batchId: BatchId,
): string {
  if (!Number.isInteger(clock) || clock < 0 || clock > MAX_CLOCK) {
    throw new Error(
      `batchRkey: clock が ${CLOCK_DIGITS} 桁の非負整数に収まらない (${clock})`,
    );
  }
  const paddedClock = String(clock).padStart(CLOCK_DIGITS, '0');
  return `${RKEY_VERSION_PREFIX}${fileId}${SEPARATOR}${paddedClock}${SEPARATOR}${batchId}`;
}

/**
 * このファイルの rkey が共有する prefix。範囲取得の**停止条件**に使う。
 * (`listByFile` は「prefix を外れた 1 件」を見た時点で走査を終える)
 */
export function batchRkeyPrefix(fileId: FileId): string {
  return RKEY_VERSION_PREFIX + fileId + SEPARATOR;
}

/**
 * このファイルの手前を指す合成 cursor。
 *
 * `listRecords` の cursor は rkey そのもので、`reverse: true` では `rkey > cursor` に
 * なる (p7-0 で実測)。`v1~<fileId>` は `v1~<fileId>~…` のどれよりも小さく、かつ
 * 1 つ小さい fileId のどのレコードよりも大きいので、**そのファイルの先頭に着地する**。
 * 降順 (`reverse` 省略) では逆に `rkey < cursor` なので、同じ値が
 * **そのファイルを丸ごと飛ばす** cursor になる (ファイル列挙で使う)。
 */
export function batchRkeyFileCursor(fileId: FileId): string {
  return RKEY_VERSION_PREFIX + fileId;
}

/**
 * AT-URI (`at://<did>/<collection>/<rkey>`) の末尾から rkey を取り出す。
 *
 * `listRecords` の応答は rkey を独立したフィールドで返さないので、rkey を見る側は
 * 必ずここを通る (取得の範囲判定 = `collections.listRecordsByRkeyPrefix` と、
 * `batch.id` の復元 = `pullRemote` の両方)。
 */
export function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

/**
 * rkey から `batch.id` を復元する。復元できなければ `null`。
 *
 * **旧 rkey (= batchId 単体) を許容する**のは p7-1 時点の読取が repo 全件 list のままで、
 * 新旧が混在するため。移行 (p7-4) と全件 list の撤去 (p7-5) が済めば新形式しか
 * 走査範囲に入らないので、この寛容さは p7-5 で外せる。
 *
 * `null` を返すのは「`v1~` で始まるのに形式を満たさない」= 壊れた新形式のときだけ。
 * 呼び出し側は**数えて警告する** (silent skip にしない, 設計 §3.6)。
 */
export function batchIdFromRkey(rkey: string): BatchId | null {
  if (!rkey.startsWith(RKEY_VERSION_PREFIX)) {
    // 旧 rkey は batchId そのもの (Phase 4c〜6 の形式)
    return rkey as BatchId;
  }
  return parseBatchRkey(rkey)?.batchId ?? null;
}

/**
 * rkey を分解する。新形式でなければ `null`。
 *
 * 呼び出し側は「`v1~` で始まるのに `null`」= 壊れた新形式レコードとして**数えて警告**する
 * こと (silent skip にしない, 設計 §3.6)。`v1~` で始まらないものは旧 rkey か他種で、
 * そもそも新経路の走査範囲に入らない。
 */
export function parseBatchRkey(rkey: string): ParsedBatchRkey | null {
  if (!rkey.startsWith(RKEY_VERSION_PREFIX)) return null;
  // `v1~<fileId>~<clock>~<batchId>` を `~` で割ると 4 要素 (先頭は形式バージョン)
  const segments = rkey.split(SEPARATOR);
  if (segments.length !== SEGMENT_COUNT) return null;

  const [, fileId, clockText, batchId] = segments as [
    string,
    string,
    string,
    string,
  ];
  if (fileId === '' || batchId === '') return null;

  // 固定幅の数字列だけを受ける。`padStart` の出力と厳密に対応させ、
  // 桁数が違う・符号や空白が混ざった rkey を「読めた」ことにしない。
  if (clockText.length !== CLOCK_DIGITS || !/^\d+$/.test(clockText))
    return null;

  return {
    fileId: fileId as FileId,
    clock: Number(clockText),
    batchId: batchId as BatchId,
  };
}
