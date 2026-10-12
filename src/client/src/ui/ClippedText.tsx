/**
 * 省略で縮む文字と、その全体を出す tooltip (ヘッダの名前, 利用者の指摘 2026-10-12)
 *
 * ブラウザの tooltip (`title`) は、ボタンには出るのにヘッダの名前には出なかった (Chrome, 利用者の
 * 環境。原因は突き止められていない)。そこで自前で出す。
 *
 * - **切れているときだけ出す** — 全部見えている名前に重ねて同じ文字を出しても邪魔なだけである
 * - 少し待ってから出す (通り過ぎるだけのポインタで出さない)
 * - `document.body` へ描き、画面に対して置く。名前の欄は `overflow: hidden` なので、中に置くと切られる
 * - 全体の文字は DOM にあるので、読み上げは省略されずに読む。tooltip は見た目だけの写しである
 */

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { color, font, radius, shadow } from '../theme';

/** 出すまでの待ち */
export const CLIPPED_TOOLTIP_DELAY_MS = 400;
/** 名前との間 */
const OFFSET = 4;

type Props = {
  /** 全体の文字 (tooltip に出す) */
  full: string;
  /** 描く中身。省略しなければ `full` */
  children?: ReactNode;
  style?: CSSProperties;
};

export function ClippedText({ full, children, style }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // 外れるときに待ちを捨てる (外れた後に出さない)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const onEnter = () => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return; // 切れていない
    cancel();
    timer.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setAt({ left: rect.left, top: rect.bottom + OFFSET });
    }, CLIPPED_TOOLTIP_DELAY_MS);
  };
  const onLeave = () => {
    cancel();
    setAt(null);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: ポインタを乗せたときの見た目の写しだけ。全体の文字は DOM にあり、読み上げはそれを読む */}
      <span
        ref={ref}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...style,
        }}
      >
        {children ?? full}
      </span>
      {at &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: at.left,
              top: at.top,
              zIndex: 1000,
              maxWidth: 480,
              padding: '4px 8px',
              fontSize: font.caption,
              color: color.text,
              background: color.bg,
              border: `1px solid ${color.border}`,
              borderRadius: radius.sm,
              boxShadow: shadow.dialog,
              overflowWrap: 'anywhere',
              pointerEvents: 'none',
            }}
          >
            {full}
          </div>,
          document.body,
        )}
    </>
  );
}
