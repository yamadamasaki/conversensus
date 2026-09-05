import { describe, expect, test } from 'bun:test';
import {
  type BatchId,
  foldParticipation,
  type JudgmentBatch,
  type JudgmentOp,
} from '@conversensus/shared';
import {
  actionLabel,
  describeRejected,
  fileSharing,
  rosterDids,
  rosterRows,
  sortRowsByLabel,
} from './rosterView';

const A = 'did:plc:alice';
const B = 'did:plc:bob';
const C = 'did:plc:carol';

const deps = { isLocalDid: () => true };

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
const resign = (): JudgmentOp => ({ kind: 'participation.resign' });
const revoke = (target: string): JudgmentOp => ({
  kind: 'participation.revoke',
  target,
});

const view = (batches: JudgmentBatch[], viewer: string) =>
  rosterRows(foldParticipation(batches, deps), viewer);

const rowOf = (rows: ReturnType<typeof rosterRows>, did: string) =>
  rows.find((r) => r.did === did);

describe('状態', () => {
  test('招待済は sent、承認済は accepted', () => {
    const rows = view(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(A, 3, [invite(C)]),
        jb(B, 4, [accept()]),
      ],
      A,
    );
    expect(rowOf(rows, B)?.status).toBe('accepted');
    expect(rowOf(rows, C)?.status).toBe('sent');
    expect(rowOf(rows, A)?.status).toBe('accepted');
  });

  test('取り消しは revoked、自分から降りたのは resigned', () => {
    const rows = view(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(A, 4, [invite(C)]),
        jb(C, 5, [accept()]),
        jb(A, 6, [revoke(B)]),
        jb(C, 7, [resign()]),
      ],
      A,
    );
    expect(rowOf(rows, B)?.status).toBe('revoked');
    expect(rowOf(rows, C)?.status).toBe('resigned');
  });

  test('招待されていない actor の承認は invalid として出る', () => {
    // 名簿の participating にも invited にも現れない。捨てた op と理由を返している
    // のは、この 1 行を出すためである
    const rows = view([jb(A, 1, [genesis()]), jb(C, 2, [accept()])], A);
    expect(rowOf(rows, C)?.status).toBe('invalid');
  });

  test('invalid は後から正規に招待されたら上書きしない', () => {
    const rows = view(
      [jb(A, 1, [genesis()]), jb(C, 2, [accept()]), jb(A, 3, [invite(C)])],
      A,
    );
    expect(rowOf(rows, C)?.status).toBe('sent');
  });

  test('他 PDS への招待は一覧に載せない', () => {
    // 名簿に関わったことが一度も無い。承認だけを invalid にするのは、
    // 「その人が参加しようとした」事実が本人にも招待者にも見えるべきだからである
    const rows = rosterRows(
      foldParticipation(
        [jb(A, 1, [genesis()]), jb(A, 2, [invite('did:plc:elsewhere')])],
        { isLocalDid: (d) => d !== 'did:plc:elsewhere' },
      ),
      A,
    );
    expect(rows.map((r) => r.did)).toEqual([A]);
  });

  test('招待者を出す — 作成者には招待者が無い', () => {
    const rows = view([jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])], A);
    expect(rowOf(rows, B)?.inviter).toBe(A);
    expect(rowOf(rows, A)?.inviter).toBeUndefined();
  });
});

describe('action は立場で決まる', () => {
  const batches = [
    jb(A, 1, [genesis()]),
    jb(A, 2, [invite(B)]),
    jb(B, 3, [accept()]),
    jb(A, 4, [invite(C)]),
  ];

  test('招待された本人は覗いて承認できる', () => {
    expect(rowOf(view(batches, C), C)?.available).toEqual([
      'preview',
      'accept',
    ]);
  });

  test('他人は、招待された行を承認できない', () => {
    expect(rowOf(view(batches, A), C)?.available).toEqual(['revoke']);
  });

  test('参加している本人は降りられるが、取り消しはできない', () => {
    // 自分を revoke するのは resign と同じことなので、action を二重に出さない
    expect(rowOf(view(batches, B), B)?.available).toEqual(['resign']);
  });

  test('参加者は他人を取り消せる', () => {
    expect(rowOf(view(batches, B), C)?.available).toEqual(['revoke']);
  });

  test('参加していない viewer は他人に何もできない', () => {
    // pre 条件と同じ条件でグレイアウトする。押せてしまって畳み込みで捨てられるより、
    // 押せない方がよい
    expect(rowOf(view(batches, C), B)?.available).toEqual([]);
  });

  test('外れた人はもう一度呼べる', () => {
    // 畳み込みは既にこれを許している — `invite` の pre は「対象が参加者でないこと」
    // であって「未依頼」ではない
    const rows = view([...batches, jb(A, 5, [revoke(B)])], A);
    expect(rowOf(rows, B)?.status).toBe('revoked');
    expect(rowOf(rows, B)?.available).toEqual(['reinvite']);
  });

  test('離脱した自分を自分で呼び戻すことはできない', () => {
    // 参加者でなければ依頼を出せない。押せてしまって畳み込みで捨てられるより,
    // 押せない方がよい
    const rows = view([...batches, jb(A, 5, [revoke(B)])], B);
    expect(rowOf(rows, B)?.available).toEqual([]);
  });

  test('参加していない viewer は外れた人を呼べない', () => {
    const rows = view([...batches, jb(A, 5, [revoke(B)])], C);
    expect(rowOf(rows, B)?.available).toEqual([]);
  });
});

describe('操作の文言は状態で変わる', () => {
  test('同じ revoke でも, 依頼中なら「依頼キャンセル」参加中なら「参加取りやめ」', () => {
    // 仕様が「承認の前後を問わず同じ取り消しとして扱う」と定めているので op は
    // 1 つしかない。見え分かれるのは文言だけである
    expect(actionLabel('revoke', 'sent')).toBe('依頼キャンセル');
    expect(actionLabel('revoke', 'accepted')).toBe('参加取りやめ');
  });

  test('自分で辞めるときも文言は「参加取りやめ」', () => {
    // 仕様「自分で辞めたか, 辞めさせられたかは問わない」。
    // 誰がやったかは参加履歴に出る
    expect(actionLabel('resign', 'accepted')).toBe('参加取りやめ');
  });
});

describe('依頼のまま取り消された人', () => {
  test('参加歴が無ければ一覧に出さない', () => {
    // 仕様「その依頼はなかったものとする」。名簿に一度も載ったことが無い人を
    // 「離脱中」として並べると, 依頼を取り消すたびに一覧が伸びていく
    const rows = view(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(A, 3, [revoke(B)])],
      A,
    );
    expect(rows.map((r) => r.did)).toEqual([A]);
  });

  test('参加歴があれば離脱中として出す', () => {
    const rows = view(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(B, 4, [resign()]),
        jb(A, 5, [invite(B)]),
        jb(A, 6, [revoke(B)]),
      ],
      A,
    );
    expect(rowOf(rows, B)?.status).toBe('revoked');
  });
});

describe('並び', () => {
  test('DID 順に並ぶ — 表示が読むたびに入れ替わらない', () => {
    const rows = view(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(C)]), jb(A, 3, [invite(B)])],
      A,
    );
    expect(rows.map((r) => r.did)).toEqual([A, B, C]);
  });
});

describe('表示名 — 記録は DID, 画面はハンドル名', () => {
  const HANDLE: Record<string, string> = {
    [A]: 'zoe.test',
    [B]: 'bob.test',
    [C]: 'carol.test',
  };
  const labelOf = (did: string) => HANDLE[did] ?? did;

  test('rosterDids は行に出る DID を残らず集める', () => {
    // **行から集める。**名簿から集め直すと、行を組む条件と食い違ったときに
    // 「表には出ているのに名前が引かれていない」DID が生まれる
    const rows = rosterRows(
      foldParticipation(
        [
          jb(A, 1, [{ kind: 'participation.genesis' }]),
          jb(A, 2, [{ kind: 'participation.invite', target: B }]),
        ],
        deps,
      ),
      A,
    );
    expect(new Set(rosterDids(rows))).toEqual(new Set([A, B]));
  });

  test('rosterDids は行に出ない DID を集めない', () => {
    const rows = rosterRows(
      foldParticipation([jb(A, 1, [{ kind: 'participation.genesis' }])], deps),
      A,
    );
    expect(rosterDids(rows)).toEqual([A]);
  });

  test('ハンドル名で並べ替える (DID 順とは違う)', () => {
    // A の DID は alice で最小だが、ハンドル名は zoe.test なので最後に来る
    const rows = rosterRows(
      foldParticipation(
        [
          jb(A, 1, [{ kind: 'participation.genesis' }]),
          jb(A, 2, [{ kind: 'participation.invite', target: B }]),
        ],
        deps,
      ),
      A,
    );
    expect(rows.map((r) => r.did)).toEqual([A, B]);
    expect(sortRowsByLabel(rows, labelOf).map((r) => r.did)).toEqual([B, A]);
  });

  test('名前が引けなかった行は DID で並ぶ', () => {
    // `labelOf` が DID をそのまま返すので、その行は DID の文字列として並ぶ
    // (`did:plc:alice` は `bob.test` より後)。順序が乱れることより、
    // **引けるまで順序が決まらない状態を作らないこと**を採る
    const rows = rosterRows(
      foldParticipation(
        [
          jb(A, 1, [{ kind: 'participation.genesis' }]),
          jb(A, 2, [{ kind: 'participation.invite', target: B }]),
        ],
        deps,
      ),
      A,
    );
    const sorted = sortRowsByLabel(rows, (did) =>
      did === B ? 'bob.test' : did,
    );
    expect(sorted.map((r) => r.did)).toEqual([B, A]);
  });
});

describe('File の共有状態 (step2 Phase 2, 2026-09-05 実機で発覚)', () => {
  const sharingOf = (batches: JudgmentBatch[], viewer: string) =>
    fileSharing(foldParticipation(batches, deps), viewer);

  test('誰とも共有していない File', () => {
    const s = sharingOf([jb(A, 1, [genesis()])], A);
    expect(s).toEqual({
      participants: 1,
      viewerParticipates: true,
      isDetached: false,
    });
  });

  test('共有中の File は人数が分かる', () => {
    const s = sharingOf(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(B, 3, [accept()])],
      A,
    );
    expect(s.participants).toBe(2);
    expect(s.isDetached).toBe(false);
  });

  test('取り消された側は「共有が切れている」', () => {
    // **File は手元に残る**が、以後ほかの参加者の編集は届かない。
    // 何も出さないと、もう同期されない File が普通の File に見える
    const batches = [
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(A, 4, [revoke(B)]),
    ];
    expect(sharingOf(batches, B).isDetached).toBe(true);
    // 残った側は切れていない
    expect(sharingOf(batches, A).isDetached).toBe(false);
  });

  test('自分で降りた場合も同じ扱いになる', () => {
    // 「自分で辞めたか, 辞めさせられたかは問わない」(仕様)
    const batches = [
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(B, 4, [resign()]),
    ];
    expect(sharingOf(batches, B).isDetached).toBe(true);
  });

  test('⚠️ 名簿が空の File は「切れている」に数えない', () => {
    // 起点 (genesis) の無い古い File では誰も参加者にならない。これを切れている
    // 扱いにすると、**共有と無関係な File にまで「同期していません」が出る**
    const s = sharingOf([], A);
    expect(s.participants).toBe(0);
    expect(s.viewerParticipates).toBe(false);
    expect(s.isDetached).toBe(false);
  });
});

describe('引き取り — 誰も参加していないときだけ出る', () => {
  /** 最後の 1 人が降りて名簿が空になった状態 */
  const abandoned = () => [
    jb(A, 1, [genesis()]),
    jb(A, 2, [invite(B)]),
    jb(B, 3, [accept()]),
    jb(B, 4, [revoke(A)]),
    jb(B, 5, [resign()]),
  ];

  test('名簿が空なら, 自分の行に引き取りが出る', () => {
    const rows = view(abandoned(), A);
    expect(rowOf(rows, A)?.available).toEqual(['reopen']);
  });

  test('自分で降りた人にも出る — 取り消されたかどうかは問わない', () => {
    const rows = view(abandoned(), B);
    expect(rowOf(rows, B)?.available).toEqual(['reopen']);
  });

  test('⚠️ 誰かが参加していれば出ない', () => {
    // 押せてしまって畳み込みで捨てられるより, 押せない方がよい (pre 条件と同じ条件)
    const rows = view(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(A, 4, [revoke(B)]),
      ],
      B,
    );
    expect(rowOf(rows, B)?.available).toEqual([]);
  });

  test('他人の行には出ない — 引き取るのは常に自分である', () => {
    const rows = view(abandoned(), A);
    expect(rowOf(rows, B)?.available).toEqual([]);
  });

  test('文言', () => {
    expect(actionLabel('reopen', 'resigned')).toBe('この File を引き取る');
  });
});

describe('捨てられた判断の知らせ', () => {
  /** 自分を招待した (必ず捨てられる) batch を 1 つ書いた状態を作る */
  const withSelfInvite = () => {
    const mine = jb(A, 5, [invite(A)]);
    const batches = [
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(B, 4, [revoke(A)]),
      mine,
    ];
    return { mine, rejected: foldParticipation(batches, deps).rejected };
  };

  test('いま書いた batch が捨てられたら知らせる', () => {
    const { mine, rejected } = withSelfInvite();
    expect(describeRejected(rejected, mine.id)).toBe(
      'いまの操作は名簿に反映されなかった: 1 件 (発行者が参加者でない)',
    );
  });

  test('⚠️ 名簿を開いただけのときは何も出さない', () => {
    // **判断ログは追記しかされないので、捨てられた op は永久に残る。**全体を数えて
    // 出すと、一度出た警告が二度と消えない。実際に消えなくなった (2026-09-05 実機)。
    // 伝えたいのは「いまの操作が効かなかった」であって、ログの健康診断ではない
    const { rejected } = withSelfInvite();
    expect(rejected.length).toBeGreaterThan(0); // 捨てた op は残っている
    expect(describeRejected(rejected, undefined)).toBeNull();
  });

  test('他人が捨てられた分は、自分の操作として知らせない', () => {
    const { mine, rejected } = withSelfInvite();
    const other = jb(C, 9, [accept()]); // 招待されていない C の承認
    const all = [...rejected, ...foldParticipation([other], deps).rejected];
    // 知らせるのは自分の batch の分だけ。数は増えない
    expect(describeRejected(all, mine.id)).toBe(
      'いまの操作は名簿に反映されなかった: 1 件 (発行者が参加者でない)',
    );
  });

  test('いま書いた batch が通っていれば何も出さない', () => {
    const mine = jb(A, 5, [invite(C)]);
    const rejected = foldParticipation(
      [jb(A, 1, [genesis()]), mine],
      deps,
    ).rejected;
    expect(describeRejected(rejected, mine.id)).toBeNull();
  });

  test('理由ごとにまとめる — 同じ理由で 10 件落ちても 1 つの句にする', () => {
    const mine = jb(A, 5, [invite(A), invite(A), invite(A)]);
    const rejected = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(B, 4, [revoke(A)]),
        mine,
      ],
      deps,
    ).rejected;
    expect(describeRejected(rejected, mine.id)).toBe(
      'いまの操作は名簿に反映されなかった: 3 件 (発行者が参加者でない)',
    );
  });
});
