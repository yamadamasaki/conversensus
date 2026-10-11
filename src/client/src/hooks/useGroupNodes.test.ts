import { describe, expect, test } from 'bun:test';
import type { Node } from '@xyflow/react';
import { RF_GROUP_NODE_TYPE } from '../graphTransform';
import { groupAbilityOf } from './useGroupNodes';

const node = (id: string, selected: boolean, type?: string): Node => ({
  id,
  type,
  selected,
  position: { x: 0, y: 0 },
  data: {},
});

describe('groupAbilityOf (#269)', () => {
  test('何も選んでいなければ、まとめることも解くこともできない', () => {
    expect(groupAbilityOf([node('a', false), node('b', false)])).toEqual({
      canGroup: false,
      canUngroup: false,
    });
  });

  test('node を 1 つでも選べばまとめられる。group でなければ解けない', () => {
    expect(groupAbilityOf([node('a', true), node('b', false)])).toEqual({
      canGroup: true,
      canUngroup: false,
    });
  });

  test('group を選べば解ける (group もまとめる対象になる)', () => {
    expect(
      groupAbilityOf([node('g', true, RF_GROUP_NODE_TYPE), node('a', false)]),
    ).toEqual({ canGroup: true, canUngroup: true });
  });

  test('選ばれていない group は解く対象にならない', () => {
    expect(
      groupAbilityOf([node('g', false, RF_GROUP_NODE_TYPE), node('a', true)]),
    ).toEqual({ canGroup: true, canUngroup: false });
  });
});
