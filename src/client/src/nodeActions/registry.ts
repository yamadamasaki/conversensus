import type { TemplateSeed } from '@conversensus/shared';
/**
 * 登録された module と、「この node に今使える操作」(計画 node-actions-request-module.md N1)
 *
 * 判断はすべてここに集め、純粋な関数にする。画面 (node のそば・右クリックのメニュー・dialog) は
 * ここが返すものを描くだけで、MCP の道具も同じ判断を使う。
 *
 * - **見るだけの所では何も出さない** (`readOnly`)。branch の閲覧・merger の passive pane など
 * - **使えない操作は出さない**。出すのは `available` が true のものだけ (登録の順)
 * - **実行の直前に確かめ直す** (`runNodeAction`)。dialog を開いている間に他の人が書けば、使えなくなって
 *   いることがある。常駐の agent が起動の直前に確かめ直すのと同じ構え
 * - module の `available`・`badge` が投げても、画面は落とさない。その操作・印は無いものとして扱う
 */

import {
  type ActionArgs,
  type ActionArgValue,
  type ActionParam,
  type ModuleNotice,
  type NodeAction,
  type NodeActionContext,
  NodeActionError,
  type NodeBadge,
  type NodeBadgeContext,
  type NodeModule,
  type NoticeDetectInput,
  type NoticeSource,
} from './nodeAction';

/** 操作の鍵 `<module>/<action>` の区切り */
const KEY_SEPARATOR = '/';

/** 知らせ 1 つ (どの module のものか)。既読の鍵は `noticeKeyOf` */
export type ArrivedNotice = ModuleNotice & { moduleId: string };

/** 既読の鍵: module の中の鍵に module の id を前に付ける (module の間で重ならない) */
export const noticeKeyOf = (notice: ArrivedNotice): string =>
  `${notice.moduleId}${KEY_SEPARATOR}${notice.key}`;

/** 印 1 つ (どの module のものか) */
export type ModuleBadge = { moduleId: string; badge: NodeBadge };

/** 使える操作 1 つ (どの module のものか) */
export type AvailableAction = {
  /** `<module>/<action>`。実行のときに使う */
  key: string;
  moduleId: string;
  action: NodeAction;
};

export type NodeActionRegistry = {
  readonly modules: readonly NodeModule[];
  /** この node に今使える操作 (登録の順)。`readOnly` なら空 */
  actionsFor: (
    ctx: NodeActionContext,
    options: { readOnly: boolean },
  ) => AvailableAction[];
  /** この node に描く印 (登録の順) */
  badgesFor: (ctx: NodeBadgeContext) => ModuleBadge[];
  /** 鍵から操作を引く。知らなければ undefined */
  find: (key: string) => AvailableAction | undefined;
  /** 受信から知らせを見つける (登録の順)。知らせを持つ module が無ければ空 */
  detectNotices: (input: NoticeDetectInput) => ArrivedNotice[];
  /** module の知らせの宣言 */
  noticeSource: (moduleId: string) => NoticeSource | undefined;
  /** module が出す template graph の種 (登録の順) */
  readonly seeds: readonly TemplateSeed[];
};

export const actionKey = (moduleId: string, actionId: string): string =>
  `${moduleId}${KEY_SEPARATOR}${actionId}`;

/** module の関数が投げたら、無いものとして扱う (画面を落とさない) */
function guarded<T>(what: string, fallback: T, f: () => T): T {
  try {
    return f();
  } catch (error) {
    console.warn(`[nodeActions] ${what} が投げた:`, error);
    return fallback;
  }
}

/**
 * module を登録する。id の重複・区切り文字を含む id は登録の誤りなので投げる
 * (起動のときに 1 度だけ呼ぶので、ここで止めてよい)
 */
export function createNodeActionRegistry(
  modules: readonly NodeModule[],
): NodeActionRegistry {
  const byKey = new Map<string, AvailableAction>();
  const moduleIds = new Set<string>();
  for (const m of modules) {
    if (m.id === '' || m.id.includes(KEY_SEPARATOR)) {
      throw new Error(`module の id が使えない: "${m.id}"`);
    }
    if (moduleIds.has(m.id)) throw new Error(`module の id が重なる: ${m.id}`);
    moduleIds.add(m.id);
    for (const action of m.actions) {
      if (action.id === '' || action.id.includes(KEY_SEPARATOR)) {
        throw new Error(`操作の id が使えない: "${m.id}/${action.id}"`);
      }
      const key = actionKey(m.id, action.id);
      if (byKey.has(key)) throw new Error(`操作の id が重なる: ${key}`);
      byKey.set(key, { key, moduleId: m.id, action });
    }
  }
  const all = [...byKey.values()];

  return {
    modules,
    actionsFor: (ctx, { readOnly }) =>
      readOnly
        ? []
        : all.filter((a) =>
            guarded(`${a.key} の available`, false, () =>
              a.action.available(ctx),
            ),
          ),
    badgesFor: (ctx) =>
      modules.flatMap((m) => {
        const badge = guarded(`${m.id} の badge`, undefined, () =>
          m.badge?.(ctx),
        );
        return badge ? [{ moduleId: m.id, badge }] : [];
      }),
    find: (key) => byKey.get(key),
    detectNotices: (input) =>
      modules.flatMap((m) =>
        m.notices
          ? guarded(
              `${m.id} の notices.detect`,
              [],
              () => m.notices?.detect(input) ?? [],
            ).map((n) => ({ ...n, moduleId: m.id }))
          : [],
      ),
    noticeSource: (moduleId) => modules.find((m) => m.id === moduleId)?.notices,
    seeds: modules.flatMap((m) => m.seeds ?? []),
  };
}

const isStringArray = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 引数 1 つを宣言どおりに確かめ、正しい形にする。足りない値は空 (選択肢は既定が無いので誤り) */
function checkParam(
  param: ActionParam,
  value: ActionArgValue | undefined,
): ActionArgValue {
  switch (param.kind) {
    case 'actors': {
      if (value === undefined) return [];
      if (!isStringArray(value)) {
        throw new NodeActionError(`${param.name} は DID の配列`);
      }
      // 同じ人を 2 度選んでも 1 人
      return [...new Set(value)] as ActionArgValue;
    }
    case 'choice': {
      if (
        typeof value !== 'string' ||
        !param.options.some((o) => o.value === value)
      ) {
        throw new NodeActionError(
          `${param.name} は ${param.options.map((o) => o.value).join(' / ')} のどれか`,
        );
      }
      return value;
    }
    case 'text': {
      const text = value ?? '';
      if (typeof text !== 'string') {
        throw new NodeActionError(`${param.name} は文字列`);
      }
      if (param.required && text.trim() === '') {
        throw new NodeActionError(`${param.name} が空`);
      }
      return text;
    }
  }
}

/**
 * 引数を宣言どおりに確かめる。**宣言に無い名前は断る** (MCP から来た引数の綴り違いを黙って捨てない)
 */
export function validateArgs(
  params: readonly ActionParam[],
  args: ActionArgs,
): ActionArgs {
  const known = new Set(params.map((p) => p.name));
  for (const name of Object.keys(args)) {
    if (!known.has(name)) throw new NodeActionError(`知らない引数: ${name}`);
  }
  return Object.fromEntries(
    params.map((p) => [p.name, checkParam(p, args[p.name])]),
  );
}

/**
 * 操作を実行して GraphEvent にする。**直前に確かめ直す**: 見るだけ・知らない操作・今は使えない・
 * 引数が合わない、のどれでも `NodeActionError` (`run` は呼ばない)
 */
export function runNodeAction(
  registry: NodeActionRegistry,
  key: string,
  ctx: NodeActionContext,
  args: ActionArgs,
  options: { readOnly: boolean },
) {
  if (options.readOnly)
    throw new NodeActionError('見るだけの所では操作できない');
  const found = registry.find(key);
  if (!found) throw new NodeActionError(`知らない操作: ${key}`);
  const usable = registry.actionsFor(ctx, options).some((a) => a.key === key);
  if (!usable) {
    throw new NodeActionError(`今この node には使えない: ${key}`);
  }
  return found.action.run(ctx, validateArgs(found.action.params ?? [], args));
}
