import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { setLocalBackend } from './api';
import { claimDeviceId } from './local/deviceClaim';
import { broadcastingBackend } from './local/localChanges';
import { startWorkerBackend } from './local/workerBackend';
import { Starting, StorageUnavailable } from './StorageUnavailable';
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

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element not found');
const root = createRoot(rootElement);

// 保存領域を開くまでの間に出す。開けない窓では判定に数秒かかる (S2-3 の記録)
root.render(<Starting />);

// **保存領域が開けたかを確かめてから描く** (step3 Phase 2 D5)。開けなければ編集させない
const started = await startWorkerBackend();
if (started.ok) {
  // ブラウザが保存領域を消さないよう求める (Safari の ITP、S0-4 の注意 3)。断られても動く —
  // そのときに頼れるのは PDS への同期と、未同期の表示 (D6) である
  void navigator.storage?.persist?.().then((granted) => {
    if (!granted) console.info('[storage] persist() は認められなかった');
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
  if (import.meta.env.DEV) {
    // E2E がブラウザの中を覗く口: SQL ドライバの契約 (sqlDriverContract.ts) と、このタブの deviceId
    (window as unknown as { __conversensus: unknown }).__conversensus = {
      runDriverContract: started.runDriverContract,
      deviceId,
    };
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  root.render(<StorageUnavailable reason={started.reason} />);
}
