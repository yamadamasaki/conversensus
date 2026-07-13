import { describe, expect, it } from 'bun:test';
import type { Batch, NodeId } from '@conversensus/shared';
import { NullSyncProvider } from './nullSyncProvider';
import { Outbox } from './outbox';
import type {
  Cursor,
  OnRemote,
  PullResult,
  SyncProvider,
} from './syncProvider';

const batch = (id: string, clock: number): Batch => ({
  id: id as Batch['id'],
  actor: 'local',
  clock,
  timestamp: clock,
  ops: [{ kind: 'node.add', target: `n${id}` as NodeId, content: id }],
});

/** push を記録し、成否を切り替えられるテスト用 provider */
class RecordingProvider implements SyncProvider {
  pushed: Batch[][] = [];
  online = true;
  /** push 呼び出し中に走らせるフック (in-flight enqueue の再現用) */
  onPush?: () => void;

  async push(batches: Batch[]): Promise<void> {
    this.onPush?.();
    if (!this.online) throw new Error('offline');
    this.pushed.push(batches);
  }
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: [], cursor: '' };
  }
  subscribe(_onRemote: OnRemote) {
    return () => {};
  }
}

describe('Outbox', () => {
  describe('enqueue', () => {
    it('積んだ batches を FIFO で保持する', () => {
      const outbox = new Outbox();
      outbox.enqueue([batch('1', 1), batch('2', 2)]);
      expect(outbox.pending().map((b) => b.id)).toEqual(['1', '2']);
      expect(outbox.size).toBe(2);
    });

    it('同一 id の再 enqueue は無視する (べき等)', () => {
      const outbox = new Outbox();
      outbox.enqueue([batch('1', 1)]);
      outbox.enqueue([batch('1', 1), batch('2', 2)]);
      expect(outbox.pending().map((b) => b.id)).toEqual(['1', '2']);
    });
  });

  describe('flush (オンライン)', () => {
    it('保留を provider へ push し、成功したら除去する', async () => {
      const provider = new RecordingProvider();
      const outbox = new Outbox();
      outbox.enqueue([batch('1', 1), batch('2', 2)]);
      const result = await outbox.flush(provider);
      expect(result).toEqual({ ok: true, flushed: 2 });
      expect(outbox.isEmpty).toBe(true);
      expect(provider.pushed).toEqual([[batch('1', 1), batch('2', 2)]]);
    });

    it('空 outbox の flush は no-op で成功する', async () => {
      const outbox = new Outbox();
      const result = await outbox.flush(new NullSyncProvider());
      expect(result).toEqual({ ok: true, flushed: 0 });
    });
  });

  describe('flush (オフライン分岐)', () => {
    it('push が reject したら保留を維持し ok=false を返す', async () => {
      const provider = new RecordingProvider();
      provider.online = false;
      const outbox = new Outbox();
      outbox.enqueue([batch('1', 1)]);
      const result = await outbox.flush(provider);
      expect(result.ok).toBe(false);
      expect(result.flushed).toBe(0);
      expect(outbox.size).toBe(1);
    });

    it('復帰後に再 flush すると送信できる', async () => {
      const provider = new RecordingProvider();
      provider.online = false;
      const outbox = new Outbox();
      outbox.enqueue([batch('1', 1)]);
      await outbox.flush(provider); // オフラインで失敗
      provider.online = true;
      const result = await outbox.flush(provider); // 復帰後に再送
      expect(result).toEqual({ ok: true, flushed: 1 });
      expect(outbox.isEmpty).toBe(true);
    });
  });

  describe('in-flight enqueue', () => {
    it('push 中に積まれた新規 batch は失われず保留に残る', async () => {
      const provider = new RecordingProvider();
      const outbox = new Outbox();
      outbox.enqueue([batch('1', 1)]);
      // push の最中に batch 2 が積まれる状況を再現する
      provider.onPush = () => outbox.enqueue([batch('2', 2)]);
      const result = await outbox.flush(provider);
      // スナップショット分 (batch 1) のみ除去され、新規 (batch 2) は残る
      expect(result).toEqual({ ok: true, flushed: 1 });
      expect(outbox.pending().map((b) => b.id)).toEqual(['2']);
    });
  });
});
