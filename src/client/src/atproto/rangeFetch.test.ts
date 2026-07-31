import { describe, expect, it } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import { batchRkey } from './batchRkey';
import {
  type ListRecordsPage,
  listBatchFileIds,
  listByRkeyPrefix,
  type RecordPage,
  type RecordSummary,
} from './rangeFetch';

const COLLECTION = 'app.conversensus.graph.batch';

/** 実データと同じ形の fileId (UUID 固定長 36。先頭 1 文字で rkey の大小が決まる) */
const fileId = (head: string) =>
  `${head.repeat(8)}-${head.repeat(4)}-4${head.repeat(3)}-8${head.repeat(3)}-${head.repeat(12)}` as FileId;

const record = (rkey: string): RecordSummary => ({
  uri: `at://did:plc:test/${COLLECTION}/${rkey}`,
  cid: `cid-${rkey}`,
  value: { rkey },
});

/**
 * PDS の `listRecords` を模す pager。`reverse: true` の意味論
 * (**rkey 昇順** + `rkey > cursor`、返す cursor = 最後のレコードの rkey) を再現する。
 * p7-0 の実機観測 (設計 §5.1) がこの模擬の根拠。
 */
function fakePager(rkeys: string[], pageSize: number) {
  const sorted = [...rkeys].sort();
  /** 各リクエストで渡された cursor (リクエスト数の証拠にもなる) */
  const cursors: Array<string | undefined> = [];
  const listPage: ListRecordsPage = async ({ cursor, reverse, limit }) => {
    cursors.push(cursor);
    const size = limit ?? pageSize;
    // 昇順: rkey > cursor / 降順: rkey < cursor (実 PDS の意味論, 設計 §1.3)
    const candidates = reverse
      ? sorted.filter((rkey) => cursor === undefined || rkey > cursor)
      : [...sorted]
          .reverse()
          .filter((rkey) => cursor === undefined || rkey < cursor);
    const page = candidates.slice(0, size);
    const next: RecordPage = {
      records: page.map(record),
      // PDS は最後のページでも cursor を返す。走査の停止は呼び出し側の判定が担う
      cursor: page.at(-1),
    };
    return next;
  };
  return {
    listPage,
    cursors,
    get requests() {
      return cursors.length;
    },
  };
}

const rkeyOf = (r: RecordSummary) => r.uri.split('/').at(-1);

describe('listByRkeyPrefix (Phase 7 p7-2)', () => {
  it('prefix に合致するレコードだけを昇順で返す', async () => {
    const pager = fakePager(
      ['v1~A~001~x', 'v1~B~001~p', 'v1~B~002~q', 'v1~C~001~z'],
      100,
    );
    const found = await listByRkeyPrefix(pager.listPage, 'v1~B~', 'v1~B');

    expect(found.map(rkeyOf)).toEqual(['v1~B~001~p', 'v1~B~002~q']);
  });

  it('prefix を外れた 1 件で止まる (以降のページを読まない)', async () => {
    // 「repo 全体を落として捨てる」形に戻っていないことの直接の証拠。
    // 読み過ぎ 1 件 (境界の検出) は正常動作なので許容する (設計 §3.2)。
    const rkeys = ['v1~B~001~p', 'v1~B~002~q'];
    for (let i = 1; i <= 50; i += 1) rkeys.push(`v1~C~${String(i)}~z`);
    const pager = fakePager(rkeys, 3);

    const found = await listByRkeyPrefix(pager.listPage, 'v1~B~', 'v1~B');

    expect(found.map(rkeyOf)).toEqual(['v1~B~001~p', 'v1~B~002~q']);
    // 1 ページ (3 件 = 対象 2 件 + 境界 1 件) で終わる。C の 50 件は読まない
    expect(pager.requests).toBe(1);
  });

  it('複数ページにまたがる範囲を cursor で継いで読む', async () => {
    const rkeys = ['v1~A~000~x'];
    for (let i = 1; i <= 7; i += 1)
      rkeys.push(`v1~B~${String(i).padStart(3, '0')}~q`);
    rkeys.push('v1~C~000~z');
    const pager = fakePager(rkeys, 3);

    const found = await listByRkeyPrefix(pager.listPage, 'v1~B~', 'v1~B');

    expect(found).toHaveLength(7);
    // 3 + 3 + (1 + 境界 1) = 3 リクエスト。cursor は前ページ末尾の rkey
    expect(pager.requests).toBe(3);
    expect(pager.cursors).toEqual(['v1~B', 'v1~B~003~q', 'v1~B~006~q']);
  });

  it('旧 rkey (v1~ より小さい) を 1 件も読まない', async () => {
    // 旧レコードは PDS に放置する決定なので、走査が踏まないことが範囲取得の前提。
    // 踏むと「全件 list を別の形でやり直す」ことになる (設計 §3.1)。
    const rkeys = ['v1~B~001~p'];
    for (let i = 0; i < 40; i += 1) rkeys.push(`${i}f2b4dce-old-uuid`);
    const pager = fakePager(rkeys, 10);

    const found = await listByRkeyPrefix(pager.listPage, 'v1~B~', 'v1~B');

    expect(found.map(rkeyOf)).toEqual(['v1~B~001~p']);
    // 合成 cursor `v1~B` が旧 rkey 40 件をまたいで着地するので、リクエスト数は
    // 旧レコード数に比例しない。2 回目は「続きが無い」の確認 (対象が尽きても PDS は
    // cursor を返すので終端確認の 1 回が入る)。
    expect(pager.requests).toBe(2);
    expect(pager.cursors).toEqual(['v1~B', 'v1~B~001~p']);
  });

  it('合致が 0 件でも空で返る (空応答・末尾のいずれでも)', async () => {
    const empty = fakePager([], 10);
    expect(await listByRkeyPrefix(empty.listPage, 'v1~B~', 'v1~B')).toEqual([]);

    const others = fakePager(['v1~C~001~z'], 10);
    expect(await listByRkeyPrefix(others.listPage, 'v1~B~', 'v1~B')).toEqual(
      [],
    );
  });

  it('空ページで cursor だけ返る応答でも無限ループしない', async () => {
    // cursor が前進しないのに回り続けると、静かに固まる (§3.6: 無言の失敗を作らない)。
    let requests = 0;
    const listPage: ListRecordsPage = async () => {
      requests += 1;
      return { records: [], cursor: 'v1~B~999~stuck' };
    };

    expect(await listByRkeyPrefix(listPage, 'v1~B~', 'v1~B')).toEqual([]);
    expect(requests).toBe(1);
  });

  it('cursor が尽きたら (undefined) そこで終わる', async () => {
    let requests = 0;
    const listPage: ListRecordsPage = async () => {
      requests += 1;
      return { records: [record('v1~B~001~p')], cursor: undefined };
    };

    const found = await listByRkeyPrefix(listPage, 'v1~B~', 'v1~B');
    expect(found.map(rkeyOf)).toEqual(['v1~B~001~p']);
    expect(requests).toBe(1);
  });
});

describe('listBatchFileIds (Phase 7 p7-3)', () => {
  const FILE_1 = fileId('1');
  const FILE_5 = fileId('5');
  const FILE_9 = fileId('9');

  /** 各ファイル 3 batch を新形式 rkey で仕込む */
  const seedRkeys = (files: FileId[]) =>
    files.flatMap((f) =>
      [1, 2, 3].map((clock) => batchRkey(f, clock, `b${clock}`)),
    );

  it('全 fileId をちょうど 1 回ずつ降順で返す (リクエスト数 = N + 1)', async () => {
    // §3.3 の予測そのもの。合成 cursor `v1~<fileId>` がそのファイルの全レコードを
    // 一気に飛ばすので、1 ファイル 1 リクエストで済む (各 1 レコードしか転送しない)。
    const pager = fakePager(seedRkeys([FILE_1, FILE_5, FILE_9]), 100);

    const ids = await listBatchFileIds(pager.listPage);

    expect(ids).toEqual([FILE_9, FILE_5, FILE_1]); // 降順
    // 3 ファイル + 「もう無い」の 1 回
    expect(pager.requests).toBe(4);
  });

  it('1 リクエスト 1 レコードしか要求しない', async () => {
    // 列挙で batch 本体を落とすと「全件取得の別の形」になる。limit を固定する。
    const limits: Array<number | undefined> = [];
    const listPage: ListRecordsPage = async ({ limit }) => {
      limits.push(limit);
      return { records: [], cursor: undefined };
    };

    await listBatchFileIds(listPage);
    expect(limits).toEqual([1]);
  });

  it('旧 rkey 領域に落ちたら 1 件見ただけで終わる (v1~ 分離, §3.1)', async () => {
    // 旧レコードは `v1~` より小さいので降順走査の最後に来る。1 件で判定して止まる —
    // ここで止まらないとリクエスト数が旧レコード数に比例する (= 全件 list の再現)。
    const rkeys = seedRkeys([FILE_5]);
    for (let i = 0; i < 30; i += 1) rkeys.push(`${i}f2b4dce-old-uuid`);
    const pager = fakePager(rkeys, 100);

    const ids = await listBatchFileIds(pager.listPage);

    expect(ids).toEqual([FILE_5]);
    // 対象 1 ファイル + 旧 rkey 領域の最大 1 件 = 2 リクエスト。30 件は読まない
    expect(pager.requests).toBe(2);
  });

  it('remote が空なら空で返る', async () => {
    const pager = fakePager([], 100);
    expect(await listBatchFileIds(pager.listPage)).toEqual([]);
    expect(pager.requests).toBe(1);
  });

  it('壊れた新形式 rkey は 1 件だけ跨いで進む (止まらない・回らない)', async () => {
    // 飛ばす cursor が作れないので、そのレコード 1 件分だけ cursor を進める。
    // 止めると以降のファイルを見落とし、進めないと同じ場所を回り続ける。
    const rkeys = [...seedRkeys([FILE_1]), `v1~${FILE_9}~42~broken`];
    const pager = fakePager(rkeys, 100);

    const ids = await listBatchFileIds(pager.listPage);

    expect(ids).toEqual([FILE_1]);
    // 壊れた 1 件 + FILE_1 + 「もう無い」= 3
    expect(pager.requests).toBe(3);
  });

  it('同じ fileId に再着地したら止まる (cursor が前進しない PDS でも回らない)', async () => {
    // cursor を無視して常に同じレコードを返す PDS を模す = §3.3 の前提が崩れた状態。
    // 進めても同じ場所を回るだけなので、検知して止める (無言で何百回も回らない, §3.6)。
    let requests = 0;
    const listPage: ListRecordsPage = async () => {
      requests += 1;
      const rkey = batchRkey(FILE_5, 1, 'b1');
      return { records: [record(rkey)], cursor: rkey };
    };

    const ids = await listBatchFileIds(listPage, 10);
    expect(ids).toEqual([FILE_5]);
    expect(requests).toBe(2); // 2 回目で再着地を検知して停止
  });

  it('リクエスト上限を超えたら打ち切る (§3.6 の検知器)', async () => {
    // 上限は「ファイル数 + 1 で収まる」前提が崩れたことの検知器。超過しても
    // 静かに回り続けず、その時点までの結果を返して警告する。
    const files = ['1', '3', '5', '7', '9', 'b'].map(fileId);
    const pager = fakePager(seedRkeys(files), 100);

    const ids = await listBatchFileIds(pager.listPage, 3);

    expect(ids).toHaveLength(3); // 上限までの分だけ
    expect(pager.requests).toBe(3);
  });
});
