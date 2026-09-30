import { describe, expect, it } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import fc from 'fast-check';
import {
  batchRkey,
  batchRkeyFileCursor,
  batchRkeyPrefix,
  parseBatchRkey,
  rkeyFromUri,
} from './batchRkey';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const OTHER = '22222222-2222-4222-8222-222222222222' as FileId;
const DEVICE = '33333333-3333-4333-8333-333333333333';
const ALICE = `did:plc:alice#${DEVICE}`;

/** ATProto の rkey に許される文字 */
const RKEY_CHARS = /^[A-Za-z0-9._:~-]+$/;
const RKEY_MAX_LENGTH = 512;

/** 実際に現れる actor の形。DID (`:` を含む) と端末 id、または genesis */
const arbActor = fc.oneof(
  fc.constant('genesis'),
  fc
    .tuple(
      fc.constantFrom('did:plc:alice', 'did:web:example.com', 'local'),
      fc.uuid(),
    )
    .map(([did, device]) => `${did}#${device}`),
);

describe('batchRkey', () => {
  it('<fileId>~<actor の # を : に>~<seq を 12 桁ゼロ詰め> を組む', () => {
    expect(batchRkey(FILE, ALICE, 7)).toBe(
      `${FILE}~did:plc:alice:${DEVICE}~000000000007`,
    );
  });

  it('あらゆる actor と seq で、ATProto の rkey として正しく、parse で往復する', () => {
    fc.assert(
      fc.property(arbActor, fc.nat({ max: 10 ** 12 - 1 }), (actor, seq) => {
        const rkey = batchRkey(FILE, actor, seq);
        expect(rkey).toMatch(RKEY_CHARS);
        expect(rkey.length).toBeLessThanOrEqual(RKEY_MAX_LENGTH);
        expect(parseBatchRkey(rkey)).toEqual({ fileId: FILE, actor, seq });
      }),
    );
  });

  it('同じ端末の別 actor (未ログインとログイン後) は別の rkey になる', () => {
    expect(batchRkey(FILE, `local#${DEVICE}`, 1)).not.toBe(
      batchRkey(FILE, `did:plc:alice#${DEVICE}`, 1),
    );
  });

  it('同じ actor の seq 順が辞書順と一致する (ゼロ詰めの目的)', () => {
    const rkeys = [1, 2, 10, 100, 999].map((s) => batchRkey(FILE, ALICE, s));
    expect([...rkeys].sort()).toEqual(rkeys);
  });

  it('seq が 12 桁に収まらなければ throw する', () => {
    expect(() => batchRkey(FILE, ALICE, 10 ** 12)).toThrow();
    expect(() => batchRkey(FILE, ALICE, -1)).toThrow();
    expect(() => batchRkey(FILE, ALICE, 1.5)).toThrow();
  });
});

describe('batchRkeyPrefix / batchRkeyFileCursor', () => {
  it('あらゆる actor と seq で、prefix はそのファイルの rkey に一致し、他ファイルには一致しない', () => {
    fc.assert(
      fc.property(arbActor, fc.nat({ max: 1000 }), (actor, seq) => {
        expect(
          batchRkey(FILE, actor, seq).startsWith(batchRkeyPrefix(FILE)),
        ).toBe(true);
        expect(
          batchRkey(OTHER, actor, seq).startsWith(batchRkeyPrefix(FILE)),
        ).toBe(false);
      }),
    );
  });

  it('あらゆる actor と seq で、cursor はそのファイルの rkey より小さく、次のファイルの rkey より小さい', () => {
    fc.assert(
      fc.property(arbActor, fc.nat({ max: 1000 }), (actor, seq) => {
        const rkey = batchRkey(FILE, actor, seq);
        // 昇順の seek は cursor より大きいものから始まるので、ファイルの先頭に着地する
        expect(batchRkeyFileCursor(FILE) < rkey).toBe(true);
        // 降順の飛び越しは cursor より小さいものへ進むので、そのファイルを丸ごと跳ぶ
        expect(batchRkeyFileCursor(OTHER) > rkey).toBe(true);
      }),
    );
  });
});

describe('parseBatchRkey', () => {
  it('セグメント数が違う rkey は null (v1 の rkey・他種)', () => {
    expect(parseBatchRkey(`v1~${FILE}~000000000001~abc`)).toBeNull();
    expect(parseBatchRkey(FILE)).toBeNull();
  });

  it('seq が固定幅の数字列でなければ null', () => {
    expect(parseBatchRkey(`${FILE}~genesis~1`)).toBeNull();
    expect(parseBatchRkey(`${FILE}~genesis~00000000000x`)).toBeNull();
  });

  it('fileId / actor が空なら null', () => {
    expect(parseBatchRkey('~genesis~000000000001')).toBeNull();
    expect(parseBatchRkey(`${FILE}~~000000000001`)).toBeNull();
  });
});

describe('rkeyFromUri', () => {
  it('AT-URI の末尾を返す', () => {
    expect(
      rkeyFromUri(`at://did:plc:a/app.x/${FILE}~genesis~000000000001`),
    ).toBe(`${FILE}~genesis~000000000001`);
  });
});
