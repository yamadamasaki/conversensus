import { describe, expect, it } from 'bun:test';
import type { BatchId, FileId } from '@conversensus/shared';
import {
  batchIdFromRkey,
  batchRkey,
  batchRkeyFileCursor,
  batchRkeyPrefix,
  parseBatchRkey,
  RKEY_VERSION_PREFIX,
} from './batchRkey';

const fid = (hex: string) => `${hex}-1111-4111-8111-111111111111` as FileId;
const bid = (hex: string) => `${hex}-2222-4222-8222-222222222222` as BatchId;

const FILE_A = fid('11111111');
const FILE_B = fid('55555555');
const BATCH = bid('9b7e0000');

describe('batchRkey', () => {
  it('v1~<fileId>~<clock を 12 桁ゼロ詰め>~<batchId> を組む', () => {
    expect(batchRkey(FILE_A, 42, BATCH)).toBe(
      `v1~${FILE_A}~000000000042~${BATCH}`,
    );
  });

  it('長さが ATProto の rkey 上限 512 に収まる', () => {
    expect(batchRkey(FILE_A, 999999999999, BATCH).length).toBe(89);
  });

  it('同じ batch からは常に同じ rkey が出る (putRecord のべき等性の前提)', () => {
    expect(batchRkey(FILE_A, 7, BATCH)).toBe(batchRkey(FILE_A, 7, BATCH));
  });

  it('clock 順が辞書順と一致する (ゼロ詰めの目的)', () => {
    const rkeys = [3, 20, 100, 7].map((c) => batchRkey(FILE_A, c, BATCH));
    expect([...rkeys].sort()).toEqual([
      batchRkey(FILE_A, 3, BATCH),
      batchRkey(FILE_A, 7, BATCH),
      batchRkey(FILE_A, 20, BATCH),
      batchRkey(FILE_A, 100, BATCH),
    ]);
  });

  it('同じファイルの rkey が辞書順で連続する (prefix 範囲取得の前提)', () => {
    const mixed = [
      batchRkey(FILE_B, 1, bid('aaaaaaaa')),
      batchRkey(FILE_A, 2, bid('bbbbbbbb')),
      batchRkey(FILE_B, 2, bid('cccccccc')),
      batchRkey(FILE_A, 1, bid('dddddddd')),
    ];
    const sorted = [...mixed].sort();
    // A の 2 件が先に固まり、その後に B の 2 件が固まる (交互にならない)
    expect(sorted.map((r) => r.startsWith(batchRkeyPrefix(FILE_A)))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('旧 rkey (小文字 hex UUID) より必ず大きい (v1~ 分離)', () => {
    // 旧 rkey で最大になりうる値 = 全桁 f
    const maxLegacy = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect(batchRkey(FILE_A, 0, BATCH) > maxLegacy).toBe(true);
    expect(RKEY_VERSION_PREFIX > maxLegacy).toBe(true);
  });

  it('clock が 12 桁に収まらなければ throw する', () => {
    // 静かに桁あふれさせると順序が狂い、再 push で rkey が変わってべき等性も壊れる
    expect(() => batchRkey(FILE_A, 10 ** 12, BATCH)).toThrow();
    expect(() => batchRkey(FILE_A, -1, BATCH)).toThrow();
    expect(() => batchRkey(FILE_A, 1.5, BATCH)).toThrow();
  });
});

describe('batchRkeyPrefix / batchRkeyFileCursor', () => {
  it('prefix はそのファイルの全 rkey に一致し、他ファイルには一致しない', () => {
    const prefix = batchRkeyPrefix(FILE_A);
    expect(batchRkey(FILE_A, 1, BATCH).startsWith(prefix)).toBe(true);
    expect(batchRkey(FILE_B, 1, BATCH).startsWith(prefix)).toBe(false);
  });

  it('cursor はそのファイルの全 rkey より小さい (昇順 seek の着地点)', () => {
    const cursor = batchRkeyFileCursor(FILE_A);
    expect(cursor < batchRkey(FILE_A, 0, bid('00000000'))).toBe(true);
    // 1 つ小さい fileId のどのレコードよりは大きい = 手前のファイルに戻らない
    const smaller = fid('00000000');
    expect(cursor > batchRkey(smaller, 999999999999, bid('ffffffff'))).toBe(
      true,
    );
  });
});

describe('parseBatchRkey', () => {
  it('batchRkey の出力を往復で復元する', () => {
    const parsed = parseBatchRkey(batchRkey(FILE_A, 42, BATCH));
    expect(parsed).toEqual({ fileId: FILE_A, clock: 42, batchId: BATCH });
  });

  it('ゼロ詰めを外して clock を数値で返す', () => {
    expect(parseBatchRkey(batchRkey(FILE_A, 0, BATCH))?.clock).toBe(0);
  });

  it('v1~ で始まらない rkey は null (旧 rkey・他種)', () => {
    expect(parseBatchRkey(BATCH)).toBeNull();
    expect(parseBatchRkey('v2~a~000000000001~b')).toBeNull();
  });

  it('セグメント数が違う rkey は null', () => {
    expect(parseBatchRkey(`v1~${FILE_A}~000000000001`)).toBeNull();
    expect(
      parseBatchRkey(`v1~${FILE_A}~000000000001~${BATCH}~extra`),
    ).toBeNull();
  });

  it('clock が固定幅の数字列でなければ null', () => {
    // 桁数違い / 非数字 / 符号付きを「読めた」ことにしない
    expect(parseBatchRkey(`v1~${FILE_A}~42~${BATCH}`)).toBeNull();
    expect(parseBatchRkey(`v1~${FILE_A}~00000000004x~${BATCH}`)).toBeNull();
    expect(parseBatchRkey(`v1~${FILE_A}~-00000000042~${BATCH}`)).toBeNull();
  });

  it('fileId / batchId が空なら null', () => {
    expect(parseBatchRkey('v1~~000000000001~x')).toBeNull();
    expect(parseBatchRkey(`v1~${FILE_A}~000000000001~`)).toBeNull();
  });
});

describe('batchIdFromRkey', () => {
  it('新形式は第 4 セグメントを batch.id として返す', () => {
    expect(batchIdFromRkey(batchRkey(FILE_A, 3, BATCH))).toBe(BATCH);
  });

  it('旧形式 (rkey = batchId) はそのまま返す', () => {
    // p7-1 時点の読取は repo 全件 list のままで新旧が混在するため許容する
    expect(batchIdFromRkey(BATCH)).toBe(BATCH);
  });

  it('v1~ で始まるのに形式を満たさない rkey だけ null になる (数えて警告する対象)', () => {
    expect(batchIdFromRkey(`v1~${FILE_A}~42~${BATCH}`)).toBeNull();
    expect(batchIdFromRkey('v1~')).toBeNull();
  });
});
