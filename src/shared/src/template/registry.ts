import { TOULMIN_TEMPLATE } from './toulmin';
import type { Template } from './types';

/**
 * template graph の**種** (step3 Phase 4 S4-1c, Q1)。
 *
 * step3 で template は「システムに埋め込むもの」から「File の中の template graph」になった
 * (architecture step3: toulmin template は維持するが, template graph による定義とする)。ここに並ぶ
 * のは、利用者が「シートを追加 ▾」から **File に複製する** template graph の元の表である
 * (`templateGraphOf`)。**実行時に template を引く先ではない** — 当てたシートが参照するのは、
 * 複製された File の中の template graph とその切断面だけである (`resolveTemplates`)
 */
export const SEED_TEMPLATES: readonly Template[] = [TOULMIN_TEMPLATE];
