import { describe, expect, it } from 'bun:test';
import type {
  Batch,
  Did,
  FileId,
  NodeId,
  Op,
  Participation,
  ParticipationEvent,
} from '@conversensus/shared';
import { GENESIS_ACTOR } from '@conversensus/shared';
import type { RemoteBatch } from '../atproto/types';
import { receiveParticipantBatches } from './receiveParticipantBatches';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const OTHER_FILE = '22222222-2222-4222-8222-222222222222' as FileId;
const ME = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;
const CAROL = 'did:plc:carol' as Did;

const addNode = (id: string): Op => ({
  kind: 'node.add',
  target: id as NodeId,
  content: 'ノード',
});

const batch = (actor: string, clock: number): Batch => ({
  id: `${actor}-${clock}` as Batch['id'],
  actor,
  clock,
  timestamp: 1_700_000_000_000 + clock,
  ops: [addNode(`n${clock}`)],
});

const event = (
  kind: ParticipationEvent['kind'],
  clock: number,
): ParticipationEvent => ({ kind, clock, timestamp: clock, by: ME });

const roster = (
  history: Record<string, ParticipationEvent[]>,
): Participation => ({
  participating: new Set(Object.keys(history) as Did[]),
  invited: new Map(),
  departed: new Map(),
  history: new Map(Object.entries(history) as [Did, ParticipationEvent[]][]),
  rejected: [],
});

/** repo ごとの op-log を持つ fake。読んだ repo を記録する */
function fakeRemote(byRepo: Record<string, RemoteBatch[]>) {
  const readRepos: Did[] = [];
  const appended: { fileId: FileId; batches: Batch[] }[] = [];
  const observed: number[] = [];
  const failing = new Set<Did>();
  return {
    readRepos,
    appended,
    observed,
    failFor(did: Did) {
      failing.add(did);
    },
    deps: {
      pullRemoteForFile: async (_fileId: FileId, repo: Did) => {
        if (failing.has(repo)) throw new Error(`${repo} の PDS が応答しない`);
        readRepos.push(repo);
        return byRepo[repo] ?? [];
      },
      appendReceived: async (fileId: FileId, batches: Batch[]) => {
        appended.push({ fileId, batches });
        return batches.length;
      },
      observeRemote: (clock: number) => {
        observed.push(clock);
      },
    },
  };
}

const envelope = (fileId: FileId, b: Batch): RemoteBatch => ({
  fileId,
  batch: b,
});

describe('receiveParticipantBatches', () => {
  describe('誰の repo を読むか', () => {
    it('参加者から自分を除いた repo を読む', async () => {
      const remote = fakeRemote({
        [BOB]: [envelope(FILE, batch(BOB, 10))],
        [CAROL]: [envelope(FILE, batch(CAROL, 11))],
      });
      const p = roster({
        [ME]: [event('genesis', 1)],
        [BOB]: [event('accept', 5)],
        [CAROL]: [event('accept', 5)],
      });
      const result = await receiveParticipantBatches(FILE, p, ME, remote.deps);
      // 自分の repo は `receiveRemoteBatches` の担当なので読まない
      expect(result.readRepos).toEqual([BOB, CAROL]);
    });

    it('読む順序を名簿の反復順に依存させない (DID 昇順)', async () => {
      const remote = fakeRemote({});
      // 挿入順は carol → bob
      const p = roster({
        [CAROL]: [event('accept', 5)],
        [BOB]: [event('accept', 5)],
      });
      await receiveParticipantBatches(FILE, p, ME, remote.deps);
      expect(remote.readRepos).toEqual([BOB, CAROL]);
    });

    it('参加者が自分だけなら 1 件も読まない', async () => {
      const remote = fakeRemote({});
      const p = roster({ [ME]: [event('genesis', 1)] });
      const result = await receiveParticipantBatches(FILE, p, ME, remote.deps);
      expect(remote.readRepos).toEqual([]);
      expect(result.appended).toBe(0);
    });
  });

  describe('参加期間で絞る', () => {
    it('期間の中の batch だけを取り込む', async () => {
      const remote = fakeRemote({
        [BOB]: [
          envelope(FILE, batch(BOB, 3)), // 参加より前
          envelope(FILE, batch(BOB, 7)), // 参加中
          envelope(FILE, batch(BOB, 20)), // 取りやめ後
        ],
      });
      const p = roster({ [BOB]: [event('accept', 5), event('revoke', 15)] });
      const result = await receiveParticipantBatches(FILE, p, ME, remote.deps);

      expect(result.received).toBe(1);
      expect(result.outsidePeriod).toBe(2);
      expect(remote.appended[0]?.batches.map((b) => b.clock)).toEqual([7]);
    });

    it('全部が期間の外なら書き込みに行かない', async () => {
      const remote = fakeRemote({
        [BOB]: [envelope(FILE, batch(BOB, 20))],
      });
      const p = roster({ [BOB]: [event('accept', 5), event('revoke', 15)] });
      const result = await receiveParticipantBatches(FILE, p, ME, remote.deps);
      expect(result.outsidePeriod).toBe(1);
      expect(remote.appended).toEqual([]);
      // clock も進めない (取り込んでいないので「後」を騙らせない)
      expect(remote.observed).toEqual([]);
    });

    it('相手の repo にある genesis は期間によらず取り込む', async () => {
      // 承認した側が起源を持たない op-log を畳むとシートが 1 枚も立ち上がらない
      const remote = fakeRemote({
        [BOB]: [envelope(FILE, batch(GENESIS_ACTOR, 0))],
      });
      const p = roster({ [BOB]: [event('accept', 5)] });
      const result = await receiveParticipantBatches(FILE, p, ME, remote.deps);
      expect(result.received).toBe(1);
      expect(result.outsidePeriod).toBe(0);
    });
  });

  describe('取り込み', () => {
    it('取り込んだ最大 clock で自端末 clock を進める', async () => {
      const remote = fakeRemote({
        [BOB]: [envelope(FILE, batch(BOB, 7)), envelope(FILE, batch(BOB, 12))],
      });
      const p = roster({ [BOB]: [event('accept', 5)] });
      await receiveParticipantBatches(FILE, p, ME, remote.deps);
      expect(remote.observed).toEqual([12]);
    });

    it('他ファイル宛の batch は落とす (rkey とボディの食い違いの検知器)', async () => {
      const remote = fakeRemote({
        [BOB]: [
          envelope(FILE, batch(BOB, 7)),
          envelope(OTHER_FILE, batch(BOB, 8)),
        ],
      });
      const p = roster({ [BOB]: [event('accept', 5)] });
      const result = await receiveParticipantBatches(FILE, p, ME, remote.deps);
      expect(result.skippedOtherFile).toBe(1);
      expect(remote.appended[0]?.batches.map((b) => b.clock)).toEqual([7]);
    });

    it('2 回呼んでも書き込みは同じ内容になる (べき等)', async () => {
      const remote = fakeRemote({
        [BOB]: [envelope(FILE, batch(BOB, 7))],
      });
      const p = roster({ [BOB]: [event('accept', 5)] });
      await receiveParticipantBatches(FILE, p, ME, remote.deps);
      await receiveParticipantBatches(FILE, p, ME, remote.deps);
      expect(remote.appended).toHaveLength(2);
      expect(remote.appended[0]?.batches).toEqual(
        remote.appended[1]?.batches as Batch[],
      );
    });
  });

  describe('1 人の失敗で全体を止めない', () => {
    it('読めなかった repo は理由とともに返し、残りは取り込む', async () => {
      const remote = fakeRemote({
        [CAROL]: [envelope(FILE, batch(CAROL, 9))],
      });
      remote.failFor(BOB);
      const p = roster({
        [BOB]: [event('accept', 5)],
        [CAROL]: [event('accept', 5)],
      });
      const result = await receiveParticipantBatches(FILE, p, ME, remote.deps);

      expect(result.unreadable.map((u) => u.did)).toEqual([BOB]);
      expect(result.readRepos).toEqual([CAROL]);
      expect(result.appended).toBe(1);
    });
  });
});
