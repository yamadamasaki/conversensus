import { describe, expect, it } from 'bun:test';
import {
  type ListRecordsPage,
  listByRkeyPrefix,
  type RecordPage,
  type RecordSummary,
} from './rangeFetch';

const COLLECTION = 'app.conversensus.graph.batch';

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
  const listPage: ListRecordsPage = async ({ cursor, reverse }) => {
    cursors.push(cursor);
    if (!reverse) throw new Error('この模擬は昇順 (reverse: true) のみ');
    const page = sorted
      .filter((rkey) => cursor === undefined || rkey > cursor)
      .slice(0, pageSize);
    const next: RecordPage = {
      records: page.map(record),
      // PDS は最後のページでも cursor を返す。走査の停止は prefix 判定が担う
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
