/**
 * useFoldLevel: 箱の中身が溢れない段を求める (ヘッダの操作を畳む, `headerFold.ts`)
 *
 * 描いたら測り、溢れていれば段を上げて描き直す。`useLayoutEffect` で行うので、溢れた姿は画面に出ない
 * (描き直しは表示の前に済む)。箱の幅が変わったとき、または中身 (名前など) が変わったときは、下限から
 * やり直す — 広がったのに畳んだままにしない。
 *
 * 測れない環境 (幅が 0) では溢れていないとみなし、下限のままにする
 */

import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { nextFoldLevel } from './headerFold';

export function useFoldLevel(
  ref: RefObject<HTMLElement | null>,
  /** 下限 (狭い画面では記号だけから始める) */
  minLevel: number,
  /** 中身の同一性。変わったら下限からやり直す */
  contentKey: string,
): number {
  const [level, setLevel] = useState(minLevel);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  /**
   * 前の描画で見た「幅・中身・下限」。変わっていれば下限に戻し、その描き直しの後で測る。
   * 戻すのと測るのを同じ effect で順に決める — 別々の effect にすると、同じ描画の古い段で測った
   * 「1 つ上げる」が戻しを打ち消す
   */
  const resetKey = `${width}|${contentKey}|${minLevel}`;
  const seenRef = useRef(resetKey);

  // 描くたびに測る。溢れていれば 1 段上げる (上げた描き直しの後にまた測る)
  useLayoutEffect(() => {
    if (seenRef.current !== resetKey) {
      seenRef.current = resetKey;
      if (level !== minLevel) {
        setLevel(minLevel);
        return;
      }
    }
    const el = ref.current;
    if (!el) return;
    const next = nextFoldLevel(level, el.scrollWidth > el.clientWidth);
    if (next !== level) setLevel(next);
  });

  return level;
}
