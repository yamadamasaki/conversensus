import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { setLocalBackend } from './api';
import { claimDeviceId } from './local/deviceClaim';
import { broadcastingBackend } from './local/localChanges';
import { startWorkerBackend } from './local/workerBackend';
import { StorageUnavailable } from './StorageUnavailable';
import { setClaimedDeviceId } from './sync/actor';

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

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

// **保存領域が開けたかを確かめてから描く** (step3 Phase 2 D5)。開けなければ編集させない
const started = await startWorkerBackend();
if (started.ok) {
  // **タブごとの deviceId を描画の前に決める** (D4)。同じ端末のタブが同じ点を発番しないため。
  // Web Locks が無ければ (古いブラウザ) 従来どおり端末に 1 つ
  const deviceId = await claimTabDeviceId();
  if (deviceId) setClaimedDeviceId(deviceId);
  // 書いたら他のタブへ知らせる (D3)
  setLocalBackend(broadcastingBackend(started.backend));
  if (import.meta.env.DEV) {
    // E2E がブラウザの中を覗く口: SQL ドライバの契約 (sqlDriverContract.ts) と、このタブの deviceId
    (window as unknown as { __conversensus: unknown }).__conversensus = {
      runDriverContract: started.runDriverContract,
      deviceId,
    };
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  createRoot(root).render(<StorageUnavailable reason={started.reason} />);
}
