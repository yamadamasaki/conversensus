import { describe, expect, test } from 'bun:test';
import { createLabelCache } from './labelCache';

type Id = string;

/** 引いた回数と引いた中身を記録する source */
function makeSource(
  table: Record<string, string>,
  over: { fail?: boolean } = {},
) {
  const calls: Id[][] = [];
  return {
    calls,
    source: {
      what: 'テスト名',
      fetch: async (ids: readonly Id[]) => {
        calls.push([...ids]);
        if (over.fail) throw new Error('boom');
        const found = new Map<Id, string>();
        for (const id of ids) {
          const label = table[id];
          if (label !== undefined) found.set(id, label);
        }
        return found;
      },
    },
  };
}

describe('createLabelCache', () => {
  test('引いた名前を返す', async () => {
    const { source } = makeSource({ a: 'alice', b: 'bob' });
    const cache = createLabelCache<Id>(source);
    const labelOf = await cache.resolve(['a', 'b']);
    expect(labelOf('a')).toBe('alice');
    expect(labelOf('b')).toBe('bob');
  });

  test('同じ id が何度並んでも 1 回しか引かない', async () => {
    // 「依頼者」列は同じ DID が何行にも出る。素通しにすると行数だけ飛ぶ
    const { source, calls } = makeSource({ a: 'alice' });
    const cache = createLabelCache<Id>(source);
    await cache.resolve(['a', 'a', 'a']);
    expect(calls).toEqual([['a']]);
  });

  test('既に覚えている id は引き直さない', async () => {
    const { source, calls } = makeSource({ a: 'alice', b: 'bob' });
    const cache = createLabelCache<Id>(source);
    await cache.resolve(['a']);
    await cache.resolve(['a', 'b']);
    expect(calls).toEqual([['a'], ['b']]);
  });

  test('引く必要が無ければ問い合わせない', async () => {
    const { source, calls } = makeSource({ a: 'alice' });
    const cache = createLabelCache<Id>(source);
    await cache.resolve([]);
    expect(calls).toEqual([]);
  });

  test('解決できなかった id は id をそのまま返す', async () => {
    // 空欄にすると「引けなかった」のか「そもそも無い」のかが区別できない
    const { source } = makeSource({ a: 'alice' });
    const cache = createLabelCache<Id>(source);
    const labelOf = await cache.resolve(['a', 'z']);
    expect(labelOf('z')).toBe('z');
  });

  test('fallback を渡せば見せ方を変えられる', async () => {
    const { source } = makeSource({});
    const cache = createLabelCache<Id>({
      ...source,
      fallback: (id) => `不明 (${id})`,
    });
    const labelOf = await cache.resolve(['z']);
    expect(labelOf('z')).toBe('不明 (z)');
  });

  test('引けなくても投げない — 名前が出ないことは一覧が出ないことより軽い', async () => {
    const { source } = makeSource({ a: 'alice' }, { fail: true });
    const cache = createLabelCache<Id>(source);
    const labelOf = await cache.resolve(['a']);
    expect(labelOf('a')).toBe('a');
  });

  test('引けなかった id は次に引き直す', async () => {
    // 失敗を「解決できない」として覚え込むと、通信が戻っても名前が出ない
    const { source, calls } = makeSource({ a: 'alice' });
    const cache = createLabelCache<Id>(source);
    await cache.resolve(['z']);
    await cache.resolve(['z']);
    expect(calls).toEqual([['z'], ['z']]);
  });

  test('peek は引かずに今わかっている範囲で答える', async () => {
    const { source, calls } = makeSource({ a: 'alice' });
    const cache = createLabelCache<Id>(source);
    expect(cache.peek('a')).toBe('a');
    await cache.resolve(['a']);
    expect(cache.peek('a')).toBe('alice');
    expect(calls).toEqual([['a']]);
  });

  test('forget で引き直せる (ハンドル名の付け替え)', async () => {
    const table: Record<string, string> = { a: 'alice' };
    const { source, calls } = makeSource(table);
    const cache = createLabelCache<Id>(source);
    await cache.resolve(['a']);
    table.a = 'alice2';
    cache.forget('a');
    const labelOf = await cache.resolve(['a']);
    expect(labelOf('a')).toBe('alice2');
    expect(calls).toEqual([['a'], ['a']]);
  });
});
