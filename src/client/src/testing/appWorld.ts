/**
 * App 結合テストの世界 (step3 Phase 0 S0-1)。
 *
 * `<App />` を丸ごと描き、**通信の境界 2 つだけ**を `fetch` の所で差し替える。
 *
 * | 境界 | 差し替え先 |
 * | --- | --- |
 * | ローカル正典 (`api.ts` のバックエンド) | **本物の `LocalStore`** を同じプロセスで呼ぶ (`storeBackend`)。DB は端末ごとのインメモリ SQLite |
 * | PDS (`AtpAgent` → `PDS_ORIGIN`) | `fakePds.ts` (XRPC を HTTP の形のまま受ける)。認証は OAuth ではなくパスワード (`passwordAuth`) |
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
 * `atproto/client.ts` の agent がプロセスに 1 つだからである。端末は「ローカル正典の DB」と
 * 「localStorage (セッション・deviceId など)」の組で、`activate` がバックエンドと
 * localStorage を差し替える。
 *
 * 相手の記録を手で組み立てずに本物の App に書かせるのは、**記録の形が変わっても
 * テストが追随する**ためである (step3 Phase 1 で op-log の形を作り直す)。
 *
 * step3 Phase 2 S2-2 で、ローカルサーバ (Hono) を経由するのをやめて `LocalStore` を直接呼ぶ形に
 * した。ブラウザでは同じ `LocalStore` が Worker の中で動く (S2-3)。**HTTP の層を外しても検証は
 * 落ちない** — 経路のロジックは `LocalStore` に移してあり、HTTP に残ったのは要求の形の検証だけで
 * ある (それは `storeBackend` が `BatchSchema` で同じだけ通す)。
 */

import { EventStore, LocalStore } from '@conversensus/shared';
import {
  BunSqliteDriver,
  IN_MEMORY,
} from '@conversensus/shared/src/store/bunSqliteDriver';
import { setLocalBackend } from '../api';
import { logout, setAuthBackend } from '../atproto/client';
import { passwordAuth } from '../atproto/passwordAuth';
import type { LocalBackend } from '../local/backend';
import { broadcastingBackend } from '../local/localChanges';
import { storeBackend } from '../local/storeBackend';
import { createFakePds, type FakePds } from './fakePds';

/** 偽の PDS の origin。パスワードの認証 (`passwordAuth`) をここへ向ける */
const PDS_ORIGIN = 'http://localhost:2583';

type Device = {
  store: LocalStore;
  backend: LocalBackend;
  storage: Record<string, string>;
};

export type AppWorld = {
  pds: FakePds;
  /**
   * 端末を切り替える (無ければ作る)。**呼ぶ前に App を unmount しておくこと** —
   * 描いたままだと、前の端末の App が新しい端末の DB と PDS セッションで動き出す
   */
  activate: (deviceName: string) => Promise<void>;
  /** いま有効な端末のローカル正典 (op-log の観測用) */
  localStore: () => LocalStore;
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
  const pds = createFakePds(PDS_ORIGIN);
  // OAuth は PDS の同意画面を人が通るので、プロセスの中では偽の PDS にパスワードでログインする
  // (step3 Phase 2 D7)。本番と開発の既定は OAuth
  setAuthBackend(passwordAuth(PDS_ORIGIN));
  const unhandled: string[] = [];
  const devices = new Map<string, Device>();
  let current: Device | null = null;
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Request が渡されたら本体ごと引き継ぐ (`@atproto/xrpc` は Request を組んで渡す)
    const request = new Request(input, init);
    const url = new URL(request.url);
    // ローカル正典は fetch を通らない (`storeBackend`)。ここに来たら HTTP の既定が漏れている
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
      const store = new LocalStore(
        new EventStore(new BunSqliteDriver(IN_MEMORY)),
      );
      // 本番 (`main.tsx`) と同じく書き込みを知らせる層で包む。別のタブへは送らない (端末を
      // 切り替えて描くので、同じプロセスの BroadcastChannel が端末をまたいで届いてしまう)。
      // このタブの中の知らせ (見るだけの pane の読み直し, S3-5) だけが出る
      device = {
        store,
        backend: broadcastingBackend(storeBackend(store), null),
        storage: {},
      };
      devices.set(deviceName, device);
    }
    current = device;
    setLocalBackend(device.backend);
    restoreStorage(device.storage);
  };

  return {
    pds,
    activate,
    localStore: () => {
      if (!current) throw new Error('appWorld: 端末が activate されていない');
      return current.store;
    },
    unhandled,
    dispose: async () => {
      await logout();
      localStorage.clear();
      globalThis.fetch = realFetch;
      setLocalBackend(null);
      setAuthBackend(null);
      for (const device of devices.values()) device.store.events.close();
    },
  };
}
