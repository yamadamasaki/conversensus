import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { suppressResizeObserverLoopErrors } from './suppressResizeObserverLoop';

// **描画より先に入れる** — 最初のレイアウトでも上がりうるため (理由はモジュール冒頭)
suppressResizeObserverLoopErrors();

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
