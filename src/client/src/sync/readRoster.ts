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
 *
 * **⚠️ 起点の repo だけでは名簿にならない** (2026-09-05 実機で発覚)。**招待者が File の
 * 起点 (genesis) とは限らない** — 参加した人は誰でも招待できる。招待者の repo には
 * genesis も、その人自身への招待も無いので、そこだけを読むと名簿は空になり、
 * **その repo にある招待は残らず `issuerNotParticipating` で捨てられる**。被招待者は
 * 「依頼が見つからない」と言われて参加できない。招待の実在を確かめるときは
 * `passes: 'converge'` で genesis に届くまで広げること。
 */

import {
  collectInviteTargets,
  type Did,
  didFromActor,
  type FileId,
  findFounder,
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
   *
   * `'converge'` にすると**広がりが止まるまで回す**。同期サイクルはこれを使わない
   * (ラウンドトリップが名簿の深さに比例する) が、**被招待者が招待の実在を確かめる
   * ときは要る** — 招待者が File の起点とは限らず、起点の repo だけでは genesis に
   * 届かないからである (下記)。
   */
  passes?: number | 'converge';
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
  /**
   * 上限 (`MAX_ROSTER_REPOS`) を超えたので読まなかった repo。名簿は数十人の前提なので、
   * 超えるのは異常か悪意である。黙って落とさず返す (security review, 受信の量)
   */
  skipped: Did[];
};

/**
 * 名簿で読みに行く repo の総数の上限 (security review, 受信の量)。名簿は数十人の前提
 * (下の `reposToExpand`) で、離脱者が溜まっても十分に収まる
 * (値を変えたら `deepse/requirements/limits.md` も直す)
 */
export const MAX_ROSTER_REPOS = 500;

/**
 * 1 人の承認から辿る招待者の数の上限。承認は自分の repo に自分で書くので、書き手は任意の
 * 数の `inviter` を並べられる (読みに行く先を水増しできる)。本物は抜けて戻るたびに 1 つ
 */
export const MAX_INVITERS_PER_ACTOR = 10;

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
 *
 * **⚠️ 離脱した actor も足りない** (step2 Phase 2, 実機で発覚)。取り消すと相手は
 * participating からも invited からも外れるので、次の読みでその repo を訪ねなくなる。
 * するとその actor の**承認 op が二度と見えなくなり**、名簿は「依頼されたが承認せずに
 * 取り消された人」を見ることになる。仕様はそれを「その依頼はなかったものとする」と
 * 定めているので、**一度参加した人が一覧から消える**。
 *
 * 参加履歴も同じところで失われる。履歴は畳み込みが持つが、畳み込みの入力にその人の
 * 承認が無ければ、履歴にも参加が載らない。
 *
 * 読む repo は離脱者の分だけ増える。名簿は数十人という前提なので許容するが、
 * **離脱者は減らない**ので、参加者が入れ替わり続ける File では効いてくる。
 */
function reposToExpand(
  participation: Participation,
  batches: readonly JudgmentBatch[],
): Set<Did> {
  const next = new Set<Did>([
    ...participation.participating,
    ...participation.invited.keys(),
    ...participation.departed.keys(),
  ]);
  // 承認の招待者は書き手ごとに数を限る。並びは読んだ順 (repo ごとに clock 順) で決まる
  const invitersOf = new Map<string, Set<Did>>();
  for (const batch of batches) {
    const author = didFromActor(batch.actor);
    const seen = invitersOf.get(author) ?? new Set<Did>();
    invitersOf.set(author, seen);
    for (const op of batch.ops) {
      if (op.kind !== 'participation.accept') continue;
      if (!seen.has(op.inviter) && seen.size >= MAX_INVITERS_PER_ACTOR)
        continue;
      seen.add(op.inviter);
      next.add(op.inviter);
    }
  }
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

  const skipped: Did[] = [];

  const readAll = async (dids: Iterable<Did>) => {
    // 上限まで読む。並びは DID の順 (読む順序で名簿が変わらないため)
    const fresh = [...dids].filter((did) => !visited.has(did)).sort();
    const room = Math.max(0, MAX_ROSTER_REPOS - visited.size);
    const targets = fresh.slice(0, room);
    for (const did of fresh.slice(room))
      if (!skipped.includes(did)) skipped.push(did);
    for (const did of targets) visited.add(did);
    const results = await Promise.all(
      targets.map(async (did) => {
        try {
          // **その repo の持ち主が書いた判断だけを採る** (security review H2)。ATProto が
          // 保証するのは「repo の中身はその DID が書いた」ことだけで、batch の actor は
          // 書き手が自由に名乗れる。照合しないと、他人の名前で取り消しや招待を書ける
          const own = (await deps.fetchJudgments(fileId, did)).filter(
            (b) => didFromActor(b.actor) === did,
          );
          return { did, batches: own };
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

  // 創設者は起点から招待の鎖を辿って決める (H2)。鎖の先がまだ読めていなければ null で、
  // どの起点も採らない — 起点が見えていないときと同じ扱いになる
  const fold = async (): Promise<Participation> =>
    foldParticipation(batches, {
      isLocalDid: await deps.buildLocalDidPredicate(
        collectInviteTargets(batches),
      ),
      founder: findFounder(batches, seed),
    });

  await readAll([seed]);
  let participation = await fold();

  // `'converge'` は「広がりが止まるまで」。下の break が必ず効く —
  // 広げる先は読んだ batch に現れた DID だけで、visited は単調に増えるからである
  const limit = passes === 'converge' ? Number.POSITIVE_INFINITY : passes;
  for (let pass = 0; pass < limit; pass += 1) {
    const next = reposToExpand(participation, batches);
    // 広がりが止まった (上限で読まなかった repo は、もう読まない)
    if ([...next].every((did) => visited.has(did) || skipped.includes(did)))
      break;
    await readAll(next);
    participation = await fold();
  }

  if (skipped.length > 0)
    console.warn(
      `[roster] ${fileId}: 読む repo が上限 (${MAX_ROSTER_REPOS}) を超えたので ${skipped.length} 件を読まなかった`,
    );
  return { participation, batches, readRepos, unreadable, skipped };
}
