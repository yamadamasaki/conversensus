import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { agentDeclarationOf } from './agentDeclaration';

const AGENT = 'did:plc:agent';
const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';

describe('agentDeclarationOf (例)', () => {
  test('宣言が無ければ agent ではない (裏付けだけがあっても)', () => {
    expect(agentDeclarationOf(AGENT, undefined, undefined)).toEqual({
      status: 'none',
    });
    expect(agentDeclarationOf(AGENT, undefined, { agent: AGENT })).toEqual({
      status: 'none',
    });
  });

  test('宣言だけなら名乗りのみ。operator・model・説明を持つ', () => {
    expect(
      agentDeclarationOf(
        AGENT,
        { operator: ALICE, model: 'claude', description: '要約する' },
        undefined,
      ),
    ).toEqual({
      status: 'claimed',
      operator: ALICE,
      model: 'claude',
      description: '要約する',
    });
  });

  test('operator の裏付けがこの agent を指していれば裏付けあり。別の agent を指していれば名乗りのみ', () => {
    const profile = { operator: ALICE };
    expect(agentDeclarationOf(AGENT, profile, { agent: AGENT }).status).toBe(
      'verified',
    );
    expect(agentDeclarationOf(AGENT, profile, { agent: BOB }).status).toBe(
      'claimed',
    );
  });

  test('形の違う record は無いのと同じ (落ちない)', () => {
    expect(agentDeclarationOf(AGENT, { operator: 3 }, undefined).status).toBe(
      'none',
    );
    expect(agentDeclarationOf(AGENT, 'x', undefined).status).toBe('none');
    expect(
      agentDeclarationOf(AGENT, { operator: ALICE }, { agent: null }).status,
    ).toBe('claimed');
  });
});

describe('agentDeclarationOf (性質)', () => {
  /** record の候補: 正しい形・違う DID・形の違うもの・無い、を小さなプールから引く */
  const did = fc.constantFrom(AGENT, ALICE, BOB);
  const profile = fc.oneof(
    fc.constant(undefined),
    fc.record({ operator: did }),
    fc.constant({ operator: 42 }),
  );
  const operated = fc.oneof(
    fc.constant(undefined),
    fc.record({ agent: did }),
    fc.constant({ agent: [] }),
  );

  test('裏付けあり ⇔ 宣言が読め、裏付けが読め、裏付けがこの DID を指す。名乗りのみ ⇔ 宣言だけが成り立つ', () => {
    fc.assert(
      fc.property(did, profile, operated, (who, p, o) => {
        const status = agentDeclarationOf(who, p, o).status;
        const declared = typeof p?.operator === 'string';
        const backed = declared && o?.agent === who;
        expect(status).toBe(
          backed ? 'verified' : declared ? 'claimed' : 'none',
        );
      }),
    );
  });
});
