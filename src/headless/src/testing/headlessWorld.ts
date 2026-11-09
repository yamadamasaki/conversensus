/**
 * headless のテストの世界 (agent 段 2)
 *
 * App 結合 (`client/src/testing/appWorld.ts`) と同じく、**通信の境界だけ**を差し替える:
 * PDS への `fetch` を偽の PDS (`fakePds.ts`) へ向け、認証はパスワード (`passwordAuth`) にする。
 * 内側 (正典・同期・名簿) はすべて本物である。
 *
 * `dataDir` は一時 directory に作り、`dispose` で消す。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passwordAuth } from '@conversensus/client/src/atproto/passwordAuth';
import {
  createFakePds,
  type FakeAccount,
  type FakePds,
} from '@conversensus/client/src/testing/fakePds';
import type { Did } from '@conversensus/shared';
import type { HeadlessOptions } from '../headless';

/** 手元のプロセスの口。偽の PDS ではない */
const LOOPBACK_HOST = '127.0.0.1';

/** 偽の PDS の origin (App 結合と同じ) */
const PDS_ORIGIN = 'http://localhost:2583';

export const ALICE: FakeAccount = {
  did: 'did:plc:alice' as Did,
  handle: 'alice.test',
  password: 'alice-pw',
};
export const AGENT: FakeAccount = {
  did: 'did:plc:agent' as Did,
  handle: 'agent.test',
  password: 'agent-pw',
};

export type HeadlessWorld = {
  pds: FakePds;
  /** 新しい `dataDir` (端末 1 つ分) を作る */
  newDataDir: () => string;
  /** `Headless.open` に渡す設定 */
  options: (dataDir: string) => HeadlessOptions;
  /** 偽の PDS に届かなかった URL (想定外の通信の検出用) */
  unhandled: string[];
  dispose: () => void;
};

export function createHeadlessWorld(): HeadlessWorld {
  const pds = createFakePds(PDS_ORIGIN);
  pds.addAccount(ALICE);
  pds.addAccount(AGENT);
  const unhandled: string[] = [];
  const dirs: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (pds.handles(url)) return pds.fetch(request);
    // 常駐の agent が自分で出す MCP の口 (127.0.0.1、段 5 S4) は本物に通す
    if (url.hostname === LOOPBACK_HOST) return realFetch(input, init);
    unhandled.push(request.url);
    return new Response('headlessWorld: unhandled', { status: 599 });
  }) as typeof fetch;

  return {
    pds,
    newDataDir: () => {
      const dir = mkdtempSync(join(tmpdir(), 'headless-'));
      dirs.push(dir);
      return dir;
    },
    options: (dataDir) => ({ dataDir, auth: passwordAuth(PDS_ORIGIN) }),
    unhandled,
    dispose: () => {
      globalThis.fetch = realFetch;
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    },
  };
}
