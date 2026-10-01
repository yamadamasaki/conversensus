/**
 * ATProto OAuth による認証 (step3 Phase 2 D7)
 *
 * - **本番**: client metadata を配信元の `/client-metadata.json` から読む (`BrowserOAuthClient.load`)。
 *   `client_id` はその URL そのものなので、配信元ごとに 1 つのファイルを置く
 * - **開発** (`localhost` / `127.0.0.1`): loopback client。OAuth サーバは `localhost` の metadata を
 *   取りに来られないので、atproto の OAuth サーバは loopback 用の metadata を自分で組む。
 *   **戻り先は `http://127.0.0.1:<port>/`** — `localhost` では開かないこと (origin が変わり、
 *   保存領域も別になる)
 *
 * どちらも scope は `atproto transition:generic` (自分の repo にレコードを書くため)。
 * handle の解決は自分たちの PDS に頼む (`com.atproto.identity.resolveHandle`) — Bluesky の
 * 公開サービスに handle と IP を渡さない。開発用 PDS は http なので `allowHttp` を許す。
 */

import { Agent } from '@atproto/api';
import {
  BrowserOAuthClient,
  buildAtprotoLoopbackClientMetadata,
  type OAuthSession,
} from '@atproto/oauth-client-browser';
import type { Did } from '@conversensus/shared';
import type { AuthBackend, SignedIn } from './auth';

/** 要る権限。自分の repo への書き込みを含む */
const OAUTH_SCOPE = 'atproto transition:generic';
/** 本番の client metadata の置き場 (配信元からの相対) */
const CLIENT_METADATA_PATH = '/client-metadata.json';
/** loopback client の戻り先のホスト。`localhost` は使えない (atproto の OAuth の規則) */
const LOOPBACK_REDIRECT_HOST = '127.0.0.1';

/**
 * `localhost` で開かれているか。loopback client の戻り先は IP (`127.0.0.1`) でなければならず、
 * ライブラリの `init()` は `localhost` を見るとその場で `127.0.0.1` へ移動する (IndexedDB の
 * origin を揃えるため)。**起動時に勝手に移動させない**よう、`localhost` では `init()` を呼ばない
 */
function onLocalhostName(): boolean {
  return location.hostname === 'localhost';
}

/** 同じ画面の `127.0.0.1` 版 */
function loopbackIpUrl(): string {
  const url = new URL(location.href);
  url.hostname = LOOPBACK_REDIRECT_HOST;
  return url.href;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

async function createClient(pdsUrl: string): Promise<BrowserOAuthClient> {
  const common = {
    handleResolver: pdsUrl,
    allowHttp: pdsUrl.startsWith('http:'),
  };
  if (!isLoopback(location.hostname)) {
    return BrowserOAuthClient.load({
      ...common,
      clientId: `${location.origin}${CLIENT_METADATA_PATH}`,
    });
  }
  const redirectUri = `http://${LOOPBACK_REDIRECT_HOST}${location.port ? `:${location.port}` : ''}/`;
  return new BrowserOAuthClient({
    ...common,
    clientMetadata: buildAtprotoLoopbackClientMetadata({
      scope: OAUTH_SCOPE,
      redirect_uris: [redirectUri],
    }),
  });
}

async function signedIn(session: OAuthSession): Promise<SignedIn> {
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

export function oauthAuth(pdsUrl: string): AuthBackend {
  let client: Promise<BrowserOAuthClient> | null = null;
  const getClient = () => {
    client ??= createClient(pdsUrl);
    return client;
  };
  /** `init` は 1 回だけ呼ぶ (ライブラリの契約)。React の StrictMode で 2 回 mount されても */
  let initialized: Promise<OAuthSession | null> | null = null;
  let current: OAuthSession | null = null;

  return {
    pdsUrl,
    needsPassword: false,
    resume: async () => {
      // `localhost` ではセッションを戻さない (戻すには `init()` が要り、それは移動を伴う)。
      // ログインを押せば `127.0.0.1` へ移る
      if (onLocalhostName()) return null;
      initialized ??= getClient()
        .then((c) => c.init())
        .then((result) => result?.session ?? null);
      current = await initialized;
      return current ? signedIn(current) : null;
    },
    signIn: async (handle) => {
      if (onLocalhostName()) {
        // 戻り先 (`127.0.0.1`) と同じ origin から始める。**保存領域は origin ごとに別**なので、
        // 開発は最初から `127.0.0.1` で開くのが正 (user-test-environment.md §0)
        location.href = loopbackIpUrl();
        return new Promise<never>(() => {});
      }
      await (await getClient()).signIn(handle, { scope: OAUTH_SCOPE });
      // signIn は PDS へ移動するので、ここには戻らない (戻ったら resume が受ける)
      throw new Error('OAuth のログインから戻ってこなかった');
    },
    signOut: async () => {
      await current?.signOut();
      current = null;
      initialized = Promise.resolve(null);
    },
  };
}
