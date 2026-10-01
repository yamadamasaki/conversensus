/**
 * ATProto の窓口 (step1 以来の形を保つ)
 *
 * `getAgent` / `currentDid` / `login` / `resumeSession` / `logout` の形は変えず、中身を認証の口
 * (`auth.ts`) に委ねる (step3 Phase 2 D7)。既定は ATProto OAuth (`oauthAuth.ts`)、App 結合テストは
 * `setAuthBackend` でパスワードの実装に差し替える。
 */

import { type Agent, AtpAgent } from '@atproto/api';
import type { Did } from '@conversensus/shared';
import type { AtprotoSession, AuthBackend, SignedIn } from './auth';
import { oauthAuth } from './oauthAuth';

export type { AtprotoSession } from './auth';

/**
 * 自分たちの PDS。handle の解決もここに頼む (`oauthAuth.ts`)。開発用 PDS は :3000 で公開する
 * (アカウントの DID 文書がそこを指している, infra/pds/docker-compose.yml)
 */
const PDS_URL = import.meta.env.VITE_ATPROTO_PDS_URL ?? 'http://localhost:3000';

let backend: AuthBackend | null = null;
let current: SignedIn | null = null;
/** React StrictMode の二重呼び出しで 2 回ログインしない */
let loginPromise: Promise<AtprotoSession> | null = null;

function auth(): AuthBackend {
  backend ??= oauthAuth(PDS_URL);
  return backend;
}

/** 認証の口を差し替える (App 結合テスト)。null で既定 (OAuth) に戻す */
export function setAuthBackend(next: AuthBackend | null): void {
  backend = next;
  current = null;
  loginPromise = null;
}

/** ログインにパスワードを要るか (ログインのダイアログがパスワード欄を出すかを決める) */
export function authNeedsPassword(): boolean {
  return auth().needsPassword;
}

/** ログインしていれば、そのセッションの Agent。していなければ認証の無い Agent */
export function getAgent(): Agent {
  return current?.agent ?? new AtpAgent({ service: pdsUrl() });
}

/** 自分の PDS の URL */
export function pdsUrl(): string {
  return current?.pdsUrl ?? auth().pdsUrl;
}

export async function login(
  identifier: string,
  password?: string,
): Promise<AtprotoSession> {
  if (loginPromise) return loginPromise;
  loginPromise = auth()
    .signIn(identifier, password)
    .then((signed) => {
      current = signed;
      return signed.session;
    });
  try {
    return await loginPromise;
    // 成功したら保持する → 以降の呼び出しは同じセッションを返す
  } catch (err) {
    loginPromise = null; // 失敗したときだけ戻して、やり直せるようにする
    throw err;
  }
}

export async function resumeSession(): Promise<AtprotoSession | null> {
  try {
    current = await auth().resume();
    return current?.session ?? null;
  } catch (error) {
    console.warn('[atproto] セッションを戻せなかった:', error);
    current = null;
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await auth().signOut();
  } catch {
    // ネットワークエラーでもローカルのセッションは捨てる
  }
  current = null;
  loginPromise = null;
}

export function currentDid(): Did {
  const did = current?.session.did;
  if (!did)
    throw new Error('ATProto session not initialized. Call login() first.');
  return did;
}
