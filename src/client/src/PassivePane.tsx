/**
 * 見るだけの pane の中身 (step3 Phase 3 S3-5)。アドレスから求めた姿を `GraphPreview` で描く
 */

import type { GraphViewAddress } from '@conversensus/shared';
import { GraphPreview } from './GraphPreview';
import { usePaneSheet } from './hooks/usePaneSheet';

const MESSAGE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#999',
  fontSize: 12,
} as const;

export function PassivePane({ address }: { address: GraphViewAddress }) {
  const state = usePaneSheet(address);
  if (state.kind === 'loading') return <div style={MESSAGE}>読み込み中…</div>;
  if (state.kind === 'missing')
    return <div style={MESSAGE}>このグラフは見つかりません</div>;
  return <GraphPreview sheet={state.sheet} />;
}
