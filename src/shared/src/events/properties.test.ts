import { describe, expect, test } from 'bun:test';
import {
  applyPropertyChange,
  applyPropertyChanges,
  diffProperties,
} from './properties';

describe('diffProperties', () => {
  test('追加されたプロパティを値つきの変更にする', () => {
    expect(diffProperties({}, { a: 1 })).toEqual([{ name: 'a', value: 1 }]);
  });

  test('値が変わったプロパティだけを拾う', () => {
    expect(diffProperties({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([
      { name: 'b', value: 3 },
    ]);
  });

  test('消えたプロパティは値を省いた変更 (= 削除) にする', () => {
    expect(diffProperties({ a: 1, b: 2 }, { a: 1 })).toEqual([{ name: 'b' }]);
  });

  test('値の比較は構造で行う (同じ中身のオブジェクトは変更でない)', () => {
    const from = { image: { cid: 'c', mimeType: 'image/png' } };
    const to = { image: { cid: 'c', mimeType: 'image/png' } };
    expect(diffProperties(from, to)).toEqual([]);
  });

  test('undefined と {} はどちらも「プロパティが無い」', () => {
    expect(diffProperties(undefined, {})).toEqual([]);
    expect(diffProperties(undefined, { a: 1 })).toEqual([
      { name: 'a', value: 1 },
    ]);
    expect(diffProperties({ a: 1 }, undefined)).toEqual([{ name: 'a' }]);
  });
});

describe('applyPropertyChange', () => {
  test('値つきの変更はそのプロパティだけを書き換え、他は残す', () => {
    expect(
      applyPropertyChange({ a: 1, b: 2 }, { name: 'b', value: 3 }),
    ).toEqual({ a: 1, b: 3 });
  });

  test('値を省いた変更はそのプロパティを消す', () => {
    expect(applyPropertyChange({ a: 1, b: 2 }, { name: 'b' })).toEqual({
      a: 1,
    });
  });

  test('元のオブジェクトを変更しない', () => {
    const before = { a: 1 };
    applyPropertyChange(before, { name: 'a', value: 2 });
    expect(before).toEqual({ a: 1 });
  });
});

describe('diff → apply の往復', () => {
  test('from と一致する properties に当てると to になる', () => {
    const from = { a: 1, b: 2 };
    const to = { a: 9, c: 3 };
    expect(applyPropertyChanges(from, diffProperties(from, to))).toEqual(to);
  });

  test('from に無かったプロパティは残る — これがキー単位化の目的である', () => {
    // 他者が並行して足した `theirs` を、こちらの from/to は知らない。
    // 全体を置換すると消えるが、キー単位なら触っていないものは残る
    const current = { mine: 1, theirs: 2 };
    const changes = diffProperties({ mine: 1 }, { mine: 5 });
    expect(applyPropertyChanges(current, changes)).toEqual({
      mine: 5,
      theirs: 2,
    });
  });
});
