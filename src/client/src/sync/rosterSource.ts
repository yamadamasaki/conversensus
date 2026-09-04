/**
 * rosterSource: File 単位の名簿の供給元 (step2 Phase 2 S1)
 *
 * 設計: `deepse/plans/step2-phase2-sync.md` §2
 *
 * Phase 1 では名簿を読むのはダイアログだけで、`useParticipation` が読み方 (起点は自分・
 * 起点が無ければ置いて読み直す) を抱えていた。**Phase 2 は同期の 1 サイクルごとに名簿を
 * 要る** — 「読む順序は名簿 → グラフに固定される」(アーキテクチャ §2) ので、グラフを
 * 取りに行く前に必ずここを通る。読み方が 2 箇所に分かれると、片方だけが起点の修復を
 * するような食い違いが生まれるので、**読み方をこのモジュール 1 つに閉じる**。
 *
 * ## 毎回読む。TTL は持たない
 *
 * 「N 秒は読み直さない」形のキャッシュにはしない。名簿が変わったことを知る手段は読むこと
 * 以外に無いので、TTL は**「相手の参加が見えるまでの遅れ」を根拠の無い定数で決めてしまう**。
 * その遅れを決めるのは同期の間隔 (S4) であって、その内側にもう 1 つ時定数を作らない。
 *
 * 代わりに**同時に走った読みは 1 回に畳む** (in-flight dedup)。同期サイクルの最中に
 * ダイアログが開く場面は普通に起きるが、そこで 2 回読む理由は無い。
 *
 * **ただし書き込みの直後は畳んではならない** (`readFresh`)。判断ログを書いた直後に
 * 進行中の読みへ相乗りすると、書く前の名簿が返る — ダイアログは「依頼したのに表に
 * 出ない」を見ることになる。
 *
 * ## 起点の修復もここでやる
 *
 * 起点 (`participation.genesis`) が無い File では、依頼が 1 件残らず
 * `issuerNotParticipating` で捨てられ、名簿が永久に空になる (Phase 1 で実機発覚)。
 * `ensureOwnGenesis` は「自分だけで書かれた File なら起点は自分にある」と判断して
 * その場で置く。**読みの一部として扱う** — 同期サイクルだけが名簿を読む File
 * (ダイアログを開いていない File) でも修復が要るからである。
 */

import type { Did, FileId } from '@conversensus/shared';
import type { ReadRosterOptions, ReadRosterResult } from './readRoster';

export type RosterSourceDeps = {
  /** 名簿を読む (`judgmentStore.loadRoster`) */
  loadRoster: (options: ReadRosterOptions) => Promise<ReadRosterResult>;
  /**
   * 起点が無ければ置く。置いたら `true` (呼び出し側は読み直す)。
   * いま読んだ判断ログを渡す — ここで読み直すと増えた分とずれる。
   */
  ensureOwnGenesis: (
    fileId: FileId,
    known: ReadRosterResult['batches'],
  ) => Promise<boolean>;
  /** この端末の DID。**不動点計算の起点になる** (既に参加している File を見るため) */
  viewer: Did;
};

export type RosterSource = {
  /**
   * その File の名簿を読む。**毎回 remote を読む**が、進行中の読みがあれば相乗りする。
   *
   * 失敗は投げる — 名簿が読めないことと名簿が空であることは違うので、握り潰さない。
   */
  read: (fileId: FileId) => Promise<ReadRosterResult>;
  /**
   * 進行中の読みに相乗りせず、**必ず新しく読む**。
   *
   * 判断ログを書いた直後の呼び出し用である。相乗りすると書く前の名簿が返る。
   */
  readFresh: (fileId: FileId) => Promise<ReadRosterResult>;
};

export function createRosterSource(deps: RosterSourceDeps): RosterSource {
  /** 進行中の読み。File ごとに最新の 1 本を持つ */
  const inFlight = new Map<FileId, Promise<ReadRosterResult>>();

  const readOnce = async (fileId: FileId): Promise<ReadRosterResult> => {
    let result = await deps.loadRoster({ fileId, seed: deps.viewer });
    // 起点が無ければ置いてから畳み直す。置けなければ (自分だけの File でなければ)
    // そのまま — 起点は他の参加者の repo にあるはずで、そちらから見える
    if (await deps.ensureOwnGenesis(fileId, result.batches))
      result = await deps.loadRoster({ fileId, seed: deps.viewer });
    return result;
  };

  const start = (fileId: FileId): Promise<ReadRosterResult> => {
    // **失敗した読みを残さない。**残すと次の呼び出しが同じ失敗を受け取り続ける。
    // 自分が最新のときだけ外す — `readFresh` が後から入れた読みを消さないため
    const started = readOnce(fileId).finally(() => {
      if (inFlight.get(fileId) === started) inFlight.delete(fileId);
    });
    inFlight.set(fileId, started);
    return started;
  };

  return {
    read: (fileId) => inFlight.get(fileId) ?? start(fileId),
    readFresh: start,
  };
}
