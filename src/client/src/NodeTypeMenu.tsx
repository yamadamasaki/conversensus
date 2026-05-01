import { DIALOG_Z_INDEX } from './ConfirmDialog';

export type NodeTypeOption = 'markdown' | 'group' | 'image';

type Props = {
  position: { x: number; y: number };
  onSelect: (nodeType: NodeTypeOption) => void;
};

export function NodeTypeMenu({ position, onSelect }: Props) {
  return (
    <div
      data-node-type-menu
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: DIALOG_Z_INDEX,
        minWidth: 160,
        padding: '4px 0',
      }}
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
        ノードの種類
      </div>
      {(
        [
          ['markdown', 'Markdown'] as const,
          ['group', 'グループ'] as const,
          ['image', '画像'] as const,
        ] as [NodeTypeOption, string][]
      ).map(([type, label]) => (
        <button
          key={type}
          type="button"
          onClick={() => onSelect(type)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '6px 14px',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
