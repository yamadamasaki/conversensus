/**
 * PDS の firehose (`com.atproto.sync.subscribeRepos`) の 1 フレームを、受信の合図に要る分だけ解く (#252)
 *
 * ## なぜ PDS を直接読むか
 *
 * conversensus は小さなサーバ (数十人) がたくさん連合する前提で、細いネットワークもありうる
 * (利用者、2026-10-11)。全ネットワークを 1 か所に集めて配り直すリレーや Jetstream は、その形と
 * 向きが逆である。ブラウザが参加者の PDS へ直接繋ぐ。
 *
 * ## 合図に要る分だけ解く
 *
 * 流れは**合図**としてだけ使い、中身は今の受信の経路 (listRecords と検査) で取る (利用者判断)。
 * 要るのは commit の `repo` (DID) と `ops[].path` (`<collection>/<rkey>`) だけなので、record の中身
 * (`blocks` の CAR) は解かない。
 *
 * フレームは DAG-CBOR の値が 2 つ続いたもの: ヘッダ `{op, t}` と本文。`op: -1` はエラーのフレーム。
 * 本文の `ops[].cid` などの CID は tag 42 で来るので、中身を読まずに捨てる。
 */

import { decodeFirst, Tagged } from 'cborg';

/** firehose の口の XRPC の名前 */
export const SUBSCRIBE_REPOS_PATH = '/xrpc/com.atproto.sync.subscribeRepos';

/** commit が書いた 1 つの record の場所 */
export type CommitPath = { collection: string; rkey: string };

export type FirehoseCommit = {
  /** 書いた repo の DID */
  did: string;
  paths: CommitPath[];
};

/** CID (tag 42) は中身を読まずに受け流す。tag の decoder は値を読み進めなければならない */
const DECODE_OPTIONS = { tags: { 42: Tagged.decoder(42) } };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * フレームを解く。**commit でなければ null** (`#identity`・`#account`・`#sync`・`#info`・エラー)。
 * 形が崩れていても投げずに null — 合図が 1 つ抜けても、ポーリングが拾う
 */
export function decodeFirehoseFrame(frame: Uint8Array): FirehoseCommit | null {
  try {
    const [header, rest] = decodeFirst(frame, DECODE_OPTIONS);
    if (!isRecord(header) || header.op !== 1 || header.t !== '#commit') {
      return null;
    }
    const [body] = decodeFirst(rest, DECODE_OPTIONS);
    if (!isRecord(body) || typeof body.repo !== 'string') return null;
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const paths: CommitPath[] = [];
    for (const op of ops) {
      if (!isRecord(op) || typeof op.path !== 'string') continue;
      const slash = op.path.indexOf('/');
      if (slash <= 0) continue;
      paths.push({
        collection: op.path.slice(0, slash),
        rkey: op.path.slice(slash + 1),
      });
    }
    return { did: body.repo, paths };
  } catch {
    return null;
  }
}

/** PDS の URL (http/https) から firehose の URL (ws/wss) を作る。cursor は付けない (今から先だけ) */
export function firehoseUrlOf(pdsUrl: string): string {
  const url = new URL(SUBSCRIBE_REPOS_PATH, pdsUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
