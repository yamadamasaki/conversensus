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
import { getAgent } from './client';

/**
 * PDS 所属の判定結果のキャッシュ。
 *
 * **step2 では単一 PDS が前提**なので、ある DID の所属が途中で変わることはない。
 * 名簿を畳むたびに全 DID を問い合わせると、参加者の数だけラウンドトリップが増える。
 */
const pdsMembership = new Map<Did, boolean>();

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
  const cached = pdsMembership.get(did);
  if (cached !== undefined) return cached;
  let hosted: boolean;
  try {
    await getAgent().api.com.atproto.repo.describeRepo({ repo: did });
    hosted = true;
  } catch {
    hosted = false;
  }
  pdsMembership.set(did, hosted);
  return hosted;
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
