/**
 * 空の状態 (visual language §9.1, #279)。**何が無いか**と**次に何をすればよいか**を、
 * 操作の口と一緒に出す。
 *
 * 文字は題 (18px) と本文 (13px・muted)。アイコンは 32px の disabled 色を 1 つまで。
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { color, font, fontWeight, space } from '../theme';

const EMPTY_ICON_SIZE = 32;
const EMPTY_ICON_STROKE = 1.5;
/** 本文が横に伸びすぎないように */
const EMPTY_TEXT_MAX_WIDTH = 360;

type Props = {
  icon?: LucideIcon;
  title: string;
  /** 次に何をすればよいか */
  children?: ReactNode;
  /** 操作の口 (ボタン) */
  actions?: ReactNode;
};

export function EmptyState({ icon: Icon, title, children, actions }: Props) {
  return (
    <section
      aria-label={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[3],
        height: '100%',
        padding: space[6],
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      {Icon && (
        <Icon
          size={EMPTY_ICON_SIZE}
          strokeWidth={EMPTY_ICON_STROKE}
          color={color.textDisabled}
          aria-hidden
        />
      )}
      <h2
        style={{
          margin: 0,
          fontSize: font.title,
          fontWeight: fontWeight.strong,
        }}
      >
        {title}
      </h2>
      {children && (
        <p
          style={{
            margin: 0,
            maxWidth: EMPTY_TEXT_MAX_WIDTH,
            fontSize: font.body,
            color: color.textMuted,
            lineHeight: 1.6,
          }}
        >
          {children}
        </p>
      )}
      {actions && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: space[2],
            marginTop: space[1],
          }}
        >
          {actions}
        </div>
      )}
    </section>
  );
}
