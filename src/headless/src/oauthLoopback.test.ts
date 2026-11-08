import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OAuthSession } from '@atproto/oauth-client';
import { JsonStore, type LoopbackClient, oauthLoopback } from './oauthLoopback';

const DID = 'did:plc:agent';
const HANDLE = 'agent.test';
const PDS = 'http://localhost:3000';

let dir: string;
let storePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oauth-loopback-'));
  storePath = join(dir, 'oauth.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * 偽のセッション。`Agent` は `did` と `fetchHandler` だけを使い、ここでは `describeRepo` だけが来る
 */
function fakeSession(log: string[]): OAuthSession {
  return {
    did: DID,
    getTokenInfo: async () => ({ aud: PDS }),
    signOut: async () => {
      log.push('signOut');
    },
    fetchHandler: async () =>
      Response.json({
        handle: HANDLE,
        did: DID,
        didDoc: {},
        collections: [],
        handleIsCorrect: true,
      }),
  } as unknown as OAuthSession;
}

/**
 * 偽の OAuth client。`authorize` は「同意した後に PDS が戻す先」をそのまま返す — `openUrl` が
 * それを開くと、ブラウザが同意の後に戻り先へ移ったのと同じことになる
 */
function fakeClient(log: string[]) {
  const seen: string[] = [];
  const create = (redirectUri: string): LoopbackClient => {
    seen.push(redirectUri);
    return {
      authorize: async (handle) => {
        log.push(`authorize ${handle}`);
        return new URL(`${redirectUri}?code=the-code&state=the-state`);
      },
      callback: async (params) => {
        log.push(`callback ${params.get('code')} ${params.get('state')}`);
        return { session: fakeSession(log) };
      },
      restore: async (did) => {
        log.push(`restore ${did}`);
        return fakeSession(log);
      },
    };
  };
  return { create, seen };
}

/**
 * 「ブラウザ」: 渡された URL を開く (戻り先へ GET する)。**bun の fetch を使う** — テストの preload が
 * 大域の `fetch` を happy-dom のものに替えており、それは bun の受け口の応答を読めない
 */
async function browser(url: URL): Promise<void> {
  const response = await Bun.fetch(url);
  expect(response.status).toBe(200);
}

describe('oauthLoopback (H4)', () => {
  it('🔴 同意の URL を渡し、戻りを受け口で受けてログインする', async () => {
    const log: string[] = [];
    const client = fakeClient(log);
    const auth = oauthLoopback({
      pdsUrl: PDS,
      storePath,
      createClient: client.create,
      openUrl: browser,
    });
    const signed = await auth.signIn(HANDLE);
    expect(signed.session).toEqual({ did: DID, handle: HANDLE });
    expect(signed.pdsUrl).toBe(PDS);
    expect(log).toEqual([`authorize ${HANDLE}`, 'callback the-code the-state']);
    // 戻り先は 127.0.0.1 の空いている port の /callback
    expect(client.seen[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it('ログインした DID を覚え、次に作った口で戻せる (起動をまたぐ)', async () => {
    const log: string[] = [];
    const client = fakeClient(log);
    const options = { pdsUrl: PDS, storePath, createClient: client.create };
    await oauthLoopback({ ...options, openUrl: browser }).signIn(HANDLE);

    const resumed = await oauthLoopback(options).resume();
    expect(resumed?.session.did).toBe(DID);
    expect(log).toContain(`restore ${DID}`);
  });

  it('🔴 戻すときの client は、ログインしたときと同じ戻り先で作る (token の更新が同じ client_id で届く)', async () => {
    // loopback の client_id は戻り先 (port を含む) から作られる。違う戻り先で作ると、token の
    // 更新が別の client から来たことになり、PDS が断ってセッションが消える (開発用の PDS で起きた)
    const client = fakeClient([]);
    const options = { pdsUrl: PDS, storePath, createClient: client.create };
    await oauthLoopback({ ...options, openUrl: browser }).signIn(HANDLE);
    await oauthLoopback(options).resume();
    expect(client.seen).toHaveLength(2);
    expect(client.seen[1]).toBe(client.seen[0] as string);
  });

  it('戻り先を覚えていない古いセッションは戻さない (ログインし直す)', async () => {
    const log: string[] = [];
    writeFileSync(
      storePath,
      JSON.stringify({ states: {}, sessions: {}, lastDid: DID }),
    );
    const auth = oauthLoopback({
      pdsUrl: PDS,
      storePath,
      createClient: fakeClient(log).create,
    });
    expect(await auth.resume()).toBeNull();
    expect(log).toEqual([]);
  });

  it('ログインしていなければ戻さない', async () => {
    const log: string[] = [];
    const auth = oauthLoopback({
      pdsUrl: PDS,
      storePath,
      createClient: fakeClient(log).create,
    });
    expect(await auth.resume()).toBeNull();
    expect(log).toEqual([]);
  });

  it('ログアウトするとセッションを捨て、次は戻さない', async () => {
    const log: string[] = [];
    const client = fakeClient(log);
    const options = { pdsUrl: PDS, storePath, createClient: client.create };
    const auth = oauthLoopback({ ...options, openUrl: browser });
    await auth.signIn(HANDLE);
    await auth.signOut();
    expect(log).toContain('signOut');
    expect(await oauthLoopback(options).resume()).toBeNull();
  });

  it('同意を待ちきれなければ失敗する (受け口を開いたままにしない)', async () => {
    const auth = oauthLoopback({
      pdsUrl: PDS,
      storePath,
      createClient: fakeClient([]).create,
      openUrl: () => {}, // 利用者が開かなかった
      consentTimeoutMs: 50,
    });
    await expect(auth.signIn(HANDLE)).rejects.toThrow();
  });

  it('同意のページを渡せなければ失敗する', async () => {
    const auth = oauthLoopback({
      pdsUrl: PDS,
      storePath,
      createClient: fakeClient([]).create,
      openUrl: () => {
        throw new Error('開けない');
      },
    });
    await expect(auth.signIn(HANDLE)).rejects.toThrow('開けない');
  });

  it('セッションの file は持ち主だけが読み書きできる (DPoP の秘密鍵を含む)', async () => {
    const store = new JsonStore(storePath);
    await store.sessionStore.set(DID, {} as never);
    expect(statSync(storePath).mode & 0o777).toBe(0o600);
  });
});
