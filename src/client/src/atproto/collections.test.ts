import { describe, expect, it } from 'bun:test';
import {
  idFromRkey,
  makeRkey,
  prefixFromRkey,
  TRUNK_PREFIX,
} from './collections';

describe('makeRkey', () => {
  it('trunk prefix + uuid → "trunk_uuid"', () => {
    expect(makeRkey('trunk', 'abc-123')).toBe('trunk_abc-123');
  });

  it('branch id + uuid → "branchId_uuid"', () => {
    expect(makeRkey('550e8400-e29b-41d4-a716-446655440000', 'node-uuid')).toBe(
      '550e8400-e29b-41d4-a716-446655440000_node-uuid',
    );
  });

  it('prefix が空文字の場合 "uuid" になる', () => {
    expect(makeRkey('', 'myid')).toBe('_myid');
  });
});

describe('idFromRkey', () => {
  it('"trunk_uuid" → "uuid"', () => {
    expect(idFromRkey('trunk_abc-123')).toBe('abc-123');
  });

  it('"branchId_uuid" → "uuid"', () => {
    expect(idFromRkey('branch-x_node-y')).toBe('node-y');
  });

  it('旧形式 (prefix なし) → そのまま返す', () => {
    expect(idFromRkey('plain-uuid')).toBe('plain-uuid');
  });

  it('UUID の rkey → そのまま返す (後方互換)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(idFromRkey(uuid)).toBe(uuid);
  });

  it('複数のアンダースコアがある場合、最初の区切りで分割', () => {
    expect(idFromRkey('prefix_mid_suffix')).toBe('mid_suffix');
  });
});

describe('prefixFromRkey', () => {
  it('"trunk_uuid" → "trunk"', () => {
    expect(prefixFromRkey('trunk_abc-123')).toBe('trunk');
  });

  it('"branchId_uuid" → "branchId"', () => {
    expect(prefixFromRkey('mybranch_node-1')).toBe('mybranch');
  });

  it('旧形式 (prefix なし) → TRUNK_PREFIX が返る', () => {
    expect(prefixFromRkey('plain-uuid')).toBe(TRUNK_PREFIX);
  });

  it('UUID の rkey → TRUNK_PREFIX が返る (後方互換)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(prefixFromRkey(uuid)).toBe(TRUNK_PREFIX);
  });

  it('複数のアンダースコアがある場合、最初の区切りで分割', () => {
    expect(prefixFromRkey('pre_mid_suf')).toBe('pre');
  });
});

describe('makeRkey → idFromRkey 往復', () => {
  it('trunk prefix で往復', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(idFromRkey(makeRkey(TRUNK_PREFIX, uuid))).toBe(uuid);
  });

  it('branch prefix で往復', () => {
    const branchId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const nodeId = '11111111-2222-3333-4444-555555555555';
    expect(idFromRkey(makeRkey(branchId, nodeId))).toBe(nodeId);
  });
});

describe('makeRkey → prefixFromRkey 往復', () => {
  it('任意の prefix が往復で復元される', () => {
    const rkey = makeRkey('custom-prefix', 'some-id');
    expect(prefixFromRkey(rkey)).toBe('custom-prefix');
  });

  it('TRUNK_PREFIX で往復', () => {
    const rkey = makeRkey(TRUNK_PREFIX, 'my-id');
    expect(prefixFromRkey(rkey)).toBe(TRUNK_PREFIX);
  });
});
