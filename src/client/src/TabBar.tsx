import { color, font } from './theme';
/**
 * タブ帯 (step3 Phase 3 S3-3)。ボディの上に、開いているグラフのアドレスを並べる。
 *
 * 中身を持たない — タブはアドレスだけを持ち、押すと App が画面をそのアドレスへ持っていく。
 * 名前は呼び出し側が引く (`labelOf`)。id で持ち、見せる直前に名前を引く (`display/labelCache`
 * と同じ考え方)。
 */

import type { Tab, TabId } from './tabs/tabs';

export const TAB_BAR_HEIGHT = 32;
const TAB_MAX_WIDTH = 200;

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
  if (tabs.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="開いているグラフ"
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
            style={{
              display: 'flex',
              alignItems: 'center',
              maxWidth: TAB_MAX_WIDTH,
              borderRight: `1px solid ${color.border}`,
              background: active ? color.bg : 'transparent',
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
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </button>
            <button
              type="button"
              aria-label={`${label} を閉じる`}
              onClick={() => onClose(tab.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: color.textMuted,
                fontSize: font.body,
                padding: '0 6px',
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
