/**
 * シートの種別 (step3 Phase 1 D7 / architecture step3 §3.3 D3)
 *
 * 特殊なグラフ (metagraph、template graph、将来は拡張が持ち込むもの) は、**種別プロパティが
 * 特別な値を持つ sheet** として表す。op の種類は足さない — op は他人の repo に永久に残る
 * 通信形式なので、拡張が op を足すと、持たない相手が畳めず同じログから違う projection が出る。
 * 未知のプロパティなら、持たない相手も保存して運び、無視できる。
 *
 * 種別の値はそれを使う Phase が定める (metagraph は S1-9)。
 */

import type { Sheet } from '../schemas';
import type { PropertyName } from './unified';

/** 種別を置くプロパティ名。名前空間付き (拡張が足してよいのはこの形のプロパティだけ) */
export const SHEET_KIND_PROPERTY: PropertyName = 'app.conversensus.sheetKind';

/** シートの種別。名前空間付きの文字列 */
export type SheetKind = string;

/**
 * metagraph の種別 (step3 Phase 1 D8)。File の sheet の一覧を node として見せる sheet。
 * graph node は op として積まず、sheet の一覧から導出する (`derivedNode.ts`)
 */
export const METAGRAPH_SHEET_KIND: SheetKind = 'app.conversensus.metagraph';

/**
 * シートの種別を読む。**置かれていない・文字列でないものは `undefined`** (= ただの sheet)。
 *
 * 値を検証して例外にしないのは、相手が新しい種別の書き方をしていても、こちらでは
 * 「ただの sheet」として開けるべきだからである (`templatesOf` が知らない id を黙って
 * 落とすのと同じ)。
 */
export function sheetKindOf(
  sheet: Pick<Sheet, 'properties'>,
): SheetKind | undefined {
  const value = sheet.properties?.[SHEET_KIND_PROPERTY];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
