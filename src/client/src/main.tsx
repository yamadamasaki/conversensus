import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { guardAgainstStuckDrag } from './stuckDragGuard';
import { suppressResizeObserverLoopErrors } from './suppressResizeObserverLoop';

// **描画より先に入れる** — 最初のレイアウトでも上がりうるため (理由はモジュール冒頭)
suppressResizeObserverLoopErrors();
// トラックパッドのタップで始まって終わらないドラッグを打ち切る (理由はモジュール冒頭)
guardAgainstStuckDrag();

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
