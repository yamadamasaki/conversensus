/**
 * op を人が読める 1 行にする (#73 change inspector)
 *
 * 種類は日本語の短い名前、内容は op が運ぶ値のうち人が読めるもの (本文・名前・property の名前) にする。
 * 対象の要素の名前は inspector が別に出す (その時点の姿から引く) ので、ここでは載せない
 */

import type { Op } from '@conversensus/shared';

const KIND_LABELS: Partial<Record<Op['kind'], string>> = {
  'node.add': 'node を追加',
  'node.remove': 'node を削除',
  'node.setParent': 'node の親を変更',
  'node.setContent': 'node の本文を変更',
  'node.setLabel': 'node の種類を変更',
  'node.setProperty': 'node の property を変更',
  'node.setProperties': 'node の property を変更',
  'node.setLayout': 'node の位置・大きさを変更',
  'node.setStyle': 'node の見た目を変更',
  'edge.add': 'edge を追加',
  'edge.remove': 'edge を削除',
  'edge.reconnect': 'edge を繋ぎ替え',
  'edge.setLabel': 'edge の名前を変更',
  'edge.setProperty': 'edge の property を変更',
  'edge.setProperties': 'edge の property を変更',
  'edge.setLayout': 'edge の形を変更',
  'edge.setStyle': 'edge の見た目を変更',
  'edge.setLabelOffset': 'edge の名前の位置を変更',
};

/** 内容として出す文字の長さの上限。長い本文で inspector を埋めない */
export const DETAIL_MAX_LENGTH = 40;

function clip(text: string): string {
  return text.length > DETAIL_MAX_LENGTH
    ? `${text.slice(0, DETAIL_MAX_LENGTH)}…`
    : text;
}

/** op の種類の名前。知らない種類はそのまま出す */
export function opKindLabel(op: Op): string {
  return KIND_LABELS[op.kind] ?? op.kind;
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
