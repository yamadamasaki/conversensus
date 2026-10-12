import type { NodeKindRef } from '@conversensus/shared';
import { useMessages } from './i18n/messages';
import { color, font, radius, shadow } from './theme';
import { DIALOG_Z_INDEX } from './ui/Dialog';

/**
 * 作る node の見た目。`graph` は metagraph の graph node (step3 Phase 4) で、作るとシートが増える
 */
export type NodeTypeOption = 'markdown' | 'group' | 'image' | 'graph';

type Props = {
  position: { x: number; y: number };
  /**
   * このシートで選べる node の種別。**空なら段そのものを出さない** (設計 D3)。
   * template が当たっていない普通のグラフに、意味の種別を出してはいけない
   */
  nodeKinds: NodeKindRef[];
  /**
   * 種別を選んだときは `NodeKindRef` をそのまま渡す — **id が実体で label は表示**で
   * あり (設計 D3)、さらに**どの template の種別か**が要る。書き込み先のプロパティ名は
   * template ごとに分かれるためである (`kindPropertyOf`)
   */
  onSelect: (nodeType: NodeTypeOption, kind?: NodeKindRef) => void;
  /** metagraph では「グラフ」(graph node = シートを足す) を出す (step3 Phase 4) */
  graphNodeOption?: boolean;
};

const HEADING: React.CSSProperties = {
  padding: '4px 14px 6px',
  fontSize: font.caption,
  color: color.textMuted,
  borderBottom: `1px solid ${color.borderSubtle}`,
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
  fontSize: font.body,
  cursor: 'pointer',
};

const APPEARANCES = [
  'markdown',
  'group',
  'image',
] as const satisfies readonly NodeTypeOption[];

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
export function NodeTypeMenu({
  position,
  nodeKinds,
  onSelect,
  graphNodeOption = false,
}: Props) {
  const t = useMessages();
  return (
    <div
      data-node-type-menu
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        boxShadow: shadow.pop,
        zIndex: DIALOG_Z_INDEX,
        minWidth: 160,
        padding: '4px 0',
      }}
    >
      {graphNodeOption && (
        <button
          type="button"
          title={t.graph.graphNodeTitle}
          onClick={() => onSelect('graph')}
          style={ITEM}
        >
          {t.graph.graphNode}
        </button>
      )}
      <div style={HEADING}>{t.graph.nodeAppearance}</div>
      {APPEARANCES.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onSelect(type)}
          style={ITEM}
        >
          {t.graph.appearances[type]}
        </button>
      ))}

      {/* template が当たっていないシートでは段そのものが無い (設計 D3) */}
      {nodeKinds.length > 0 && (
        <>
          <div style={{ ...HEADING, marginTop: 4 }}>{t.graph.nodeKind}</div>
          {nodeKinds.map((ref) => (
            <button
              key={`${ref.templateId}/${ref.kind.id}`}
              type="button"
              title={ref.kind.description}
              onClick={() => onSelect('markdown', ref)}
              style={ITEM}
            >
              {ref.kind.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
