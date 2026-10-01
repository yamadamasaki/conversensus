/**
 * S2-6 spike: 開発用 PDS (http://localhost:3000) で ATProto OAuth が通るか (step3 Phase 2, 投棄可)
 *
 * - loopback client (`clientMetadata: undefined`)。**http://127.0.0.1:<port> で開く**こと
 * - 開発用 PDS は http なので `allowHttp: true`
 * - handle の解決は PDS 自身 (`com.atproto.identity.resolveHandle`)
 *
 * 通ったら、OAuth のセッションで Agent を作り、自分の repo を 1 回読んで結果を出す。
 */

import { Agent } from '@atproto/api';
import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

const PDS = 'http://localhost:3000';
const out = document.getElementById('out') as HTMLPreElement;
const log = (line: string) => {
  out.textContent += `${line}\n`;
};

const client = new BrowserOAuthClient({
  handleResolver: PDS,
  clientMetadata: undefined,
  allowHttp: true,
});

try {
  const result = await client.init();
  if (result) {
    const { session } = result;
    log(`✅ セッション: ${session.sub}`);
    const agent = new Agent(session);
    const repo = await agent.com.atproto.repo.describeRepo({
      repo: session.sub,
    });
    log(
      `✅ describeRepo: handle=${repo.data.handle}, collections=${repo.data.collections.join(', ')}`,
    );
  } else {
    log('(未ログイン) handle を入れてログインしてください');
  }
} catch (error) {
  log(`❌ init: ${String(error)}`);
}

document.getElementById('form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const handle = (document.getElementById('handle') as HTMLInputElement).value;
  try {
    await client.signIn(handle);
  } catch (error) {
    log(`❌ signIn: ${String(error)}`);
  }
});
