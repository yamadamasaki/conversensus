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
import { discoverParticipatingFiles } from './discoverParticipatingFiles';
import type { ReadRosterResult } from './readRoster';

const JOINED = '11111111-1111-4111-8111-111111111111' as FileId;
const MINE = '22222222-2222-4222-8222-222222222222' as FileId;
const INVITED_ONLY = '33333333-3333-4333-8333-333333333333' as FileId;
const ME = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;

const addNode = (id: string): Op => ({
  kind: 'node.add',
  target: id as NodeId,
  content: 'ノード',
});

const batch = (clock: number, ops: Op[] = [addNode(`n${clock}`)]): Batch => ({
  id: `b${clock}` as Batch['id'],
  actor: BOB,
  clock,
  timestamp: 1_700_000_000_000 + clock,
  ops,
});

const removeFile = (fileId: FileId): Op => ({
  kind: 'file.remove',
  target: fileId,
});

const event = (
  kind: ParticipationEvent['kind'],
  clock: number,
): ParticipationEvent => ({ kind, clock, timestamp: clock, by: BOB });

const rosterOf = (participants: Did[]): ReadRosterResult => ({
  participation: {
    participating: new Set(participants),
    invited: new Map(),
    departed: new Map(),
    history: new Map(participants.map((d) => [d, [event('accept', 1)]])),
    rejected: [],
  } satisfies Participation,
  batches: [],
  readRepos: [],
  unreadable: [],
});

type Options = {
  judgmentFiles?: FileId[];
  localFiles?: FileId[];
  rosters?: Record<string, ReadRosterResult>;
  collected?: Record<string, Batch[]>;
  rosterFails?: FileId[];
};

function harness(options: Options = {}) {
  const appended: { fileId: FileId; batches: Batch[] }[] = [];
  const collectedFor: FileId[] = [];
  const rosterFails = new Set(options.rosterFails ?? []);
  return {
    appended,
    collectedFor,
    deps: {
      listJudgmentFileIds: async () => options.judgmentFiles ?? [],
      listLocalFileIds: async () => options.localFiles ?? [],
      readRoster: async (fileId: FileId) => {
        if (rosterFails.has(fileId))
          throw new Error(`${fileId} の名簿が読めない`);
        return options.rosters?.[fileId] ?? rosterOf([]);
      },
      collectFromParticipants: async (fileId: FileId) => {
        collectedFor.push(fileId);
        return { batches: options.collected?.[fileId] ?? [] };
      },
      appendReceived: async (fileId: FileId, batches: Batch[]) => {
        appended.push({ fileId, batches });
        return batches.length;
      },
      viewer: ME,
    },
  };
}

describe('discoverParticipatingFiles', () => {
  describe('列挙の入口', () => {
    it('自分の判断ログにあって手元に無い File を立ち上げる', async () => {
      const h = harness({
        judgmentFiles: [JOINED],
        localFiles: [],
        rosters: { [JOINED]: rosterOf([ME, BOB]) },
        collected: { [JOINED]: [batch(1)] },
      });
      const result = await discoverParticipatingFiles(h.deps);

      expect(result.discovered).toEqual([JOINED]);
      expect(result.appended).toBe(1);
      expect(h.appended).toEqual([{ fileId: JOINED, batches: [batch(1)] }]);
    });

    it('既知の File は触らない', async () => {
      const h = harness({
        judgmentFiles: [MINE],
        localFiles: [MINE],
        rosters: { [MINE]: rosterOf([ME]) },
      });
      const result = await discoverParticipatingFiles(h.deps);

      expect(result.skippedKnownFiles).toBe(1);
      expect(result.discovered).toEqual([]);
      // 名簿すら読まない (既知の File に発見の仕事は無い)
      expect(h.collectedFor).toEqual([]);
    });

    it('2 回目は何もしない (べき等)', async () => {
      // 1 回目で materialize されたので、2 回目は既知集合に入っている
      const h = harness({
        judgmentFiles: [JOINED],
        localFiles: [JOINED],
        rosters: { [JOINED]: rosterOf([ME, BOB]) },
        collected: { [JOINED]: [batch(1)] },
      });
      const result = await discoverParticipatingFiles(h.deps);
      expect(result.discovered).toEqual([]);
      expect(h.appended).toEqual([]);
    });
  });

  describe('名簿で確かめてからグラフを読む', () => {
    it('いま参加者でない File は立ち上げない (依頼されただけ / 離脱済)', async () => {
      const h = harness({
        judgmentFiles: [INVITED_ONLY],
        rosters: { [INVITED_ONLY]: rosterOf([BOB]) }, // 自分がいない
        collected: { [INVITED_ONLY]: [batch(1)] },
      });
      const result = await discoverParticipatingFiles(h.deps);

      expect(result.skippedNotParticipating).toBe(1);
      expect(result.discovered).toEqual([]);
      // **グラフを読みに行かない。**参加期間が 1 つも開いていないので全部落ちる
      expect(h.collectedFor).toEqual([]);
    });

    it('名簿が読めなければ理由とともに返し、他の File は続ける', async () => {
      const h = harness({
        judgmentFiles: [INVITED_ONLY, JOINED],
        rosterFails: [INVITED_ONLY],
        rosters: { [JOINED]: rosterOf([ME, BOB]) },
        collected: { [JOINED]: [batch(1)] },
      });
      const result = await discoverParticipatingFiles(h.deps);

      expect(result.unreadable.map((u) => u.fileId)).toEqual([INVITED_ONLY]);
      expect(result.discovered).toEqual([JOINED]);
    });
  });

  describe('書く前の検査', () => {
    it('相手が消した File は materialize しない (remove-wins)', async () => {
      const h = harness({
        judgmentFiles: [JOINED],
        rosters: { [JOINED]: rosterOf([ME, BOB]) },
        collected: { [JOINED]: [batch(1), batch(5, [removeFile(JOINED)])] },
      });
      const result = await discoverParticipatingFiles(h.deps);

      expect(result.skippedDeletedFiles).toBe(1);
      expect(result.discovered).toEqual([]);
      // **1 件も書かない。**書いてから消す形は取れない (削除は tombstone でしか表せない)
      expect(h.appended).toEqual([]);
    });

    it('相手の repo から 1 件も集まらなければ File を作らない', async () => {
      const h = harness({
        judgmentFiles: [JOINED],
        rosters: { [JOINED]: rosterOf([ME, BOB]) },
        collected: { [JOINED]: [] },
      });
      const result = await discoverParticipatingFiles(h.deps);

      expect(result.discovered).toEqual([]);
      expect(h.appended).toEqual([]);
    });
  });
});
