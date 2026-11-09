/**
 * ATProto の窓口 (step1 以来の形を保つ)
 *
 * `getAgent` / `currentDid` / `login` / `resumeSession` / `logout` の形は変えず、中身を認証の口
 * (`auth.ts`) に委ねる (step3 Phase 2 D7)。口は使う側が `setAuthBackend` で入れる: ブラウザは
 * ATProto OAuth (`oauthAuth.ts`, `main.tsx` が入れる)、App 結合テストはパスワードの実装、headless は
 * 自分の実装。
 *
 * **ここで `oauthAuth` を import しない** (agent 段 2 H0)。`@atproto/oauth-client-browser` は読み込んだ
 * だけで警告を出し、bun のプロセスを終わらせなくする。ブラウザの外 (headless) でも読むモジュールなので、
 * ブラウザ専用の実装はブラウザの入口に置く。
 */

import { type Agent, AtpAgent } from '@atproto/api';
import type { Did } from '@conversensus/shared';
import type { AtprotoSession, AuthBackend, SignedIn } from './auth';

export type { AtprotoSession } from './auth';

/**
 * 自分たちの PDS。handle の解決もここに頼む (`oauthAuth.ts`)。開発用 PDS は :3000 で公開する
 * (アカウントの DID 文書がそこを指している, infra/pds/docker-compose.yml)
 */
export const PDS_URL =
  import.meta.env.VITE_ATPROTO_PDS_URL ?? 'http://localhost:3000';

let backend: AuthBackend | null = null;
let current: SignedIn | null = null;
/** React StrictMode の二重呼び出しで 2 回ログインしない */
let loginPromise: Promise<AtprotoSession> | null = null;

/**
 * 口が入れられていないとき。未ログインの Agent が向く先だけを持ち、ログインはできない。
 * ブラウザでは描画の前に `main.tsx` が OAuth を入れるので、ここに来るのはテストだけである
 */
const UNCONFIGURED: AuthBackend = {
  pdsUrl: PDS_URL,
  needsPassword: false,
  resume: async () => null,
  signIn: async () => {
    throw new Error('[atproto] 認証の口が入れられていない (setAuthBackend)');
  },
  signOut: async () => {},
};

function auth(): AuthBackend {
  return backend ?? UNCONFIGURED;
}

/** 認証の口を入れる。null で「入れていない」に戻す */
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

/**
 * 保存したセッションを戻す。**戻せなければ、前のログインの結果も捨てる** — 捨てないと、次の `login` が
 * 失効したセッションを返し、ログインし直せない (常駐の agent が失効の後に入り直す、agent 段 5 S1)
 */
export async function resumeSession(): Promise<AtprotoSession | null> {
  try {
    current = await auth().resume();
  } catch (error) {
    console.warn('[atproto] セッションを戻せなかった:', error);
    current = null;
  }
  if (!current) loginPromise = null;
  return current?.session ?? null;
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
