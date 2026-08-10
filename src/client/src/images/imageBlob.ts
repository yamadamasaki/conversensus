/**
 * 画像 blob の保存と解決 (ANA-116 S3)
 *
 * 「画像を受け取ってから op に載る参照になるまで」と「properties から画像の実体に
 * 戻るまで」の判断をここに集める。`GraphEditor` / `ImageNode` に残すのは配線と描画だけ
 * である (設計: `deepse/plans/step1-refinement-ana116-image.md` §5「S3 の設計」)。
 *
 * 書く形と読む形を 1 箇所で決めているのが要点である — この 2 つは同じ約束の裏表で、
 * 離して置くと片方だけが新形式になる (S3 で旧 S4 を統合した理由そのもの)。
 */

import {
  type BlobCid,
  MAX_BLOB_SIZE,
  type MimeType,
  type Op,
} from '@conversensus/shared';
import { fetchBlob, putBlob, type StoredBlob } from '../api';
import {
  cacheBlobUrl,
  fetchRemoteBlob,
  getCachedBlobUrl,
  loggedInDid,
  uploadImageBlob,
} from '../atproto/blob';

/**
 * op の properties に載せる画像の参照。**ATProto の blob ref そのもの**である (設計 D1/D2a)。
 *
 * この形で batch レコードの `ops` に埋めておくと、`ops` が lexicon 上 `unknown` でも
 * PDS はレコード書込時に blob を pin する (S1 で実測)。
 * **`{cid, mimeType}` の 2 キーだけの形にしてはならない** — `@atproto/lexicon` の
 * `ipldToLex` はレキシコン定義を見ずにツリーを歩くので、その形も blob ref と誤認する。
 */
export type ImageBlobRef = {
  $type: 'blob';
  ref: { $link: BlobCid };
  mimeType: MimeType;
  size: number;
};

/** 画像の参照を置く properties のキー */
export const IMAGE_PROPERTY_KEY = 'image';

// 旧形式 (step0 〜 step1 初期) の flat なキー。**読み取りだけ**残す (設計 §7)
const LEGACY_CID_KEY = 'imageBlobCid';
const LEGACY_MIME_KEY = 'imageBlobMimeType';
/** 旧形式の base64 埋め込み。`ImageNode` の表示互換のためだけに読む (D4 の 4) */
export const LEGACY_DATA_URL_KEY = 'imageDataUrl';

/** 画像かどうかの判定に使う MIME の接頭辞。受け入れ経路が 4 つあるので 1 箇所で持つ */
export const IMAGE_MIME_PREFIX = 'image/';
const BYTES_PER_MIB = 1024 * 1024;
const MIB_FRACTION_DIGITS = 1;

/** blob の実体が置かれている場所。ローカル・PDS のどちらでも同じ識別子で引ける */
export type ImageBlobLocation = { cid: BlobCid; mimeType: MimeType };

/**
 * 解決した画像。`fromCache` が true の URL は**共有キャッシュの持ち物**なので、
 * 受け取った側が `revokeObjectURL` してはならない (他のノードが表示中でも壊れる)。
 */
export type ResolvedImage = { url: string; fromCache: boolean };

/**
 * 大きさの表示。**MiB とバイト数を併記する。**
 *
 * MiB だけだと上限ぎりぎりの画像で「5.0 MiB、上限は 5.0 MiB です」と出てしまい、
 * 同じ値に見えて理由が伝わらない (実機で確認)。
 */
function formatSize(bytes: number): string {
  const mib = (bytes / BYTES_PER_MIB).toFixed(MIB_FRACTION_DIGITS);
  return `${mib} MiB / ${bytes.toLocaleString('en-US')} バイト`;
}

function toImageBlobRef(stored: StoredBlob): ImageBlobRef {
  return {
    $type: 'blob',
    ref: { $link: stored.cid },
    mimeType: stored.mimeType,
    size: stored.size,
  };
}

function isImageBlobRef(value: unknown): value is ImageBlobRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  if (ref.$type !== 'blob' || typeof ref.mimeType !== 'string') return false;
  const link = (ref.ref as Record<string, unknown> | undefined)?.$link;
  return typeof link === 'string' && link.length > 0;
}

/**
 * properties から画像の場所を読む。新形式を優先し、無ければ旧形式の flat なキーを見る。
 *
 * 読み取りは書き込みより緩くしてある (`size` の有無を問わない) — 旧データや他端末が
 * 書いたものを開けなくする理由が無いためである。
 */
export function readImageBlobLocation(
  properties: Record<string, unknown> | undefined,
): ImageBlobLocation | undefined {
  if (!properties) return undefined;

  const ref = properties[IMAGE_PROPERTY_KEY];
  if (isImageBlobRef(ref)) {
    return { cid: ref.ref.$link, mimeType: ref.mimeType };
  }

  const cid = properties[LEGACY_CID_KEY];
  const mimeType = properties[LEGACY_MIME_KEY];
  if (
    typeof cid === 'string' &&
    cid &&
    typeof mimeType === 'string' &&
    mimeType
  )
    return { cid, mimeType };

  return undefined;
}

/** 参照を `NODE_ADDED` などに載せる properties の形にする */
export function imagePropertiesOf(ref: ImageBlobRef): Record<string, unknown> {
  return { [IMAGE_PROPERTY_KEY]: ref };
}

/**
 * 既存ノードの画像を差し替えたあとの properties を作る (ANA-117 / S6)。
 *
 * **差分ではなく置き換え後の全体を返す。** `NODE_PROPERTIES_CHANGED` は差分の形を
 * しているが、統一 op の `node.setProperties` は**置換**意味論である
 * (`events/toUnified.ts` の冒頭に既知の制約として書かれている)。差分だけを載せると
 * projection でその他の properties が消える。
 *
 * **旧形式の画像キーは落とす。** 新しい画像が古いものを置き換えるので残す意味が無く、
 * とりわけ `imageDataUrl` (base64) を持ち回すと、差し替えのたびに base64 が新しい op へ
 * 載り直してレコード上限 (約 1 MB) に当たる — S3 で止めたことがここで復活してしまう。
 * 画像以外の properties (`imageUrl` など) はそのまま残す。
 */
export function replaceImageProperties(
  existing: Record<string, unknown> | undefined,
  ref: ImageBlobRef,
): Record<string, unknown> {
  const next = { ...existing };
  delete next[LEGACY_CID_KEY];
  delete next[LEGACY_MIME_KEY];
  delete next[LEGACY_DATA_URL_KEY];
  return { ...next, ...imagePropertiesOf(ref) };
}

/**
 * 画像差し替えの `NODE_PROPERTIES_CHANGED` に載せる from / to。
 *
 * `from` は**差し替え前の全体**である。undo (`invertEvent`) は from と to を入れ替える
 * だけなので、片方が差分だと元に戻したときに properties が欠ける。
 */
export function imagePropertiesChange(
  existing: Record<string, unknown> | undefined,
  ref: ImageBlobRef,
): { from: Record<string, unknown>; to: Record<string, unknown> } {
  return { from: { ...existing }, to: replaceImageProperties(existing, ref) };
}

export type SaveImageDeps = {
  put: typeof putBlob;
  cache: typeof cacheBlobUrl;
};

const defaultSaveDeps: SaveImageDeps = { put: putBlob, cache: cacheBlobUrl };

/**
 * 画像をローカル blob ストアへ保存し、op に載せる参照を返す。
 *
 * **PDS は触らない** (設計 D5)。未ログインでも画像を使えることが要件であり、
 * PDS への `uploadBlob` は batch を push する経路の前段で行う (S5)。
 * blob CID はバイト列から決まるので、ここで作った参照は後から書き換えずに push できる。
 *
 * 失敗はユーザーに見せる前提の日本語メッセージで投げる — 旧実装のように
 * `console.error` で握り潰すと「落としたのに何も起きない」ように見える (設計 D7)。
 */
export async function saveImageBlob(
  source: Blob,
  deps: SaveImageDeps = defaultSaveDeps,
): Promise<ImageBlobRef> {
  const mimeType = source.type;
  if (!mimeType.startsWith(IMAGE_MIME_PREFIX)) {
    throw new Error(
      `画像ではないので追加できません (${mimeType || '種別不明'})`,
    );
  }
  // 読み込む前に弾く。上限は PDS の実測値で、超えたものは送信時 (S5) に必ず失敗する
  if (source.size > MAX_BLOB_SIZE) {
    throw new Error(
      `画像が大きすぎます (${formatSize(source.size)})。上限は ${formatSize(MAX_BLOB_SIZE)} です`,
    );
  }

  const bytes = new Uint8Array(await source.arrayBuffer());
  const stored = await deps.put(bytes, mimeType);
  // 保存直後は GET せずに表示できるようにしておく (解決順序の 1)
  deps.cache(stored.cid, bytes, stored.mimeType);
  return toImageBlobRef(stored);
}

export type ResolveImageDeps = {
  cached: typeof getCachedBlobUrl;
  local: typeof fetchBlob;
  remote: typeof fetchRemoteBlob;
  put: typeof putBlob;
  did: typeof loggedInDid;
};

const defaultResolveDeps: ResolveImageDeps = {
  cached: getCachedBlobUrl,
  local: fetchBlob,
  remote: fetchRemoteBlob,
  put: putBlob,
  did: loggedInDid,
};

/**
 * 画像の実体を表示できる URL に解決する (設計 D4 の 1〜3)。
 *
 * どこにも無ければ `undefined` を返す。呼び出し元はそこで旧データの `imageDataUrl` /
 * `imageUrl` (4〜5) へ落ちる — 「無い」は他端末が作った画像で普通に起こるので、
 * 例外にはしない。
 */
export async function resolveImageUrl(
  location: ImageBlobLocation,
  deps: ResolveImageDeps = defaultResolveDeps,
): Promise<ResolvedImage | undefined> {
  // 1. アップロード直後のメモリキャッシュ
  const cached = deps.cached(location.cid);
  if (cached) return { url: cached, fromCache: true };

  // 2. ローカル blob ストア (daemon)。ここで取れれば PDS もログインも要らない
  const local = await deps.local(location.cid);
  if (local) return { url: URL.createObjectURL(local), fromCache: false };

  // 3. PDS。**ログインしている時だけ**触る。未ログインで `currentDid()` を呼ぶと
  //    throw して表示が止まってしまう (旧 ImageNode の不具合)
  const did = deps.did();
  if (!did) return undefined;

  const remote = await deps.remote(did, location.cid, location.mimeType);
  // ローカルへ書き戻す: 次回以降は PDS を触らずに、オフラインでも表示できる。
  // content-addressed で冪等なので安全であり、失敗しても表示は妨げない (best effort)
  void remote
    .arrayBuffer()
    .then((buf) => deps.put(new Uint8Array(buf), location.mimeType))
    .catch(() => {});
  return { url: URL.createObjectURL(remote), fromCache: false };
}

// --- PDS への送り出し (ANA-116 S5) ---

/**
 * op 列が参照している画像 blob を集める (重複は cid で畳む)。
 *
 * **新形式 (`properties.image` の blob ref) だけを集める。** 旧 flat 形式
 * (`imageBlobCid`) は PDS から見ればただの文字列で pin の対象にならないので、
 * 送信前に upload する意味が無い (旧経路は作成時に upload 済でもある)。
 */
export function collectImageBlobRefs(ops: readonly Op[]): ImageBlobRef[] {
  const byCid = new Map<BlobCid, ImageBlobRef>();
  for (const op of ops) {
    const properties = 'properties' in op ? op.properties : undefined;
    const ref = properties?.[IMAGE_PROPERTY_KEY];
    if (isImageBlobRef(ref)) byCid.set(ref.ref.$link, ref);
  }
  return [...byCid.values()];
}

export type UploadImageBlobDeps = {
  local: typeof fetchBlob;
  upload: typeof uploadImageBlob;
};

const defaultUploadDeps: UploadImageBlobDeps = {
  local: fetchBlob,
  upload: uploadImageBlob,
};

/**
 * op が参照する画像 blob を **PDS へ先に上げる**関数を作る (設計 D5)。
 *
 * **順序が要件である。** blob を上げる前に blob ref を含むレコードを書こうとすると
 * PDS は `Could not find blob: <cid>` で拒否する (S1 で実測)。壊れたレコードが
 * できるより安全だが、順序を間違えるとその batch は再送し続けて outbox に詰まる。
 *
 * 上げ済みの cid をセッション内で覚える。ログイン単位で作り直す前提なので
 * (`useRemoteSyncQueue` が session ごとに provider ごと作り直す)、別 repo の
 * 上げ済みを引き継ぐことはない。
 */
export function createPdsBlobUploader(
  deps: UploadImageBlobDeps = defaultUploadDeps,
): (ops: readonly Op[]) => Promise<void> {
  const uploaded = new Set<BlobCid>();

  return async function uploadImageBlobsForOps(ops) {
    for (const ref of collectImageBlobRefs(ops)) {
      const cid = ref.ref.$link;
      if (uploaded.has(cid)) continue;

      const bytes = await deps.local(cid);
      if (!bytes) {
        // ローカルに実体が無い = この端末では上げられない。**数えずに黙って
        // 進む**のではなく警告する: レコード側は「PDS に既にある」場合だけ通り、
        // 無ければ push が失敗して未同期のまま残る (どちらもここで判別できない)
        console.warn(
          `[image] blob ${cid} is not in the local store; skipping upload. ` +
            'The record push will fail unless the PDS already has it.',
        );
        continue;
      }

      const stored = await deps.upload(
        new Uint8Array(await bytes.arrayBuffer()),
        ref.mimeType,
      );
      // CID はバイト列から決まる (S1 U2) ので、食い違いは「別の実体を上げた」ことを
      // 意味する。そのまま進むと参照先が pin されないレコードができるので止める
      if (stored.cid !== cid) {
        throw new Error(
          `Uploaded blob CID mismatch: expected ${cid}, PDS returned ${stored.cid}`,
        );
      }
      uploaded.add(cid);
    }
  };
}
