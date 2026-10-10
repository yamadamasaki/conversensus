/**
 * ボタンの 3 種類 (visual language §5): 主・副・記号。破壊的は副の変種。
 *
 * 見た目 (hover・押下・無効・トグルの on) は `index.css` の `.cs-btn*` が持つ。ここは
 * **アイコンだけのボタンに名前を必ず持たせる** ための口でもある — `IconButton` は `label` を
 * 要求し、`aria-label` と tooltip (`title`) の両方に使う。iOS には hover が無いので、
 * tooltip だけでは意味が伝わらないものには `Button` に文字を添える (§4)
 */

import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const ICON_SIZE = 16;
export const ICON_SIZE_SM = 14;
const ICON_STROKE = 1.75;

type Variant = 'primary' | 'secondary' | 'plain' | 'danger' | 'danger-solid';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: Variant;
  icon?: LucideIcon;
  children: ReactNode;
};

function classOf(variant: Variant, extra?: string): string {
  return ['cs-btn', variant === 'plain' ? '' : `cs-btn--${variant}`, extra]
    .filter(Boolean)
    .join(' ');
}

/** 文字のあるボタン。アイコンを添えるときは `icon` */
export function Button({
  variant = 'secondary',
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button type="button" className={classOf(variant, className)} {...rest}>
      {Icon && <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'children' | 'title' | 'aria-label'
> & {
  icon: LucideIcon;
  /** 何をするボタンか。`aria-label` と tooltip に使う (必須) */
  label: string;
  small?: boolean;
};

/** アイコンだけのボタン。tooltip が無くても意味が分かるもの (閉じる・検索・設定 等) に限る */
export function IconButton({
  icon: Icon,
  label,
  small,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={classOf(
        'plain',
        `cs-btn--icon${small ? ' cs-btn--sm' : ''}${className ? ` ${className}` : ''}`,
      )}
      {...rest}
    >
      <Icon
        size={small ? ICON_SIZE_SM : ICON_SIZE}
        strokeWidth={ICON_STROKE}
        aria-hidden
      />
    </button>
  );
}
