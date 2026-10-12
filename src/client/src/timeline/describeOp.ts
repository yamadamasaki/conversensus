/**
 * op を人が読める 1 行にする (#73 change inspector)
 *
 * 種類は日本語の短い名前、内容は op が運ぶ値のうち人が読めるもの (本文・名前・property の名前) にする。
 * 対象の要素の名前は inspector が別に出す (その時点の姿から引く) ので、ここでは載せない
 */

import type { Op } from '@conversensus/shared';
import { messages } from '../i18n/messages';

/** 内容として出す文字の長さの上限。長い本文で inspector を埋めない */
export const DETAIL_MAX_LENGTH = 40;

function clip(text: string): string {
  return text.length > DETAIL_MAX_LENGTH
    ? `${text.slice(0, DETAIL_MAX_LENGTH)}…`
    : text;
}

/** op の種類の名前。知らない種類はそのまま出す */
export function opKindLabel(op: Op): string {
  const labels: Partial<Record<string, string>> = messages().timeline.opKinds;
  return labels[op.kind] ?? op.kind;
}

/** op が運ぶ値のうち、人が読めるもの。無ければ空 */
export function opDetail(op: Op): string {
  switch (op.kind) {
    case 'node.add':
    case 'node.setContent':
      return clip(op.content);
    case 'node.setLabel':
    case 'edge.setLabel':
      return clip(String(op.label ?? ''));
    case 'node.setProperty':
    case 'edge.setProperty':
      return op.name;
    default:
      return '';
  }
}
