/**
 * File をまたいだ中身の検索 (#248)
 *
 * 各 File の **trunk の Sheet** に Sheet 内検索 (`searchSheet`) をそのまま当てる。branch は含めない
 * (利用者判断 2026-10-11): 同じ node が trunk と branch の両方で当たって二重に並ぶ。branch の中身は
 * branch を開いて Sheet 内検索で引く。
 *
 * 当て方 (欄・system プロパティを出さない・並び) は `searchSheet` と同じにする。同じ検索語が、
 * Sheet 内検索とここで違う結果を出さないため。走らせるのはローカル正典の Worker の中
 * (`storeBackend.searchFiles`) — 全 File を畳み込むので、main に File を運ばない。
 */

import type { FileId, GraphFile, SheetId } from '@conversensus/shared';
import { type SearchHit, type SearchOptions, searchSheet } from './searchSheet';

/** 当たった 1 件と、それがある File と Sheet */
export type FileSearchHit = SearchHit & {
  fileId: FileId;
  fileName: string;
  sheetId: SheetId;
  sheetName: string;
};

/**
 * 当てる件数の上限。これを超えたら打ち切る — 1 文字の検索語は全 File の要素の大半に当たり、
 * Worker から運ぶのも描くのも重い。打ち切ったことは呼び出し側が `truncated` で知る
 */
export const FILE_SEARCH_LIMIT = 500;

export type FileSearchResult = {
  hits: FileSearchHit[];
  /** 上限で打ち切った */
  truncated: boolean;
};

/** 並びは File の一覧の順 → Sheet の順 → `searchSheet` の順 */
export function searchFiles(
  files: readonly GraphFile[],
  query: string,
  options: SearchOptions = {},
  limit = FILE_SEARCH_LIMIT,
): FileSearchResult {
  const hits: FileSearchHit[] = [];
  for (const file of files) {
    for (const sheet of file.sheets) {
      for (const hit of searchSheet(sheet, query, options)) {
        if (hits.length >= limit) return { hits, truncated: true };
        hits.push({
          ...hit,
          fileId: file.id,
          fileName: file.name,
          sheetId: sheet.id,
          sheetName: sheet.name,
        });
      }
    }
  }
  return { hits, truncated: false };
}
