/**
 * 差分の印 (visual language §8.4)。追加と変更は枠の色だけが違うので、**色に頼らず形でも
 * 区別する** ため、node の右上の角に記号を添える (§1.3)。
 *
 * node の本文 (`overflow: auto`) の外、React Flow の node の枠 (位置の基準) に置く。
 * 本文の中に置くと角で切れる
 */

import { Pencil, Plus } from 'lucide-react';
import { color } from '../theme';

export type DiffType = 'add' | 'update';

const MARK_SIZE = 16;
const MARK_ICON = 11;

const MARKS = {
  add: { Icon: Plus, bg: color.diffAdd, label: '追加' },
  update: { Icon: Pencil, bg: color.diffUpdate, label: '変更' },
} as const;

export function DiffMark({ diffType }: { diffType: DiffType }) {
  const { Icon, bg, label } = MARKS[diffType];
  return (
    <span
      role="img"
      aria-label={label}
      data-diff-mark={diffType}
      style={{
        position: 'absolute',
        top: -MARK_SIZE / 2,
        right: -MARK_SIZE / 2,
        width: MARK_SIZE,
        height: MARK_SIZE,
        borderRadius: '50%',
        background: bg,
        color: color.textOnPrimary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <Icon size={MARK_ICON} strokeWidth={2.5} aria-hidden />
    </span>
  );
}
