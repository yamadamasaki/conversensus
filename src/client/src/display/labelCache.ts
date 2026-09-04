/**
 * id を人が読める名前に解決する (step2)
 *
 * **記録に残すのは id、人に見せるのは名前**である。この 2 つは常に食い違う。
 *
 * | 記録 | 表示 | 解決の口 |
 * |---|---|---|
 * | DID | ハンドル名 | `describeRepo` |
 * | FileId | ファイル名 | File のレコード |
 *
 * 名前を記録に持つわけにはいかない。ハンドル名は付け替えられるしファイル名は変わるので、
 * 記録した瞬間の名前を残すと**後から嘘になる**。かといって画面に DID を出すわけにも
 * いかない。したがって「id で持ち、見せる直前に引く」しかなく、**その引き方を
 * 一箇所に集めたのがこれ**である。
 *
 * ## 引くのは描画の前、描画に渡すのは同期の関数
 *
 * `resolve` は未知の id をまとめて引いてから、**同期の** `(id) => string` を返す。
 * 描画の途中で待たない。これは `buildLocalDidPredicate` が畳み込みに対してやっている
 * ことと同じ形で、理由も同じである — 行ごとに待つと表がちらつき、失敗の扱いが行ごとに
 * ばらける。**「まとめて解決してから、確定した答えだけを渡す」**。
 *
 * ## 解決できないときは id をそのまま出す
 *
 * 空欄や「不明」にしない。DID がそのまま出ていれば何が起きたか追えるが、空欄は
 * 「解決できなかった」のか「そもそも無い」のかが区別できない。
 */

export type LabelSource<Id extends string> = {
  /**
   * 未知の id をまとめて引く。
   *
   * **解決できなかった id は返さない。**返さないことがそのまま「解決できない」の
   * 表明である (空文字を返されると、それが名前なのか失敗なのか分からない)。
   */
  fetch: (ids: readonly Id[]) => Promise<ReadonlyMap<Id, string>>;
  /** 解決できないときの見せ方。既定は id をそのまま出す */
  fallback?: (id: Id) => string;
  /** 何の名前か (警告に出す)。`'ハンドル名'` など */
  what: string;
};

export type LabelResolver<Id extends string> = (id: Id) => string;

export type LabelCache<Id extends string> = {
  /**
   * 未知の id だけを引き、描画に渡す同期の関数を返す。
   *
   * **引けなくても投げない。**名前が出ないことは、一覧が出ないことより遥かに軽い。
   * ただし黙らない — 全部が id のまま並ぶ理由が分からないと調べようがない
   */
  resolve: (ids: Iterable<Id>) => Promise<LabelResolver<Id>>;
  /** 引かずに、今わかっている範囲で答える */
  peek: LabelResolver<Id>;
  /** 覚えた分を捨てる。id を省くと全部 (ハンドル名の付け替えなど) */
  forget: (id?: Id) => void;
};

export function createLabelCache<Id extends string>(
  source: LabelSource<Id>,
): LabelCache<Id> {
  const known = new Map<Id, string>();
  const fallback = source.fallback ?? ((id: Id) => id as string);
  const peek: LabelResolver<Id> = (id) => known.get(id) ?? fallback(id);

  return {
    peek,
    forget: (id) => {
      if (id === undefined) known.clear();
      else known.delete(id);
    },
    resolve: async (ids) => {
      // 同じ id が何度並んでも 1 回しか引かない。名簿は「依頼者」列で同じ DID が
      // 何行にも出るので、ここを素通しにすると行数だけリクエストが飛ぶ
      const missing = [...new Set(ids)].filter((id) => !known.has(id));
      if (missing.length > 0) {
        try {
          for (const [id, label] of await source.fetch(missing))
            known.set(id, label);
        } catch (error) {
          console.warn(
            `[display] ${source.what}を ${missing.length} 件引けなかった ` +
              `(id をそのまま表示する):`,
            error,
          );
        }
      }
      return peek;
    },
  };
}
