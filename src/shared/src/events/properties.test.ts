import { describe, expect, test } from 'bun:test';
import {
  applyPropertyChange,
  applyPropertyChanges,
  canonicalProperties,
  canonicalPropertyName,
  diffProperties,
  SYSTEM_PROPERTY_PREFIX,
} from './properties';

const IMAGE = `${SYSTEM_PROPERTY_PREFIX}image`;
const IMAGE_URL = `${SYSTEM_PROPERTY_PREFIX}imageUrl`;

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

describe('名前の正規化 (#137)', () => {
  test('旧名は新名へ寄せる', () => {
    expect(canonicalPropertyName('image')).toBe(IMAGE);
    expect(canonicalPropertyName('imageUrl')).toBe(IMAGE_URL);
  });

  test('対応表に無い名前はそのまま — custom は触らない', () => {
    // 判定規則は「`.` を含むか否か」の一点。custom に名前空間は要求しない
    expect(canonicalPropertyName('期限')).toBe('期限');
    expect(canonicalPropertyName('imageBlobCid')).toBe('imageBlobCid');
    expect(canonicalPropertyName(IMAGE)).toBe(IMAGE);
  });

  test('canonicalProperties は旧名のキーを新名へ移す', () => {
    expect(canonicalProperties({ image: 1, 期限: 2 })).toEqual({
      [IMAGE]: 1,
      期限: 2,
    });
  });

  test('旧名が無ければ同じ参照を返す (無駄なコピーをしない)', () => {
    const props = { [IMAGE]: 1 };
    expect(canonicalProperties(props)).toBe(props);
    expect(canonicalProperties(undefined)).toBeUndefined();
  });

  test('新旧が両方あれば新名が勝つ', () => {
    // 移行期には「旧名のまま残っている値」の上に新名で書き足す経路がある。
    // 旧名が勝つと、書き足したはずの編集が消える
    expect(canonicalProperties({ image: 'old', [IMAGE]: 'new' })).toEqual({
      [IMAGE]: 'new',
    });
  });

  test('diffProperties は両側を寄せてから比べる', () => {
    // 寄せないと「旧名の削除 + 新名の追加」の 2 件に割れ、merge の競合単位も割れる
    expect(diffProperties({ image: 'a' }, { [IMAGE]: 'b' })).toEqual([
      { name: IMAGE, value: 'b' },
    ]);
    expect(diffProperties({ image: 'a' }, { [IMAGE]: 'a' })).toEqual([]);
  });

  test('applyPropertyChange は変更の名前も当てる先も寄せる', () => {
    expect(
      applyPropertyChange({ image: 'a' }, { name: 'image', value: 'b' }),
    ).toEqual({
      [IMAGE]: 'b',
    });
    // 旧名の op が新名のプロパティを消せる — 同じプロパティだからである
    expect(applyPropertyChange({ [IMAGE]: 'a' }, { name: 'image' })).toEqual(
      {},
    );
  });
});
