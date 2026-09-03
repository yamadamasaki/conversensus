/**
 * 名簿の読み出し (step2 Phase 1)
 *
 * 設計: `deepse/plans/step2-phase1-participation.md` §6
 * アーキテクチャ: `deepse/architecture/step2.md` §2「名簿の読み出しは不動点計算になる」
 *
 * **名簿は自分の repo だけでは作れない。**「a が a' を招待した」op は a の repo にあり、
 * 「a' が承認した」op は a' の repo にある。誰の repo を読むかは名簿が決めるが、
 * その名簿は読んだ結果で決まる — **不動点計算**である。
 *
 * 素朴に書くと回り続けるので **既定は 1 パス**とする。名簿の食い違いは正常な状態であり
 * (仕様の決定)、収束を待つ必要が無い。1 パスで止めると「1 ホップ先の招待までは見えるが、
 * その先はまだ見えない」状態になるが、それは「まだ同期していない」と同じことで、
 * 次のサイクルで追いつく。収束まで回すとラウンドトリップが**名簿の深さに比例**する。
 *
 * **起点 (seed) が要る。**不動点は初期値を決めなければ定まらない。
 *
 *   - 既に参加している File: 起点は**自分自身**
 *   - まだ参加していない File: 起点は**参加コードが指す招待者**
 *     (「読む資格は名簿への所属と独立」— 被招待者は参加者でないのに招待者の repo を読む)
 */

import {
  collectInviteTargets,
  type Did,
  type FileId,
  foldParticipation,
  type JudgmentBatch,
  type Participation,
} from '@conversensus/shared';

export type ReadRosterDeps = {
  /** その repo の、その File の判断ログを読む */
  fetchJudgments: (fileId: FileId, repo: Did) => Promise<JudgmentBatch[]>;
  /** 招待先の DID の PDS 所属をまとめて解決し、同期の述語にする */
  buildLocalDidPredicate: (
    dids: Iterable<Did>,
  ) => Promise<(did: Did) => boolean>;
};

export type ReadRosterOptions = {
  fileId: FileId;
  /** 不動点計算の起点。自分自身、または参加コードが指す招待者 */
  seed: Did;
  /**
   * 起点の後に何回広げるか。**既定は 1**。
   * 0 にすると起点の repo だけを読む (被招待者が招待の実在を確かめる用途)。
   */
  passes?: number;
};

export type ReadRosterResult = {
  participation: Participation;
  /**
   * 読み込んだ判断 batch そのもの。
   *
   * **clock の seed に要る** — 次に判断を書くとき、判断ログの最大 clock まで引き上げて
   * から発番しないとグラフ側の clock と衝突する (`appendJudgment`)。呼び出し側が
   * 取り直すと二重に読むうえ、その間に増えた分とずれる。
   */
  batches: JudgmentBatch[];
  /** 実際に読んだ repo */
  readRepos: Did[];
  /**
   * 読めなかった repo と理由。
   *
   * **失敗で名簿全体を落とさない。**相手の PDS が一時的に応答しないことは正常に起こり、
   * そのとき「読めた範囲の名簿」は依然として意味を持つ。ただし黙って落とすと
   * 「招待したのに相手が参加者にならない」が理由不明のまま残るので、返して見せる。
   */
  unreadable: { did: Did; error: unknown }[];
};

/**
 * 次に読むべき repo の集合。
 *
 * **participating だけでは足りない。**招待された actor の「承認」op はその actor 自身の
 * repo にあるので、承認を見つけるには**まだ参加していない被招待者の repo も読む**必要が
 * ある。読んでみて承認が無ければ、その actor は invited のままである。
 *
 * **承認が指す招待者も足りない。**招待された側が自分を起点にすると、自分の repo には
 * 承認しか無く、genesis も invite も招待者の repo にあるので**辿る先が無い**
 * (実機で発覚)。`accept` が持つ `inviter` が「自分 → 招待者」の辺になる。
 * これは**畳み込みの結果ではなく生の op から取る** — 承認が pre 条件で捨てられる場合
 * (まだ招待が見えていない場合がまさにそれである) でも、読みには行かなければならない。
 */
function reposToExpand(
  participation: Participation,
  batches: readonly JudgmentBatch[],
): Set<Did> {
  const next = new Set<Did>([
    ...participation.participating,
    ...participation.invited.keys(),
  ]);
  for (const batch of batches)
    for (const op of batch.ops)
      if (op.kind === 'participation.accept') next.add(op.inviter);
  return next;
}

export async function readRoster(
  deps: ReadRosterDeps,
  { fileId, seed, passes = 1 }: ReadRosterOptions,
): Promise<ReadRosterResult> {
  const batches: JudgmentBatch[] = [];
  const readRepos: Did[] = [];
  const unreadable: { did: Did; error: unknown }[] = [];
  const visited = new Set<Did>();

  const readAll = async (dids: Iterable<Did>) => {
    const targets = [...dids].filter((did) => !visited.has(did));
    for (const did of targets) visited.add(did);
    const results = await Promise.all(
      targets.map(async (did) => {
        try {
          return { did, batches: await deps.fetchJudgments(fileId, did) };
        } catch (error) {
          return { did, error };
        }
      }),
    );
    // **結果を did で並べ直してから畳む。**`Promise.all` は入力順を保つが、
    // 呼び出し側が渡す集合の反復順に依存させない — 名簿は読む順序で変わってはならない
    for (const r of results.sort((a, b) => a.did.localeCompare(b.did))) {
      if ('error' in r) {
        unreadable.push({ did: r.did, error: r.error });
        continue;
      }
      readRepos.push(r.did);
      batches.push(...r.batches);
    }
  };

  const fold = async (): Promise<Participation> =>
    foldParticipation(batches, {
      isLocalDid: await deps.buildLocalDidPredicate(
        collectInviteTargets(batches),
      ),
    });

  await readAll([seed]);
  let participation = await fold();

  for (let pass = 0; pass < passes; pass += 1) {
    const next = reposToExpand(participation, batches);
    if ([...next].every((did) => visited.has(did))) break; // 広がりが止まった
    await readAll(next);
    participation = await fold();
  }

  return { participation, batches, readRepos, unreadable };
}
