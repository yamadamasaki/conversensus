/**
 * 画像 blob の由来を `ImageNode` へ降ろす口 (step2 Phase 2 S5)
 *
 * **`ImageNode` は React Flow が `nodeTypes` 経由で描くので props を渡せない。**
 * `imageErrorContext` と同じ理由で context にする (`GraphEditorProps` も増やさない)。
 *
 * 降ろすのは**関数 1 つ**であって Map ではない。呼び出し側は cid を渡して DID を
 * 受け取るだけでよく、Map の同一性がレンダリングに漏れない。
 */

import type { BlobCid, Did } from '@conversensus/shared';
import { createContext, useContext } from 'react';

/** cid からその blob を持つ repo の DID を引く。分からなければ `undefined` */
export type BlobOriginResolver = (cid: BlobCid) => Did | undefined;

/**
 * 既定は「分からない」。**Provider を置き忘れても壊れない** — 呼び出し側は自分の
 * repo に落ちるので、単一 actor の File はこれまで通り表示される
 * (多アクタの画像だけが出なくなる)。
 */
const BlobOriginContext = createContext<BlobOriginResolver>(() => undefined);

export const BlobOriginProvider = BlobOriginContext.Provider;

export function useBlobOrigin(): BlobOriginResolver {
  return useContext(BlobOriginContext);
}
