import { X } from 'lucide-react';
import { color, font, fontWeight } from './theme';
import { ICON_SIZE_SM } from './ui/Button';
/**
 * タブ帯 (step3 Phase 3 S3-3)。ボディの上に、開いているグラフのアドレスを並べる。
 *
 * 中身を持たない — タブはアドレスだけを持ち、押すと App が画面をそのアドレスへ持っていく。
 * 名前は呼び出し側が引く (`labelOf`)。id で持ち、見せる直前に名前を引く (`display/labelCache`
 * と同じ考え方)。
 */

import { useEffect, useRef } from 'react';
import type { Tab, TabId } from './tabs/tabs';

export const TAB_BAR_HEIGHT = 32;
/**
 * タブは並ぶ数に応じて縮む (#277)。この幅までは縮めて全部を見せ、それでも溢れたら横へ送る。
 * 名前が省略されたら全体は tooltip で読む
 */
const TAB_MAX_WIDTH = 200;
const TAB_MIN_WIDTH = 96;

type Props = {
  tabs: readonly Tab[];
  activeId: TabId | null;
  labelOf: (tab: Tab) => string;
  onActivate: (id: TabId) => void;
  onClose: (id: TabId) => void;
};

export function TabBar({
  tabs,
  activeId,
  labelOf,
  onActivate,
  onClose,
}: Props) {
  const activeRef = useRef<HTMLDivElement>(null);
  // アクティブなタブが帯の外に送られていたら見える所まで寄せる (溢れたとき)
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId が変わったときだけ寄せる
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeId]);

  if (tabs.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="開いているグラフ"
      className="cs-tabbar"
      // マウスのホイールは縦にしか回らない。溢れた帯を横へ送れるよう、縦の回転を横に読み替える
      onWheel={(e) => {
        if (e.deltaX !== 0 || e.deltaY === 0) return;
        e.currentTarget.scrollLeft += e.deltaY;
      }}
      style={{
        display: 'flex',
        height: TAB_BAR_HEIGHT,
        flexShrink: 0,
        borderBottom: `1px solid ${color.border}`,
        background: color.bgSubtle,
        overflowX: 'auto',
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const label = labelOf(tab);
        return (
          <div
            key={tab.id}
            ref={active ? activeRef : undefined}
            className="cs-tab"
            data-active={active}
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: `0 1 ${TAB_MAX_WIDTH}px`,
              minWidth: TAB_MIN_WIDTH,
              borderRight: `1px solid ${color.border}`,
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={label}
              onClick={() => onActivate(tab.id)}
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: font.body,
                padding: '0 8px',
                height: '100%',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'inherit',
                fontWeight: active ? fontWeight.strong : fontWeight.normal,
              }}
            >
              {label}
            </button>
            <button
              type="button"
              aria-label={`${label} を閉じる`}
              onClick={() => onClose(tab.id)}
              className="cs-btn cs-btn--icon cs-btn--sm"
            >
              <X size={ICON_SIZE_SM} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
