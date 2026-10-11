import { color, font } from './theme';
/**
 * 右サイドバー (step3 Phase 3 S3-4b, 仕様 design-language「右サイドバー」)
 *
 * ボディで選ばれているグラフ要素の詳細を出す。いまの pane は property editor 1 つ。仕様の
 * timeline view / operation inspector / change inspector は後の Phase で pane として足す。
 *
 * **ボディ内の property editor と併用する** (仕様 property editor)。どちらも同じ選択の写し
 * (`PropertyTarget`) を読み、同じ口 (`setProperty`) で書く
 */

import type { PropertyTarget } from './graph/editorControls';
import { PropertyEditor } from './PropertyEditor';
import { propertyRows } from './property/propertyRows';

type Props = {
  selection: PropertyTarget | undefined;
  onSetProperty: (name: string, value: unknown) => void;
  readOnly: boolean;
};

export const RIGHT_SIDEBAR_PROPERTY_LABEL = '詳細の property';

export function RightSidebar({ selection, onSetProperty, readOnly }: Props) {
  return (
    <aside
      aria-label="詳細"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ margin: 0, padding: '10px 12px', fontSize: font.body }}>
        詳細
      </h3>
      {selection ? (
        <PropertyEditor
          placement="docked"
          label={RIGHT_SIDEBAR_PROPERTY_LABEL}
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
          要素を選ぶと、その property が出ます
        </p>
      )}
    </aside>
  );
}
