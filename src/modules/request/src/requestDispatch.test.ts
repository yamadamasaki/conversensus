import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorage } from '@conversensus/headless/src/fileStorage';
import type { FileId, NodeId, SheetId } from '@conversensus/shared';
import fc from 'fast-check';
import {
  type AttemptStore,
  createDispatcher,
  DEFAULT_DISPATCH_LIMITS,
  type DispatchLimits,
  type RequestJob,
  type SkipReason,
  storageAttempts,
} from './requestDispatch';

const FILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as FileId;
const SHEET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as SheetId;
const N1 = '11111111-1111-4111-8111-111111111111' as NodeId;
const N2 = '22222222-2222-4222-8222-222222222222' as NodeId;

const job = (nodeId: NodeId, sent: number): RequestJob => ({
  fileId: FILE,
  sheetId: SHEET,
  nodeId,
  sent,
  content: `依頼 ${nodeId.slice(0, 1)} の ${sent} 回目`,
});

/** プロセスの中だけの印 */
function memoryAttempts(): AttemptStore {
  const map = new Map<string, number>();
  return {
    lastAttempted: (f, n) => map.get(`${f}/${n}`) ?? 0,
    record: (f, n, sent) => map.set(`${f}/${n}`, sent),
  };
}

/** 今答えるべき依頼を差し替えられる世界 */
function world(attempts: AttemptStore = memoryAttempts()) {
  let open: RequestJob[] = [];
  const ran: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const dispatcher = createDispatcher({
    requestsOf: () => open,
    runner: {
      run: async (j) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Bun.sleep(0);
        ran.push(`${j.nodeId.slice(0, 1)}#${j.sent}`);
        inFlight--;
      },
    },
    attempts,
  });
  return {
    dispatcher,
    ran,
    maxInFlight: () => maxInFlight,
    setOpen: (jobs: RequestJob[]) => {
      open = jobs;
    },
  };
}

describe('createDispatcher (段 5 S3)', () => {
  it('答えるべき依頼を 1 つずつ起動する', async () => {
    const w = world();
    w.setOpen([job(N1, 1), job(N2, 1)]);
    w.dispatcher.offer(FILE);
    await w.dispatcher.idle();
    expect(w.ran).toEqual(['1#1', '2#1']);
    expect(w.maxInFlight()).toBe(1);
  });

  it('🔴 同じ送信には 2 度起動しない (同期のたびに offer が来ても)', async () => {
    const w = world();
    w.setOpen([job(N1, 1)]);
    w.dispatcher.offer(FILE);
    w.dispatcher.offer(FILE);
    await w.dispatcher.idle();
    w.dispatcher.offer(FILE);
    await w.dispatcher.idle();
    expect(w.ran).toEqual(['1#1']);
  });

  it('送り直されれば (回数が増えれば) もう一度起動する', async () => {
    const w = world();
    w.setOpen([job(N1, 1)]);
    w.dispatcher.offer(FILE);
    await w.dispatcher.idle();
    w.setOpen([job(N1, 2)]);
    w.dispatcher.offer(FILE);
    await w.dispatcher.idle();
    expect(w.ran).toEqual(['1#1', '1#2']);
  });

  it('列で待つ間に答えられた・閉じられた依頼は起動しない', async () => {
    const w = world();
    w.setOpen([job(N1, 1), job(N2, 1)]);
    w.dispatcher.offer(FILE);
    // N1 を起動している間に、誰かが N2 に答えた
    w.setOpen([job(N1, 1)]);
    await w.dispatcher.idle();
    expect(w.ran).toEqual(['1#1']);
  });

  it('回し終える間際に来た offer を取り残さない (性質が見つけた反例)', async () => {
    const w = world();
    w.setOpen([]);
    w.dispatcher.offer(FILE); // 空の列を回し始める
    w.setOpen([job(N2, 1)]);
    w.dispatcher.offer(FILE); // 回し終える前に入る
    await w.dispatcher.idle();
    expect(w.ran).toEqual(['2#1']);
  });

  it('起動が失敗しても印は残り (2 度起動しない)、次の依頼へ進む', async () => {
    const attempts = memoryAttempts();
    const errors: unknown[] = [];
    const ran: string[] = [];
    const dispatcher = createDispatcher({
      requestsOf: () => [job(N1, 1), job(N2, 1)],
      runner: {
        run: async (j) => {
          ran.push(j.nodeId);
          if (j.nodeId === N1) throw new Error('claude が落ちた');
        },
      },
      attempts,
      onError: (_, e) => errors.push(e),
    });
    dispatcher.offer(FILE);
    await dispatcher.idle();
    dispatcher.offer(FILE);
    await dispatcher.idle();
    expect(ran).toEqual([N1, N2]);
    expect(errors).toHaveLength(1);
  });

  it('🔴 印は置き場所に残り、再起動しても同じ送信に起動しない', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'attempts-')), 'storage.json');
    const first = world(storageAttempts(new FileStorage(path)));
    first.setOpen([job(N1, 1)]);
    first.dispatcher.offer(FILE);
    await first.dispatcher.idle();

    const second = world(storageAttempts(new FileStorage(path)));
    second.setOpen([job(N1, 1), job(N2, 1)]);
    second.dispatcher.offer(FILE);
    await second.dispatcher.idle();
    expect(first.ran).toEqual(['1#1']);
    expect(second.ran).toEqual(['2#1']);
  });

  it('性質: どんな offer と依頼の変わり方でも、同じ (node・回数) への起動は高々 1 回で、同時に 1 つ。最後に開いている依頼はその回数以上で起動済み', async () => {
    // 依頼の変わり方: 各 step で、2 つの node の送った回数 (0 = 答えるべきでない) を 1〜3 から引く
    const step = fc.record({
      n1: fc.integer({ min: 0, max: 3 }),
      n2: fc.integer({ min: 0, max: 3 }),
      wait: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 10 }), async (steps) => {
        const w = world();
        let open: RequestJob[] = [];
        for (const s of steps) {
          open = [
            ...(s.n1 > 0 ? [job(N1, s.n1)] : []),
            ...(s.n2 > 0 ? [job(N2, s.n2)] : []),
          ];
          w.setOpen(open);
          w.dispatcher.offer(FILE);
          if (s.wait) await w.dispatcher.idle();
        }
        await w.dispatcher.idle();
        expect(new Set(w.ran).size).toBe(w.ran.length);
        expect(w.maxInFlight()).toBeLessThanOrEqual(1);
        // 取り残さない: 最後に開いている依頼は、その回数以上で起動されている
        for (const j of open) {
          const prefix = `${j.nodeId.slice(0, 1)}#`;
          const most = Math.max(
            0,
            ...w.ran
              .filter((r) => r.startsWith(prefix))
              .map((r) => Number(r.slice(prefix.length))),
          );
          expect(most).toBeGreaterThanOrEqual(j.sent);
        }
      }),
    );
  });
});

describe('起動の回数の上限 (#387)', () => {
  const ALICE = 'did:plc:alice' as RequestJob['from'];
  const BOB = 'did:plc:bob' as RequestJob['from'];
  const node = (i: number) =>
    `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111` as NodeId;
  const from = (j: RequestJob, who: RequestJob['from']): RequestJob => ({
    ...j,
    ...(who && { from: who }),
  });

  /** 上限と時計を差し替えた世界 */
  function limited(limits: Partial<DispatchLimits>) {
    let open: RequestJob[] = [];
    let clock = 0;
    const ran: string[] = [];
    const skipped: SkipReason[] = [];
    const dispatcher = createDispatcher({
      requestsOf: () => open,
      runner: {
        run: async (j) => {
          ran.push(`${j.nodeId.slice(0, 8)}#${j.sent}`);
        },
      },
      attempts: memoryAttempts(),
      limits: { ...DEFAULT_DISPATCH_LIMITS, ...limits },
      onSkip: (_, reason) => skipped.push(reason),
      now: () => clock,
    });
    return {
      ran,
      skipped,
      offer: async (jobs: RequestJob[]) => {
        open = jobs;
        dispatcher.offer(FILE);
        await dispatcher.idle();
      },
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('🔴 列に入れる数に上限があり、溢れた分は次の offer で入る', async () => {
    const w = limited({ queue: 2 });
    const jobs = [1, 2, 3].map((i) => job(node(i), 1));
    await w.offer(jobs);
    expect(w.ran).toHaveLength(2);
    expect(w.skipped).toEqual(['queueFull']);
    await w.offer(jobs);
    expect(w.ran).toHaveLength(3);
  });

  it('🔴 1 時間あたりの起動に上限があり、時間が空けば次の offer で起動する', async () => {
    const w = limited({ perHour: 2 });
    const jobs = [1, 2, 3].map((i) => job(node(i), 1));
    await w.offer(jobs);
    expect(w.ran).toHaveLength(2);
    expect(w.skipped).toEqual(['perHour']);
    // 1 時間たたないうちは起動しない
    await w.offer(jobs);
    expect(w.ran).toHaveLength(2);
    w.advance(60 * 60_000 + 1);
    await w.offer(jobs);
    expect(w.ran).toHaveLength(3);
  });

  it('🔴 送り手ごとの上限: 1 人が上限に達しても、他の人の依頼は起動する', async () => {
    const w = limited({ perSenderPerHour: 1 });
    await w.offer([
      from(job(node(1), 1), ALICE),
      from(job(node(2), 1), ALICE),
      from(job(node(3), 1), BOB),
    ]);
    expect(w.ran).toEqual(['00000001#1', '00000003#1']);
    expect(w.skipped).toEqual(['perSender']);
  });

  it('🔴 同じ node への起動 (送り直し) に上限があり、超えたら送り直しても起動しない', async () => {
    const w = limited({ perNode: 2 });
    for (const sent of [1, 2, 3, 4]) await w.offer([job(N1, sent)]);
    expect(w.ran).toEqual(['11111111#1', '11111111#2']);
    expect(w.skipped).toEqual(['perNode', 'perNode']);
  });
});

describe('storageAttempts の数の上限 (#387)', () => {
  it('🔴 上限を超えたら、最後に置いたのが古い印から捨てる', () => {
    const dir = mkdtempSync(join(tmpdir(), 'attempts-cap-'));
    const attempts = storageAttempts(new FileStorage(join(dir, 's.json')), 2);
    attempts.record(FILE, N1, 1);
    attempts.record(FILE, N2, 1);
    // N1 を置き直すと新しくなる
    attempts.record(FILE, N1, 2);
    const N3 = '33333333-3333-4333-8333-333333333333' as NodeId;
    attempts.record(FILE, N3, 1);
    expect(attempts.lastAttempted(FILE, N2)).toBe(0);
    expect(attempts.lastAttempted(FILE, N1)).toBe(2);
    expect(attempts.lastAttempted(FILE, N3)).toBe(1);
  });
});
