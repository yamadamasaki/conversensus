import type { TemplateRef } from '../schemas';
import { TOULMIN_TEMPLATE } from './toulmin';
import type { Template } from './types';

/**
 * アプリに作り込まれている template の一覧。
 *
 * step2 で作るのは toulmin 一つだけである (spec/template.md)。**一覧という形にしてある
 * のは、シート作成時の選択肢がここから出るからである** — UI に toulmin を直書きすると、
 * template が増えたとき画面を書き直すことになる。
 *
 * template をユーザが定義できるようにするのは step3。そのときここが「作り込み分」に
 * 縮み、ユーザ定義分と併せて引かれる。
 */
export const BUILTIN_TEMPLATES: readonly Template[] = [TOULMIN_TEMPLATE];

/**
 * シートの `templateIds` (`TemplateRef` の配列) から、作り込みの template の実体を引く。
 *
 * **知らない id は黙って落とす。**共同作業では、相手が持っている template を自分が
 * 持たないことが起こり得る (step3 でユーザ定義になれば普通に起こる)。そこで例外を
 * 投げると、**相手の作ったシートを開けなくなる** — 種別が少し引けないより遥かに悪い。
 * 落とした結果は「template を当てていないシート」に連続的に近づく。
 */
export function templatesOf(
  templateIds: readonly TemplateRef[] | undefined,
  available: readonly Template[] = BUILTIN_TEMPLATES,
): Template[] {
  if (!templateIds) return [];
  return templateIds.flatMap((ref) =>
    // template graph の切断面 (step3 Phase 1 D7) はまだ解決しない。知らない id と同じく
    // 落とすので、「template を当てていないシート」に縮退する
    typeof ref === 'string' ? available.filter((t) => t.id === ref) : [],
  );
}
