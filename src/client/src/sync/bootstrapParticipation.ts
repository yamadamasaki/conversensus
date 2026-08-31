/**
 * bootstrapParticipation: 既存 File に名簿の起点を置く (step2 Phase 1)
 *
 * 設計: `deepse/plans/step2-phase1-participation.md` §4
 *
 * **step1 で作った File には名簿の起点が無い。**「file を作った actor が自動的に参加する」を
 * 成立させたいが、`file.create` op が無く genesis batch の actor は `GENESIS_ACTOR` という
 * 固定文字列なので、**作成者の DID がグラフの op-log のどこにも載っていない** (事実 7)。
 * 起点が無いと最初の招待が pre 条件で落ち、誰も参加できない。
 *
 * そこで、**今ログインしている DID を genesis として書く**。step1 の File は単一 actor で
 * 作られているので取り違えは起きない — が、それに寄りかからず**実際に op-log を見て
 * 確かめる** (下の `isSolelyOwnedBy`)。Phase 2 で他 actor の File がローカルに現れるように
 * なった後にこの移行が走っても、他人の File を自分のものだと宣言しない。
 *
 * べき等である。genesis の id は fileId と actor から決定論的に導かれ (`
 * participationGenesisBatch`)、rkey もそこから決まるので、**何度走らせても同じ
 * レコードに収束する**。marker は「毎回 N 回読みに行かない」ためのものであって、
 * 正しさの前提ではない。
 */

import {
  type Actor,
  type Batch,
  type Did,
  didFromActor,
  type FileId,
  GENESIS_ACTOR,
  isFileDeleted,
  type JudgmentBatch,
  LOCAL_DID,
  participationGenesisBatch,
} from '@conversensus/shared';
import { safeLocalStorage } from './safeStorage';

/** bootstrap 済 marker の localStorage キーの前置き。DID を連結して端末 × アカウント単位にする */
export const PARTICIPATION_BOOTSTRAP_STORAGE_PREFIX =
  'conversensus_participation_bootstrapped_v1:';

/** localStorage が使えない環境の退避先 (セッション内のみ)。手続きはべき等なので無害 */
const inMemoryBootstrapped = new Set<string>();

export type BootstrapParticipationDeps = {
  /** ローカルに存在する File の id (削除済みを含む既知集合でよい) */
  listLocalFileIds: () => Promise<FileId[]>;
  /** ローカル正典の batch を読む。「本当に自分の File か」の判定に使う */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  /** **自分の repo で**判断ログを持つ fileId を列挙する */
  listJudgmentFileIds: () => Promise<FileId[]>;
  /** 判断 batch を自分の repo へ書く */
  putJudgment: (fileId: FileId, batch: JudgmentBatch) => Promise<void>;
  /** この端末の actor (`<did>#<deviceId>`) */
  actor: Actor;
  hasBootstrapped: () => boolean;
  markBootstrapped: () => void;
};

export type BootstrapParticipationResult =
  | { status: 'already-bootstrapped' }
  | {
      status: 'done';
      /** genesis を書いた File 数 */
      wrote: number;
      /** 既に判断ログがあったので触らなかった File 数 */
      skippedExisting: number;
      /** 自分だけの File ではないので触らなかった File 数 */
      skippedForeign: number;
      /** 削除済みなので触らなかった File 数 */
      skippedDeleted: number;
      elapsedMs: number;
    };

/**
 * その op-log が `did` (とログイン前の自分・genesis) だけで書かれているか。
 *
 * **他人の op が 1 件でもあれば、自分が作った File ではない。**名簿の起点は
 * 「誰が作ったか」の主張なので、確かめずに書いてはならない。
 *
 * `LOCAL_DID` を許すのは、ログイン前に作った File が `local#<deviceId>` の actor を
 * 持つためである。それは自分の端末で自分が作ったものに他ならない。
 */
export function isSolelyOwnedBy(batches: readonly Batch[], did: Did): boolean {
  return batches.every((batch) => {
    const actorDid = didFromActor(batch.actor);
    return (
      actorDid === did || actorDid === LOCAL_DID || actorDid === GENESIS_ACTOR
    );
  });
}

export async function bootstrapParticipation(
  deps: BootstrapParticipationDeps,
): Promise<BootstrapParticipationResult> {
  if (deps.hasBootstrapped()) return { status: 'already-bootstrapped' };
  const startedAt = Date.now();
  const did = didFromActor(deps.actor);

  // 1 回の列挙で「既に判断ログがある File」を割り出す。File ごとに読みに行くと
  // File 数だけリクエストが要る (名簿は滅多に変わらないので列挙で足りる)
  const existing = new Set<FileId>(await deps.listJudgmentFileIds());

  let wrote = 0;
  let skippedExisting = 0;
  let skippedForeign = 0;
  let skippedDeleted = 0;

  for (const fileId of await deps.listLocalFileIds()) {
    if (existing.has(fileId)) {
      skippedExisting += 1;
      continue;
    }
    const batches = await deps.fetchBatches(fileId);
    // 削除済みの File に起点を置いても意味がない (誰も招待しない)
    if (isFileDeleted(batches)) {
      skippedDeleted += 1;
      continue;
    }
    if (!isSolelyOwnedBy(batches, did)) {
      skippedForeign += 1;
      continue;
    }
    await deps.putJudgment(
      fileId,
      participationGenesisBatch(fileId, deps.actor),
    );
    wrote += 1;
  }

  deps.markBootstrapped();
  return {
    status: 'done',
    wrote,
    skippedExisting,
    skippedForeign,
    skippedDeleted,
    elapsedMs: Date.now() - startedAt,
  };
}

export function hasParticipationBootstrapped(
  did: string,
  storage?: Storage,
): boolean {
  const store = storage ?? safeLocalStorage();
  if (!store) return inMemoryBootstrapped.has(did);
  return store.getItem(PARTICIPATION_BOOTSTRAP_STORAGE_PREFIX + did) !== null;
}

/**
 * bootstrap 済 marker を立てる。
 *
 * 書き込みに失敗しても**例外にしない** — bootstrap そのものは成功しているので、
 * marker が残らずに次回もう一度走ること (べき等なので無害) の方が、成功した bootstrap を
 * 失敗として扱うより正しい。ただし静かには済ませない。
 */
export function markParticipationBootstrapped(
  did: string,
  storage?: Storage,
): void {
  inMemoryBootstrapped.add(did);
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(
      PARTICIPATION_BOOTSTRAP_STORAGE_PREFIX + did,
      new Date().toISOString(),
    );
  } catch (error) {
    console.warn(
      '[participation] bootstrap marker の保存に失敗した (次回もう一度走る):',
      error,
    );
  }
}
