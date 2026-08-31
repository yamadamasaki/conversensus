import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
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

/**
 * 名前は旧名・新名・custom を混ぜる。#137 の正規化が往復の意味そのものに絡むので、
 * 旧名を引かない生成器では往復の性質を確かめたことにならない。
 */
const propertyName = fc.constantFrom(
  'image',
  'imageUrl',
  IMAGE,
  IMAGE_URL,
  '期限',
  'a',
);

/**
 * 値は**小さなプールから引く**。`sameValue` が JSON で比べる規則なので JSON 値に限り、
 * かつプールを小さくして **from と to が同じ値になる場合を引き当てられるようにする**。
 * 変更が 0 件のときだけ正規化されないという欠陥は、値が一致する場合にしか現れなかった
 * (`fc.jsonValue()` では 500 回引いても当たらない)。
 */
const propertyValue = fc.constantFrom(1, 'x', null, { cid: 'c' }, [1, 2]);

const properties = fc.dictionary(propertyName, propertyValue, { maxKeys: 4 });

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

describe('diff → apply の往復 (性質として書く)', () => {
  test('∀ from, to. apply(from, diff(from, to)) = canonical(to)', () => {
    // 右辺が `to` ではなく `canonical(to)` なのがこの関数対の契約である。
    // diff も apply も新名へ寄せるので、旧名は往復を通ると新名になって出てくる
    fc.assert(
      fc.property(properties, properties, (from, to) => {
        expect(applyPropertyChanges(from, diffProperties(from, to))).toEqual(
          canonicalProperties(to) ?? {},
        );
      }),
    );
  });

  test('∀ current, from, to. 差分に現れないキーは変わらない', () => {
    // これがキー単位化の目的である。`current` には他者が並行して足したプロパティが
    // 入っていて、こちらの from/to はそれを知らない。全体を置換すると消えるが、
    // キー単位なら差分に名前が出てこないキーは触られない
    fc.assert(
      fc.property(properties, properties, properties, (current, from, to) => {
        const changes = diffProperties(from, to);
        const touched = new Set(changes.map((c) => c.name));
        const before = canonicalProperties(current) ?? {};
        const after = applyPropertyChanges(current, changes);

        for (const name of Object.keys(before))
          if (!touched.has(name)) expect(after[name]).toEqual(before[name]);
      }),
    );
  });

  test('変更が 0 件でも結果は正規化される', () => {
    // 上の性質が見つけた反例をそのまま残す。乱数が毎回ここを引く保証はない。
    // 欠陥は `applyPropertyChanges` が reduce の初期値を寄せていなかったことで、
    // 「変更が 1 件以上あるときだけ正規化される」という非対称になっていた
    const same = { image: 'x', a: 2 };
    expect(applyPropertyChanges(same, diffProperties(same, same))).toEqual({
      [IMAGE]: 'x',
      a: 2,
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
