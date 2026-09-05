/**
 * 参加依頼を書く前に、通る分と通らない分を仕分ける (step2)
 *
 * 仕様: `deepse/requirements/spec/participation.md`
 * 「依頼相手が見つからなかったり, すでに参加中であったりする場合には, その旨をダイアログで知らせる」
 *
 * **書いても畳み込みが捨てるものを書かない。**見つからないハンドル、既に参加している人、
 * 別の PDS のアカウントは、判断ログに書いたところで pre 条件で落ちる。捨てられると
 * 分かっているものを書かず、その場で理由を返す。
 *
 * **通る分は書く。**5 人中 1 人が見つからないときに 4 人分を捨てると打ち直しになる。
 * 仕分けであって、可否の判定ではない。
 *
 * 依頼を出す UI から切り離してあるのは、**ネットワークの口を差し替えて確かめられる
 * ようにする**ためである (hook は具体のモジュールを直接束ねているので単体で触れない)。
 */

import type { Did } from '@conversensus/shared';

export type PlanInvitationsDeps = {
  /** ハンドル名から DID を引く。解決できなければ `null` */
  resolveHandle: (handle: string) => Promise<Did | null>;
  /** その DID がこの PDS に属するか */
  isLocalDid: (did: Did) => Promise<boolean>;
  /** その DID が既に参加者か。名簿から見る (ネットワークは要らない) */
  isParticipating: (did: Did) => boolean;
  /**
   * 依頼を出す本人の DID。**自分自身への依頼を止めるために要る。**
   *
   * `isParticipating` では止まらない — **自分が離脱中のときに素通りする**。
   * 畳み込みは自分への依頼を必ず捨てるが (参加中なら `targetAlreadyParticipating`、
   * 離脱中なら `issuerNotParticipating`)、捨てられた op は判断ログに永久に残る
   * (2026-09-05 実機で 1 件書かれた)。
   */
  viewer: Did;
};

export type InvitationPlan = {
  /** 依頼を書く相手 */
  targets: Did[];
  /** 書かなかった相手と理由。**そのまま画面に出せる文にする** */
  problems: string[];
};

export async function planInvitations(
  deps: PlanInvitationsDeps,
  handles: readonly string[],
): Promise<InvitationPlan> {
  // 同じハンドルを 2 度書いても畳み込みの結果は同じだが、op が無駄に増える
  const unique = [...new Set(handles.map((h) => h.trim()).filter(Boolean))];
  const resolved = await Promise.all(
    unique.map(
      async (handle) => [handle, await deps.resolveHandle(handle)] as const,
    ),
  );

  const targets: Did[] = [];
  const problems: string[] = [];
  for (const [handle, did] of resolved) {
    if (!did) {
      problems.push(`${handle} は見つからない`);
      continue;
    }
    if (did === deps.viewer) {
      // **参加中かどうかの前に見る。**離脱中の自分は `isParticipating` を抜ける
      problems.push(`${handle} は自分自身である`);
      continue;
    }
    if (deps.isParticipating(did)) {
      problems.push(`${handle} は既に参加している`);
      continue;
    }
    if (!(await deps.isLocalDid(did))) {
      // 仕様は他 PDS のアカウントへの依頼を「やらない」ではなく**「無効とする」**と
      // 定めている。畳み込みも同じ判定をする (`targetForeignPds`) が、
      // ここで止めれば「なぜ相手が一覧に出ないのか」が画面に出る
      problems.push(`${handle} は別の PDS のアカウントである`);
      continue;
    }
    // **既に依頼済でも通す。**参加コードの再発行は正当な操作で、畳み込みも
    // 「既に招待済でも捨てない」と決めている (依頼者を上書きする)
    targets.push(did);
  }
  return { targets, problems };
}
