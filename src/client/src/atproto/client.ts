import type { AtpSessionData, AtpSessionEvent } from '@atproto/api';
import { AtpAgent } from '@atproto/api';
import type { Did } from '@conversensus/shared';

export type AtprotoSession = {
  did: Did;
  handle: string;
};

// ローカル開発用デフォルト値 (VITE_ATPROTO_* 環境変数で上書き可能)
const PDS_URL = import.meta.env.VITE_ATPROTO_PDS_URL ?? 'http://localhost:2583';
const SESSION_STORAGE_KEY = 'atproto_session';

let _agent: AtpAgent | null = null;
// React StrictMode による二重呼び出しを防ぐ
let _loginPromise: Promise<AtprotoSession> | null = null;

function onPersistSession(
  _evt: AtpSessionEvent,
  session: AtpSessionData | undefined,
): void {
  if (session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function getAgent(): AtpAgent {
  if (!_agent) {
    _agent = new AtpAgent({
      service: PDS_URL,
      persistSession: onPersistSession,
    });
  }
  return _agent;
}

export async function login(
  identifier: string,
  password: string,
): Promise<AtprotoSession> {
  if (_loginPromise) return _loginPromise;
  _loginPromise = (async () => {
    const agent = getAgent();
    const res = await agent.login({ identifier, password });
    return { did: res.data.did, handle: res.data.handle };
  })();
  try {
    return await _loginPromise;
    // 成功時は _loginPromise を保持 → 以降の呼び出しはキャッシュされたセッションを返す
  } catch (err) {
    _loginPromise = null; // 失敗時のみリセットして再試行を許可
    throw err;
  }
}

export async function resumeSession(): Promise<AtprotoSession | null> {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as AtpSessionData;
    const agent = getAgent();
    // refresh 失敗はエラーにならない場合がある (d.ts 参照) → 戻り値よりも session を確認
    await agent.resumeSession(stored).catch(() => {});
    const s = agent.session;
    if (!s) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return { did: s.did, handle: s.handle };
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await getAgent().logout();
  } catch {
    // ネットワークエラーでもローカルセッションはクリアする
  }
  localStorage.removeItem(SESSION_STORAGE_KEY);
  _agent = null;
  _loginPromise = null;
}

export function currentDid(): Did {
  const did = getAgent().session?.did;
  if (!did)
    throw new Error('ATProto session not initialized. Call login() first.');
  return did;
}
