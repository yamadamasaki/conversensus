import type { EdgeLabel, NodeLabel } from '../schemas';
import type { EdgeKind, NodeKind, Template } from './types';

/**
 * 適用された template を畳んで種別の一覧・接続の可否を出す。
 *
 * **複数 template を前提にする** (設計 §4)。当面は 1 つしか当てないが、畳み方を後から
 * 決めると「1 つのときだけ通る実装」が固定される。畳み方は一貫して **和** である —
 * template は語彙を**足す**ものであって、狭めるものではない。
 */

/** id で重複を除いた和。**先に来た template の定義を残す** (メニューの並びを安定させる) */
function unionById<T extends { id: string }>(kinds: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const k of kinds) {
    if (seen.has(k.id)) continue;
    seen.add(k.id);
    out.push(k);
  }
  return out;
}

/** 選べる node の種別。適用された template の `nodeKinds` の和 */
export function nodeKindsOf(templates: readonly Template[]): NodeKind[] {
  return unionById(templates.flatMap((t) => t.nodeKinds));
}

/** 選べる edge の種別。適用された template の `edgeKinds` の和 */
export function edgeKindsOf(templates: readonly Template[]): EdgeKind[] {
  return unionById(templates.flatMap((t) => t.edgeKinds));
}

/** 接続の 3 値判定。**「違反」と「決まらない」は別物である** */
type Verdict = 'allowed' | 'violation' | 'undetermined';

/**
 * 1 つの template の中だけで判定する。
 *
 * **label → 種別の解決は template ごとに行う。**和の上で解決すると、T1 の edge 種別を
 * T2 の node 種別で満たす、という混線が起こる (id は template をまたいで一意ではない)。
 */
function verdictIn(
  t: Template,
  from: NodeLabel | undefined,
  to: NodeLabel | undefined,
  edge: EdgeLabel | undefined,
): Verdict {
  const fromKind = t.nodeKinds.find((k) => k.label === from);
  const toKind = t.nodeKinds.find((k) => k.label === to);
  const edgeKinds = t.edgeKinds.filter((k) => k.label === edge);

  // どれか一つでもこの template の語彙に無ければ、この template は何も言えない。
  //
  // **設計 D5 (種別が空なら警告しない) もここに落ちる。**`NodeKind.label` /
  // `EdgeKind.label` は `min(1)` なので、空や未設定はどの種別とも一致しない。
  // 「まだ種別を付けていない」と「知らない種別名」は、判定の上では同じ**語彙に無い**
  // であり、別の分岐で書く必要が無い (書くと、どのテストでも区別できない枝が増える)。
  // 既存グラフに template を当てる途中ではどちらも普通に在る (設計 §7)
  if (!fromKind || !toKind || edgeKinds.length === 0) return 'undetermined';

  const ok = edgeKinds.some(
    (ek) => ek.from.includes(fromKind.id) && ek.to.includes(toKind.id),
  );
  return ok ? 'allowed' : 'violation';
}

/**
 * この接続が template に反していないか。**反していても拒否はせず、警告に使う** (設計 D5)。
 *
 * 判定は 3 値の和である — **どの template の規則にも合わないときだけ** false。
 * 片方が許していれば警告しない。
 *
 * **「許容の単調な和」ではない。**「template を足すと許容が減らない」を性質として
 * 課すと、**語彙を知らない template を足しただけで既存の警告が消える** (`undetermined` が
 * 拒否権を打ち消してしまう)。和を取るのは**規則**であって許容ではないので、
 * 「許すものが在れば許す / 無くて違反が在れば警告」の順で見る。
 *
 * **`false` は「違反が確定した」を意味する。**決まらない場合はすべて `true` を返す:
 *
 * - template が当たっていない
 * - 端点かエッジの種別が空 (設計 D5)。既存グラフに template を当てる途中では普通に起こる
 *   ので、ここで警告すると「まだ種別を付けていない」が全部警告になる
 * - 種別名がどの template の語彙にも無い (孤児)。template 側で種別名を変えると起こる (§7)
 */
export function isConnectionAllowed(
  templates: readonly Template[],
  connection: {
    fromLabel?: NodeLabel;
    toLabel?: NodeLabel;
    edgeLabel?: EdgeLabel;
  },
): boolean {
  const { fromLabel, toLabel, edgeLabel } = connection;
  const verdicts = templates.map((t) =>
    verdictIn(t, fromLabel, toLabel, edgeLabel),
  );
  // 許す規則が一つでもあれば許す (片方が許していれば警告しない)
  if (verdicts.includes('allowed')) return true;
  // 誰も許さないとき、違反と言う template が居てはじめて警告する。
  // 全員が黙っている (template 無し / 語彙に無い) なら決まらないので許す
  return !verdicts.includes('violation');
}
