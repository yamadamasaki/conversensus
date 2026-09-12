import type { NodeKind } from '@conversensus/shared';
import { DIALOG_Z_INDEX } from './ConfirmDialog';

export type NodeTypeOption = 'markdown' | 'group' | 'image';

type Props = {
  position: { x: number; y: number };
  /**
   * このシートで選べる node の種別。**空なら段そのものを出さない** (設計 D3)。
   * template が当たっていない普通のグラフに、意味の種別を出してはいけない
   */
  nodeKinds: NodeKind[];
  /**
   * 種別を選んだときは `NodeKind` をそのまま渡す — **id が実体で label は表示**である
   * (設計 D3)。label だけ渡すと、呼び出し側が id を引き直すことになる
   */
  onSelect: (nodeType: NodeTypeOption, kind?: NodeKind) => void;
};

const HEADING: React.CSSProperties = {
  padding: '4px 14px 6px',
  fontSize: 11,
  color: '#888',
  borderBottom: '1px solid #eee',
  marginBottom: 4,
};

const ITEM: React.CSSProperties = {
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
};

const APPEARANCES: [NodeTypeOption, string][] = [
  ['markdown', 'Markdown'],
  ['group', 'グループ'],
  ['image', '画像'],
];

/**
 * ノード生成メニュー。**2 段**にする (設計 D3)。
 *
 * 上段の「見た目」(markdown / グループ / 画像) と下段の「種別」(主張 / データ / …) は
 * **直交する 2 つの軸**である。同じ「種類」という語が 2 つの意味を持っていたので、
 * 画面の文言を分けてある。
 *
 * 見た目は必ず決まるが種別は決まらなくてよいので、**上段は即座に作り、
 * 下段は上段の選択を伴う**という非対称な形にはしない — 下段を選ぶときも
 * 見た目は markdown で確定する (種別を持つのは意味のあるノードだけである)。
 *
 * **ここが種別を決める唯一の場所である** (設計 D3, 2026-09-12)。toulmin node の
 * 種別とラベルは作成時に決まり、その後変更できない。
 */
export function NodeTypeMenu({ position, nodeKinds, onSelect }: Props) {
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
      <div style={HEADING}>ノードの見た目</div>
      {APPEARANCES.map(([type, label]) => (
        <button
          key={type}
          type="button"
          onClick={() => onSelect(type)}
          style={ITEM}
        >
          {label}
        </button>
      ))}

      {/* template が当たっていないシートでは段そのものが無い (設計 D3) */}
      {nodeKinds.length > 0 && (
        <>
          <div style={{ ...HEADING, marginTop: 4 }}>ノードの種別</div>
          {nodeKinds.map((kind) => (
            <button
              key={kind.id}
              type="button"
              title={kind.description}
              onClick={() => onSelect('markdown', kind)}
              style={ITEM}
            >
              {kind.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
