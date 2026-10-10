import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { color, overlay, shadow } from './theme';
import { ICON_SIZE } from './ui/Button';
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
/**
 * 重ねて出すサイドバーの重なり順 (visual language §9.2)。ボディ (検索窓 800 を除く) より上、
 * ダイアログ (1000) より下
 */
const OVERLAY_PANEL_Z_INDEX = 500;

type Props = {
  side: PanelSide;
  /** 何のサイドバーか (ボタンと取っ手の名前に使う)。例: `左サイドバー` */
  label: string;
  state: SidePanelState;
  onResize: (width: number) => void;
  onToggle: () => void;
  /**
   * `docked` はボディと並べる、`overlay` はボディに重ねる (狭い画面, §9.2)。重ねるときも畳んだ帯は
   * 並べて残す — 広げるボタンの置き場所を変えないため
   */
  mode?: 'docked' | 'overlay';
  /** 重ねたときに外側を押すと呼ぶ。渡したときだけ外側に幕を敷く */
  onDismiss?: () => void;
  children: ReactNode;
};

export function SidePanel({
  side,
  label,
  state,
  onResize,
  onToggle,
  mode = 'docked',
  onDismiss,
  children,
}: Props) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const border = side === 'left' ? 'borderRight' : 'borderLeft';
  // 広げる・畳むの印。サイドバーの側に合わせる
  const ExpandIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen;
  const CollapseIcon = side === 'left' ? PanelLeftClose : PanelRightClose;

  // 畳んだ帯。重ねて開いている間も並べて残すが、そのときボタンは panel の側にある
  const strip = (withButton: boolean) => (
    <div
      style={{
        width: COLLAPSED_PANEL_WIDTH,
        flexShrink: 0,
        [border]: `1px solid ${color.border}`,
        background: color.bgSubtle,
        display: 'flex',
        justifyContent: 'center',
        // ボタンを帯の高さいっぱいに伸ばさない (上に置く)
        alignItems: 'flex-start',
        paddingTop: 8,
      }}
    >
      {withButton && (
        <button
          type="button"
          aria-label={`${label}を広げる`}
          onClick={onToggle}
          className="cs-btn cs-btn--icon"
        >
          <ExpandIcon size={ICON_SIZE} aria-hidden />
        </button>
      )}
    </div>
  );
  if (state.collapsed) return strip(true);

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

  const overlaid = mode === 'overlay';
  const panel = (
    <div
      style={{
        position: overlaid ? 'absolute' : 'relative',
        width: state.width,
        // 重ねるときは画面の幅を超えない (iPhone の縦で端が切れない)
        maxWidth: overlaid ? '100%' : undefined,
        flexShrink: 0,
        [border]: `1px solid ${color.border}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        ...(overlaid && {
          top: 0,
          bottom: 0,
          [side]: 0,
          zIndex: OVERLAY_PANEL_Z_INDEX,
          background: color.bg,
          boxShadow: shadow.dialog,
        }),
      }}
    >
      <button
        type="button"
        aria-label={`${label}を畳む`}
        onClick={onToggle}
        className="cs-btn cs-btn--icon cs-btn--sm"
        style={{
          position: 'absolute',
          top: 8,
          // 左右とも右上に置く。左は見出し (conversensus) の後ろ、右は見出し (詳細) の反対側。
          // 右サイドバーの左上に置くと、見出しの文字に重なる (2026-10-02 実機で発覚)
          right: 8,
          zIndex: 1,
        }}
      >
        <CollapseIcon size={ICON_SIZE} aria-hidden />
      </button>
      {children}
      {handle}
    </div>
  );
  if (!overlaid) return panel;
  return (
    <>
      {strip(false)}
      {onDismiss && (
        // 外側の幕。押すと閉じる (狭い画面の左サイドバー)
        <div
          aria-hidden
          onClick={onDismiss}
          style={{
            position: 'absolute',
            inset: 0,
            background: overlay,
            zIndex: OVERLAY_PANEL_Z_INDEX,
          }}
        />
      )}
      {panel}
    </>
  );
}
