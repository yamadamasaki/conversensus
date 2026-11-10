import { describe, expect, mock, test } from 'bun:test';
import type { AgentDeclaration, Did } from '@conversensus/shared';
import { createAgentDeclarationCache } from './agentDeclarations';

const AGENT = 'did:plc:agent' as Did;
const CLAIMED: AgentDeclaration = {
  status: 'claimed',
  operator: 'did:plc:alice',
};

describe('createAgentDeclarationCache', () => {
  test('同じ DID は 1 度だけ読む (読んでいる最中に重ねて頼んでも)', async () => {
    const read = mock(async (_: Did) => CLAIMED);
    const cache = createAgentDeclarationCache(read);
    const [a, b] = await Promise.all([cache.get(AGENT), cache.get(AGENT)]);
    expect(a).toEqual(CLAIMED);
    expect(b).toEqual(CLAIMED);
    await cache.get(AGENT);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('忘れると次は読み直す (認めた・取り消した後)', async () => {
    const read = mock(async (_: Did) => CLAIMED);
    const cache = createAgentDeclarationCache(read);
    await cache.get(AGENT);
    cache.forget(AGENT);
    await cache.get(AGENT);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
