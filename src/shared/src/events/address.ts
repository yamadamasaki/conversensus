/**
 * グラフ view のアドレス (step3 Phase 3 S3-1, 計画 Q2 / step3 O1)
 *
 * 「いま、どのグラフを、どの時点の姿で見ているか」を 1 つの値で言い表す。アプリ内タブ・
 * multiple モードの pane・merger の元/先/後・timeline・global search の結果・Deep Link は、
 * すべてこの値の上に載る。
 *
 * 画面の中身は**アドレスから projection して決める** (`projectAddress`)。以前は開いている
 * File の state (`activeFile`) を branch の中身で差し替えて「branch を見ている」を表していた
 * (設計 F1) ので、同じ File を 2 か所で開くことも、閉じたものを同じ姿で開き直すこともできなかった。
 *
 * mode (view の種類) は持たない (Phase 3 Q1)。編集できるかどうかは切断面と pane の役割から導く。
 */

import type {
  BranchId,
  EdgeId,
  FileId,
  NodeId,
  Sheet,
  SheetId,
} from '../schemas';
import { type Branch, branchSheet } from './branchLog';
import { covers, type VersionVector } from './causality';
import { projectFile } from './project';
import type { Batch } from './unified';

/** 最新の姿 (編集に追随する) を指す切断面 */
export const HEAD_CUT = 'head';

/**
 * 切断面。`'head'` は最新、`VersionVector` は固定された時点 (commit・merge・分岐点など)。
 *
 * vector は actor ごとの seq の上限で、**trunk と branch の両方に同じ vector が効く** —
 * trunk・その branch・判断ログは 1 つの発番器を共有するので (`CausalClock` の冒頭)、
 * actor の seq は File の中で 1 系列である
 */
export type Cut = typeof HEAD_CUT | VersionVector;

export type GraphViewAddress = {
  fileId: FileId;
  sheetId: SheetId;
  /** null = trunk */
  branchId: BranchId | null;
  cut: Cut;
  /** 強調する要素 (検索の結果など)。中身には影響しない */
  highlight?: { nodeIds: NodeId[]; edgeIds: EdgeId[] };
};

/** trunk を表すキーの綴り (`addressKey`) */
const TRUNK_KEY = 'trunk';

/**
 * アドレスの同一性を表す文字列。**中身を決める項目だけで作る** — highlight は強調にすぎず、
 * 同じグラフの同じ時点を指すアドレスは highlight が違っても同じ view である。
 *
 * タブの重複の判定 (Phase 3 Q2: 同じアドレスは既存のタブへ移る)、React の key、
 * undo の履歴の置き場に使う。vector は actor の順に並べて綴る (同じ vector が同じ文字列になる)
 */
export function addressKey(address: GraphViewAddress): string {
  const cut =
    address.cut === HEAD_CUT
      ? HEAD_CUT
      : Object.entries(address.cut)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([actor, seq]) => `${actor}:${seq}`)
          .join(',');
  return [
    address.fileId,
    address.sheetId,
    address.branchId ?? TRUNK_KEY,
    cut,
  ].join('/');
}

/** その切断面に含まれる batch。`'head'` なら全部 */
export function batchesWithin(batches: Batch[], cut: Cut): Batch[] {
  if (cut === HEAD_CUT) return batches;
  return batches.filter((b) => covers(cut, b.actor, b.seq));
}

/** 過去の切断面は読み取り専用 (そこへ書くと、その後の op と並ばない) */
export function isReadOnlyCut(cut: Cut): boolean {
  return cut !== HEAD_CUT;
}

/** アドレスが指すものを projection するための op-log */
export type AddressLogs = {
  /** trunk の op-log (file_id = address.fileId) */
  trunk: Batch[];
  /**
   * branch のアドレスのときだけ: その branch と、branch 専用の op-log。
   * branch の解決 (id → 分岐点・branch 専用 file_id) は呼び出し側が trunk の畳み込みで行う
   */
  branch?: { branch: Branch; batches: Batch[] };
};

/**
 * アドレスが指す Sheet を求める。そのシートが (その切断面で) 無ければ undefined。
 *
 * - trunk: 切断面までの trunk を `projectFile` で畳み、そのシートを取る
 * - branch: 分岐点までの trunk に、切断面までの branch を重ねる (`branchSheet`)。
 *   シートのメタ (名前など) は切断面までの trunk のものを使う — branch は構造 op を
 *   持たない (`branchProjection` の冒頭)
 *
 * branch では分岐点と切断面の**両方**で trunk を切る。切断面が分岐点より前なら、
 * 「分岐する前の姿」になる
 */
export function projectAddress(
  address: GraphViewAddress,
  logs: AddressLogs,
): Sheet | undefined {
  const trunk = batchesWithin(logs.trunk, address.cut);
  const sheet = projectFile(trunk, address.fileId).sheets.find(
    (s) => s.id === address.sheetId,
  );
  if (sheet === undefined || address.branchId === null) return sheet;
  const resolved = logs.branch;
  if (resolved === undefined || resolved.branch.id !== address.branchId) {
    throw new Error(
      `projectAddress: branch ${address.branchId} の op-log が渡されていない`,
    );
  }
  // branchSheet が分岐点で切る。メタ (templateIds・properties も) は sheet から写す
  return branchSheet(
    resolved.branch,
    trunk,
    batchesWithin(resolved.batches, address.cut),
    sheet,
  );
}
