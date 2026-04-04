import { AtpAgent } from '@atproto/api';

export type AtprotoSession = {
  did: string;
  handle: string;
};

// ローカル開発用デフォルト値 (VITE_ATPROTO_* 環境変数で上書き可能)
const PDS_URL = import.meta.env.VITE_ATPROTO_PDS_URL ?? 'http://localhost:2583';

let _agent: AtpAgent | null = null;
// React StrictMode による二重呼び出しを防ぐ
let _loginPromise: Promise<AtprotoSession> | null = null;

export function getAgent(): AtpAgent {
  if (!_agent) {
    _agent = new AtpAgent({ service: PDS_URL });
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
  } finally {
    _loginPromise = null;
  }
}

export function currentDid(): string {
  const did = getAgent().session?.did;
  if (!did)
    throw new Error('ATProto session not initialized. Call login() first.');
  return did;
}
