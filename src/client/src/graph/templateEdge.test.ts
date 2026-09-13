import { describe, expect, it } from 'bun:test';
import {
  kindPropertyOf,
  type Template,
  TemplateSchema,
  TOULMIN_TEMPLATE,
} from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';
import {
  canConnectByTemplate,
  canReconnectByTemplate,
  edgeKindFor,
} from './templateEdge';

const KIND = kindPropertyOf(TOULMIN_TEMPLATE.id);
const T = [TOULMIN_TEMPLATE];

/** 種別つき / なしのノード */
function node(id: string, kind?: string): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: kind ? { properties: { [KIND]: kind } } : {},
  } as Node;
}

const NODES = [
  node('claim', 'claim'),
  node('data', 'data'),
  node('warrant', 'warrant'),
  node('plain'),
];

/** 主張が 2 つある集合。**繋ぎ替え先が同じ種類**という場合を作るために要る */
const NODES2 = [...NODES, node('claim2', 'claim')];

describe('edgeKindFor', () => {
  it('候補 1 なら種類を返す — 両端が決まれば自動で決まる', () => {
    const ref = edgeKindFor(T, NODES, 'data', 'claim');
    expect(ref?.kind.label).toBe('支える');
    expect(ref?.templateId).toBe(TOULMIN_TEMPLATE.id);
  });

  it('向きが逆なら候補 0 — 何も返さない', () => {
    expect(edgeKindFor(T, NODES, 'claim', 'data')).toBeUndefined();
  });

  it('片端が普通のノードなら何も返さない (制約の対象外)', () => {
    expect(edgeKindFor(T, NODES, 'plain', 'claim')).toBeUndefined();
    expect(edgeKindFor(T, NODES, 'data', 'plain')).toBeUndefined();
  });

  it('template が当たっていなければ何も返さない', () => {
    expect(edgeKindFor([], NODES, 'data', 'claim')).toBeUndefined();
  });

  it('候補が複数なら何も返さない — 選ばせる UI は step2 では作らない', () => {
    const ambiguous: Template = TemplateSchema.parse({
      id: 'com.example.ambiguous',
      name: 'ambiguous',
      nodeKinds: [
        { id: 'a', label: 'あ' },
        { id: 'b', label: 'い' },
      ],
      edgeKinds: [
        { id: 'e1', label: '支持', from: ['a'], to: ['b'] },
        { id: 'e2', label: '反対', from: ['a'], to: ['b'] },
      ],
    });
    const kp = kindPropertyOf(ambiguous.id);
    const nodes = [
      {
        id: 'x',
        position: { x: 0, y: 0 },
        data: { properties: { [kp]: 'a' } },
      },
      {
        id: 'y',
        position: { x: 0, y: 0 },
        data: { properties: { [kp]: 'b' } },
      },
    ] as Node[];
    expect(edgeKindFor([ambiguous], nodes, 'x', 'y')).toBeUndefined();
  });

  it('居ないノードを指しても落ちない (受信で消えた直後などに起こる)', () => {
    expect(edgeKindFor(T, NODES, 'missing', 'claim')).toBeUndefined();
  });
});

describe('canConnectByTemplate', () => {
  it('規則どおりの接続は許す', () => {
    expect(canConnectByTemplate(T, NODES, 'data', 'claim')).toBe(true);
    expect(canConnectByTemplate(T, NODES, 'warrant', 'claim')).toBe(true);
  });

  it('許されない組は拒否する — 警告ではなく繋がせない (D5)', () => {
    expect(canConnectByTemplate(T, NODES, 'claim', 'data')).toBe(false);
    expect(canConnectByTemplate(T, NODES, 'data', 'warrant')).toBe(false);
  });

  it('片端が普通のノードなら許す — ここを間違えると普通のノードに繋げなくなる', () => {
    // 「候補 0」と「制約の対象外」はどちらも候補が空になる。取り違えの本命
    expect(canConnectByTemplate(T, NODES, 'plain', 'claim')).toBe(true);
    expect(canConnectByTemplate(T, NODES, 'claim', 'plain')).toBe(true);
    expect(canConnectByTemplate(T, NODES, 'plain', 'plain')).toBe(true);
  });

  it('template が当たっていなければ何でも許す', () => {
    expect(canConnectByTemplate([], NODES, 'claim', 'data')).toBe(true);
  });

  it('居ないノードを指すときは許す (止める根拠が無い)', () => {
    expect(canConnectByTemplate(T, NODES, 'missing', 'claim')).toBe(true);
  });
});

describe('canReconnectByTemplate', () => {
  /** その種類を持つ edge (実際に onConnect が書く形) */
  const edgeOf = (kindId?: string): Edge =>
    ({
      id: 'e1',
      source: 'data',
      target: 'claim',
      ...(kindId ? { data: { properties: { [KIND]: kindId } } } : {}),
    }) as Edge;

  it('種類が変わらない繋ぎ替えは許す — 支える先の主張を付け替える', () => {
    // データA → 主張A を データA → 主張B に。組は (データ, 主張) のまま
    expect(
      canReconnectByTemplate(T, NODES2, edgeOf('supports'), 'data', 'claim2'),
    ).toBe(true);
  });

  it('種類が変わる繋ぎ替えは拒否する — label が古いまま残るため', () => {
    // データ → 主張 (支える) を 論拠 → 主張 に。種類は「正当化する」になる
    expect(
      canReconnectByTemplate(T, NODES2, edgeOf('supports'), 'warrant', 'claim'),
    ).toBe(false);
  });

  it('toulmin node 以外への繋ぎ替えは拒否する — 種類が無くなる', () => {
    expect(
      canReconnectByTemplate(T, NODES2, edgeOf('supports'), 'data', 'plain'),
    ).toBe(false);
  });

  it('許されない組への繋ぎ替えも拒否する', () => {
    expect(
      canReconnectByTemplate(T, NODES2, edgeOf('supports'), 'claim', 'data'),
    ).toBe(false);
  });

  it('種類を持たない edge は今までどおり自由に繋ぎ替えられる', () => {
    // **`canConnectByTemplate` と違い、元の edge を見るのがこの関数である**
    expect(canReconnectByTemplate(T, NODES2, edgeOf(), 'claim', 'data')).toBe(
      true,
    );
    expect(canReconnectByTemplate(T, NODES2, edgeOf(), 'data', 'plain')).toBe(
      true,
    );
  });

  it('template が当たっていなければ何でも許す', () => {
    expect(
      canReconnectByTemplate(
        [],
        NODES2,
        edgeOf('supports'),
        'warrant',
        'claim',
      ),
    ).toBe(true);
  });
});
