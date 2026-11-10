/**
 * node・edge を書いた人 (#354、設計 agent-actor.md D2a)
 *
 * **その要素の意味を変える op を出した actor 全員**を作者とする。作者は op (batch の actor) に既にあるので、
 * op-log からの導出で足りる (op は足さない)。
 *
 * - 数える: 作成 (`node.add`・`edge.add`) と、中身・ラベル・プロパティ・親・つなぎ替え
 * - 数えない: 位置と見た目 (`setLayout`・`setStyle`・`setLabelOffset`) と、消すこと。並べ替えた人が全 node の作者に
 *   なるのを避ける
 * - 並べ方: **作った人を先頭に**、あとは最後に書いた順 (新しい順)。順序は畳み込みと同じ物差し
 *   (`compareByClockActorId`)
 * - 未ログインの actor (`local`) は数えない (ログインした時に自分の actor に書き換えて出し直す)
 */

import type { Did } from '../schemas';
import {
  type Batch,
  compareByClockActorId,
  didFromActor,
  LOCAL_DID,
  type Op,
} from './unified';

/** 作者に数える op の種類 */
const AUTHORING_KINDS: ReadonlySet<Op['kind']> = new Set<Op['kind']>([
  'node.add',
  'node.setContent',
  'node.setLabel',
  'node.setProperty',
  'node.setProperties',
  'node.setParent',
  'edge.add',
  'edge.setLabel',
  'edge.setProperty',
  'edge.setProperties',
  'edge.reconnect',
]);

/** 作成の op (作った人を先頭にするため) */
const CREATING_KINDS: ReadonlySet<Op['kind']> = new Set<Op['kind']>([
  'node.add',
  'edge.add',
]);

/** 要素の id → 作者の DID の列 (作った人が先頭、あとは最後に書いた順) */
export type Authors = ReadonlyMap<string, readonly Did[]>;

/** op-log から、node・edge ごとの作者を導く */
export function authorsOf(batches: readonly Batch[]): Authors {
  /** 要素ごと: 作った人と、actor ごとの最後に書いた位置 (畳み込みの順の番号) */
  const seen = new Map<string, { creator?: Did; last: Map<Did, number> }>();
  const ordered = [...batches].sort(compareByClockActorId);
  ordered.forEach((batch, position) => {
    const did = didFromActor(batch.actor) as Did;
    if (did === LOCAL_DID) return;
    for (const op of batch.ops) {
      if (!AUTHORING_KINDS.has(op.kind) || !('target' in op)) continue;
      const id = String(op.target);
      const entry = seen.get(id) ?? { last: new Map<Did, number>() };
      if (CREATING_KINDS.has(op.kind) && entry.creator === undefined) {
        entry.creator = did;
      }
      entry.last.set(did, position);
      seen.set(id, entry);
    }
  });
  const result = new Map<string, readonly Did[]>();
  for (const [id, { creator, last }] of seen) {
    const others = [...last]
      .filter(([did]) => did !== creator)
      .sort((a, b) => b[1] - a[1])
      .map(([did]) => did);
    result.set(id, creator ? [creator, ...others] : others);
  }
  return result;
}
