import { describe, expect, it } from 'bun:test';
import type { Batch, NodeId, SheetId } from '@conversensus/shared';
import { LamportClock, SheetIdSchema } from '@conversensus/shared';
import type {
  NodeLayout,
  NodeRelabeledEvent,
  NodeStyleChangedEvent,
} from '../events/GraphEvent';
import { graphEventToBatch } from '../events/toUnified';
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
  /** restore で観測される既存ログ (pull が返す) */
  existing: Batch[] = [];
  /** pull を失敗させて restore 失敗を再現する */
  pullFails = false;
  async push(batches: Batch[]): Promise<void> {
    if (!this.online) throw new Error('offline');
    this.pushed.push(...batches);
  }
  async pull(_since: Cursor): Promise<PullResult> {
    if (this.pullFails) throw new Error('pull failed');
    return { batches: this.existing, cursor: '' };
  }
  subscribe(_onRemote: OnRemote) {
    return () => {};
  }
}

const ACTOR = 'did:plc:alice#device-1';

/** 指定 clock を持つ有効な既存 batch (restore テストの永続ログ用) */
const existingBatch = (clock: number): Batch =>
  graphEventToBatch(relabel(), { clock, actor: ACTOR });

describe('EventSyncTap', () => {
  it('ops を生じる event を Batch 化して provider へ push する', async () => {
    const provider = new RecordingProvider();
    const tap = new EventSyncTap({ provider, actor: ACTOR });
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed).toHaveLength(1);
    expect(provider.pushed[0]?.ops[0]?.kind).toBe('node.setContent');
  });

  it('tap に渡した actor が batch に載る (Phase 4d-2)', async () => {
    // actor は UI の event ではなく同期層が与える。端末まで一意な値なので、
    // 受信側が因果順序と重複排除の単位を識別できる
    const provider = new RecordingProvider();
    const tap = new EventSyncTap({ provider, actor: 'did:plc:bob#device-9' });
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed[0]?.actor).toBe('did:plc:bob#device-9');
  });

  it('空 ops の event はスキップし clock も消費しない', async () => {
    const provider = new RecordingProvider();
    const clock = new LamportClock();
    const tap = new EventSyncTap({ provider, clock, actor: ACTOR });
    tap.record(emptyStyle());
    await tap.settled();
    expect(provider.pushed).toHaveLength(0);
    expect(clock.current()).toBe(0); // tick されていない
  });

  it('連続 record で clock が単調増加する', async () => {
    const provider = new RecordingProvider();
    const tap = new EventSyncTap({ provider, actor: ACTOR });
    tap.record(relabel());
    tap.record(relabel());
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed.map((b) => b.clock)).toEqual([1, 2, 3]);
  });

  it('再起動後は永続ログの max clock を観測し max+1 から発番する', async () => {
    const provider = new RecordingProvider();
    provider.existing = [existingBatch(5), existingBatch(7), existingBatch(6)];
    const clock = new LamportClock(); // 0 起点 (再起動直後を模す)
    const tap = new EventSyncTap({ provider, clock, actor: ACTOR });
    tap.record(relabel());
    tap.record(relabel());
    await tap.settled();
    // max(5,7,6)=7 を seed → 次の tick は 8, 9
    expect(provider.pushed.map((b) => b.clock)).toEqual([8, 9]);
  });

  it('restore (pull) 失敗時は保留し発番せず、次の record で再試行する', async () => {
    const provider = new RecordingProvider();
    provider.pullFails = true;
    const clock = new LamportClock();
    const errors: unknown[] = [];
    const tap = new EventSyncTap({
      provider,
      actor: ACTOR,
      clock,
      onError: (e) => errors.push(e),
    });
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed).toHaveLength(0);
    expect(tap.pending).toBe(1); // event は保留
    expect(clock.current()).toBe(0); // tick されていない
    expect(errors).toHaveLength(1);

    provider.pullFails = false;
    provider.existing = [existingBatch(3)];
    tap.record(relabel()); // restore 再試行 → seed(3) → tick 4,5
    await tap.settled();
    expect(provider.pushed.map((b) => b.clock)).toEqual([4, 5]);
    expect(tap.pending).toBe(0);
  });

  it('record の sheetId が push された content batch に載る (W3c2)', async () => {
    const provider = new RecordingProvider();
    const tap = new EventSyncTap({ provider, actor: ACTOR });
    const sheetId = SheetIdSchema.parse(crypto.randomUUID()) as SheetId;
    tap.record(relabel(), sheetId);
    await tap.settled();
    expect(provider.pushed[0]?.sheetId).toBe(sheetId);
  });

  it('sheetId 無しの record は sheetId を持たない batch になる (structure 経路)', async () => {
    const provider = new RecordingProvider();
    const tap = new EventSyncTap({ provider, actor: ACTOR });
    tap.record(relabel());
    await tap.settled();
    expect(provider.pushed[0]?.sheetId).toBeUndefined();
  });

  it('オフライン時は保留し、復帰後の record で再送する', async () => {
    const provider = new RecordingProvider();
    provider.online = false;
    const errors: unknown[] = [];
    const tap = new EventSyncTap({
      provider,
      actor: ACTOR,
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
