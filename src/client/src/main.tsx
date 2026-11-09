import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { REQUEST_MODULE } from '@conversensus/request/src/requestModule';
import App from './App.tsx';
import { setLocalBackend } from './api';
import { PDS_URL, setAuthBackend } from './atproto/client';
import { oauthAuth } from './atproto/oauthAuth';
import { BOUNDARY_LABELS, ErrorBoundary } from './ErrorBoundary';
import { claimDeviceId } from './local/deviceClaim';
import { browserEraseDeps, eraseIfRequested } from './local/eraseDevice';
import { broadcastingBackend } from './local/localChanges';
import { requestPersistence } from './local/storagePersistence';
import { startWorkerBackend } from './local/workerBackend';
import { createNodeActionRegistry } from './nodeActions/registry';
import { NodeActionsProvider } from './nodeActions/registryContext';
import { Erased, Starting, StorageUnavailable } from './StorageUnavailable';
import { setClaimedDeviceId } from './sync/actor';

/**
 * node の操作を持つ module (計画 node-actions-request-module.md §3.2)。**どの module を使うかを決めるのは
 * ここだけ**で、core (この package の他の所) は module を import しない
 */
const NODE_ACTIONS = createNodeActionRegistry([REQUEST_MODULE]);

/** Web Locks で deviceId を借りる。使えない環境では null (従来の端末に 1 つの id を使う) */
async function claimTabDeviceId(): Promise<string | null> {
  if (!navigator.locks) return null;
  const { deviceId } = await claimDeviceId({
    storage: localStorage,
    locks: navigator.locks,
    newId: () => crypto.randomUUID(),
  });
  return deviceId;
}

import { guardAgainstStuckDrag } from './stuckDragGuard';
import { suppressResizeObserverLoopErrors } from './suppressResizeObserverLoop';

// **描画より先に入れる** — 最初のレイアウトでも上がりうるため (理由はモジュール冒頭)
suppressResizeObserverLoopErrors();
// トラックパッドのタップで始まって終わらないドラッグを打ち切る (理由はモジュール冒頭)
guardAgainstStuckDrag();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element not found');
const root = createRoot(rootElement);

// 保存領域を開くまでの間に出す。開けない窓では判定に数秒かかる (S2-3 の記録)
root.render(<Starting />);

// ログアウトで「この端末のデータも消す」を選んだ後の起動なら、**何も開く前に**消す (#288)
const erased = await eraseIfRequested(browserEraseDeps()).catch(
  (error: unknown) => {
    console.error('[erase] この端末のデータを消せなかった', error);
    return 'failed' as const;
  },
);
if (erased === 'otherTabs') {
  console.warn(
    '[erase] 別のタブが開いていたので、この端末のデータを消さなかった',
  );
}

/** 保存領域を開いて画面を描く */
async function startApp(): Promise<void> {
  // **保存領域が開けたかを確かめてから描く** (step3 Phase 2 D5)。開けなければ編集させない
  const started = await startWorkerBackend();
  if (started.ok) {
    // ブラウザが保存領域を消さないよう求める (Safari の ITP、S0-4 の注意 3)。断られても動く —
    // そのときに頼れるのは PDS への同期と、未同期の表示 (D6) である
    // 断られたことは覚えておき、この端末だけの File があるときに知らせる (#263)
    void requestPersistence(navigator.storage).then((result) => {
      if (result !== 'persisted') {
        console.info('[storage] persist() は認められなかった');
      }
    });
    // オフラインで起動するため (本番ビルドだけ。開発中は Vite の更新と噛み合わない)
    if (import.meta.env.PROD) {
      void navigator.serviceWorker?.register('/sw.js');
    }
    // **タブごとの deviceId を描画の前に決める** (D4)。同じ端末のタブが同じ点を発番しないため。
    // Web Locks が無ければ (古いブラウザ) 従来どおり端末に 1 つ
    const deviceId = await claimTabDeviceId();
    if (deviceId) setClaimedDeviceId(deviceId);
    // 書いたら他のタブへ知らせる (D3)
    setLocalBackend(broadcastingBackend(started.backend));
    // 認証はブラウザの OAuth。`atproto/client.ts` は headless でも読むので、ここで入れる (agent 段 2 H0)。
    // OAuth の client は最初に使うときに開くので、消去 (`eraseIfRequested`) の後であればよい
    setAuthBackend(oauthAuth(PDS_URL));
    if (import.meta.env.DEV) {
      // E2E がブラウザの中を覗く口: SQL ドライバの契約 (sqlDriverContract.ts) と、このタブの deviceId
      (window as unknown as { __conversensus: unknown }).__conversensus = {
        runDriverContract: started.runDriverContract,
        deviceId,
      };
    }
    root.render(
      <StrictMode>
        {/* 部分の境界 (グラフ・サイドバー) をすり抜けたものの最後の受け (#290) */}
        <ErrorBoundary label={BOUNDARY_LABELS.app}>
          <NodeActionsProvider registry={NODE_ACTIONS}>
            <App />
          </NodeActionsProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  } else {
    root.render(<StorageUnavailable reason={started.reason} />);
  }
}

// 消したら、保存領域を開き直さずに「消した」とだけ出す (#288)。次に開けば空から始まる
if (erased === 'erased') root.render(<Erased />);
else await startApp();
