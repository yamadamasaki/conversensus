/**
 * App 結合テスト用の PDS (step3 Phase 0 S0-1)。
 *
 * **XRPC を HTTP の形のまま受ける。**`AtpAgent` と `collections.ts` 以下の本物のコードを
 * そのまま通すためである — ここより上を差し替えると、差し替えた層の配線が検証から落ちる。
 * 受けるのは conversensus が実際に叩く口だけで、それ以外は 501 を返して気付けるようにする。
 *
 * 応答は `@atproto/xrpc` が lexicon で検証する (`assertValidXrpcOutput`) ので、
 * cid・at-uri・did・handle は形式として正しい値を返す必要がある。
 *
 * **書き込みを保留できる (`withhold` / `release`)。**端末は 1 つずつしか立てられないので
 * (`appWorld.ts`)、「bob が画面を開いている間に alice の編集が届く」はそのままでは作れない。
 * alice の書き込みを保留しておき、bob の画面が開いた後で公開すれば、それが「届いた」になる。
 */

import type { Did } from '@conversensus/shared';

/** lexicon の `cid` 形式を満たす値。中身の同一性は検証に使っていないので固定でよい */
const FAKE_CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm';

/** `listRecords` の既定の件数。本物の PDS と同じ */
const DEFAULT_LIST_LIMIT = 50;

const XRPC_PREFIX = '/xrpc/';

export type FakeAccount = { did: Did; handle: string; password: string };

type StoredRecord = { rkey: string; value: unknown };

export type FakePds = {
  /** この PDS 宛ての URL か */
  handles: (url: URL) => boolean;
  fetch: (request: Request) => Promise<Response>;
  addAccount: (account: FakeAccount) => void;
  /** 以後この DID の書き込みを、読み手から隠す (冒頭の注を参照) */
  withhold: (did: Did) => void;
  /** 隠していた書き込みを公開し、以後は即時に公開する */
  release: (did: Did) => void;
  /** repo の中身を rkey 昇順で返す (テストの観測用) */
  records: (did: Did, collection: string) => StoredRecord[];
};

/** JWT の形をした値。agent は期限を読むので `exp` だけは意味のある値にする */
function fakeJwt(did: Did): string {
  const encode = (o: object) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const farFuture = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: did, exp: farFuture })}.sig`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function xrpcError(error: string, message: string, status = 400): Response {
  return json({ error, message }, status);
}

export function createFakePds(serviceUrl: string): FakePds {
  const origin = new URL(serviceUrl).origin;
  const accounts = new Map<Did, FakeAccount>();
  /** did → collection → rkey → value */
  const repos = new Map<Did, Map<string, Map<string, unknown>>>();
  /** accessJwt → did */
  const sessions = new Map<string, Did>();
  /** refreshJwt → did */
  const refreshTokens = new Map<string, Did>();
  /** 保留中の DID → まだ公開していない書き込み */
  const withheld = new Map<Did, (() => void)[]>();

  /**
   * 書き込みを適用する。保留中の DID なら後回しにする。
   * **書いた本人の読みにも出ない** — 本物の PDS に置き換えると「送信が遅れた」に当たる
   */
  const write = (did: Did, apply: () => void) => {
    const pending = withheld.get(did);
    if (pending) pending.push(apply);
    else apply();
  };

  const collectionOf = (did: Did, collection: string) => {
    let repo = repos.get(did);
    if (!repo) {
      repo = new Map();
      repos.set(did, repo);
    }
    let coll = repo.get(collection);
    if (!coll) {
      coll = new Map();
      repo.set(collection, coll);
    }
    return coll;
  };

  const uriOf = (did: Did, collection: string, rkey: string) =>
    `at://${did}/${collection}/${rkey}`;

  const sortedRecords = (did: Did, collection: string): StoredRecord[] =>
    [...collectionOf(did, collection).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([rkey, value]) => ({ rkey, value }));

  const sessionBody = (account: FakeAccount) => {
    const accessJwt = fakeJwt(account.did);
    const refreshJwt = `${fakeJwt(account.did)}.refresh`;
    sessions.set(accessJwt, account.did);
    refreshTokens.set(refreshJwt, account.did);
    return {
      did: account.did,
      handle: account.handle,
      accessJwt,
      refreshJwt,
      active: true,
    };
  };

  const bearer = (request: Request) =>
    request.headers.get('authorization')?.replace(/^Bearer /, '');

  /** 書き込みは認証した本人の repo にしかできない (本物と同じ非対称) */
  const authedDid = (request: Request): Did | null => {
    const token = bearer(request);
    return token ? (sessions.get(token) ?? null) : null;
  };

  /**
   * `listRecords` の範囲の意味は本物に合わせる (`collections.ts` の `listRecordsPage` の注)。
   * 既定は rkey 降順、`reverse` で昇順。cursor は rkey として直接比較する。
   */
  const listRecords = (params: URLSearchParams): Response => {
    const did = params.get('repo') as Did;
    const collection = params.get('collection') ?? '';
    const limit = Number(params.get('limit') ?? DEFAULT_LIST_LIMIT);
    const reverse = params.get('reverse') === 'true';
    const cursor = params.get('cursor');
    const ordered = sortedRecords(did, collection);
    if (!reverse) ordered.reverse();
    const after = cursor
      ? ordered.filter((r) => (reverse ? r.rkey > cursor : r.rkey < cursor))
      : ordered;
    const page = after.slice(0, limit);
    const last = page.at(-1);
    return json({
      records: page.map((r) => ({
        uri: uriOf(did, collection, r.rkey),
        cid: FAKE_CID,
        value: r.value,
      })),
      // 本物はページが埋まったときだけ続きの cursor を返す
      ...(page.length === limit && last ? { cursor: last.rkey } : {}),
    });
  };

  const handlers: Record<
    string,
    (request: Request, params: URLSearchParams) => Promise<Response>
  > = {
    'com.atproto.server.createSession': async (request) => {
      const { identifier, password } = (await request.json()) as {
        identifier: string;
        password: string;
      };
      const account = [...accounts.values()].find(
        (a) => a.handle === identifier || a.did === identifier,
      );
      if (!account || account.password !== password) {
        return xrpcError(
          'AuthenticationRequired',
          'Invalid identifier or password',
          401,
        );
      }
      return json(sessionBody(account));
    },
    'com.atproto.server.getSession': async (request) => {
      const did = authedDid(request);
      const account = did ? accounts.get(did) : undefined;
      if (!account)
        return xrpcError('AuthenticationRequired', 'no session', 401);
      return json({ did: account.did, handle: account.handle, active: true });
    },
    'com.atproto.server.refreshSession': async (request) => {
      const token = bearer(request);
      const did = token ? refreshTokens.get(token) : undefined;
      const account = did ? accounts.get(did) : undefined;
      if (!account) return xrpcError('ExpiredToken', 'refresh failed', 400);
      return json(sessionBody(account));
    },
    'com.atproto.repo.putRecord': async (request) => {
      const did = authedDid(request);
      const body = (await request.json()) as {
        repo: Did;
        collection: string;
        rkey: string;
        record: unknown;
      };
      if (!did || did !== body.repo) {
        return xrpcError('AuthenticationRequired', 'not your repo', 401);
      }
      write(did, () =>
        collectionOf(did, body.collection).set(body.rkey, body.record),
      );
      return json({
        uri: uriOf(did, body.collection, body.rkey),
        cid: FAKE_CID,
      });
    },
    'com.atproto.repo.applyWrites': async (request) => {
      const did = authedDid(request);
      const body = (await request.json()) as {
        repo: Did;
        writes: { collection: string; rkey: string; value: unknown }[];
      };
      if (!did || did !== body.repo) {
        return xrpcError('AuthenticationRequired', 'not your repo', 401);
      }
      // 本物の `#create` は既存 rkey で 500 になり、チャンクが丸ごと巻き戻る
      const clash = body.writes.find((w) =>
        collectionOf(did, w.collection).has(w.rkey),
      );
      if (clash) return xrpcError('InternalServerError', 'record exists', 500);
      write(did, () => {
        for (const w of body.writes) {
          collectionOf(did, w.collection).set(w.rkey, w.value);
        }
      });
      return json({});
    },
    'com.atproto.repo.deleteRecord': async (request) => {
      const did = authedDid(request);
      const body = (await request.json()) as {
        repo: Did;
        collection: string;
        rkey: string;
      };
      if (!did || did !== body.repo) {
        return xrpcError('AuthenticationRequired', 'not your repo', 401);
      }
      write(did, () => collectionOf(did, body.collection).delete(body.rkey));
      return json({});
    },
    'com.atproto.repo.getRecord': async (_request, params) => {
      const did = params.get('repo') as Did;
      const collection = params.get('collection') ?? '';
      const rkey = params.get('rkey') ?? '';
      const coll = collectionOf(did, collection);
      if (!coll.has(rkey)) return xrpcError('RecordNotFound', 'not found');
      return json({
        uri: uriOf(did, collection, rkey),
        cid: FAKE_CID,
        value: coll.get(rkey),
      });
    },
    'com.atproto.repo.listRecords': async (_request, params) =>
      listRecords(params),
    'com.atproto.repo.describeRepo': async (_request, params) => {
      const did = params.get('repo') as Did;
      const account = accounts.get(did);
      if (!account) return xrpcError('RepoNotFound', 'no such repo');
      return json({
        handle: account.handle,
        did: account.did,
        didDoc: {},
        collections: [...(repos.get(did)?.keys() ?? [])],
        handleIsCorrect: true,
      });
    },
    'com.atproto.identity.resolveHandle': async (_request, params) => {
      const handle = params.get('handle');
      const account = [...accounts.values()].find((a) => a.handle === handle);
      if (!account) return xrpcError('HandleNotFound', 'no such handle');
      return json({ did: account.did });
    },
  };

  return {
    handles: (url) =>
      url.origin === origin && url.pathname.startsWith(XRPC_PREFIX),
    fetch: async (request) => {
      const url = new URL(request.url);
      const nsid = url.pathname.slice(XRPC_PREFIX.length);
      const handler = handlers[nsid];
      if (!handler) {
        return xrpcError('MethodNotImplemented', `fakePds: ${nsid}`, 501);
      }
      return handler(request, url.searchParams);
    },
    addAccount: (account) => {
      accounts.set(account.did, account);
    },
    withhold: (did) => {
      if (!withheld.has(did)) withheld.set(did, []);
    },
    release: (did) => {
      const pending = withheld.get(did) ?? [];
      withheld.delete(did);
      for (const apply of pending) apply();
    },
    records: (did, collection) => sortedRecords(did, collection),
  };
}
