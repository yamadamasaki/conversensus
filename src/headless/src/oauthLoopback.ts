/**
 * headless の認証: ATProto OAuth の loopback client (agent 段 2 H4, 設計 D3)
 *
 * ATProto の OAuth には device flow が無い (authorization code だけ)。代わりに native client の
 * **loopback redirect** を使う — 手元に小さな受け口 (`http://127.0.0.1:<port>/callback`) を開き、
 * 利用者にブラウザで一度だけ同意してもらう (`gh auth login` と同じ形)。
 *
 * - 本番の認証方式 (OAuth) と統一できる。パスワードを headless に渡さない
 * - **public client なので、セッションは最長 2 週間** (ATProto OAuth の上限)。その後は同意し直す。
 *   常駐の agent でこれが困るかは段 5 で考える (設計 A2')
 * - セッション (DPoP の秘密鍵を含む) は `dataDir` の JSON に置く。file の権限は持ち主だけにする
 *
 * client_id は `http://localhost` (loopback の特例)。**PDS がこれを受けるかは任意**なので、
 * 自前の PDS で確かめる (計画 H4)。
 *
 * ## `@atproto/oauth-client-node` を使わない理由
 *
 * 使うと、DNS で handle を解決する部品 (`@atproto-labs/handle-resolver-node` → `fetch-node`) が
 * undici 8 を読み込み、**bun では読み込んだ時点で落ちる** (`webidl.util.markAsUncloneable is not a
 * function`)。私たちは handle の解決を自分の PDS に頼む (ブラウザの `oauthAuth.ts` と同じ) ので、
 * その部品は要らない。`NodeOAuthClient` が核 (`@atproto/oauth-client`) に足しているのは、鍵を作る・
 * 乱数・ハッシュと、DPoP の鍵を JSON で保存するための変換だけなので、それをここで組む。
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Agent } from '@atproto/api';
import { JoseKey } from '@atproto/jwk-jose';
import {
  buildAtprotoLoopbackClientMetadata,
  type InternalStateData,
  type Jwk,
  type Key,
  OAuthClient,
  type OAuthSession,
  requestLocalLock,
  type Session,
} from '@atproto/oauth-client';
import type {
  AuthBackend,
  SignedIn,
} from '@conversensus/client/src/atproto/auth';
import type { Did } from '@conversensus/shared';

/** 要る権限。自分の repo への書き込みを含む (ブラウザの `oauthAuth.ts` と同じ) */
const OAUTH_SCOPE = 'atproto transition:generic';
/** 戻り先のホスト。`localhost` は使えない (ATProto の OAuth の規則) */
const LOOPBACK_HOST = '127.0.0.1';
/** 戻り先の path。**path は一致が要る** (port は照合されない) */
const CALLBACK_PATH = '/callback';
/** 利用者が同意するのを待つ上限 */
const CONSENT_TIMEOUT_MS = 5 * 60_000;
/** 持ち主だけが読み書きできる (DPoP の秘密鍵を含むため) */
const OWNER_ONLY = 0o600;

/** OAuth client のうち使う部分 (テストで差し替える) */
export type LoopbackClient = {
  authorize(handle: string, options: { scope: string }): Promise<URL>;
  callback(params: URLSearchParams): Promise<{ session: OAuthSession }>;
  restore(did: string): Promise<OAuthSession>;
};

export type OAuthLoopbackOptions = {
  /** 自分たちの PDS。handle の解決もここに頼む (ブラウザと同じ) */
  pdsUrl: string;
  /** セッションを置く file (JSON) */
  storePath: string;
  /**
   * 同意のページの URL を利用者に渡す。既定は標準エラーに出す。
   * (ブラウザを自動で開くかは呼ぶ側が決める — CLI なら `open` を呼べる)
   */
  openUrl?: (url: URL) => void | Promise<void>;
  /** OAuth client を作る (テスト用)。既定は `NodeOAuthClient` */
  createClient?: (redirectUri: string, store: JsonStore) => LoopbackClient;
  /** 同意を待つ上限 (テスト用) */
  consentTimeoutMs?: number;
};

/** 保存の形: DPoP の鍵 (`Key`) を JWK (JSON) に置き換えたもの */
type WithJwk<V extends { dpopKey: Key }> = Omit<V, 'dpopKey'> & {
  dpopJwk: Jwk;
};
type NodeSavedState = WithJwk<InternalStateData>;
type NodeSavedSession = WithJwk<Session>;

/** OAuth client が保存するもの + 最後にログインした DID と戻り先。1 つの JSON に置く */
type Saved = {
  states: Record<string, NodeSavedState>;
  sessions: Record<string, NodeSavedSession>;
  lastDid?: string;
  /**
   * ログインしたときの戻り先 (port を含む)。**loopback の client_id は戻り先から作られる**ので、
   * 戻すときも同じ戻り先で client を作らないと、token の更新が別の client から来たことになり、
   * PDS が断ってセッションが消える
   */
  lastRedirectUri?: string;
};

/** OAuth client の store (`SimpleStore`) を 1 つの JSON file の上に作る */
export class JsonStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  read(): Saved {
    if (!existsSync(this.path)) return { states: {}, sessions: {} };
    return JSON.parse(readFileSync(this.path, 'utf8')) as Saved;
  }

  update(change: (saved: Saved) => void): void {
    const saved = this.read();
    change(saved);
    writeFileSync(this.path, JSON.stringify(saved), { mode: OWNER_ONLY });
    // 既にあった file は mode が効かないので、毎回合わせる
    chmodSync(this.path, OWNER_ONLY);
  }

  readonly stateStore = {
    get: async (key: string) => this.read().states[key],
    set: async (key: string, value: NodeSavedState) =>
      this.update((s) => {
        s.states[key] = value;
      }),
    del: async (key: string) =>
      this.update((s) => {
        delete s.states[key];
      }),
  };

  readonly sessionStore = {
    get: async (key: string) => this.read().sessions[key],
    set: async (key: string, value: NodeSavedSession) =>
      this.update((s) => {
        s.sessions[key] = value;
      }),
    del: async (key: string) =>
      this.update((s) => {
        delete s.sessions[key];
      }),
  };
}

/** 鍵の入った値を、JWK の入った値の store の上で読み書きする (`toDpopKeyStore` と同じ) */
function withDpopKeys<V extends { dpopKey: Key }>(store: {
  get: (key: string) => Promise<WithJwk<V> | undefined>;
  set: (key: string, value: WithJwk<V>) => Promise<void>;
  del: (key: string) => Promise<void>;
}) {
  return {
    async get(key: string): Promise<V | undefined> {
      const saved = await store.get(key);
      if (!saved) return undefined;
      const { dpopJwk, ...rest } = saved;
      return {
        ...rest,
        dpopKey: await JoseKey.fromJWK(dpopJwk),
      } as unknown as V;
    },
    async set(key: string, { dpopKey, ...rest }: V): Promise<void> {
      const dpopJwk = dpopKey.privateJwk;
      if (!dpopJwk) throw new Error('[headless] DPoP の秘密鍵が無い');
      await store.set(key, { ...rest, dpopJwk } as WithJwk<V>);
    },
    del: (key: string) => store.del(key),
  };
}

function defaultClient(pdsUrl: string) {
  return (redirectUri: string, store: JsonStore): LoopbackClient =>
    new OAuthClient({
      clientMetadata: buildAtprotoLoopbackClientMetadata({
        scope: OAUTH_SCOPE,
        redirect_uris: [redirectUri],
      }),
      responseMode: 'query',
      stateStore: withDpopKeys<InternalStateData>(store.stateStore),
      sessionStore: withDpopKeys<Session>(store.sessionStore),
      handleResolver: pdsUrl,
      allowHttp: pdsUrl.startsWith('http:'),
      runtimeImplementation: {
        // 1 プロセス = 1 agent なので、プロセスの中の lock で足りる
        requestLock: requestLocalLock,
        createKey: (algs) => JoseKey.generate(algs),
        getRandomValues: randomBytes,
        digest: (bytes, algorithm) =>
          createHash(algorithm.name).update(bytes).digest(),
      },
    });
}

/** 同意のページの URL を出す (既定) */
function printUrl(url: URL): void {
  console.error(
    `[headless] ブラウザでこの URL を開いて、ログインを許可してください:\n${url.href}`,
  );
}

async function toSignedIn(session: OAuthSession): Promise<SignedIn> {
  const agent = new Agent(session);
  const [token, repo] = await Promise.all([
    session.getTokenInfo(),
    agent.com.atproto.repo.describeRepo({ repo: session.did }),
  ]);
  return {
    agent,
    session: { did: session.did as Did, handle: repo.data.handle },
    pdsUrl: token.aud,
  };
}

/** 認可の戻りの形か: GET で、`state` と、`code` か `error` を持つ (#391) */
export function isAuthorizationResponse(
  method: string,
  params: URLSearchParams,
): boolean {
  return (
    method === 'GET' &&
    !!params.get('state') &&
    (!!params.get('code') || !!params.get('error'))
  );
}

/**
 * 受け口を開き、戻り (`/callback?code=…&state=…`) を 1 回だけ受けて閉じる。
 * @returns 受け口の URL、戻りの query を待つ Promise、待つのをやめて閉じる関数
 */
function listenOnce(timeoutMs: number): {
  redirectUri: string;
  received: Promise<URLSearchParams>;
  abandon: () => void;
} {
  let resolve!: (params: URLSearchParams) => void;
  let reject!: (error: Error) => void;
  const received = new Promise<URLSearchParams>((ok, ng) => {
    resolve = ok;
    reject = ng;
  });
  const server = Bun.serve({
    hostname: LOOPBACK_HOST,
    port: 0, // 空いている port を OS に選ばせる
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== CALLBACK_PATH) {
        return new Response('not found', { status: 404 });
      }
      // 戻りの形をした要求 (GET で、state と code か error を持つ) だけを受ける。それ以外は断って待ち続ける
      // (#391) — 同じ機械の他のプロセスやページが先に叩いて、受け口を閉じさせないように
      if (!isAuthorizationResponse(request.method, url.searchParams)) {
        return new Response('bad request', { status: 400 });
      }
      resolve(url.searchParams);
      return new Response(
        'conversensus: ログインを受け取りました。このタブは閉じてかまいません。',
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    },
  });
  const timer = setTimeout(
    () => reject(new Error('[headless] ログインの許可を待ちきれなかった')),
    timeoutMs,
  );
  // **受けても待ちきれなくても閉じる。**開いたままだとプロセスが終わらない
  const close = () => {
    clearTimeout(timer);
    // 応答を返し終える前に切らない
    setTimeout(() => server.stop(), 0);
  };
  received.then(close, close);
  return {
    redirectUri: `http://${LOOPBACK_HOST}:${server.port}${CALLBACK_PATH}`,
    received,
    abandon: () => reject(new Error('[headless] ログインをやめた')),
  };
}

/** loopback OAuth の認証の口 */
export function oauthLoopback(options: OAuthLoopbackOptions): AuthBackend {
  const store = new JsonStore(options.storePath);
  const createClient = options.createClient ?? defaultClient(options.pdsUrl);
  const openUrl = options.openUrl ?? printUrl;
  const timeoutMs = options.consentTimeoutMs ?? CONSENT_TIMEOUT_MS;
  let current: OAuthSession | null = null;

  return {
    pdsUrl: options.pdsUrl,
    needsPassword: false,

    resume: async () => {
      const { lastDid: did, lastRedirectUri: redirectUri } = store.read();
      // 戻り先を覚えていない (段 2 の初めの形の) セッションは、更新できないので戻さない
      if (!did || !redirectUri) return null;
      // 受け口は開かない (戻すのに戻りは来ない)。client_id を揃えるためだけに同じ戻り先を渡す
      const client = createClient(redirectUri, store);
      current = await client.restore(did);
      return toSignedIn(current);
    },

    signIn: async (handle) => {
      const { redirectUri, received, abandon } = listenOnce(timeoutMs);
      const client = createClient(redirectUri, store);
      try {
        await openUrl(await client.authorize(handle, { scope: OAUTH_SCOPE }));
      } catch (error) {
        // 同意のページへ行けないなら、受け口を待たせずに閉じる
        received.catch(() => {});
        abandon();
        throw error;
      }
      const { session } = await client.callback(await received);
      current = session;
      store.update((s) => {
        s.lastDid = session.did;
        s.lastRedirectUri = redirectUri;
      });
      return toSignedIn(session);
    },

    signOut: async () => {
      await current?.signOut();
      current = null;
      store.update((s) => {
        delete s.lastDid;
        delete s.lastRedirectUri;
      });
    },
  };
}
