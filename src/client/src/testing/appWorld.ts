/**
 * App 結合テストの世界 (step3 Phase 0 S0-1)。
 *
 * `<App />` を丸ごと描き、**通信の境界 2 つだけ**を `fetch` の所で差し替える。
 *
 * | 境界 | 差し替え先 |
 * | --- | --- |
 * | ローカルサーバ (`api.ts` → `http://localhost:3000`) | **本物の Hono アプリ** (`src/server`) をプロセス内で呼ぶ。DB は端末ごとの一時ディレクトリ |
 * | PDS (`AtpAgent` → `VITE_ATPROTO_PDS_URL`) | `fakePds.ts` (XRPC を HTTP の形のまま受ける) |
 *
 * **`mock.module` は使わない。**bun のモジュールモックはプロセス全体に効いて無関係な
 * テストを壊した経緯がある (`useEventSyncTap.test.ts` の冒頭)。`fetch` の差し替えは
 * `dispose` で必ず戻す。
 *
 * 境界より内側 (hooks・sync・atproto・サーバの op-log) はすべて本物である。
 * **ここで見たいのは「フックと子の間を一周する値」**であり (step3-entry §2.3)、
 * 内側を偽物にすると、まさにその配線が検証から落ちる。
 *
 * ## 端末
 *
 * 複数の参加者は**端末を順番に切り替えて**表す。同時に 2 つの App は立てられない —
 * `atproto/client.ts` の agent がプロセスに 1 つだからである。端末は「ローカルサーバの DB」と
 * 「localStorage (セッション・deviceId など)」の組で、`activate` がそれを差し替える。
 * サーバの `getEventStore` は `DATA_DIR` を**要求のたびに**引くので、環境変数を差すだけで
 * 別の DB に向く。
 *
 * 相手の記録を手で組み立てずに本物の App に書かせるのは、**記録の形が変わっても
 * テストが追随する**ためである (step3 Phase 1 で op-log の形を作り直す)。
 *
 * step3 Phase 2 (PWA 化) でローカルサーバはブラウザ内の eventStore に置き換わる。
 * そのときはこのファイルの「ローカルサーバ」の部分だけを差し替える。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logout } from '../atproto/client';
import { createFakePds, type FakePds } from './fakePds';

/** `api.ts` の既定 (`VITE_API_BASE` 未設定時) と揃える */
const LOCAL_SERVER_ORIGIN = 'http://localhost:3000';
/** `atproto/client.ts` の既定 (`VITE_ATPROTO_PDS_URL` 未設定時) と揃える */
const PDS_ORIGIN = 'http://localhost:2583';

type Device = { dataDir: string; storage: Record<string, string> };

export type AppWorld = {
  pds: FakePds;
  /**
   * 端末を切り替える (無ければ作る)。**呼ぶ前に App を unmount しておくこと** —
   * 描いたままだと、前の端末の App が新しい端末の DB と PDS セッションで動き出す
   */
  activate: (deviceName: string) => Promise<void>;
  /** いま有効な端末のローカルサーバを直接叩く (op-log の観測用) */
  localServer: (path: string, init?: RequestInit) => Promise<Response>;
  /** 境界の偽物に届かなかった URL (想定外の通信の検出用) */
  unhandled: string[];
  dispose: () => Promise<void>;
};

function snapshotStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) out[key] = localStorage.getItem(key) ?? '';
  }
  return out;
}

function restoreStorage(storage: Record<string, string>): void {
  localStorage.clear();
  for (const [key, value] of Object.entries(storage)) {
    localStorage.setItem(key, value);
  }
}

/** 世界を作る。**テストごとに作り直す** — 端末の DB も PDS も新しくなる */
export async function createAppWorld(): Promise<AppWorld> {
  const previousDataDir = process.env.DATA_DIR;
  const { app } = await import('../../../server/src/index');

  const pds = createFakePds(PDS_ORIGIN);
  const unhandled: string[] = [];
  const devices = new Map<string, Device>();
  let current: Device | null = null;
  const realFetch = globalThis.fetch;

  const localServer = (path: string, init?: RequestInit) =>
    Promise.resolve(
      app.fetch(new Request(`${LOCAL_SERVER_ORIGIN}${path}`, init)),
    );

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Request が渡されたら本体ごと引き継ぐ (`@atproto/xrpc` は Request を組んで渡す)
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === LOCAL_SERVER_ORIGIN) {
      if (!current) throw new Error('appWorld: 端末が activate されていない');
      return app.fetch(request);
    }
    if (pds.handles(url)) return pds.fetch(request);
    unhandled.push(request.url);
    return new Response('appWorld: unhandled', { status: 599 });
  }) as typeof fetch;

  const activate = async (deviceName: string) => {
    // agent はプロセスに 1 つなので、端末を替える前に必ず手放す。
    // logout はセッション記録も消すので、localStorage の控えはその前に取る
    if (current) current.storage = snapshotStorage();
    await logout();

    let device = devices.get(deviceName);
    if (!device) {
      device = {
        dataDir: mkdtempSync(join(tmpdir(), `conversensus-${deviceName}-`)),
        storage: {},
      };
      devices.set(deviceName, device);
    }
    current = device;
    process.env.DATA_DIR = device.dataDir;
    restoreStorage(device.storage);
  };

  return {
    pds,
    activate,
    localServer: (path, init) => {
      if (!current) throw new Error('appWorld: 端末が activate されていない');
      return localServer(path, init);
    },
    unhandled,
    dispose: async () => {
      await logout();
      localStorage.clear();
      globalThis.fetch = realFetch;
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      for (const device of devices.values()) {
        rmSync(device.dataDir, { recursive: true, force: true });
      }
    },
  };
}
