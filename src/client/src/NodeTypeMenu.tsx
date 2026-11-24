import {
  kindDescriptionIn,
  kindLabelIn,
  type NodeKindRef,
} from '@conversensus/shared';
import { useLocale, useMessages } from './i18n/messages';
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

/** 見た目の下に並べる種類の字下げ。どの見た目の種類かを、見出しを足さずに位置で示す */
const KIND_ITEM: React.CSSProperties = {
  ...ITEM,
  paddingLeft: 30,
};

/** 種類の見た目 (無ければ markdown。`NodeKind.nodeType` の約束) */
function appearanceOf(ref: NodeKindRef): NodeTypeOption {
  return ref.kind.nodeType ?? 'markdown';
}

/**
 * ノード生成メニュー。**見た目を選んでから、その見た目の種類を選ぶ**形にする (#412、template-update K11)。
 *
 * 「見た目」(markdown / グループ / 画像) と「種別」(主張 / データ / …) は直交する 2 つの軸だが、
 * 種類は見た目を 1 つ持つ (group の種類は group node になる、#406)。そこで各見た目のすぐ下に、
 * その見た目の種類を字下げして並べる。見た目だけを選べば種類を持たない node、種類を選べば
 * その見た目の node ができる。1 回の選択で済み、見た目の合わない種類は選べない。
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
  const locale = useLocale();
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
        <div key={type}>
          <button type="button" onClick={() => onSelect(type)} style={ITEM}>
            {t.graph.appearances[type]}
          </button>
          {/* template が当たっていないシートでは種類が並ばない (設計 D3) */}
          {nodeKinds
            .filter((ref) => appearanceOf(ref) === type)
            .map((ref) => (
              <button
                key={`${ref.templateId}/${ref.kind.id}`}
                type="button"
                title={kindDescriptionIn(ref.kind, locale)}
                onClick={() => onSelect(type, ref)}
                style={KIND_ITEM}
              >
                {kindLabelIn(ref.kind, locale)}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
