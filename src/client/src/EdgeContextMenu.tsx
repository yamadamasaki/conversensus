import type { EdgePathType } from '@conversensus/shared';
import { DIALOG_Z_INDEX } from './ConfirmDialog';
import { DEFAULT_EDGE_PATH_TYPE } from './graphTransform';
import type { EdgeContextMenuState } from './hooks/useEdgeContextMenu';
import { color, font, radius, shadow } from './theme';

type Props = {
  contextMenu: NonNullable<EdgeContextMenuState>;
  onSelect: (targetEdgeIds: string[], pathType: EdgePathType) => void;
};

export function EdgeContextMenu({ contextMenu, onSelect }: Props) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: context menu uses mousedown to block propagation
    <div
      style={{
        position: 'fixed',
        top: contextMenu.y,
        left: contextMenu.x,
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        boxShadow: shadow.pop,
        zIndex: DIALOG_Z_INDEX,
        minWidth: 160,
        padding: '4px 0',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '4px 14px 6px',
          fontSize: font.caption,
          color: color.textMuted,
          borderBottom: `1px solid ${color.borderSubtle}`,
          marginBottom: 4,
        }}
      >
        {contextMenu.targetEdgeIds.length === 1
          ? 'エッジの種類'
          : `${contextMenu.targetEdgeIds.length} 本のエッジを変更`}
      </div>
      {(
        [
          [DEFAULT_EDGE_PATH_TYPE, 'Bezier（曲線）'],
          ['straight', 'Straight（直線）'],
          ['step', 'Step（直角）'],
          ['smoothstep', 'Smooth Step（角丸）'],
        ] as [EdgePathType, string][]
      ).map(([type, label]) => {
        const isCurrent = contextMenu.currentPathType === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(contextMenu.targetEdgeIds, type)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '6px 14px',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              fontSize: font.body,
              fontWeight: isCurrent ? 'bold' : 'normal',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 12, flexShrink: 0 }}>
              {isCurrent ? '✓' : ''}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
