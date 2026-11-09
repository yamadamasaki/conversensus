/**
 * node の右クリックのメニュー (計画 N2、Q1 案 a)。node のそばと同じ操作を出す。
 * 見た目と閉じ方は edge の右クリックのメニュー (`EdgeContextMenu`) に揃える
 */

import { useLocale, useMessages } from '../i18n/messages';
import { color, font, radius, shadow } from '../theme';
import { DIALOG_Z_INDEX } from '../ui/Dialog';
import type { AvailableAction } from './registry';
import type { NodeActionMenuState } from './useNodeActions';

type Props = {
  menu: NodeActionMenuState;
  onPick: (nodeId: string, found: AvailableAction) => void;
};

/** メニューの最小の幅 */
const MENU_MIN_WIDTH = 160;

export function NodeActionMenu({ menu, onPick }: Props) {
  const t = useMessages();
  const locale = useLocale();
  return (
    <div
      role="menu"
      aria-label={t.nodeActions.region}
      style={{
        position: 'fixed',
        top: menu.y,
        left: menu.x,
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        boxShadow: shadow.pop,
        zIndex: DIALOG_Z_INDEX,
        minWidth: MENU_MIN_WIDTH,
        padding: '4px 0',
      }}
      // 外のクリックで閉じる見張り (window の mousedown) に届かせない
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.actions.map((found) => (
        <button
          key={found.key}
          type="button"
          role="menuitem"
          onClick={() => onPick(menu.nodeId, found)}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 14px',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            fontSize: font.body,
            cursor: 'pointer',
          }}
        >
          {found.action.label[locale]}
        </button>
      ))}
    </div>
  );
}
