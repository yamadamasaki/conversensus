import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { setLocalBackend } from './api';
import { startWorkerBackend } from './local/workerBackend';
import { StorageUnavailable } from './StorageUnavailable';
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
  setLocalBackend(started.backend);
  if (import.meta.env.DEV) {
    // E2E がブラウザの中で SQL ドライバの契約を当てる口 (sqlDriverContract.ts)
    (window as unknown as { __conversensus: unknown }).__conversensus = {
      runDriverContract: started.runDriverContract,
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
