/**
 * 覆い型のダイアログの枠 (visual language §6)。確認・入力・知らせの 3 つの型と、参加者などの
 * 一覧はこの枠に載せる。余白・幅・影・閉じ方をここ 1 か所で決める (#275)
 *
 * ## 閉じ方は型で決まる (§6.1)
 *
 * - Esc はどの型でも閉じる
 * - **外側のクリックで閉じるかは型による。**確認は閉じない — 重い操作の前の問いが、
 *   覆いを押しただけで「キャンセル」に化けると、何に答えたのか分からなくなる
 *
 * ポップオーバー (`SettingsPopup`) と通知 (`ConflictNotice` など) は覆いを敷かないので、
 * この枠を使わない。
 */

import type { ReactNode } from 'react';
import { color, font, overlay, radius, shadow, space } from '../theme';

export const DIALOG_Z_INDEX = 1000;
export const DIALOG_WIDTH = 380;

export type DialogKind = 'confirm' | 'input' | 'alert';

/** 外側のクリックで閉じる型。確認だけが閉じない (§6.1) */
const DISMISS_ON_OUTSIDE: Record<DialogKind, boolean> = {
  confirm: false,
  input: true,
  alert: true,
};

type Props = {
  kind: DialogKind;
  /** 領域の名前 (`aria-label`)。見出しを出さないダイアログでも読み上げに要る */
  label: string;
  /** 見出し。出すときだけ渡す */
  title?: string;
  /** Esc・外側のクリック (型が許すとき) で呼ぶ */
  onDismiss: () => void;
  width?: number;
  /** 背の高い中身 (一覧) をダイアログの中でスクロールさせる */
  scroll?: boolean;
  /** ダイアログの上にダイアログを重ねるときだけ上げる (参加履歴) */
  layer?: number;
  children: ReactNode;
};

export function Dialog({
  kind,
  label,
  title,
  onDismiss,
  width = DIALOG_WIDTH,
  scroll = false,
  layer = 0,
  children,
}: Props) {
  const dismissOnOutside = DISMISS_ON_OUTSIDE[kind];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: モーダル背景のクリック閉じ
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: DIALOG_Z_INDEX + layer,
      }}
      onClick={dismissOnOutside ? onDismiss : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDismiss();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: role は dialog か alertdialog (式なので biome が読めない) */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: 同上。どちらの role も aria-modal を持つ */}
      <div
        role={kind === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={label}
        style={{
          background: color.bg,
          borderRadius: radius.md,
          padding: space[6],
          width,
          maxWidth: '90vw',
          boxShadow: shadow.dialog,
          fontSize: font.body,
          lineHeight: 1.6,
          ...(scroll && { maxHeight: '80vh', overflowY: 'auto' }),
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // 覆いの外 (グラフのショートカット) へ打鍵を漏らさない
          e.stopPropagation();
          if (e.key === 'Escape') onDismiss();
        }}
      >
        {title && (
          <h2
            style={{
              margin: `0 0 ${space[4]}px`,
              fontSize: font.heading,
              fontWeight: 600,
            }}
          >
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * ボタンの並び (§6.2)。右下に並べ、主を右端に置く — 子は「キャンセル」「主」の順に渡す。
 * 破壊的な操作は `destructive` に渡し、主から最も離れた左端に置く (#271)
 */
export function DialogActions({
  destructive,
  children,
}: {
  destructive?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        marginTop: space[4],
      }}
    >
      {destructive}
      <div
        style={{
          display: 'flex',
          gap: space[2],
          marginLeft: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
