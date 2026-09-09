import type { NodeKind } from '@conversensus/shared';
import { DIALOG_Z_INDEX } from './ConfirmDialog';
import type { NodeKindMenuState } from './hooks/useNodeKindMenu';

/** 種別を外す。`node.setLabel` に空文字を載せる (undefined は op に載らない) */
export const NO_NODE_KIND = '';

type Props = {
  menu: NonNullable<NodeKindMenuState>;
  onSelect: (targetNodeIds: string[], label: string) => void;
};

/**
 * 既にあるノードの種別を変える口 (設計 D3)。
 *
 * **「あれば良い」ではなく要る。**仕様が「既存のノードのラベルは空でよい」と言う以上、
 * 空のまま存在するノードに種別を与える道が無ければ、**template を当てた sheet に
 * 既存のノードを持ち込めない**。Phase 6 が dialogue graph を作るときにも通る道である。
 *
 * エッジの `EdgeContextMenu` と同じ形にしてある — 右クリック、選択が複数ならまとめて。
 */
export function NodeKindMenu({ menu, onSelect }: Props) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: context menu uses mousedown to block propagation
    <div
      style={{
        position: 'fixed',
        top: menu.y,
        left: menu.x,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: DIALOG_Z_INDEX,
        minWidth: 160,
        padding: '4px 0',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '4px 14px 6px',
          fontSize: 11,
          color: '#888',
          borderBottom: '1px solid #eee',
          marginBottom: 4,
        }}
      >
        {menu.targetNodeIds.length === 1
          ? 'ノードの種別'
          : `${menu.targetNodeIds.length} 個のノードの種別`}
      </div>
      {[...menu.nodeKinds, null].map((kind: NodeKind | null) => {
        const label = kind ? kind.label : NO_NODE_KIND;
        // 対象が混在しているときは currentLabel が null なので、どれも現在値にしない
        const isCurrent = menu.currentLabel === label;
        return (
          <button
            key={kind ? kind.id : '(none)'}
            type="button"
            title={kind?.description}
            onClick={() => onSelect(menu.targetNodeIds, label)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '6px 14px',
              textAlign: 'left',
              background: isCurrent ? '#eef2ff' : 'none',
              border: 'none',
              fontSize: 13,
              color: kind ? '#000' : '#888',
              cursor: 'pointer',
            }}
          >
            {kind ? kind.label : '種別なし'}
          </button>
        );
      })}
    </div>
  );
}
