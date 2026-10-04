/**
 * ATProto PDS のコレクション操作
 *
 * **step1 Phase 6 p6-5b で legacy snapshot コレクション (sheet/node/edge/layout/
 * branch/commit/merge) の口を撤去した** — これらを読み書きしていた `branchState.ts` /
 * `sync.ts` / `mapper.ts` が退役し、消費者がゼロになったため (設計 §3.8)。
 * PDS 上の既存レコードと lexicon json は放置する決定なので、レコード型 (`types.ts`)
 * と NSID はそのまま残る。
 *
 * 残っているのは:
 *   - `batches`:   op-log の正典コレクション (Phase 4c 以降のグラフの同期単位)
 *   - `judgments`: 判断ログ (step2 Phase 1)。名簿と、Phase 6 の DtR 承認
 *   - `files`:     legacy file レコードの後始末 (ファイル削除時の `delete` のみ)
 *   - `noticeDismissals` / `folders` / `filePlacements`: actor 固有の state (step3 Phase 6)。
 *     **自分の repo だけを読む** — 他の actor の整理や既読を読む理由が無い
 */

import type { AtUri, Did, FileId, Rkey } from '@conversensus/shared';
import { batchRkeyFileCursor, batchRkeyPrefix } from './batchRkey';
import { currentDid, getAgent } from './client';
import {
  listAllRecords,
  listBatchFileHeads,
  listByRkeyPrefix,
  type RecordPage,
} from './rangeFetch';
import {
  type BatchRecord,
  type FilePlacementRecord,
  type FolderRecord,
  type JudgmentRecord,
  type NoticeDismissalRecord,
  NSID,
  type RecordResult,
} from './types';

/** trunk を指す表示名。branch 一覧・UI の既定枝として使う */
export const TRUNK_PREFIX = 'trunk';

/**
 * `listRecords` の 1 ページの取得件数。**PDS の上限値そのもの** —
 * `limit=101` は 400 InvalidRequest になることを実機で確認済 (設計 §5.1 の観測④)。
 */
const PAGE_LIMIT = 100;

/**
 * 読み出し先の repo (step2 Phase 0)
 *
 * 省略すると自分の repo を読む。**Phase 2 の多アクタ同期が、他 actor の op-log を
 * 読むためにここへ相手の DID を渡す**。Phase 0 の時点では呼び出し側を変えないので、
 * 観測される振舞いは変わらない。
 *
 * **書き込みは引数化しない。**ATProto の credential は自分の repo のものしか無いので、
 * `repo` を受ける write は型が嘘をつくことになる。「他者の repo は読めるが書けない」
 * という非対称を、そのまま型の形に出しておく。
 */
type ReadRepo = { repo?: Did };

// --- 汎用ヘルパー ---

async function putRecord(
  collection: string,
  rkey: Rkey,
  record: Record<string, unknown>,
): Promise<RecordResult> {
  const res = await getAgent().api.com.atproto.repo.putRecord({
    repo: currentDid(),
    collection,
    rkey,
    record,
  });
  return res.data;
}

async function getRecord(
  collection: string,
  rkey: Rkey,
  { repo }: ReadRepo = {},
): Promise<{ uri: AtUri; cid: string; value: unknown }> {
  const res = await getAgent().api.com.atproto.repo.getRecord({
    repo: repo ?? currentDid(),
    collection,
    rkey,
  });
  return { ...res.data, cid: res.data.cid ?? '' };
}

/**
 * `listRecords` を 1 ページだけ叩く (step1 Phase 7 p7-2)。
 *
 * 全件取得と範囲取得の共通の土台。`reverse` を省くと **rkey 降順**、`true` で昇順になり、
 * `cursor` はそれぞれ `rkey < cursor` / `rkey > cursor` として比較される (設計 §1.3)。
 * **cursor に検証は無く rkey として直接比較される**ので、前回応答由来でない値を渡して
 * 任意の rkey 位置へ seek できる (p7-0 で実機確認済)。
 */
async function listRecordsPage(
  collection: string,
  params: {
    cursor?: string;
    reverse?: boolean;
    limit?: number;
  } & ReadRepo = {},
): Promise<RecordPage> {
  const res = await getAgent().api.com.atproto.repo.listRecords({
    repo: params.repo ?? currentDid(),
    collection,
    limit: params.limit ?? PAGE_LIMIT,
    cursor: params.cursor,
    reverse: params.reverse,
  });
  return { records: res.data.records, cursor: res.data.cursor };
}

async function deleteRecord(collection: string, rkey: Rkey): Promise<void> {
  await getAgent().api.com.atproto.repo.deleteRecord({
    repo: currentDid(),
    collection,
    rkey,
  });
}

// --- Batch (op-log, step1 Phase 4c) ---

export const batches = {
  /**
   * rkey は `batchRkey()` **だけ**が組み立てる (Phase 7 p7-1, 設計 §6.6)。
   * ここへ任意の文字列を直書きすると `listByFile` の走査から漏れる。
   */
  put(rkey: string, data: Omit<BatchRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.batch, rkey, { $type: NSID.batch, ...data });
  },
  get(rkey: string, options?: ReadRepo) {
    return getRecord(NSID.batch, rkey, options);
  },
  /**
   * 1 ファイル分の batch レコードだけを取得する (Phase 7 p7-2)。
   * rkey が `<fileId>~…` なので prefix 範囲取得で済み、**repo 全体を読まない**。
   */
  listByFile(fileId: FileId, { repo }: ReadRepo = {}) {
    return listByRkeyPrefix(
      (params) => listRecordsPage(NSID.batch, { ...params, repo }),
      batchRkeyPrefix(fileId),
      batchRkeyFileCursor(fileId),
    );
  },
  /**
   * remote に存在するファイルを列挙する (Phase 7 p7-3)。
   * 1 ファイル 1 リクエスト・各 1 レコードで、**batch 本体を落とさない** (§3.3)。
   *
   * 返すのは fileId と**着地した 1 レコード**である (ANA-127 S3)。着地レコードは
   * そのファイルの rkey の最大 = **辞書順で最後の actor の最大 seq** の batch である。
   * v1 (rkey に clock) では clock 最大の batch だったので削除の tombstone がそこに現れたが、
   * v2 では現れるとは限らない。**削除の判定の正しさは発見側の 2 つ目の検査**
   * (引いた op-log に `file.remove` があるか, `discoverRemoteFiles`) が持つ
   */
  listFileHeads({ repo }: ReadRepo = {}) {
    return listBatchFileHeads((params) =>
      listRecordsPage(NSID.batch, { ...params, repo }),
    );
  },
  delete(rkey: string) {
    return deleteRecord(NSID.batch, rkey);
  },
};

// --- Judgment (判断ログ, step2 Phase 1) ---

/**
 * 判断ログ。名簿の op を置き、Phase 6 で DtR の承認が加わる。
 *
 * **rkey は `batches` と同じスキーム** (`batchRkey`) を使う。collection が違うので
 * 空間は衝突せず、他 actor の repo から**1 ファイル分の名簿だけ**を prefix 範囲取得
 * できる。相手の repo は自分のより大きいのが普通なので、全部読む形にはできない
 * (U6-P1 スパイク)。
 *
 * **書き込みに repo 引数が無いのは `batches` と同じ理由**である — ATProto の
 * credential は自分の repo のものしか無い。
 */
export const judgments = {
  /**
   * rkey は `batchRkey()` だけが組み立てる (`batches.put` と同じ規約)。
   * `putRecord` はべき等なので、genesis の bootstrap を何度走らせても増えない。
   */
  put(
    rkey: string,
    data: Omit<JudgmentRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.judgment, rkey, { $type: NSID.judgment, ...data });
  },
  /** 1 ファイル分の判断だけを取得する。**他 actor の repo を読むのが本命の用途** */
  listByFile(fileId: FileId, { repo }: ReadRepo = {}) {
    return listByRkeyPrefix(
      (params) => listRecordsPage(NSID.judgment, { ...params, repo }),
      batchRkeyPrefix(fileId),
      batchRkeyFileCursor(fileId),
    );
  },
  /**
   * 判断ログのある fileId を列挙する。
   *
   * **Phase 2 の発見経路がこれを使う。**グラフの `batches.listFileHeads` を他 actor の
   * repo に回すと、共同作業していない File まで materialize してしまう (U6-P1)。
   * 「名簿を先に読み、グラフを後に読む」ので、絞り込みはこちら側で行う。
   */
  listFileHeads({ repo }: ReadRepo = {}) {
    return listBatchFileHeads((params) =>
      listRecordsPage(NSID.judgment, { ...params, repo }),
    );
  },
  delete(rkey: string) {
    return deleteRecord(NSID.judgment, rkey);
  },
};

// --- actor 固有の state (step3 Phase 6) ---

/**
 * 閉じた通知。rkey は `noticeDismissalRkey()` だけが組み立てる (`<fileId>~…` でないと
 * `listByFile` の範囲から漏れる)。
 */
export const noticeDismissals = {
  put(
    rkey: string,
    data: Omit<NoticeDismissalRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.noticeDismissal, rkey, {
      $type: NSID.noticeDismissal,
      ...data,
    });
  },
  /** 1 File 分の既読だけを取得する (rkey が `<fileId>~` で始まる) */
  listByFile(fileId: FileId) {
    return listByRkeyPrefix(
      (params) => listRecordsPage(NSID.noticeDismissal, params),
      batchRkeyPrefix(fileId),
      batchRkeyFileCursor(fileId),
    );
  },
  delete(rkey: string) {
    return deleteRecord(NSID.noticeDismissal, rkey);
  },
};

/** Folder。rkey = FolderId */
export const folders = {
  put(id: Rkey, data: Omit<FolderRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.folder, id, { $type: NSID.folder, ...data });
  },
  list() {
    return listAllRecords((params) => listRecordsPage(NSID.folder, params));
  },
  delete(id: Rkey) {
    return deleteRecord(NSID.folder, id);
  },
};

/** File の置き場。rkey = FileId。トップ・レベルに戻す = `delete` */
export const filePlacements = {
  put(
    fileId: FileId,
    data: Omit<FilePlacementRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.filePlacement, fileId, {
      $type: NSID.filePlacement,
      ...data,
    });
  },
  list() {
    return listAllRecords((params) =>
      listRecordsPage(NSID.filePlacement, params),
    );
  },
  delete(fileId: FileId) {
    return deleteRecord(NSID.filePlacement, fileId);
  },
};
