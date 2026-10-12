/**
 * Deep Link: グラフ view のアドレスを URL に載せる (#251)
 *
 * 形は `https://<origin>/#/v/<fileId>/<sheetId>` (trunk) と `…/#/v/<fileId>/<sheetId>/<branchId>`
 * (branch)。**`#` の後ろに置く** — fragment はサーバへ送られないので、File の id が配信の
 * ログに残らない。PWA は独自のスキーム (`conversensus://`) を登録できないので https の URL にした
 * (利用者の決定 2026-10-12)。
 *
 * 過去の時点 (vector の切断面) と強調は query に載せる (#73 timeline view の「その時点のタブ」)。
 *
 * - `at=<actor>@<seq>` を actor ごとに繰り返す。無ければ最新 (`'head'`)、値の無い `at=` は空の切断面。
 *   seq は数字なので、最後の `@` で分ける
 * - `n=<nodeId>` / `e=<edgeId>` を強調する要素ごとに繰り返す
 *
 * 知らない query は読み飛ばすので、後で項目を足しても古い版で開ける。
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

const PARAM = { at: 'at', node: 'n', edge: 'e' } as const;
const AT_SEPARATOR = '@';

/** アドレスを fragment にする */
export function viewHash(address: GraphViewAddress): string {
  const segments: string[] = [address.fileId, address.sheetId];
  if (address.branchId !== null) segments.push(address.branchId);
  const params = new URLSearchParams();
  if (address.cut !== HEAD_CUT) {
    // 空の切断面 (何も含まない時点) は値の無い `at=` で表す。何も書かないと最新と区別できない
    if (Object.keys(address.cut).length === 0) params.append(PARAM.at, '');
    // actor の順に並べる (同じ切断面が同じ URL になる)
    for (const [actor, seq] of Object.entries(address.cut).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      params.append(PARAM.at, `${actor}${AT_SEPARATOR}${seq}`);
    }
  }
  for (const id of address.highlight?.nodeIds ?? [])
    params.append(PARAM.node, id);
  for (const id of address.highlight?.edgeIds ?? [])
    params.append(PARAM.edge, id);
  const query = params.toString();
  return (
    VIEW_HASH_PREFIX +
    segments.map(encodeURIComponent).join('/') +
    (query ? `?${query}` : '')
  );
}

/** その画面の URL (`location`) の fragment を、アドレスのものに替えた URL */
export function viewUrl(address: GraphViewAddress, base: string): string {
  const url = new URL(base);
  url.hash = viewHash(address);
  return url.href;
}

/**
 * `at` の並びを切断面にする。1 つも無ければ最新、値の無い `at=` だけなら空の切断面。
 * 読めない値が 1 つでもあれば null
 */
function cutOf(values: string[]): GraphViewAddress['cut'] | null {
  if (values.length === 0) return HEAD_CUT;
  const cut: Record<string, number> = {};
  for (const value of values) {
    if (value === '') continue; // 空の切断面の印 (`viewHash`)
    const at = value.lastIndexOf(AT_SEPARATOR);
    if (at <= 0) return null;
    const seq = Number(value.slice(at + 1));
    if (!/^\d+$/.test(value.slice(at + 1)) || !Number.isSafeInteger(seq))
      return null;
    cut[value.slice(0, at)] = seq;
  }
  return cut;
}

/**
 * fragment を読む。view のリンクでなければ (空、ログインの戻り、壊れた値) null。
 * **外から来た値なので検める** — id の形が違うもの・読めない切断面は開かない
 */
export function parseViewHash(hash: string): GraphViewAddress | null {
  if (!hash.startsWith(VIEW_HASH_PREFIX)) return null;
  const rest = hash.slice(VIEW_HASH_PREFIX.length);
  const queryAt = rest.indexOf('?');
  const path = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const params = new URLSearchParams(
    queryAt === -1 ? '' : rest.slice(queryAt + 1),
  );
  let segments: string[];
  try {
    segments = path.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.length !== 2 && segments.length !== 3) return null;
  const [fileId, sheetId, branchId = null] = segments;
  const cut = cutOf(params.getAll(PARAM.at));
  if (cut === null) return null;
  const nodeIds = params.getAll(PARAM.node);
  const edgeIds = params.getAll(PARAM.edge);
  const parsed = GraphViewAddressSchema.safeParse({
    fileId,
    sheetId,
    branchId,
    cut,
    ...(nodeIds.length + edgeIds.length > 0 && {
      highlight: { nodeIds, edgeIds },
    }),
  });
  return parsed.success ? parsed.data : null;
}
