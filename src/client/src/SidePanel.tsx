/**
 * サイドバーの外枠 (step3 Phase 3 S3-4b)。幅を変える取っ手と、折り畳む・広げるボタンを持つ。
 * 中身 (左はグラフの入れ物、右はグラフの詳細) は呼び出し側が渡す。
 *
 * 取っ手は**ボディ側の端**に置く (左サイドバーは右端、右サイドバーは左端)。ポインタで引くほか、
 * フォーカスして ← / → でも変えられる (`role="separator"` の約束)
 */

import { type ReactNode, useRef } from 'react';
import {
  type PanelSide,
  resizedWidth,
  type SidePanelState,
} from './layout/sidePanels';

/** 畳んだときに残す帯の幅。広げるボタンが押せる幅 */
export const COLLAPSED_PANEL_WIDTH = 24;
const HANDLE_WIDTH = 6;
/** ← / → 1 回で変える幅 */
const KEYBOARD_STEP = 16;

type Props = {
  side: PanelSide;
  /** 何のサイドバーか (ボタンと取っ手の名前に使う)。例: `左サイドバー` */
  label: string;
  state: SidePanelState;
  onResize: (width: number) => void;
  onToggle: () => void;
  children: ReactNode;
};

export function SidePanel({
  side,
  label,
  state,
  onResize,
  onToggle,
  children,
}: Props) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const border = side === 'left' ? 'borderRight' : 'borderLeft';
  // 広げる向き。左は右へ (▶)、右は左へ (◀)
  const expandMark = side === 'left' ? '▶' : '◀';
  const collapseMark = side === 'left' ? '◀' : '▶';

  if (state.collapsed) {
    return (
      <div
        style={{
          width: COLLAPSED_PANEL_WIDTH,
          flexShrink: 0,
          [border]: '1px solid #ddd',
          background: '#fafafa',
          display: 'flex',
          justifyContent: 'center',
          // ボタンを帯の高さいっぱいに伸ばさない (上に置く)
          alignItems: 'flex-start',
          paddingTop: 8,
        }}
      >
        <button
          type="button"
          aria-label={`${label}を広げる`}
          onClick={onToggle}
          style={collapseButtonStyle}
        >
          {expandMark}
        </button>
      </div>
    );
  }

  const handle = (
    // biome-ignore lint/a11y/useSemanticElements: 幅を変える取っ手。hr では引けない
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label}の幅`}
      aria-valuenow={state.width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: state.width };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onResize(
          resizedWidth(
            side,
            drag.current.startWidth,
            e.clientX - drag.current.startX,
          ),
        );
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        const dx =
          e.key === 'ArrowRight'
            ? KEYBOARD_STEP
            : e.key === 'ArrowLeft'
              ? -KEYBOARD_STEP
              : 0;
        if (dx === 0) return;
        e.preventDefault();
        onResize(resizedWidth(side, state.width, dx));
      }}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side === 'left' ? 'right' : 'left']: -HANDLE_WIDTH / 2,
        width: HANDLE_WIDTH,
        cursor: 'col-resize',
        zIndex: 1,
        touchAction: 'none',
      }}
    />
  );

  return (
    <div
      style={{
        position: 'relative',
        width: state.width,
        flexShrink: 0,
        [border]: '1px solid #ddd',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <button
        type="button"
        aria-label={`${label}を畳む`}
        onClick={onToggle}
        style={{
          ...collapseButtonStyle,
          position: 'absolute',
          top: 8,
          // 左右とも右上に置く。左は見出し (conversensus) の後ろ、右は見出し (詳細) の反対側。
          // 右サイドバーの左上に置くと、見出しの文字に重なる (2026-10-02 実機で発覚)
          right: 8,
          zIndex: 1,
        }}
      >
        {collapseMark}
      </button>
      {children}
      {handle}
    </div>
  );
}

const collapseButtonStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#888',
  fontSize: 11,
  padding: '2px 4px',
} as const;
