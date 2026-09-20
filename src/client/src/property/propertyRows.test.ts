import { describe, expect, it } from 'bun:test';
import {
  SYSTEM_PROPERTY_PREFIX,
  type Template,
  TemplateSchema,
  TOULMIN_TEMPLATE,
} from '@conversensus/shared';
import { addablePropertyNames, propertyRows } from './propertyRows';

const KIND = 'jp.co.metabolics.toulmin.kind';

/**
 * 宣言を持つ template。**TOULMIN では試せない** — `EdgeKind.properties` は
 * `.default([])` で型には在るが、TOULMIN はどの種類にも実際の宣言を書いていない
 * (Phase 5 は「宣言だけ置く」と言いながら、宣言の中身は空のままだった)。
 * 機構を固定するには宣言を持つ template が要る。
 */
const WITH_DECL: Template = TemplateSchema.parse({
  id: 'jp.co.example.decl',
  name: '宣言つき',
  nodeKinds: [{ id: 'a', label: 'A' }],
  edgeKinds: [
    {
      id: 'rel',
      label: '関係',
      from: ['a'],
      to: ['a'],
      properties: ['出典', '確度'],
    },
  ],
});
const DECL_KIND = 'jp.co.example.decl.kind';

/**
 * **同じ種別 id (`rel`) を持つ、別の宣言つき template。**
 *
 * 混線を観測するにはこれが要る。`edgeKindsOf` は種別 id で重複を除き**先に来た
 * template を残す**ので、id が違えば混ぜても引き当たらず、差が出ない。
 * 実際、当初は TOULMIN と混ぜて試していたが **TOULMIN の宣言が空**なため
 * 「混線しても `[]`、閉じていても `[]`」で何も言っていなかった (変異が生き残った)。
 */
const OTHER_DECL: Template = TemplateSchema.parse({
  id: 'jp.co.example.other',
  name: '別の宣言つき',
  nodeKinds: [{ id: 'b', label: 'B' }],
  edgeKinds: [
    {
      id: 'rel',
      label: '関係',
      from: ['b'],
      to: ['b'],
      properties: ['別の宣言'],
    },
  ],
});
const OTHER_KIND = 'jp.co.example.other.kind';

describe('system は行にしない', () => {
  it('app.conversensus.* は出ない', () => {
    // 仕様の表: system は「見えない, 追加/変更/削除できない」
    const rows = propertyRows({
      [`${SYSTEM_PROPERTY_PREFIX}imageUrl`]: 'https://例/a.png',
      期限: '2026-09-20',
    });
    expect(rows.map((r) => r.name)).toEqual(['期限']);
  });

  it('検索と同じ規則である (出す/出さないが 1 つの規則)', () => {
    // 画面に出ないものが検索だけで出ると「開けない結果」になる。
    // どちらも propertyCategory に委ねていることの確認
    expect(propertyRows({ [`${SYSTEM_PROPERTY_PREFIX}image`]: {} })).toEqual(
      [],
    );
  });
});

describe('extension は出すが、種別だけは編集させない', () => {
  it('*.kind は見えるが編集できない', () => {
    // toulmin node / edge の種類は作成時に決まり変更できない (仕様 OnMutation)
    const rows = propertyRows({ [KIND]: 'claim' });
    expect(rows).toHaveLength(1);
    expect(rows[0].readOnly).toBe('templateKind');
  });

  it('同じ extension でも .kind で終わらなければ編集できる', () => {
    // 仕様は extension を「見える/見えないが混在」とし、既定は見える側である
    const rows = propertyRows({ 'jp.co.metabolics.toulmin.備考': 'x' });
    expect(rows[0].readOnly).toBeUndefined();
  });

  it('custom は編集できる', () => {
    expect(propertyRows({ 期限: '2026-09-20' })[0].readOnly).toBeUndefined();
  });

  it('判定に template を渡していない — 知らない template の種別でも効く', () => {
    // isKindProperty は語尾だけを見る。描画側に template を配るより漏れない
    const rows = propertyRows({ 'com.unknown.vendor.kind': 'x' });
    expect(rows[0].readOnly).toBe('templateKind');
  });
});

describe('型は値から推論する', () => {
  it('検索の結果一覧と同じ型が出る', () => {
    // 同じプロパティが片方で date、片方で string に見えてはいけない
    const rows = propertyRows({
      期限: '2026-09-20',
      優先度: 3,
      確定: true,
      出典: ['甲'],
    });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.type]));
    expect(byName).toEqual({
      期限: 'date',
      優先度: 'number',
      確定: 'boolean',
      出典: 'array',
    });
  });
});

describe('並び順は挿入順に依らない', () => {
  it('入れる順を変えても同じ並びになる (日本語の名前で)', () => {
    // Object.entries は挿入順なので、他者の op が届いた順で行が入れ替わる。
    // **ここは編集する表**なので、押そうとした行が動くのは誤操作の問題になる。
    //
    // **固定するのは「安定であること」であって、特定の並びではない。**
    // localeCompare('ja') は漢字を読みで並べないので (実測: 期限, 出典, 優先度)、
    // 「名前順」に人が期待する読み順とは一致しない。並びの中身を書き写すと
    // 実装を写したテストになるだけで、何も主張しない
    const a = propertyRows({ 優先度: 1, 期限: 2, 出典: 3 }).map((r) => r.name);
    const b = propertyRows({ 出典: 3, 優先度: 1, 期限: 2 }).map((r) => r.name);
    const c = propertyRows({ 期限: 2, 出典: 3, 優先度: 1 }).map((r) => r.name);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    // 取りこぼしが無いこと (並びは問わない)
    expect([...a].sort()).toEqual(['優先度', '出典', '期限'].sort());
  });

  it('ASCII では名前順になる', () => {
    // 読みの問題が出ない範囲では、人の期待どおりに並ぶ
    const a = propertyRows({ b: 1, a: 2, c: 3 }).map((r) => r.name);
    const b = propertyRows({ c: 3, b: 1, a: 2 }).map((r) => r.name);
    expect(a).toEqual(b);
    expect(a).toEqual(['a', 'b', 'c']);
  });

  it('かなは読み順になる', () => {
    // 漢字と違い、かなは localeCompare('ja') が読みで並べる
    const rows = propertyRows({ ゆうせんど: 1, きげん: 2, しゅってん: 3 });
    expect(rows.map((r) => r.name)).toEqual([
      'きげん',
      'しゅってん',
      'ゆうせんど',
    ]);
  });
});

describe('追加できる名前の候補 (EdgeKind.properties の最初の消費者)', () => {
  it('その edge の種類が宣言した名前が出る', () => {
    const names = addablePropertyNames([WITH_DECL], { [DECL_KIND]: 'rel' });
    expect(names).toEqual(['出典', '確度']);
  });

  it('既に値が入っている名前は出ない', () => {
    // 行として出ているものを「追加」に並べると、押しても何も起きないか既存を消す
    const names = addablePropertyNames([WITH_DECL], {
      [DECL_KIND]: 'rel',
      出典: '甲',
    });
    expect(names).toEqual(['確度']);
  });

  it('判定は template ごとに閉じる — 他の template の宣言は出ない', () => {
    // T1 の種類の宣言を T2 の edge に出す混線を防ぐ。
    //
    // **同じ種別 id (`rel`) を持つ 2 つで試す。**`edgeKindsOf` は id で重複を除き
    // 先に来た template を残すので、id が違えば混ぜても引き当たらず差が出ない。
    // ここで渡すのは **2 つ目 (OTHER_DECL) の種別**なので、閉じていれば
    // 「別の宣言」が、混線していれば先頭の WITH_DECL の「出典/確度」が返る
    const names = addablePropertyNames([WITH_DECL, OTHER_DECL], {
      [OTHER_KIND]: 'rel',
    });
    expect(names).toEqual(['別の宣言']);
  });

  it('宣言が空の template と混ぜても引きずられない', () => {
    // 当初はこれだけを「template ごとに閉じる」の検証にしていたが、TOULMIN の
    // 宣言が空なので**混線しても閉じていても `[]`** になり、何も言っていなかった。
    // 残してあるのは、空の宣言を持つ template が混じっても壊れないことの確認である
    const names = addablePropertyNames([WITH_DECL, TOULMIN_TEMPLATE], {
      [KIND]: 'supports',
    });
    expect(names).toEqual([]);
  });

  it('種別を持たない edge には候補が無い', () => {
    expect(addablePropertyNames([WITH_DECL], { 期限: 'x' })).toEqual([]);
    expect(addablePropertyNames([WITH_DECL], undefined)).toEqual([]);
  });

  it('知らない template の種別で追加を塞がない', () => {
    // templatesOf が知らない id を黙って落とすのと同じ判断。
    // 相手の template を持たないせいで操作できなくなる方が悪い
    expect(
      addablePropertyNames([WITH_DECL], { 'com.unknown.x.kind': 'y' }),
    ).toEqual([]);
  });

  it('⚠️ TOULMIN は宣言を持たないので常に空である', () => {
    // Phase 5 は「宣言だけ置く」と言ったが、**宣言の中身は空のまま**だった
    // (edgeKinds の 5 件とも properties を書いていない)。機構は正しく、
    // 食う相手がまだ居ない状態である。仕様が宣言を書いたらここが変わる
    for (const ref of TOULMIN_TEMPLATE.edgeKinds) {
      expect(ref.properties).toEqual([]);
    }
    expect(
      addablePropertyNames([TOULMIN_TEMPLATE], { [KIND]: 'supports' }),
    ).toEqual([]);
  });
});
