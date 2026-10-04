/**
 * `LocalStore` を同じスレッドで直接呼ぶバックエンド (step3 Phase 2 D2)
 *
 * HTTP の往復が無いだけで、**HTTP の経路と同じ検証を通す** — 書き込む batch と読み出した
 * batch を `BatchSchema` で読み直す (HTTP では送受信の境界で zod を通していた)。既定値の補完
 * (`Commit.kind` など) まで同じにしておかないと、経路によって畳み込みの入力が変わる。
 */

import {
  type Batch,
  BatchSchema,
  GraphFileSchema,
  type LocalStore,
  ReceivedBatchSchema,
  StoredBatchSchema,
} from '@conversensus/shared';
import { z } from 'zod';
import type { LocalBackend } from './backend';

/** 自分が書く batch。知らない op はありえない */
const BatchesSchema = z.array(BatchSchema);
/**
 * 受信した batch は**知らない種類の op を含んだまま**通して保存する (step3 FPR の確認 §5.3)。
 * 弾くと受信がまるごと止まる
 */
const ReceivedBatchesSchema = z.array(ReceivedBatchSchema);
/** 保存から読んだ batch は知らない op を落とした後なので、ops が空でありうる */
const StoredBatchesSchema = z.array(StoredBatchSchema);

export function storeBackend(store: LocalStore): LocalBackend {
  return {
    fetchFiles: async () => store.listFiles(),
    fetchLocalFileIds: async () => store.listAllFileIds(),
    createFile: async (name) =>
      GraphFileSchema.parse(store.createFile({ name })),
    postImportFile: async (data) => {
      const result = store.importFile(data);
      if (!result.ok) throw new Error('Failed to import file');
      return GraphFileSchema.parse(result.file);
    },
    pushBatches: async (fileId, batches: Batch[]) =>
      store.appendBatches(fileId, BatchesSchema.parse(batches)),
    pushReceivedBatches: async (fileId, batches: Batch[]) =>
      store.appendReceived(
        fileId,
        // 知らない op は `Op` の型に無いが、保存の JSON にはそのまま残す
        ReceivedBatchesSchema.parse(batches) as Batch[],
      ),
    fetchBatches: async (fileId, since) =>
      StoredBatchesSchema.parse(store.getBatches(fileId, since)),
    putBlob: async (bytes, mimeType) => {
      const result = await store.putBlob(bytes, mimeType);
      // HTTP の経路と同じく、断った理由を呼び出し元へ渡す (利用者に「なぜ」を伝えるため)
      if (!result.ok)
        throw new Error(`Failed to store blob: ${result.message}`);
      return result.blob;
    },
    fetchBlob: async (cid) => {
      const blob = store.getBlob(cid);
      if (!blob) return undefined;
      return new Blob([blob.bytes as unknown as BlobPart], {
        type: blob.mimeType,
      });
    },
  };
}
