/**
 * ハンドル名と DID の解決 (step2 Phase 1)
 *
 * UI の入力は**ハンドル名**だが、参加コードに載るのも名簿に載るのも **DID** である。
 * ハンドルは付け替えられるが DID は変わらないので、記録に残すのは DID でなければならない。
 *
 * あわせて「その DID がこの PDS に属するか」を判定する。仕様は他 PDS のアカウントの
 * 招待を「やらない」ではなく**「無効とする」**と定めている (`spec-step2.md`) ので、
 * これは名簿の畳み込みの pre 条件である。
 */

import type { Did } from '@conversensus/shared';
import { createLabelCache } from '../display/labelCache';
import { getAgent } from './client';

/** `describeRepo` が答えたもの。`null` は「この PDS にいない」 */
type RepoDescription = { handle: string } | null;

/**
 * `describeRepo` の結果のキャッシュ。
 *
 * **1 回の問い合わせが 2 つの答えを持つ。**「この PDS に属するか」(名簿の pre 条件) と
 * 「ハンドル名は何か」(画面の表示) は同じレコードから出るので、別々に引かない。
 *
 * **step2 では単一 PDS が前提**なので所属が途中で変わることはない。名簿を畳むたびに
 * 全 DID を問い合わせると、参加者の数だけラウンドトリップが増える。
 * ハンドル名は付け替えられるので、そちらは `handleLabels.forget()` で捨てられる。
 */
const repoDescriptions = new Map<Did, RepoDescription>();

/**
 * その DID の repo を引く。**成否がそのまま PDS 所属の判定になる**ので、
 * 失敗を例外にせず `null` として覚える。
 */
async function describeRepo(did: Did): Promise<RepoDescription> {
  const cached = repoDescriptions.get(did);
  if (cached !== undefined) return cached;
  let described: RepoDescription;
  try {
    const res = await getAgent().api.com.atproto.repo.describeRepo({
      repo: did,
    });
    described = { handle: res.data.handle };
  } catch {
    described = null;
  }
  repoDescriptions.set(did, described);
  return described;
}

/**
 * DID → ハンドル名。
 *
 * 名簿が持つのは DID だが、画面に出すのはハンドル名である
 * (`deepse/requirements/spec/participation.md` の図)。**記録にハンドル名を持たない**のは、
 * 付け替えられた瞬間に記録が嘘になるからで、だから見せる直前に引く。
 *
 * `isDidOnThisPds` と同じ `describeRepo` を使うので、**名簿の pre 条件を解決した後なら
 * 参加者分の追加リクエストは 0 である** (作成者だけは招待先ではないので 1 回増える)。
 */
export const handleLabels = createLabelCache<Did>({
  what: 'ハンドル名',
  fetch: async (dids) => {
    const found = new Map<Did, string>();
    await Promise.all(
      dids.map(async (did) => {
        const handle = (await describeRepo(did))?.handle;
        if (handle) found.set(did, handle);
      }),
    );
    return found;
  },
});

/** ハンドル名から DID を引く。解決できなければ `null` */
export async function resolveHandle(handle: string): Promise<Did | null> {
  try {
    const res = await getAgent().api.com.atproto.identity.resolveHandle({
      handle,
    });
    return res.data.did;
  } catch {
    // 存在しないハンドルは 400 で返る。呼び出し側は「見つからない」として扱えばよい
    return null;
  }
}

/**
 * その DID をこの PDS がホストしているか。
 *
 * `describeRepo` はホストしていない DID に対してエラーを返すので、**成否がそのまま
 * 所属の判定になる**。DID の書式からは判定できない (`did:plc:` はどの PDS でも使う)。
 *
 * **実在するが他 PDS にある DID も 400 (`RepoNotFound`) になる**ことを実機で確認した
 * (2026-08-31、bsky.app の公開アカウントの DID をローカル PDS に問い合わせた)。
 * 「存在しない DID」だけで確かめると、この区別が効いている証拠にならない。
 */
export async function isDidOnThisPds(did: Did): Promise<boolean> {
  return (await describeRepo(did)) !== null;
}

/**
 * 名簿を畳む**前に** DID の所属をまとめて解決し、同期の述語を作る。
 *
 * `foldParticipation` の `isLocalDid` が同期なのは、畳み込みの決定論を保つためである
 * (非同期にすると「あらゆる配送順で同じ名簿になる」の検証に解決の順序まで入り込む)。
 * ネットワークはここで済ませ、畳み込みには**確定した答えだけ**を渡す。
 *
 * **解決できなかった DID は「この PDS に属さない」として扱う。**招待を通してしまうより
 * 落とす方が安全で、しかも `rejected` に載るので UI に理由が出る。
 */
export async function buildLocalDidPredicate(
  dids: Iterable<Did>,
  check: (did: Did) => Promise<boolean> = isDidOnThisPds,
): Promise<(did: Did) => boolean> {
  const unique = [...new Set(dids)];
  const results = await Promise.all(
    unique.map(async (did) => [did, await check(did)] as const),
  );
  const local = new Map(results);
  return (did) => local.get(did) === true;
}
