/**
 * useViewLink: URL の fragment と、いま見ている view を結ぶ (#251)
 *
 * - **読む**: 起動したときと、fragment が書き換えられたとき (開いている PWA にリンクを貼った、など)。
 *   view のリンクならそのアドレスを開く。File の一覧を読み終えるまで待ち、手元に無い File なら
 *   開かずに知らせる (タブの側は開けない File のタブを黙って閉じるので、ここで先に断る)
 * - **書く**: アクティブな view が動くたびに fragment をそのアドレスにする (利用者の決定: 追随
 *   させる)。`replaceState` なので履歴は積まない (戻るボタンでタブを遡るのは別の話)。
 *   ログインの戻り (OAuth) が fragment を読み終えるまでは書かない — 先に書くとログインが壊れる
 */

import type { FileId, GraphViewAddress } from '@conversensus/shared';
import { useEffect, useRef, useState } from 'react';
import { parseViewHash, viewHash } from './viewLink';

type Options = {
  /** いま見ている view。何も開いていなければ null */
  current: GraphViewAddress | null;
  /** fragment を書いてよいか。ログインの戻りを読み終えた後 (`resuming` が終わった後) */
  canWrite: boolean;
  /** File の一覧を読み終えたか。終わるまで、届いたリンクを開かずに待つ */
  filesLoaded: boolean;
  hasFile: (fileId: FileId) => boolean;
  open: (address: GraphViewAddress) => void;
  /** リンクの File が手元に無い */
  onMissing: (address: GraphViewAddress) => void;
};

export function useViewLink({
  current,
  canWrite,
  filesLoaded,
  hasFile,
  open,
  onMissing,
}: Options): void {
  /** 届いて、まだ開いていないリンク */
  const [incoming, setIncoming] = useState<GraphViewAddress | null>(() =>
    parseViewHash(location.hash),
  );

  /**
   * 最後に自分で書いた fragment。`replaceState` は本来 `hashchange` を出さないが、出す実装
   * (happy-dom) もある。自分で書いた値を「届いたリンク」と取り違えると、移る途中の姿
   * (branch を開く前の trunk など) のタブへ引き戻してしまう
   */
  const writtenRef = useRef<string | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      if (location.hash === writtenRef.current) return;
      const address = parseViewHash(location.hash);
      if (address) setIncoming(address);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // 渡された関数は描画ごとに変わりうるので、最新を ref で読む (開く effect を余計に走らせない)
  const handlers = useRef({ hasFile, open, onMissing });
  handlers.current = { hasFile, open, onMissing };

  useEffect(() => {
    if (!incoming || !filesLoaded) return;
    const { hasFile, open, onMissing } = handlers.current;
    if (hasFile(incoming.fileId)) open(incoming);
    else onMissing(incoming);
    setIncoming(null);
  }, [incoming, filesLoaded]);

  const currentHash = current ? viewHash(current) : '';
  useEffect(() => {
    // 届いたリンクを開くまでは書かない (開く前の view で上書きすると、リンクが消えて見える)
    if (!canWrite || incoming) return;
    if (location.hash === currentHash) return;
    writtenRef.current = currentHash;
    history.replaceState(
      history.state,
      '',
      currentHash || location.pathname + location.search,
    );
  }, [canWrite, incoming, currentHash]);
}
