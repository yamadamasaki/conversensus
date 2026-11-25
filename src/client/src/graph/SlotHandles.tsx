/**
 * 各辺に並べる、見えない接続点 (#410)。真ん中の接続点 (`source-top` など) は各 node の部品が描くので、
 * ここはその両側の分だけを足す。
 *
 * 端の接続点を持たない edge の端を、中心線と枠の交点にいちばん近い接続点に置くため (`facingSides.ts`)。
 * 同じ辺を向く edge の端が 1 点に集まって重なり、一番上の edge しか選べなかった。
 *
 * - **見えず、押せない** (`opacity: 0`・`pointerEvents: 'none'`)。人が線を引き始めるのは今までどおり
 *   真ん中の 4 つの接続点からである。並べた接続点を見せると、node の縁が点だらけになる
 * - 位置は測られるので (React Flow は DOM の位置を読む)、線の端と付け替えのつかみ所はここに描かれる
 */

import { Handle, Position } from '@xyflow/react';
import { EXTRA_SLOTS, slotFraction, slotHandleId } from './facingSides';

const SIDES = [Position.Top, Position.Bottom, Position.Left, Position.Right];

const HIDDEN = { opacity: 0, pointerEvents: 'none' } as const;

export function SlotHandles({ connectable = true }: { connectable?: boolean }) {
  return (
    <>
      {SIDES.flatMap((position) =>
        EXTRA_SLOTS.map((slot) => {
          const offset = `${slotFraction(slot) * 100}%`;
          const horizontal =
            position === Position.Top || position === Position.Bottom;
          return (
            <Handle
              key={slotHandleId(position, slot)}
              type="source"
              position={position}
              id={slotHandleId(position, slot)}
              // 既定 (繋げる) のときは渡さない。真ん中の接続点と同じ書き方にそろえる
              {...(!connectable && { isConnectable: false })}
              style={{
                ...HIDDEN,
                ...(horizontal ? { left: offset } : { top: offset }),
              }}
            />
          );
        }),
      )}
    </>
  );
}
