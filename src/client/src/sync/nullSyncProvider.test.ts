import { describe, expect, it } from 'bun:test';
import type { Batch, NodeId } from '@conversensus/shared';
import { NullSyncProvider } from './nullSyncProvider';
import { INITIAL_CURSOR } from './syncProvider';

const sampleBatch = (): Batch => ({
  id: 'b1' as Batch['id'],
  actor: 'local',
  clock: 1,
  timestamp: 1,
  ops: [{ kind: 'node.add', target: 'n1' as NodeId, content: 'ノード1' }],
});

describe('NullSyncProvider', () => {
  it('push は remote が無くても解決する (no-op)', async () => {
    const provider = new NullSyncProvider();
    await expect(provider.push([sampleBatch()])).resolves.toBeUndefined();
  });

  it('pull は常に空 batches と初期カーソルを返す', async () => {
    const provider = new NullSyncProvider();
    const result = await provider.pull('any-cursor');
    expect(result.batches).toEqual([]);
    expect(result.cursor).toBe(INITIAL_CURSOR);
  });

  it('subscribe は onRemote を一度も呼ばない', () => {
    const provider = new NullSyncProvider();
    let called = 0;
    provider.subscribe(() => {
      called += 1;
    });
    expect(called).toBe(0);
  });

  it('subscribe の解除ハンドルは例外なく呼べる (no-op)', () => {
    const provider = new NullSyncProvider();
    const unsubscribe = provider.subscribe(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
