/**
 * Deep Link: グラフ view のアドレスを URL に載せる (#251)
 *
 * 形は `https://<origin>/#/v/<fileId>/<sheetId>` (trunk) と `…/#/v/<fileId>/<sheetId>/<branchId>`
 * (branch)。**`#` の後ろに置く** — fragment はサーバへ送られないので、File の id が配信の
 * ログに残らない。PWA は独自のスキーム (`conversensus://`) を登録できないので https の URL にした
 * (利用者の決定 2026-10-12)。
 *
 * **載せるのは file・sheet・branch だけ**で、切断面は常に `'head'` として読む。いまの画面は
 * アクティブな view に最新の姿しか出せず (`App` の `viewAddress`)、過去の切断面や highlight を
 * 載せても開いた側が黙って最新を出すことになる。timeline (#73) がそれを出せるようになったら、
 * query (`?…`) に足す。知らない query は読み飛ばすので、そのとき古い版でも開ける。
 *
 * ログインの戻り (OAuth) も fragment を使う (`#state=…&code=…`)。こちらは `#/` で始まるので
 * 取り違えない (`parseViewHash` は null を返す)。
 */

import {
  type GraphViewAddress,
  GraphViewAddressSchema,
  HEAD_CUT,
} from '@conversensus/shared';

/** view のリンクの fragment の頭 */
export const VIEW_HASH_PREFIX = '#/v/';

/** アドレスを fragment にする。切断面と highlight は載せない (冒頭) */
export function viewHash(address: GraphViewAddress): string {
  const segments: string[] = [address.fileId, address.sheetId];
  if (address.branchId !== null) segments.push(address.branchId);
  return VIEW_HASH_PREFIX + segments.map(encodeURIComponent).join('/');
}

/** その画面の URL (`location`) の fragment を、アドレスのものに替えた URL */
export function viewUrl(address: GraphViewAddress, base: string): string {
  const url = new URL(base);
  url.hash = viewHash(address);
  return url.href;
}

/**
 * fragment を読む。view のリンクでなければ (空、ログインの戻り、壊れた値) null。
 * **外から来た値なので検める** — id の形が違うものは開かない
 */
export function parseViewHash(hash: string): GraphViewAddress | null {
  if (!hash.startsWith(VIEW_HASH_PREFIX)) return null;
  const path = hash.slice(VIEW_HASH_PREFIX.length).split('?')[0] ?? '';
  let segments: string[];
  try {
    segments = path.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.length !== 2 && segments.length !== 3) return null;
  const [fileId, sheetId, branchId = null] = segments;
  const parsed = GraphViewAddressSchema.safeParse({
    fileId,
    sheetId,
    branchId,
    cut: HEAD_CUT,
  });
  return parsed.success ? parsed.data : null;
}
