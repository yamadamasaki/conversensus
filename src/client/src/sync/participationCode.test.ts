import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  decodeParticipationCode,
  encodeParticipationCode,
  type ParticipationCodePayload,
} from './participationCode';

const payload: ParticipationCodePayload = {
  fileId: '11111111-1111-4111-8111-111111111111',
  inviter: 'did:plc:alice',
  invitee: 'did:plc:bob',
};

describe('往復', () => {
  test('符号化して読み戻すと元に戻る', () => {
    const decoded = decodeParticipationCode(encodeParticipationCode(payload));
    expect(decoded).toEqual({ ok: true, payload });
  });

  test('前後の空白は落とす — コピペで改行が混ざるのは日常的に起きる', () => {
    const code = encodeParticipationCode(payload);
    expect(decodeParticipationCode(`\n  ${code}\t\n`)).toEqual({
      ok: true,
      payload,
    });
  });

  test('base64url なので URL に置ける文字だけになる', () => {
    // `+` `/` `=` が残っていると, URL やクエリに載せたときに壊れる
    expect(encodeParticipationCode(payload)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('壊れた入力 — 例外を投げず理由を返す', () => {
  // 入力はユーザが貼り付けた任意の文字列である。UI が理由で出し分けるので、
  // 「貼り間違い」と「古いコード」を混同させない

  test('base64url でなければ malformed', () => {
    expect(decodeParticipationCode('これは参加コードではない')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('空文字も malformed', () => {
    expect(decodeParticipationCode('')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('base64 だが JSON でなければ malformed', () => {
    expect(decodeParticipationCode(btoa('not json'))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('形式バージョンが違えば unsupportedVersion', () => {
    const old = btoa(
      JSON.stringify({ v: 0, f: payload.fileId, i: 'a', t: 'b' }),
    );
    expect(decodeParticipationCode(old)).toEqual({
      ok: false,
      reason: 'unsupportedVersion',
    });
  });

  test('項目が欠けていれば invalidFields', () => {
    const broken = btoa(JSON.stringify({ v: 1, f: payload.fileId }));
    expect(decodeParticipationCode(broken)).toEqual({
      ok: false,
      reason: 'invalidFields',
    });
  });

  test('fileId が UUID でなければ invalidFields', () => {
    // 名簿は File 単位なので、ここが壊れていると読む先が決まらない
    const broken = btoa(
      JSON.stringify({ v: 1, f: 'not-a-uuid', i: 'a', t: 'b' }),
    );
    expect(decodeParticipationCode(broken)).toEqual({
      ok: false,
      reason: 'invalidFields',
    });
  });
});

describe('性質', () => {
  test('∀ payload. 符号化 → 復号で元に戻る', () => {
    // DID の書式は方式が複数あり (`did:plc:` / `did:web:` など) 固定できない。
    // 例で 1 つ選ぶと、選ばなかった書式で壊れても気づけない
    const did = fc
      .tuple(
        fc.constantFrom('plc', 'web', 'key'),
        fc.string({ minLength: 1, maxLength: 24 }),
      )
      .map(([method, id]) => `did:${method}:${id}`);
    const arb = fc.record({
      fileId: fc.uuid(),
      inviter: did,
      invitee: did,
    });

    fc.assert(
      fc.property(arb, (p) => {
        expect(decodeParticipationCode(encodeParticipationCode(p))).toEqual({
          ok: true,
          payload: p,
        });
      }),
    );
  });

  test('∀ 任意の文字列. 復号は例外を投げない', () => {
    // ユーザが何を貼っても落ちてはならない
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => decodeParticipationCode(s)).not.toThrow();
      }),
    );
  });
});
