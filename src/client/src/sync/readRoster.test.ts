import { describe, expect, test } from 'bun:test';
import type {
  BatchId,
  Did,
  FileId,
  JudgmentBatch,
  JudgmentOp,
} from '@conversensus/shared';
import fc from 'fast-check';
import { type ReadRosterDeps, readRoster } from './readRoster';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const A = 'did:plc:alice';
const B = 'did:plc:bob';
const C = 'did:plc:carol';
const D = 'did:plc:dave';

let seq = 0;
const jb = (did: string, clock: number, ops: JudgmentOp[]): JudgmentBatch => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId,
  actor: `${did}#dev-1`,
  clock,
  timestamp: 0,
  ops,
});

const genesis = (): JudgmentOp => ({ kind: 'participation.genesis' });
const invite = (target: string): JudgmentOp => ({
  kind: 'participation.invite',
  target,
});
const accept = (inviter = A): JudgmentOp => ({
  kind: 'participation.accept',
  inviter,
});
const revoke = (target: string): JudgmentOp => ({
  kind: 'participation.revoke',
  target,
});

/**
 * 各 actor の repo にある判断ログ。**op は書いた本人の repo にしかない** —
 * これが「自分の repo だけでは名簿が作れない」ことの正体である
 */
function makeDeps(
  repos: Record<string, JudgmentBatch[]>,
  over: Partial<ReadRosterDeps> = {},
): ReadRosterDeps & { reads: Did[] } {
  const reads: Did[] = [];
  return {
    reads,
    fetchJudgments: async (_fileId, repo) => {
      reads.push(repo);
      return repos[repo] ?? [];
    },
    buildLocalDidPredicate: async () => () => true,
    ...over,
  };
}

describe('起点だけでは名簿が作れない', () => {
  test('承認は被招待者の repo にあるので、起点だけ読むと invited のまま', () => {
    // passes: 0 = 起点の repo だけ。被招待者が「本当に自分が招待されたか」を
    // 確かめる用途がこれである
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept()])],
    });
    return readRoster(deps, { fileId: FILE, seed: A, passes: 0 }).then((r) => {
      expect([...r.participation.participating]).toEqual([A]);
      expect([...r.participation.invited.keys()]).toEqual([B]);
      expect(deps.reads).toEqual([A]);
    });
  });

  test('1 パス広げると被招待者の承認が見える', async () => {
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept()])],
    });
    const r = await readRoster(deps, { fileId: FILE, seed: A });

    expect([...r.participation.participating].sort()).toEqual([A, B]);
    expect(r.participation.invited.size).toBe(0);
    expect(r.readRepos.sort()).toEqual([A, B]);
  });

  test('招待されただけで承認していない actor の repo も読む', async () => {
    // participating だけを広げると承認を永久に見つけられない
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [], // まだ承認していない
    });
    const r = await readRoster(deps, { fileId: FILE, seed: A });

    expect(deps.reads.sort()).toEqual([A, B]);
    expect([...r.participation.invited.keys()]).toEqual([B]);
  });
});

describe('1 パスで止める', () => {
  test('2 ホップ先の承認は見えない — 次のサイクルで追いつく', async () => {
    // A が B を招待し、B が C を招待し、C が承認した。
    // 1 パスでは C の repo を読まないので、C は invited のままである
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept()]), jb(B, 4, [invite(C)])],
      [C]: [jb(C, 5, [accept()])],
    });
    const r = await readRoster(deps, { fileId: FILE, seed: A });

    expect([...r.participation.participating].sort()).toEqual([A, B]);
    expect([...r.participation.invited.keys()]).toEqual([C]);
    expect(deps.reads).not.toContain(C);
  });

  test('パスを増やせば追いつく', async () => {
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept()]), jb(B, 4, [invite(C)])],
      [C]: [jb(C, 5, [accept()])],
    });
    const r = await readRoster(deps, { fileId: FILE, seed: A, passes: 2 });

    expect([...r.participation.participating].sort()).toEqual([A, B, C]);
  });

  test('広がりが止まれば残りのパスは走らない', async () => {
    const deps = makeDeps({ [A]: [jb(A, 1, [genesis()])] });
    await readRoster(deps, { fileId: FILE, seed: A, passes: 5 });
    // 起点しか居ないので 1 回読んで終わる
    expect(deps.reads).toEqual([A]);
  });

  test('読んだ判断 batch をそのまま返す — clock の seed に要る', async () => {
    // 呼び出し側が取り直すと二重に読むうえ、その間に増えた分とずれる
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept()])],
    });
    const r = await readRoster(deps, { fileId: FILE, seed: A });
    expect(r.batches.map((b) => b.clock).sort()).toEqual([1, 2, 3]);
  });

  test('同じ repo を 2 度読まない', async () => {
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept()])],
    });
    await readRoster(deps, { fileId: FILE, seed: A, passes: 3 });
    expect(deps.reads.sort()).toEqual([A, B]);
  });
});

describe('招待された側の起点', () => {
  test('自分の repo には承認しか無いので、承認が指す招待者を辿る', async () => {
    // **実機で発覚した穴。**起点を自分自身にすると、bob の repo には accept しか無く
    // genesis も invite も alice の repo にあるので辿る先が無い。accept の inviter が
    // 「自分 → 招待者」の辺になる
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept(A)])],
    });
    const r = await readRoster(deps, { fileId: FILE, seed: B });

    expect([...r.participation.participating].sort()).toEqual([A, B]);
    expect(deps.reads.sort()).toEqual([A, B]);
  });

  test('承認が pre 条件で捨てられても、招待者は辿る', async () => {
    // 起点が自分のとき、最初の畳み込みでは招待が見えないので承認は必ず捨てられる。
    // 畳み込みの結果から辿ると、そこで止まってしまう
    const deps = makeDeps({
      [B]: [jb(B, 3, [accept(A)])],
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
    });
    await readRoster(deps, { fileId: FILE, seed: B });
    expect(deps.reads).toContain(A);
  });
});

describe('起点は自分とは限らない', () => {
  test('被招待者は招待者の repo を起点にして、自分への招待を確かめられる', async () => {
    // 「読む資格は名簿への所属と独立」— B はまだ参加者でないのに A の repo を読む
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
    });
    const r = await readRoster(deps, { fileId: FILE, seed: A, passes: 0 });

    expect(r.participation.invited.get(B)).toBe(A);
  });

  test('起点と繋がっていない genesis は読まれない', async () => {
    // 自己申告でよい理由がこれである。D は勝手に genesis を宣言しているが、
    // A の名簿からは辿れないので存在しないのと同じ
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()])],
      [D]: [jb(D, 1, [genesis()])],
    });
    const r = await readRoster(deps, { fileId: FILE, seed: A });

    expect([...r.participation.participating]).toEqual([A]);
    expect(deps.reads).not.toContain(D);
  });
});

describe('読めない repo があっても名簿を返す', () => {
  test('失敗した repo は理由つきで返し、読めた範囲で畳む', async () => {
    // 相手の PDS が一時的に応答しないことは正常に起こる。黙って落とすと
    // 「招待したのに相手が参加者にならない」が理由不明のまま残る
    const deps = makeDeps(
      {
        [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      },
      {
        fetchJudgments: async (_f, repo) => {
          if (repo === B) throw new Error('offline');
          return [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])];
        },
      },
    );
    const r = await readRoster(deps, { fileId: FILE, seed: A });

    expect([...r.participation.participating]).toEqual([A]);
    expect(r.unreadable.map((u) => u.did)).toEqual([B]);
    expect(r.readRepos).toEqual([A]);
  });
});

describe('取り消しは広げた先で見つかる', () => {
  test('参加者が増えてから取り消しが見えることがある', async () => {
    // パスを増やしても参加者が単調に増えるとは限らない。広げた先に revoke があれば減る
    const deps = makeDeps({
      [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      [B]: [jb(B, 3, [accept()]), jb(B, 4, [invite(C)])],
      [C]: [jb(C, 5, [accept()]), jb(C, 6, [revoke(B)])],
    });
    const onePass = await readRoster(deps, { fileId: FILE, seed: A });
    expect([...onePass.participation.participating].sort()).toEqual([A, B]);

    const twoPass = await readRoster(
      makeDeps({
        [A]: [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
        [B]: [jb(B, 3, [accept()]), jb(B, 4, [invite(C)])],
        [C]: [jb(C, 5, [accept()]), jb(C, 6, [revoke(B)])],
      }),
      { fileId: FILE, seed: A, passes: 2 },
    );
    // C が B を取り消したので B は外れる。**パス数を増やすと参加者は減りうる**
    expect([...twoPass.participation.participating].sort()).toEqual([A, C]);
  });
});

describe('離脱した actor の repo も読む (step2 Phase 2, 実機で発覚)', () => {
  test('取り消した後も, 相手が参加していた事実が名簿に残る', async () => {
    // A が B を取り消すと B は participating からも invited からも外れる。
    // **B の repo を訪ねなくなると, B の承認が二度と見えなくなる** —
    // 名簿は「依頼されたが承認せずに取り消された人」を見ることになり、
    // 仕様の「その依頼はなかったものとする」で **B が一覧から消える**
    const deps = makeDeps({
      [A]: [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(A, 4, [revoke(B)]),
      ],
      [B]: [jb(B, 3, [accept()])],
    });
    const result = await readRoster(deps, { fileId: FILE, seed: A });

    expect(deps.reads).toContain(B); // 離脱者の repo を訪ねる
    expect(result.participation.departed.get(B)).toBe('revoked');
    // 参加履歴に**承認が載っている**ことが要点。これが無いと
    // `hasEverParticipated` が false になり、一覧から行ごと消える
    expect(result.participation.history.get(B)?.map((e) => e.kind)).toEqual([
      'invite',
      'accept',
      'revoke',
    ]);
  });

  test('依頼のまま取り消された人は, 訪ねても参加歴を持たない', async () => {
    // 離脱者を訪ねるようにしても、承認していない人が participating に化けたりしない
    const deps = makeDeps({
      [A]: [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(A, 3, [revoke(B)]),
      ],
      [B]: [],
    });
    const result = await readRoster(deps, { fileId: FILE, seed: A });

    expect(result.participation.history.get(B)?.map((e) => e.kind)).toEqual([
      'invite',
      'revoke',
    ]);
    expect(result.participation.participating.has(B)).toBe(false);
  });
});

describe('性質', () => {
  test('∀ repo の応答順. 同じ名簿になる', async () => {
    // 読みは並行なので完了順は毎回違う。名簿が読む順序で変わってはならない
    const repos: Record<string, JudgmentBatch[]> = {
      [A]: [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(A, 3, [invite(C)]),
      ],
      [B]: [jb(B, 4, [accept()])],
      [C]: [jb(C, 5, [accept()])],
    };

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 30 }), {
          minLength: 3,
          maxLength: 3,
        }),
        async (delays) => {
          const order = [A, B, C];
          const deps: ReadRosterDeps = {
            fetchJudgments: async (_f, repo) => {
              // repo ごとに違う遅延を入れて完了順を入れ替える
              const i = order.indexOf(repo);
              await new Promise((r) => setTimeout(r, delays[i] ?? 0));
              return repos[repo] ?? [];
            },
            buildLocalDidPredicate: async () => () => true,
          };
          const r = await readRoster(deps, { fileId: FILE, seed: A });
          expect([...r.participation.participating].sort()).toEqual([A, B, C]);
          expect(r.readRepos).toEqual([A, B, C]); // did 順に整列して畳む
        },
      ),
      { numRuns: 20 },
    );
  });
});
