import { describe, expect, it } from 'bun:test';
import type {
  LiveHint,
  LiveSignal,
} from '@conversensus/client/src/sync/liveChannel';
import type { FileId } from '@conversensus/shared';
import fc from 'fast-check';
import { watch } from './watch';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as FileId;
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as FileId;
const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as FileId;

/** 長すぎて試験の間には来ないポーリング */
const NEVER = 60 * 60_000;

/** 手で合図を出す流れ */
function fakeLive(
  connected = true,
): LiveSignal & { hint: (h: LiveHint) => void } {
  const listeners = new Set<(h: LiveHint) => void>();
  return {
    isConnected: () => connected,
    onHint: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    hint: (h) => {
      for (const l of listeners) l(h);
    },
  };
}

/** 呼ばれたことを順に記録する偽の headless */
function world(initial: FileId[], joinable: FileId[] = []) {
  const known = [...initial];
  const log: string[] = [];
  return {
    known,
    log,
    deps: {
      files: async () => [...known],
      discover: async () => {
        log.push('discover');
        for (const id of joinable) if (!known.includes(id)) known.push(id);
      },
      sync: async (id: FileId) => {
        log.push(`sync ${id}`);
      },
      onSynced: (id: FileId) => {
        log.push(`synced ${id}`);
      },
    },
  };
}

describe('watch (段 5 S2)', () => {
  it('始めると、見つけてから手元の File を全部同期する', async () => {
    const w = world([A, B]);
    const live = fakeLive();
    const { stop, idle } = watch({
      ...w.deps,
      live,
      pollIntervalMs: NEVER,
      livePollIntervalMs: NEVER,
    });
    await idle();
    stop();
    expect(w.log).toEqual([
      'discover',
      `sync ${A}`,
      `synced ${A}`,
      `sync ${B}`,
      `synced ${B}`,
    ]);
  });

  it('知っている File の合図は、その File だけを同期する (見つけ直さない)', async () => {
    const w = world([A, B]);
    const live = fakeLive();
    const { stop, idle } = watch({
      ...w.deps,
      live,
      pollIntervalMs: NEVER,
      livePollIntervalMs: NEVER,
    });
    await idle();
    w.log.length = 0;
    live.hint({ fileId: B });
    await idle();
    stop();
    expect(w.log).toEqual([`sync ${B}`, `synced ${B}`]);
  });

  it('🔴 知らない File の合図は、見つけ直してからその File を同期する (新しく参加した File)', async () => {
    const joinable: FileId[] = [];
    const w = world([A], joinable);
    const live = fakeLive();
    const { stop, idle } = watch({
      ...w.deps,
      live,
      pollIntervalMs: NEVER,
      livePollIntervalMs: NEVER,
    });
    await idle();
    w.log.length = 0;
    // 始めた後に参加した (alice が招待し、agent が受けた)
    joinable.push(NEW);
    live.hint({ fileId: NEW });
    await idle();
    stop();
    expect(w.log).toEqual(['discover', `sync ${NEW}`, `synced ${NEW}`]);
  });

  it('null の合図 (取りこぼしたかもしれない) は全部を同期する', async () => {
    const w = world([A, B]);
    const live = fakeLive();
    const { stop, idle } = watch({
      ...w.deps,
      live,
      pollIntervalMs: NEVER,
      livePollIntervalMs: NEVER,
    });
    await idle();
    w.log.length = 0;
    live.hint({ fileId: null });
    await idle();
    stop();
    expect(w.log).toEqual([
      `sync ${A}`,
      `synced ${A}`,
      `sync ${B}`,
      `synced ${B}`,
    ]);
  });

  it('合図が無くても、ポーリングが見つけ直して全部を同期する', async () => {
    const joinable: FileId[] = [];
    const w = world([A], joinable);
    const { stop } = watch({
      ...w.deps,
      live: fakeLive(false),
      pollIntervalMs: 5,
      livePollIntervalMs: NEVER,
    });
    // 始めた後に参加した File を、合図なしにポーリングが見つける
    joinable.push(NEW);
    await Bun.sleep(30);
    stop();
    expect(w.log.filter((l) => l === 'discover').length).toBeGreaterThan(1);
    expect(w.log).toContain(`synced ${NEW}`);
  });

  it('流れに繋がっている間は、ポーリングの間隔を延ばす', async () => {
    const w = world([A]);
    const { stop, idle } = watch({
      ...w.deps,
      live: fakeLive(true),
      pollIntervalMs: 5,
      livePollIntervalMs: NEVER,
    });
    await idle();
    await Bun.sleep(30);
    stop();
    expect(w.log.filter((l) => l === 'discover')).toEqual(['discover']);
  });

  it('同期が失敗しても onSynced は呼び、次の File へ進む', async () => {
    const w = world([A, B]);
    const errors: unknown[] = [];
    const { stop, idle } = watch({
      ...w.deps,
      sync: async (id) => {
        w.log.push(`sync ${id}`);
        if (id === A) throw new Error('PDS が落ちている');
      },
      live: fakeLive(),
      pollIntervalMs: NEVER,
      livePollIntervalMs: NEVER,
      onError: (e) => errors.push(e),
    });
    await idle();
    stop();
    expect(w.log).toContain(`synced ${A}`);
    expect(w.log).toContain(`synced ${B}`);
    expect(errors).toHaveLength(1);
  });

  it('性質: どんな合図の並びでも、同期は 1 本ずつで、合図を受けた知っている File はすべて同期される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<FileId | null>(A, B, null), {
          maxLength: 12,
        }),
        async (hints) => {
          const w = world([A, B]);
          let inFlight = 0;
          let maxInFlight = 0;
          const synced: FileId[] = [];
          const live = fakeLive();
          const { stop, idle } = watch({
            ...w.deps,
            sync: async () => {
              inFlight++;
              maxInFlight = Math.max(maxInFlight, inFlight);
              await Promise.resolve();
              inFlight--;
            },
            onSynced: (id) => {
              synced.push(id);
            },
            live,
            pollIntervalMs: NEVER,
            livePollIntervalMs: NEVER,
          });
          await idle();
          synced.length = 0;
          for (const h of hints) live.hint({ fileId: h });
          await idle();
          stop();
          expect(maxInFlight).toBe(1);
          const expected = hints.includes(null)
            ? [A, B]
            : [...new Set(hints as FileId[])];
          for (const id of expected) expect(synced).toContain(id);
        },
      ),
    );
  });
});
