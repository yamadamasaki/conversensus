import { color, font } from './theme';
/**
 * 見るだけの pane の中身 (step3 Phase 3 S3-5)。アドレスから求めた姿を `GraphPreview` で描く
 */

import type { GraphViewAddress, Sheet } from '@conversensus/shared';
import { GraphPreview, type PreviewMarks } from './GraphPreview';
import { usePaneSheet } from './hooks/usePaneSheet';

const MESSAGE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: color.textMuted,
  fontSize: font.body,
} as const;

type Props = {
  address: GraphViewAddress;
  /** 印 (merger)。シートから求めるので、求めた姿を受け取って印を返す関数で渡す */
  marksFor?: (sheet: Sheet) => PreviewMarks;
  onElementClick?: (id: string, additive: boolean) => void;
  onElementContextMenu?: (id: string, at: { x: number; y: number }) => void;
};

export function PassivePane({
  address,
  marksFor,
  onElementClick,
  onElementContextMenu,
}: Props) {
  const state = usePaneSheet(address);
  if (state.kind === 'loading') return <div style={MESSAGE}>読み込み中…</div>;
  if (state.kind === 'missing')
    return <div style={MESSAGE}>このグラフは見つかりません</div>;
  return (
    <GraphPreview
      sheet={state.sheet}
      {...(marksFor && { marks: marksFor(state.sheet) })}
      {...(onElementClick && { onElementClick })}
      {...(onElementContextMenu && { onElementContextMenu })}
    />
  );
}
