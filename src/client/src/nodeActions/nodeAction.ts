/**
 * node の操作の拡張点 (計画 node-actions-request-module.md §3.2、N1)
 *
 * core が知るのは「node に操作がある」「node に印がある」ことだけで、どんな操作があるかは module が
 * 登録する (依頼が最初の利用者)。module は**宣言と純粋な関数だけ**を持つ:
 *
 * - React も React Flow の store も触らない。渡された値 (`NodeActionContext`) を読み、GraphEvent を返す
 * - 引数は宣言し (`ActionParam`)、dialog は core が描く (計画 Q2)。同じ宣言から MCP の道具も作れる
 * - 文言は module が自分で持つ (`LocalizedText`)。core の辞書 (`i18n/ja.ts`) に module の言葉を入れない
 *
 * こうしておけば、同じ module を画面でも headless (MCP・常駐の agent) でも使え、将来プラグインに
 * するときも、読み込むのはデータと純粋な関数だけで済む。
 */

import type { Did, GraphEdge, GraphNode, Sheet } from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import type { Locale } from '../i18n/locale';

/** 言語ごとの文言。辞書のある言語すべてを持つ (欠けると型で分かる) */
export type LocalizedText = Readonly<Record<Locale, string>>;

/** 引数の候補になる actor (開いている File の参加者) */
export type ActionActor = { did: Did; label: string };

/** 操作を考えるときに module に渡すもの。module はこれだけを読む */
export type NodeActionContext = {
  /** 操作の対象 */
  node: GraphNode;
  /** node のある Sheet (edge を含む。答えの置き場所や状態の導出に要る) */
  sheet: Sheet;
  /** 操作する人。ログインしていなければ undefined */
  me: Did | undefined;
  /** 開いている File の参加者 */
  participants: readonly ActionActor[];
  /** 操作する人の言語。操作が書く文言 (依頼の答えの edge の「答え」など) をこの言語にする */
  locale: Locale;
};

/**
 * 引数の宣言。**型は小さく保つ** — core が dialog を描ける型だけを持つ。足すときは core の dialog と
 * 引数の確かめ (`validateArgs`) を一緒に足す
 */
export type ActionParam =
  /** 参加者から 0 人以上を選ぶ。値は DID の配列 */
  | { name: string; kind: 'actors'; label: LocalizedText }
  /** 選択肢から 1 つ。値は選んだものの `value` */
  | {
      name: string;
      kind: 'choice';
      label: LocalizedText;
      options: readonly { value: string; label: LocalizedText }[];
    }
  /** 本文。`required` なら空白だけは受けない */
  | {
      name: string;
      kind: 'text';
      label: LocalizedText;
      multiline?: boolean;
      required?: boolean;
    };

/** 引数の値: `actors` は DID の配列、`choice`・`text` は文字列 */
export type ActionArgValue = readonly Did[] | string;
export type ActionArgs = Readonly<Record<string, ActionArgValue>>;

/** node への操作 1 つ */
export type NodeAction = {
  /** module の中で一意 */
  id: string;
  label: LocalizedText;
  /** この node に今使えるか。使えなければ出さない (押せるのに効かない形を作らない) */
  available: (ctx: NodeActionContext) => boolean;
  /** 引数。無ければ押してすぐ実行する。あれば dialog で決めてから実行する */
  params?: readonly ActionParam[];
  /** dialog を開いたときの値 (多くは node の property から読む — 前に決めた値が入っている) */
  initial?: (ctx: NodeActionContext) => ActionArgs;
  /**
   * 実行: GraphEvent **1 つ**にする。1 つの event は op の batch 1 つで、1 回の undo で戻る。
   * 引数を property に書く操作は、引数と操作の印を 1 つの `NODE_PROPERTIES_CHANGED` にまとめる
   * (分けると、undo が途中で止まり、届くのも別々になる)。引数は宣言どおりに確かめてから渡す (`runNodeAction`)
   */
  run: (ctx: NodeActionContext, args: ActionArgs) => GraphEvent;
};

/** node の上に描く印の調子 */
export type BadgeTone = 'muted' | 'normal' | 'primary';

/**
 * node の上に描く印 (状態など)。文言と調子だけを返し、描くのは core。`value` は機械が読む値
 * (`data-badge-value` に出す。試験と、将来の絞り込みのため)
 */
export type NodeBadge = { text: LocalizedText; tone: BadgeTone; value: string };

/**
 * 印を決めるときに module に渡すもの。**すべての node について、canvas が変わるたびに**呼ばれるので、
 * Sheet 全体ではなく node だけを渡し、出ていく edge は要るときにだけ引く (`outgoing`)。印を持たない
 * node は property を見るだけで済ませる
 */
export type NodeBadgeContext = {
  node: GraphNode;
  /** この node から出ている edge (ゴーストを除く)。引いたときにだけ数える */
  outgoing: () => readonly GraphEdge[];
};

/** module: 操作と印をまとめたもの */
export type NodeModule = {
  /** 全体で一意。操作は `<module>/<action>` で呼ぶ */
  id: string;
  actions: readonly NodeAction[];
  /** この node に印があれば返す */
  badge?: (ctx: NodeBadgeContext) => NodeBadge | undefined;
};

/** 操作できない (使えない・引数が合わない・知らない操作)。画面は知らせ、MCP は理由を返す */
export class NodeActionError extends Error {}
