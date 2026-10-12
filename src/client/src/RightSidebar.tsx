import { color, font, radius } from './theme';
/**
 * 右サイドバー (step3 Phase 3 S3-4b, 仕様 design-language「右サイドバー」)
 *
 * ボディで選ばれているグラフ要素の詳細を出す。pane は property editor と timeline view (#73) で、
 * 上の切り替えで一方を出す (#73 Q1: 幅が狭くても潰れないように)。timeline view の中身
 * (version tree と inspector) は渡された `timeline` が描く。
 *
 * **ボディ内の property editor と併用する** (仕様 property editor)。どちらも同じ選択の写し
 * (`PropertyTarget`) を読み、同じ口 (`setProperty`) で書く
 */

import type { ReactNode } from 'react';
import type { PropertyTarget } from './graph/editorControls';
import { useMessages } from './i18n/messages';
import { PropertyEditor } from './PropertyEditor';
import { propertyRows } from './property/propertyRows';

/** 右サイドバーに出す pane */
export type RightSidebarPane = 'property' | 'timeline';

const PANES: readonly RightSidebarPane[] = ['property', 'timeline'];

type Props = {
  selection: PropertyTarget | undefined;
  onSetProperty: (name: string, value: unknown) => void;
  readOnly: boolean;
  pane: RightSidebarPane;
  onPaneChange: (pane: RightSidebarPane) => void;
  /** timeline view の中身 (#73) */
  timeline: ReactNode;
};

export function RightSidebar({
  selection,
  onSetProperty,
  readOnly,
  pane,
  onPaneChange,
  timeline,
}: Props) {
  const t = useMessages();
  return (
    <aside
      aria-label={t.rightSidebar.region}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ margin: 0, padding: '10px 12px', fontSize: font.body }}>
        {t.rightSidebar.heading}
      </h3>
      <div
        role="tablist"
        aria-label={t.rightSidebar.paneSwitch}
        style={{ display: 'flex', gap: 4, padding: '0 12px 8px' }}
      >
        {PANES.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => onPaneChange(p)}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: font.body,
              cursor: 'pointer',
              border: `1px solid ${color.border}`,
              borderRadius: radius.sm,
              background: pane === p ? color.selectionBg : color.bg,
              color: color.text,
            }}
          >
            {t.rightSidebar.panes[p]}
          </button>
        ))}
      </div>
      {pane === 'timeline' ? (
        timeline
      ) : selection ? (
        <PropertyEditor
          placement="docked"
          label={t.rightSidebar.propertyRegion}
          title={selection.title}
          rows={propertyRows(selection.properties)}
          addable={selection.addable}
          onSet={onSetProperty}
          onRemove={(name) => onSetProperty(name, undefined)}
          readOnly={readOnly}
        />
      ) : (
        // 仕様は「選択されていないときにはグラフ全体」の詳細を出す。シートのプロパティを
        // 書く op がまだ無いので、いまは選んでいないことだけを言う
        <p
          style={{
            margin: 0,
            padding: '0 12px',
            fontSize: font.body,
            color: color.textMuted,
          }}
        >
          {t.rightSidebar.noSelection}
        </p>
      )}
    </aside>
  );
}
