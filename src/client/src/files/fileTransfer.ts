/**
 * `.conversensus` ファイルの書き出しと読み込み (ANA-116 レビュー D1)
 *
 * **画像の実体を同梱する**のがこのモジュールの存在理由である。ノードの properties に
 * 載るのは blob 参照 (cid) だけなので、参照だけを書き出すと別の端末で開いた瞬間に
 * 全画像が「画像を読み込めません」になる。v4 まではここが base64 で自己完結していた
 * (それがレコード上限に当たったので ANA-116 で参照へ移した) ため、**自己完結性の回帰**
 * だった。op-log に base64 を戻さないまま、配布物であるファイルの側で実体を運ぶ。
 *
 * `api.ts` から分けてあるのは依存の向きのためである。ここは HTTP の薄いラッパ
 * (`api.ts`) と画像の読み方 (`images/imageBlob.ts`) の**両方**に依存するので、
 * api.ts に置くと `api → images → api` の循環になる。
 */

import {
  CONVERSENSUS_FILE_VERSION,
  type ConversensusFile,
  type ExportedBlob,
  type GraphFile,
} from '@conversensus/shared';
import { fetchBlob, postImportFile, putBlob } from '../api';
import { readImageBlobLocation } from '../images/imageBlob';

/** ファイル名に使えない文字 (OS をまたいで安全な範囲に落とす) */
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|]/g;
const FILENAME_REPLACEMENT = '_';
const FILE_EXTENSION = '.conversensus';
const JSON_INDENT = 2;
/** base64 化を分割する単位。大きい画像で引数の上限に当たらないようにする */
const BASE64_CHUNK_SIZE = 0x8000;

/** 書き出しの結果。**同梱できなかった画像**を呼び出し側へ伝える */
export type ExportSummary = {
  /**
   * 実体がこの端末に無く同梱できなかった cid。空でなければ、そのファイルを
   * 他の端末で開いても該当画像は表示できない — 黙って落とすと D1 の再発なので返す。
   */
  missingBlobs: readonly string[];
};

export type ExportFileDeps = {
  local: typeof fetchBlob;
  /** ブラウザにファイルを保存させる。テストは記録するだけの実装を渡す */
  download: (name: string, json: string) => void;
};

export type ImportFileDeps = {
  put: typeof putBlob;
  post: typeof postImportFile;
};

const defaultExportDeps: ExportFileDeps = {
  local: fetchBlob,
  download: downloadJson,
};

const defaultImportDeps: ImportFileDeps = {
  put: putBlob,
  post: postImportFile,
};

/** ファイル内のノードが参照している画像を重複なく集める */
function collectImageLocations(
  file: GraphFile,
): { cid: string; mimeType: string }[] {
  const byCid = new Map<string, { cid: string; mimeType: string }>();
  for (const sheet of file.sheets) {
    for (const node of sheet.nodes) {
      const location = readImageBlobLocation(node.properties);
      if (location) byCid.set(location.cid, location);
    }
  }
  return [...byCid.values()];
}

function bytesToBase64(bytes: Uint8Array): string {
  // 一度に渡すと大きい画像で String.fromCharCode の引数上限に当たる
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * ファイルが参照している画像の実体をローカル blob ストアから集める。
 *
 * **取れないものは飛ばす** (呼び出し側が `missingBlobs` で知る)。他端末が作った画像で
 * 一度も表示していないものは、この端末のストアに無いのが普通である — 書き出し自体を
 * 失敗させる理由にはならない。
 */
async function collectExportedBlobs(
  file: GraphFile,
  deps: ExportFileDeps,
): Promise<{ blobs: ExportedBlob[]; missingBlobs: string[] }> {
  const blobs: ExportedBlob[] = [];
  const missingBlobs: string[] = [];
  for (const { cid, mimeType } of collectImageLocations(file)) {
    const blob = await deps.local(cid).catch(() => undefined);
    if (!blob) {
      missingBlobs.push(cid);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    blobs.push({ cid, mimeType, data: bytesToBase64(bytes) });
  }
  return { blobs, missingBlobs };
}

/** ブラウザに JSON をファイルとして保存させる */
function downloadJson(name: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * ファイルを `.conversensus` として書き出す。**参照されている画像の実体を同梱する**。
 */
export async function exportFile(
  file: GraphFile,
  deps: ExportFileDeps = defaultExportDeps,
): Promise<ExportSummary> {
  const { blobs, missingBlobs } = await collectExportedBlobs(file, deps);
  const data: ConversensusFile = {
    ...file,
    version: CONVERSENSUS_FILE_VERSION,
    // 画像が無いファイルに空配列を付けない (v4 と同じ見た目のままにする)
    ...(blobs.length > 0 ? { blobs } : {}),
  };
  const safeName = file.name.replace(
    UNSAFE_FILENAME_CHARS,
    FILENAME_REPLACEMENT,
  );
  deps.download(
    `${safeName}${FILE_EXTENSION}`,
    JSON.stringify(data, null, JSON_INDENT),
  );
  return { missingBlobs };
}

/**
 * 同梱されていた画像をローカル blob ストアへ戻す。
 *
 * content-addressed なので**冪等**である (同じ実体を何度入れても同じ cid)。
 * 1 つの失敗で import 全体を落とさない — その画像が表示できないだけで、
 * グラフは読める方がよい。cid の検証はストア側 (`putBlob` の戻り) で行う。
 */
async function restoreImportedBlobs(
  blobs: readonly ExportedBlob[],
  deps: ImportFileDeps,
): Promise<void> {
  for (const { cid, mimeType, data } of blobs) {
    try {
      const stored = await deps.put(base64ToBytes(data), mimeType);
      if (stored.cid !== cid) {
        // ファイルの cid と実体が食い違う = ノードの参照では引けない。入れた実体は
        // 別 cid で残るが content-addressed なので害はない
        console.warn(
          `[import] blob cid mismatch: file says ${cid}, stored as ${stored.cid}`,
        );
      }
    } catch (error) {
      console.warn(`[import] failed to restore blob ${cid}:`, error);
    }
  }
}

/**
 * `.conversensus` を読み込んで新規ファイルとして保存する。
 *
 * **実体を先に戻してからグラフを送る。** 逆順だと、import 直後の描画で画像が
 * 解決できず「読み込めません」が出る (後から入れても再解決の契機が無い)。
 *
 * `blobs` はここで外す — op-log へ base64 を持ち込まないためである
 * (server 側でも落としているが、送らないのが最も確実)。
 */
export async function importFile(
  data: ConversensusFile,
  deps: ImportFileDeps = defaultImportDeps,
): Promise<GraphFile> {
  const { blobs, ...graph } = data;
  if (blobs && blobs.length > 0) await restoreImportedBlobs(blobs, deps);
  return deps.post(graph);
}
