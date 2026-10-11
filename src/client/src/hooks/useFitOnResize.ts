/**
 * useFitOnResize: キャンバスの大きさが変わったら、表示をグラフ全体に合わせ直す
 * (visual language §8.5, #257)
 *
 * File を開いた直後や右サイドバーを開閉した後に、node が端で切れていた。React Flow の `fitView`
 * は描き始めに 1 度合わせるだけで、その後にキャンバスの幅が変わっても合わせ直さない。
 *
 * **利用者が自分で表示を動かした後は合わせ直さない** — 見ていた所から勝手に動かされると、
 * 何をしていたか分からなくなる。動かしたかは React Flow の `onMoveStart` が人の操作 (event を
 * 伴う) で呼ばれたかで見る。プログラムからの移動 (検索で寄せる・表示の同期等) は event を持たないか、
 * React Flow の内側の印 (`{ sync: true }` などの素の object) を持つ。**本物の DOM の Event だけを
 * 人の操作として数える** (実機で、描き始めの同期が人の操作に数えられ、合わせ直さなかった)
 */

import { useCallback, useEffect, useRef } from 'react';

export function useFitOnResize(fitView: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userMovedRef = useRef(false);
  const fitRef = useRef(fitView);
  fitRef.current = fitView;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // 観測を始めた直後の 1 回は合わせない。描き始めの位置は React Flow の fitView が決める
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      // React Flow も自分の ResizeObserver でキャンバスの大きさを測り直す。同じ変化を先に受けて
      // すぐ合わせると、古い大きさで合わせてしまう (実機で発覚)。1 フレーム待って測り直しを先に通す
      if (!userMovedRef.current) requestAnimationFrame(() => fitRef.current());
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onMoveStart = useCallback(
    (event: MouseEvent | TouchEvent | null | Record<string, unknown>) => {
      if (event instanceof Event) userMovedRef.current = true;
    },
    [],
  );

  return { containerRef, onMoveStart };
}
