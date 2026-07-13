import { describe, expect, it } from 'bun:test';
import type { Batch, NodeId } from '@conversensus/shared';
import { LamportClock } from '@conversensus/shared';
import type {
  NodeLayout,
  NodeRelabeledEvent,
  NodeStyleChangedEvent,
} from '../events/GraphEvent';
import { EventSyncTap } from './eventSyncTap';
import type {
  Cursor,
  OnRemote,
  PullResult,
  SyncProvider,
} from './syncProvider';

let seq = 0;
const uuid = () => {
  seq += 1;
  return `${seq.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
};

/** node.setContent を 1 件生む content イベント (ops あり) */
const relabel = (): NodeRelabeledEvent => ({
  id: uuid(),
  timestamp: Date.now(),
  userId: 'local',
  category: 'content',
  type: 'NODE_RELABELED',
  nodeId: uuid() as NodeId,
  from: 'a',
  to: 'b',
});

/** width/height を持たない style イベント → ops 空 */
const emptyStyle = (): NodeStyleChangedEvent => {
  const nodeId = uuid() as NodeId;
  return {
    id: uuid(),
    timestamp: Date.now(),
    userId: 'local',
    category: 'presentation',
    type: 'NODE_STYLE_CHANGED',
    nodeId,
    from: { nodeId } as NodeLayout,
    to: { nodeId } as NodeLayout,
  };
};

class RecordingProvider implements SyncProvider {
  pushed: Batch[] = [];
  online = true;
  async push(batches: Batch[]): Promise<void> {
    if (!this.online) throw new Error('offline');
    this.pushed.push(...batches);
  }
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: [], cursor: '' };
  }
  subscribe(_onRemote: OnRemote) {
    return () => {};
  }
}

describe('EventSyncTap', () => {
  it('ops を生じる event を Batch 化して provider へ push する', async () => {
    const provider = new RecordingProvider();
    const tap = new EventSyncTap({ provider });
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed).toHaveLength(1);
    expect(provider.pushed[0]?.ops[0]?.kind).toBe('node.setContent');
  });

  it('空 ops の event はスキップし clock も消費しない', async () => {
    const provider = new RecordingProvider();
    const clock = new LamportClock();
    const tap = new EventSyncTap({ provider, clock });
    tap.record(emptyStyle());
    await tap.settled();
    expect(provider.pushed).toHaveLength(0);
    expect(clock.current()).toBe(0); // tick されていない
  });

  it('連続 record で clock が単調増加する', async () => {
    const provider = new RecordingProvider();
    const tap = new EventSyncTap({ provider });
    tap.record(relabel());
    tap.record(relabel());
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed.map((b) => b.clock)).toEqual([1, 2, 3]);
  });

  it('オフライン時は保留し、復帰後の record で再送する', async () => {
    const provider = new RecordingProvider();
    provider.online = false;
    const errors: unknown[] = [];
    const tap = new EventSyncTap({
      provider,
      onError: (e) => errors.push(e),
    });
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed).toHaveLength(0);
    expect(tap.pending).toBe(1);
    expect(errors).toHaveLength(1);

    provider.online = true;
    tap.record(relabel()); // 復帰後の操作が drain を再起動
    await tap.settled();
    expect(provider.pushed).toHaveLength(2); // 保留分 + 新規
    expect(tap.pending).toBe(0);
  });
});
