import { X } from 'lucide-react';
import { color, font, radius, shadow, space } from './theme';
import { Button, IconButton } from './ui/Button';
/**
 * 競合の通知 (step2 Phase 3 T4)
 *
 * 検出した競合を人に届ける唯一の口である。ここが無いと、T1-T3 で検出した競合は
 * `console.warn` にしか出ず「検出したが誰にも届かない」で終わる (設計の事実 B)。
 *
 * ## モーダルにしない
 *
 * 仕様の 3 段のうち **layout の競合は日常的に起きる** — 共同編集で二人が同じノードを
 * 動かすことは普通にある。毎回モーダルで止めると、通知が作業の障害物になる。
 * 非モーダルの通知にして、閉じる操作を人に委ねる。
 *
 * ## 3 段の出し分けは「扱いが違うこと」を見せる
 *
 * 件数を並べるだけでは 3 段にした意味が無い。**人の判断が要るのか、結果の報告なのか**が
 * 一目で分かるようにする (`spec/merging.md`)。
 *
 * | 種別 | 扱い | この画面での見せ方 |
 * | --- | --- | --- |
 * | content | DtR graph を強制起動 | 開いた状態。決着が要ると書く |
 * | structure | 通知し, 手動で DtR 起動 | 開いた状態。何の前提が壊れたかを書く |
 * | layout | 通知のみ | **畳んだ状態**。結果の報告だと書く |
 *
 * **DtR graph の起動口はまだ無い** (Phase 6)。ここで起動の見た目だけを作ると、押せない
 * ボタンか, 何も起きないボタンになる。**起動口は fork を書く T6 で, 行き先ができてから
 * 付ける。**
 */

import type { ForkMeta, MergeConflict } from '@conversensus/shared';
import { messages, useMessages } from './i18n/messages';

/**
 * 通知の重なり順。ダイアログ (1000) より下、画面上の浮遊 UI (100) より上。
 *
 * **位置は自分で持たない。**上書きの報告 (T8) と同じ隅に出るので、重ならないよう
 * 積むのは呼び出し側 (`App` の通知スタック) の仕事である。
 */
export const NOTICE_Z_INDEX = 900;

/** 通知の段。仕様の 3 段そのもの */
type Tier = {
  category: MergeConflict['category'];
  /** 既定で開くか。人の判断が要る段だけ開く (段の名前と扱われ方は辞書の `conflicts.tiers`) */
  open: boolean;
};

const TIERS: Tier[] = [
  { category: 'content', open: true },
  { category: 'structure', open: true },
  { category: 'layout', open: false },
];

/**
 * 競合の同一性。**単位は「対象 + 何について揉めたか」**である (検出側の単位キーと同じ)。
 * 同じ対象に content と layout、あるいは position と size が並ぶので、対象だけでは足りない
 */
function keyOf(conflict: MergeConflict): string {
  const about =
    conflict.category === 'layout'
      ? conflict.aspect
      : (conflict.propertyName ?? '');
  return `${conflict.category}:${conflict.target}:${about}`;
}

/**
 * 何について揉めたか。検出した競合 (`MergeConflict`) と、fork に凍結された記述
 * (`ForkOrigin`, T7-5) の両方がこの形を満たす。**言い方を 1 か所に置く** — 同じ競合が
 * 「検出した」と「相手が保留した」で違う言葉になると、別の出来事に見える
 */
type ConflictUnit = {
  category: MergeConflict['category'];
  propertyName?: string;
  kind?: 'removeDependency' | 'parallelChange';
  aspect?: 'position' | 'size' | 'route';
};

/** 1 件の競合を 1 行で言い表す。**対象が何かと、何が起きたか**の 2 つだけ */
function describe(unit: ConflictUnit): string {
  const t = messages().conflicts;
  switch (unit.category) {
    case 'content':
      return unit.propertyName ? t.property(unit.propertyName) : t.content;
    case 'structure':
      return unit.kind === 'removeDependency'
        ? t.removeDependency
        : t.parallelStructure;
    case 'layout':
      return t.layout(t.aspects[unit.aspect ?? 'position']);
  }
}

type Props = {
  conflicts: readonly MergeConflict[];
  /**
   * 対象の id を人が読める名前にする。
   *
   * **id をそのまま出さない。**target は UUID なので、出しても何のことか分からない。
   * 名前を引くのは呼び出し側の仕事である — **いま開いているシートからは引けない**
   * (削除依存の対象はまさに消された要素なので居ない)。merge の結果が運ぶ
   * 「分岐点での名前」から引く。
   */
  labelOf: (target: string) => string;
  /**
   * 保留の記録 (fork) として書かれた件数 (step2 Phase 3 T6)。
   *
   * **explicit merge では 0 である** — あちらは人が押した merge なので、保留ではなく
   * 取り込みが起きている。implicit merge だけが fork を作る。
   */
  forkCount?: number;
  /**
   * 相手が書いた fork (保留した競合) の到着 (step2 Phase 3 T7-5)。
   *
   * 当事者は両方とも自分で競合を検出する (step3 Phase 1 D4) ので、ここに出るのは主に
   * **自分では検出しなかった第三者**である (対立の片側がまだ届いていない、または両側が
   * 同じ受信で新着になった)。その人はこれでしか保留を知らない。
   * 仕様は fork の通知を対話グラフ (DtR) への入口とするので、控えめな印ではなくここに出す。
   * 名前と何が起きたかは fork に凍結された記述 (`origin`) から出す — 相手の手元で検出された
   * 競合なので、こちらの projection からは引けないことがある
   */
  arrivedForks?: readonly ForkMeta[];
  /** 保留した競合を merger で決める (step3 Phase 5 S5-3)。無ければ入口を出さない */
  onOpenMerger?: (fork: ForkMeta) => void;
  onClose: () => void;
};

export function ConflictNotice({
  conflicts,
  labelOf,
  forkCount = 0,
  arrivedForks = [],
  onOpenMerger,
  onClose,
}: Props) {
  const t = useMessages();
  if (conflicts.length === 0 && arrivedForks.length === 0) return null;

  const byTier = TIERS.map((tier) => ({
    tier,
    items: conflicts.filter((c) => c.category === tier.category),
  })).filter(({ items }) => items.length > 0);

  return (
    <section
      role="status"
      aria-label={t.conflicts.region}
      style={{
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '60vh',
        overflowY: 'auto',
        background: color.bg,
        // 判断が要る通知 (visual language §6.3): 競合の色の左の帯で、ほかの通知と分ける
        border: `1px solid ${color.border}`,
        borderLeft: `4px solid ${color.conflict}`,
        borderRadius: radius.md,
        boxShadow: shadow.dialog,
        padding: 16,
        fontSize: font.body,
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <strong>
          {conflicts.length > 0
            ? t.conflicts.detected(conflicts.length)
            : t.conflicts.arrived(arrivedForks.length)}
        </strong>
        <IconButton
          icon={X}
          small
          label={t.conflicts.close}
          onClick={onClose}
        />
      </div>

      {forkCount > 0 && (
        // **通知だけでは消えてしまう。**保留したことを記録に残したと伝える —
        // 後から「何でこれが生じたんだ?」に答えられるのはこの記録である
        <p style={{ margin: '8px 0 0', color: color.textMuted }}>
          {t.conflicts.recorded(forkCount)}
        </p>
      )}

      {byTier.map(({ tier, items }) => (
        <details key={tier.category} open={tier.open} style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {t.conflicts.tierCount(
              t.conflicts.tiers[tier.category].title,
              items.length,
            )}
          </summary>
          <p style={{ margin: '4px 0 8px', color: color.textMuted }}>
            {t.conflicts.tiers[tier.category].handling}
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {items.map((c) => (
              <li key={keyOf(c)} style={{ marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>{labelOf(c.target)}</span>:{' '}
                {describe(c)}
              </li>
            ))}
          </ul>
        </details>
      ))}

      {arrivedForks.length > 0 && (
        // 判断が要る段 (content / structure) の保留なので開いて出す
        <details open style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {t.conflicts.arrivedHeading(arrivedForks.length)}
          </summary>
          <p style={{ margin: '4px 0 8px', color: color.textMuted }}>
            {t.conflicts.arrivedNote}
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {arrivedForks.map((fork) => (
              <li key={fork.conflictKey} style={{ marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>
                  {fork.origin.targetLabel === ''
                    ? t.conflicts.unnamed
                    : fork.origin.targetLabel}
                </span>
                : {describe(fork.origin)}
                {onOpenMerger && (
                  <Button
                    variant="primary"
                    className="cs-btn--sm"
                    onClick={() => onOpenMerger(fork)}
                    style={{ marginLeft: space[2] }}
                  >
                    {t.conflicts.decideInMerger}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
