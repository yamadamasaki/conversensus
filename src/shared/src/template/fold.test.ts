import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { edgeKindsOf, isConnectionAllowed, nodeKindsOf } from './fold';
import { TOULMIN_TEMPLATE } from './toulmin';
import { type Template, TemplateSchema } from './types';

/** テスト用の template を組む。参照整合性は schema が見るので必ず parse を通す */
function template(
  id: string,
  nodeKinds: { id: string; label: string }[],
  edgeKinds: { id: string; label: string; from: string[]; to: string[] }[],
): Template {
  return TemplateSchema.parse({ id, name: id, nodeKinds, edgeKinds });
}

/** toulmin と語彙が重ならない 2 つ目の template (和を測るための対照) */
const OTHER = template(
  'other',
  [
    { id: 'question', label: '問い' },
    { id: 'answer', label: '答え' },
  ],
  [{ id: 'answers', label: '答える', from: ['answer'], to: ['question'] }],
);

const conn = (fromLabel: string, toLabel: string, edgeLabel: string) => ({
  fromLabel,
  toLabel,
  edgeLabel,
});

describe('nodeKindsOf / edgeKindsOf', () => {
  test('toulmin の 5 種別と 5 つの接続をそのまま返す', () => {
    expect(nodeKindsOf([TOULMIN_TEMPLATE]).map((k) => k.label)).toEqual([
      '主張',
      'データ',
      '論拠',
      '反論',
      '裏付け',
    ]);
    expect(edgeKindsOf([TOULMIN_TEMPLATE]).map((k) => k.label)).toEqual([
      '支える',
      '正当化する',
      '強化する',
      '切り崩す',
      '疑問を呈する',
    ]);
  });

  test('template が無ければ種別は空 (種別メニューを出さない根拠)', () => {
    expect(nodeKindsOf([])).toEqual([]);
    expect(edgeKindsOf([])).toEqual([]);
  });

  test('複数 template は和になる — 狭めない', () => {
    const labels = nodeKindsOf([TOULMIN_TEMPLATE, OTHER]).map((k) => k.label);
    expect(labels).toContain('主張');
    expect(labels).toContain('問い');
    expect(labels).toHaveLength(7);
  });

  test('同じ id は先に来た方を残す (並びを安定させる)', () => {
    const a = template('a', [{ id: 'x', label: 'A の X' }], []);
    const b = template('b', [{ id: 'x', label: 'B の X' }], []);
    expect(nodeKindsOf([a, b]).map((k) => k.label)).toEqual(['A の X']);
    expect(nodeKindsOf([b, a]).map((k) => k.label)).toEqual(['B の X']);
  });
});

describe('isConnectionAllowed — toulmin の規則', () => {
  test('規則どおりの接続は許す', () => {
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], conn('データ', '主張', '支える')),
    ).toBe(true);
    expect(
      isConnectionAllowed(
        [TOULMIN_TEMPLATE],
        conn('反論', '論拠', '疑問を呈する'),
      ),
    ).toBe(true);
  });

  test('端点の向きが逆なら違反 (from と to は非対称)', () => {
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], conn('主張', 'データ', '支える')),
    ).toBe(false);
  });

  test('種別の組み合わせが規則に無ければ違反', () => {
    // 「支える」は データ → 主張 だけ。裏付け → 主張 は規則に無い
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], conn('裏付け', '主張', '支える')),
    ).toBe(false);
  });
});

describe('isConnectionAllowed — 決まらない場合は許す (設計 D5)', () => {
  // 「違反が確定した」ときだけ false を返す。決まらないものを警告に上げると、
  // template を当てる途中の既存グラフが警告だらけになる

  test('template が当たっていなければ常に許す', () => {
    expect(isConnectionAllowed([], conn('主張', 'データ', '支える'))).toBe(
      true,
    );
  });

  test('端点の種別が空なら許す — まだ種別を付けていないだけである', () => {
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], {
        toLabel: '主張',
        edgeLabel: '支える',
      }),
    ).toBe(true);
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], {
        fromLabel: 'データ',
        edgeLabel: '支える',
      }),
    ).toBe(true);
  });

  test('エッジの種別が空なら許す', () => {
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], {
        fromLabel: '主張',
        toLabel: 'データ',
      }),
    ).toBe(true);
  });

  test('空文字列は「無い」と同じ扱いにする', () => {
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], conn('', '主張', '支える')),
    ).toBe(true);
  });

  test('語彙に無い種別名 (孤児) は許す — template 側の改名で起こる (§7)', () => {
    expect(
      isConnectionAllowed([TOULMIN_TEMPLATE], conn('言い分', '主張', '支える')),
    ).toBe(true);
  });
});

describe('isConnectionAllowed — 複数 template の和', () => {
  // 以下 2 件は性質が見つけた反例を例として残したものである (乱数が毎回そこを引く
  // 保証は無い)。どちらも「和」の素朴な読みが誤っていた所を指している

  test('template を 1 つも当てていない状態から当てると、許容は減る', () => {
    // 空は「和の単位元」ではなく「規則が無い = 全部許す」である。したがって
    // 「足すと許容が減らない」は空を含めた形では成り立たない
    const c = conn('主張', 'データ', '支える');
    expect(isConnectionAllowed([], c)).toBe(true);
    expect(isConnectionAllowed([TOULMIN_TEMPLATE], c)).toBe(false);
  });

  test('語彙を知らない template を足しても、既存の警告は消えない', () => {
    // OTHER は 主張 も データ も 支える も知らないので黙る。黙りを「許す」と
    // 数えると、template を足すだけで警告が全部消えてしまう
    const c = conn('主張', 'データ', '支える');
    expect(isConnectionAllowed([TOULMIN_TEMPLATE], c)).toBe(false);
    expect(isConnectionAllowed([TOULMIN_TEMPLATE, OTHER], c)).toBe(false);
  });

  test('片方が許していれば許す — もう片方が違反と言っても警告しない', () => {
    // 「支える」を 裏付け → 主張 にも許す template を足す
    const loose = template(
      'loose',
      [
        { id: 'backing', label: '裏付け' },
        { id: 'claim', label: '主張' },
      ],
      [{ id: 'supports', label: '支える', from: ['backing'], to: ['claim'] }],
    );
    const c = conn('裏付け', '主張', '支える');
    expect(isConnectionAllowed([TOULMIN_TEMPLATE], c)).toBe(false);
    expect(isConnectionAllowed([TOULMIN_TEMPLATE, loose], c)).toBe(true);
  });

  test('label → 種別の解決は template ごとに行う (和の上で混線させない)', () => {
    // どちらも id 'a'/'b' を使うが label が違う。T1 の edge 規則を T2 の
    // node 種別で満たしてはならない
    const t1 = template(
      't1',
      [
        { id: 'a', label: 'あ' },
        { id: 'b', label: 'い' },
      ],
      [{ id: 'e', label: '繋ぐ', from: ['a'], to: ['b'] }],
    );
    const t2 = template(
      't2',
      [
        { id: 'a', label: 'う' },
        { id: 'b', label: 'え' },
      ],
      [{ id: 'e2', label: '別', from: ['a'], to: ['b'] }],
    );
    // 「う」→「い」は、id で見れば a→b だが、同じ template の中の組ではない
    expect(isConnectionAllowed([t1, t2], conn('う', 'い', '繋ぐ'))).toBe(true);
    // (t2 では「繋ぐ」が未知 = 決まらない、t1 では「う」が未知 = 決まらない)
  });
});

// --- 性質 (fast-check) ---

/**
 * 生成器は**小さなプールから引く**。広い文字列生成器では label が template の語彙に
 * 当たらず、`undetermined` ばかりを引いて **`violation` の道を一度も通らない** —
 * 単調性は「決まらないものは足しても決まらない」を確かめただけになる。
 *
 * プールは toulmin の語彙 + 語彙に無い名前 + 空文字 + undefined を混ぜる。
 */
const nodeLabel = fc.constantFrom(
  '主張',
  'データ',
  '論拠',
  '反論',
  '裏付け',
  '問い',
  '言い分',
  '',
  undefined,
);
const edgeLabel = fc.constantFrom(
  '支える',
  '正当化する',
  '切り崩す',
  '答える',
  '不明',
  '',
  undefined,
);
const connection = fc.record({
  fromLabel: nodeLabel,
  toLabel: nodeLabel,
  edgeLabel,
});

/** 母集団も小さく。同じ template を 2 度引くこと (冪等の確認) を起こしたい */
const someTemplate = fc.constantFrom(TOULMIN_TEMPLATE, OTHER);
const templates = fc.array(someTemplate, { maxLength: 3 });

describe('性質: 畳み方は規則の和である', () => {
  /**
   * **単調性 (「template を足すと許容が減らない」) は課さない。**それを課すと
   * `undetermined` が拒否権を打ち消す実装しか通らず、**語彙を知らない template を
   * 足しただけで既存の警告が消える**。和を取るのは規則であって許容ではない。
   *
   * 代わりに、和の意味を 2 つの向きから述べる。
   */

  test('許す template を足せば許される', () => {
    fc.assert(
      fc.property(templates, someTemplate, connection, (ts, extra, c) => {
        if (!isConnectionAllowed([extra], c)) return true; // 前提を満たさない
        if (!c.fromLabel || !c.toLabel || !c.edgeLabel) return true;
        // extra 単独で許される = extra が許すか黙っているか。許す場合だけを見たい
        const known =
          extra.nodeKinds.some((k) => k.label === c.fromLabel) &&
          extra.nodeKinds.some((k) => k.label === c.toLabel) &&
          extra.edgeKinds.some((k) => k.label === c.edgeLabel);
        if (!known) return true; // 黙っている場合は別の性質で見る
        return isConnectionAllowed([...ts, extra], c);
      }),
    );
  });

  /**
   * **これが `undetermined` の意味そのものである。**語彙を持たない template は
   * 判定に一切影響してはならない。この性質だけが「知らない template が既存の警告を
   * 消す」誤りを否定する — 実際 `some(v !== 'violation')` と書いた実装はここで落ちる。
   */
  test('語彙を持たない template を足しても結果は変わらない', () => {
    const foreign = template(
      'foreign',
      [{ id: 'z', label: '未使用の種別' }],
      [],
    );
    fc.assert(
      fc.property(templates, connection, (ts, c) => {
        return (
          isConnectionAllowed([...ts, foreign], c) ===
          isConnectionAllowed(ts, c)
        );
      }),
    );
  });

  test('種別の一覧は足して減らない (こちらは本当に単調)', () => {
    fc.assert(
      fc.property(templates, someTemplate, (ts, extra) => {
        const before = new Set(nodeKindsOf(ts).map((k) => k.id));
        const after = new Set(nodeKindsOf([...ts, extra]).map((k) => k.id));
        return [...before].every((id) => after.has(id));
      }),
    );
  });

  test('同じ template を重ねても結果は変わらない (冪等)', () => {
    fc.assert(
      fc.property(templates, connection, (ts, c) => {
        return (
          isConnectionAllowed([...ts, ...ts], c) ===
            isConnectionAllowed(ts, c) &&
          nodeKindsOf([...ts, ...ts]).length === nodeKindsOf(ts).length
        );
      }),
    );
  });

  test('接続の可否は template の並び順に依存しない', () => {
    fc.assert(
      fc.property(templates, connection, (ts, c) => {
        return (
          isConnectionAllowed(ts, c) ===
          isConnectionAllowed([...ts].reverse(), c)
        );
      }),
    );
  });
});

describe('性質: 決まらないものは許す', () => {
  test('種別が一つでも欠けていれば、どんな template でも許す (D5)', () => {
    fc.assert(
      fc.property(templates, connection, (ts, c) => {
        if (c.fromLabel && c.toLabel && c.edgeLabel) return true; // 前提を満たさない
        return isConnectionAllowed(ts, c);
      }),
    );
  });

  test('template が無ければ何を訊いても許す', () => {
    fc.assert(fc.property(connection, (c) => isConnectionAllowed([], c)));
  });
});
