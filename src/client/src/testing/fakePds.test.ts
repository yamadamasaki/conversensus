import { describe, expect, test } from 'bun:test';
import type { Did } from '@conversensus/shared';
import fc from 'fast-check';
import { createFakePds, type FakeAccount } from './fakePds';

const SERVICE = 'http://pds.test';
const COLLECTION = 'app.conversensus.graph.batch';
const ALICE: FakeAccount = {
  did: 'did:plc:alice000000000000000000' as Did,
  handle: 'alice.test',
  password: 'pw',
};
const BOB: FakeAccount = {
  did: 'did:plc:bob00000000000000000000' as Did,
  handle: 'bob.test',
  password: 'pw',
};

function xrpc(nsid: string, params: Record<string, string> = {}) {
  const url = new URL(`${SERVICE}/xrpc/${nsid}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

function post(nsid: string, body: unknown, token?: string): Request {
  return new Request(xrpc(nsid), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function signIn(
  pds: ReturnType<typeof createFakePds>,
  account: FakeAccount,
): Promise<string> {
  const res = await pds.fetch(
    post('com.atproto.server.createSession', {
      identifier: account.handle,
      password: account.password,
    }),
  );
  return ((await res.json()) as { accessJwt: string }).accessJwt;
}

async function putRecord(
  pds: ReturnType<typeof createFakePds>,
  token: string,
  did: Did,
  rkey: string,
) {
  return pds.fetch(
    post(
      'com.atproto.repo.putRecord',
      { repo: did, collection: COLLECTION, rkey, record: { rkey } },
      token,
    ),
  );
}

/** cursor を辿って全ページを読み、rkey の並びを返す */
async function listAll(
  pds: ReturnType<typeof createFakePds>,
  did: Did,
  limit: number,
  reverse: boolean,
): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await pds.fetch(
      new Request(
        xrpc('com.atproto.repo.listRecords', {
          repo: did,
          collection: COLLECTION,
          limit: String(limit),
          reverse: String(reverse),
          ...(cursor && { cursor }),
        }),
      ),
    );
    const page = (await res.json()) as {
      records: { value: { rkey: string } }[];
      cursor?: string;
    };
    out.push(...page.records.map((r) => r.value.rkey));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

describe('fakePds: listRecords の範囲の意味', () => {
  test('あらゆる rkey の集合とページの大きさで、cursor を辿ると全件が 1 回ずつ rkey 順に出る', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.stringMatching(/^[a-z0-9~]{1,6}$/), {
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        async (rkeys, limit, reverse) => {
          const pds = createFakePds(SERVICE);
          pds.addAccount(ALICE);
          const token = await signIn(pds, ALICE);
          for (const rkey of rkeys)
            await putRecord(pds, token, ALICE.did, rkey);

          const ascending = [...rkeys].sort();
          const expected = reverse ? ascending : ascending.reverse();
          expect(await listAll(pds, ALICE.did, limit, reverse)).toEqual(
            expected,
          );
        },
      ),
    );
  });

  test('ページがちょうど埋まったときは cursor を返し、次のページは空になる (本物と同じ)', async () => {
    const pds = createFakePds(SERVICE);
    pds.addAccount(ALICE);
    const token = await signIn(pds, ALICE);
    for (const rkey of ['a', 'b']) await putRecord(pds, token, ALICE.did, rkey);

    const res = await pds.fetch(
      new Request(
        xrpc('com.atproto.repo.listRecords', {
          repo: ALICE.did,
          collection: COLLECTION,
          limit: '2',
        }),
      ),
    );
    expect(((await res.json()) as { cursor?: string }).cursor).toBe('a');
  });
});

describe('fakePds: 書き込み', () => {
  test('他人の repo には書けない', async () => {
    const pds = createFakePds(SERVICE);
    pds.addAccount(ALICE);
    pds.addAccount(BOB);
    const aliceToken = await signIn(pds, ALICE);

    const res = await putRecord(pds, aliceToken, BOB.did, 'x');

    expect(res.status).toBe(401);
    expect(pds.records(BOB.did, COLLECTION)).toEqual([]);
  });

  test('withhold 中の書き込みは誰にも見えず、release で現れる', async () => {
    const pds = createFakePds(SERVICE);
    pds.addAccount(ALICE);
    const token = await signIn(pds, ALICE);

    pds.withhold(ALICE.did);
    await putRecord(pds, token, ALICE.did, 'held');
    expect(pds.records(ALICE.did, COLLECTION)).toEqual([]);

    pds.release(ALICE.did);
    expect(pds.records(ALICE.did, COLLECTION).map((r) => r.rkey)).toEqual([
      'held',
    ]);

    // release の後は即時に見える
    await putRecord(pds, token, ALICE.did, 'after');
    expect(pds.records(ALICE.did, COLLECTION)).toHaveLength(2);
  });

  test('知らない口は 501 で答える (想定外の通信に気付けるように)', async () => {
    const pds = createFakePds(SERVICE);
    const res = await pds.fetch(new Request(xrpc('com.atproto.sync.getRepo')));
    expect(res.status).toBe(501);
  });
});
