/**
 * 参加コード (step2 Phase 1)
 *
 * 設計: `deepse/plans/step2-phase1-participation.md` §7
 * 仕様: `deepse/requirements/spec/participation.md`「ワークフロー」
 *
 * 招待者 DID + 被招待者 DID + fileId を運ぶ。招待者がこれを生成して相手に渡し、
 * 受け取った側が承認に使う。
 *
 * **秘密ではない。**本人以外の承認は名簿の畳み込みの pre 条件で落ちるので
 * (`participation.ts` の `issuerNotInvited`)、第三者が入手しても参加できない。
 * したがって暗号的な要求は無く、**署名も要らない** — 署名を足すより
 * 「招待者の repo にその invite op があるか」を確かめる方が確実で、しかも無料である
 * (被招待者は判断ログを 1 レコード読めばよい。名簿を別 collection にした理由の 1 つがこれ)。
 *
 * **base64url にするのは秘匿のためではない。**ユーザが中身を編集して壊す余地を減らし、
 * 改行やスペースが混ざったコピペに強くするためである。仕様も「表示せずに copy ボタン
 * だけでもいい」と述べている。
 */

import { z } from 'zod';

/** コードの形式バージョン。壊れた古いコードを黙って誤解釈しないために持つ */
const CODE_VERSION = 1;

/**
 * コードの中身。**キーを 1 文字にしてある** — 3 つの DID/UUID で 100 文字を超えるので、
 * 冗長なキー名の分だけコードが伸びる。読むのは機械だけである。
 */
const PayloadSchema = z.object({
  /** version */
  v: z.literal(CODE_VERSION),
  /** file */
  f: z.string().uuid(),
  /** inviter */
  i: z.string().min(1),
  /** target (invitee) */
  t: z.string().min(1),
});

export type ParticipationCodePayload = {
  fileId: string;
  inviter: string;
  invitee: string;
};

export type DecodeParticipationCodeResult =
  | { ok: true; payload: ParticipationCodePayload }
  | { ok: false; reason: DecodeFailure };

/**
 * 復号に失敗した理由。**UI が出し分けるために種類を残す** — 「貼り間違い」と
 * 「古いバージョンのコード」では、ユーザにしてもらうことが違う。
 */
export type DecodeFailure =
  /** base64url でない、または JSON として読めない */
  | 'malformed'
  /** 形式バージョンが違う */
  | 'unsupportedVersion'
  /** 形は JSON だが、必要な項目が揃っていない */
  | 'invalidFields';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(code: string): Uint8Array | null {
  const normalized = code.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeParticipationCode(
  payload: ParticipationCodePayload,
): string {
  const json = JSON.stringify({
    v: CODE_VERSION,
    f: payload.fileId,
    i: payload.inviter,
    t: payload.invitee,
  });
  return toBase64Url(new TextEncoder().encode(json));
}

/**
 * 参加コードを読む。**例外を投げない** — 入力はユーザが貼り付けた任意の文字列である。
 *
 * 前後の空白は落とす。コピペで改行が混ざるのは日常的に起きるうえ、
 * base64url の文字集合に空白は無いので、落としても曖昧さが生じない。
 */
export function decodeParticipationCode(
  code: string,
): DecodeParticipationCodeResult {
  const bytes = fromBase64Url(code.trim());
  if (!bytes) return { ok: false, reason: 'malformed' };

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // バージョンだけ先に見る。項目不足と「古いコード」を混同させないため
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'v' in raw &&
    raw.v !== CODE_VERSION
  ) {
    return { ok: false, reason: 'unsupportedVersion' };
  }

  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalidFields' };

  return {
    ok: true,
    payload: {
      fileId: parsed.data.f,
      inviter: parsed.data.i,
      invitee: parsed.data.t,
    },
  };
}
