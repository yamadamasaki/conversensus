/**
 * 上書きの報告 (step2 Phase 3 T8)
 *
 * 検出は `sync/overwrites.ts`。ここは**出し方**だけを担う。
 *
 * ## 自動では出さない — 常設の印にする
 *
 * 報告は**順次編集でも鳴る**。相手が私の書いた文章を読んで直すたびに 1 件出るので、
 * 競合の通知 (`ConflictNotice`) と同じ強さで自動表示すると、共同編集の間じゅう
 * 通知が開き続ける。**通知が信用されなくなるのが一番まずい** — 本当に判断が要る
 * 競合まで読み飛ばされる。
 *
 * そこで「鳴る通知」ではなく**常設の控えめな印**にする。件数だけを出し、
 * **人が押したときだけ**一覧が開く。事実の報告なので、見に行く時機は人が決めてよい。
 *
 * ## 開閉は `<details>` に任せる
 *
 * 開いた・閉じたを state で持たない。キーボード操作と支援技術への対応が
 * ブラウザ側で済むうえ、**状態を持たない分だけ壊れない**。
 *
 * ## 生きた領域 (live region) にしない
 *
 * `ConflictNotice` は `role="status"` で読み上げに割り込むが、こちらは割り込まない。
 * 「自動で鳴らさない」という決着を、目で見える形だけでなく読み上げでも守る。
 */

import type { Did } from '@conversensus/shared';
import type { OverwriteReport } from './sync/overwrites';
import { overwriteKeyOf } from './sync/overwrites';

const ASPECT_LABEL = {
  position: '位置',
  size: '大きさ',
  route: '経路',
} as const;

/**
 * 1 件を 1 行で言い表す。**「競合しました」とは言わない** — 相手が私のを見た上で
 * 直しただけかもしれないので、並行だったとは言い切れない (T8 の決着)。
 * 言うのは**起きた事実**だけである。
 */
function describe(report: OverwriteReport): string {
  switch (report.category) {
    case 'content':
      return report.propertyName
        ? `プロパティ「${report.propertyName}」が別の値になりました`
        : '内容が書き換えられました';
    case 'structure':
      return 'つなぎ方が変えられました';
    case 'layout':
      return `${ASPECT_LABEL[report.aspect ?? 'position']}が変えられました`;
  }
}

type Props = {
  reports: readonly OverwriteReport[];
  /**
   * 対象の id を人が読める名前にする。**id は UUID なので出しても意味が無い** —
   * `ConflictNotice` と同じく、名前は分岐点の projection から引いたものを渡す
   */
  labelOf: (target: string) => string;
  /** 上書きした相手の DID を表示名にする (名簿の `labelOf`) */
  actorLabelOf: (did: Did) => string;
  /** 印ごと消す。報告は読めば済むものなので、閉じたら溜め直しでよい */
  onDismiss: () => void;
};

export function OverwriteNotice({
  reports,
  labelOf,
  actorLabelOf,
  onDismiss,
}: Props) {
  if (reports.length === 0) return null;

  return (
    <section
      aria-label="上書きの報告"
      style={{
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '50vh',
        overflowY: 'auto',
        background: '#fff',
        // **警告色を使わない。**判断を求めていないことを見た目で言う
        border: '1px solid #ccc',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        padding: '8px 12px',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <details>
        <summary
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
            color: '#555',
          }}
        >
          <span>
            あなたが書いた {reports.length} 件が, 相手の編集で変わりました
          </span>
        </summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          {reports.map((report) => (
            <li key={overwriteKeyOf(report)} style={{ marginBottom: 2 }}>
              <span style={{ fontWeight: 600 }}>{labelOf(report.target)}</span>:{' '}
              {describe(report)} ({actorLabelOf(report.by)})
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="上書きの報告を消す"
            style={{
              padding: '2px 8px',
              fontSize: 13,
              cursor: 'pointer',
              background: 'none',
              border: '1px solid #ccc',
              borderRadius: 4,
            }}
          >
            消す
          </button>
        </div>
      </details>
    </section>
  );
}
