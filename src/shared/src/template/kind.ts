import {
  canonicalPropertyName,
  SYSTEM_PROPERTY_PREFIX,
} from '../events/properties';
import type { PropertyName } from '../events/unified';
import type { EdgeKind, NodeKind, NodeKindId, Template } from './types';

/**
 * 要素が template の**どの種別か**を記録する property 名 (設計 D3)。
 *
 * **`nodeType` (markdown / グループ / 画像) の軸ではない。**toulmin の「主張」は
 * 見た目としては markdown node である。種別は意味の軸なので property に載せる。
 *
 * **システム接頭辞を付ける。**`.` を含まない名前は編集者のものである
 * (`spec/propertyEditor.md`「名前」)。template が使う名前は編集者のものではない。
 *
 * **template ごとに分けず 1 つにする。**複数 template は和で畳む (設計 §4) ので、
 * template ごとに `kind` を持つと 1 つの要素が 2 つの種別を持ててしまう。
 */
export const KIND_PROPERTY: PropertyName = `${SYSTEM_PROPERTY_PREFIX}kind`;

/** properties から種別 id を読む。無ければ undefined (= template の要素ではない) */
export function kindIdOf(
  properties: Readonly<Record<string, unknown>> | undefined,
): NodeKindId | undefined {
  if (!properties) return undefined;
  // 旧名の正規化を通す — 種別は新名でしか書かれないが、判定を 1 箇所に揃えておく
  for (const [name, value] of Object.entries(properties)) {
    if (canonicalPropertyName(name) !== KIND_PROPERTY) continue;
    return typeof value === 'string' && value !== ''
      ? (value as NodeKindId)
      : undefined;
  }
  return undefined;
}

/**
 * 種別 id から `NodeKind` を引く。当たっている template を順に見て**先勝ち**
 * (種別一覧の `unionById` と同じ規則)。
 *
 * `NodeKindId` は template の中でだけ一意なので、2 つの template が同じ id を使うと
 * 曖昧になる。1 つしか当てない間は起こらない (設計 §7)。
 */
export function nodeKindById(
  templates: readonly Template[],
  kindId: NodeKindId | undefined,
): NodeKind | undefined {
  if (kindId === undefined) return undefined;
  for (const t of templates) {
    const found = t.nodeKinds.find((k) => k.id === kindId);
    if (found) return found;
  }
  return undefined;
}

/**
 * 両端の種別から、その edge になりうる種類の**候補**を返す (設計 D5)。
 *
 * **候補の数が挙動を決める** — 0 なら繋げない、1 なら自動、複数なら選ばせる。
 * step2 で起こるのは 0 と 1 だけだが、**判定は最初から一般の形にしておく**。
 * 後から分岐を足すと「一意のときだけ通る実装」が固定される。
 *
 * 端点のどちらかが種別を持たなければ**空ではなく「制約の対象外」**である。
 * 呼び出し側が区別できるよう、その判定は `isTemplateEdge` に分けてある。
 */
export function edgeKindsBetween(
  templates: readonly Template[],
  fromKindId: NodeKindId | undefined,
  toKindId: NodeKindId | undefined,
): EdgeKind[] {
  if (fromKindId === undefined || toKindId === undefined) return [];
  return templates.flatMap((t) =>
    // **解決は template ごとに行う** — 和の上で引くと、T1 の edge 規則を T2 の
    // node 種別で満たす混線が起こる (id は template をまたいで一意ではない)
    t.nodeKinds.some((k) => k.id === fromKindId) &&
    t.nodeKinds.some((k) => k.id === toKindId)
      ? t.edgeKinds.filter(
          (ek) => ek.from.includes(fromKindId) && ek.to.includes(toKindId),
        )
      : [],
  );
}

/**
 * この接続が template の規則に従うべきものか (= 両端とも template の要素か)。
 *
 * **`edgeKindsBetween` が空であることと区別する。**両端とも種別を持つのに候補が
 * 0 なら「許されない組」で繋げないが、片端でも種別が無ければ「制約の対象外」で
 * 自由に繋げる (設計 D5)。両者を混同すると、普通のノードに繋げなくなる。
 */
export function isTemplateEdge(
  fromKindId: NodeKindId | undefined,
  toKindId: NodeKindId | undefined,
): boolean {
  return fromKindId !== undefined && toKindId !== undefined;
}
