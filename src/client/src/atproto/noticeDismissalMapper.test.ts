import { describe, expect, test } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import fc from 'fast-check';
import type { NoticeDismissal } from '../notices/types';
import {
  noticeDismissalRkey,
  noticeDismissalToRecord,
  recordToNoticeDismissal,
} from './noticeDismissalMapper';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const OTHER_FILE = '22222222-2222-4222-8222-222222222222' as FileId;

/** rkey に使える文字 (ATProto の record key の文法) */
const RKEY_CHARS = /^[A-Za-z0-9._:~-]+$/;
const RKEY_MAX_LENGTH = 512;

/**
 * 鍵の生成器: 実際の鍵と同じく区切りに `\u0000` を含み、長さの決まらない文字列。
 * **小さなプールから組む**ので、同じ鍵・1 文字違いの鍵を引く
 */
const arbKey = fc
  .array(
    fc.constantFrom('content', 'node', 'a', 'b', '\u0000', 'x'.repeat(300)),
    {
      minLength: 1,
      maxLength: 6,
    },
  )
  .map((parts) => parts.join(''));

const dismissal: NoticeDismissal = {
  fileId: FILE,
  key: 'content\u0000n1\u0000\u0000b1\u0000b2',
  dismissedAt: '2026-10-04T00:00:00.000Z',
};

describe('noticeDismissalRkey', () => {
  test('どんな鍵でも rkey の文法と長さに収まり、File の prefix で始まる', async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, async (key) => {
        const rkey = await noticeDismissalRkey(FILE, key);
        expect(rkey.startsWith(`${FILE}~`)).toBe(true);
        expect(rkey).toMatch(RKEY_CHARS);
        expect(rkey.length).toBeLessThanOrEqual(RKEY_MAX_LENGTH);
      }),
    );
  });

  test('同じ (File, 鍵) は同じ rkey、違えば違う rkey になる', async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, arbKey, async (a, b) => {
        const ra = await noticeDismissalRkey(FILE, a);
        const rb = await noticeDismissalRkey(FILE, b);
        expect(ra === rb).toBe(a === b);
      }),
    );
  });

  test('同じ鍵でも File が違えば別の rkey になる', async () => {
    expect(await noticeDismissalRkey(FILE, 'k')).not.toBe(
      await noticeDismissalRkey(OTHER_FILE, 'k'),
    );
  });
});

describe('往復と検証', () => {
  test('レコードへ落として戻すと元に戻る', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const d = { ...dismissal, key };
        expect(recordToNoticeDismissal(noticeDismissalToRecord(d))).toEqual(d);
      }),
    );
  });

  test('$type が付いていても読める', () => {
    const value = {
      $type: 'app.conversensus.v2.noticeDismissal',
      ...noticeDismissalToRecord(dismissal),
    };
    expect(recordToNoticeDismissal(value)).toEqual(dismissal);
  });

  test.each([
    ['fileId が UUID でない', { ...dismissal, fileId: 'not-a-uuid' }],
    ['鍵が空', { ...dismissal, key: '' }],
    ['dismissedAt が日時でない', { ...dismissal, dismissedAt: 'yesterday' }],
    ['null', null],
  ])('壊れたレコードは null: %s', (_, value) => {
    expect(recordToNoticeDismissal(value)).toBeNull();
  });
});
