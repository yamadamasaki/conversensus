import { afterEach, describe, expect, it } from 'bun:test';
import { batchRkey } from '@conversensus/client/src/atproto/batchRkey';
import { NSID } from '@conversensus/client/src/atproto/types';
import type { LiveHint } from '@conversensus/client/src/sync/liveChannel';
import type { Actor, FileId } from '@conversensus/shared';
import { encode, Tagged } from 'cborg';
import { headlessLiveChannel } from './liveSocket';

const FILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as FileId;
const ACTOR = 'did:plc:alice#dev' as Actor;

/** PDS が送る commit の 1 フレーム (ヘッダ + 本文) */
function commitFrame(path: string): Uint8Array {
  const cid = new Tagged(42, new Uint8Array([0, 1, 113, 18, 32]));
  return new Uint8Array([
    ...encode({ op: 1, t: '#commit' }),
    ...encode({
      seq: 1,
      repo: 'did:plc:alice',
      rev: '3l3qo2vutsw2b',
      time: '2026-11-09T00:00:00.000Z',
      commit: cid,
      blocks: new Uint8Array([1]),
      ops: [{ action: 'create', path, cid }],
      blobs: [],
      rebase: false,
      tooBig: false,
    }),
  ]);
}

let server: ReturnType<typeof Bun.serve> | null = null;
/** サーバ側の繋がっている socket (相手から切るのに使う) */
const sockets = new Set<{ close: () => void }>();
afterEach(() => {
  server?.stop(true);
  server = null;
  sockets.clear();
});

/** 繋がると commit を 1 つ送る、firehose の代わり */
function fakeFirehose(path: string) {
  server = Bun.serve({
    port: 0,
    fetch(request, s) {
      if (new URL(request.url).pathname.endsWith('subscribeRepos')) {
        if (s.upgrade(request, { data: undefined })) return undefined;
      }
      return new Response('not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        ws.sendBinary(commitFrame(path));
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {},
    },
  });
  return `http://127.0.0.1:${server.port}`;
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(10);
}

describe('headlessLiveChannel (段 5 S2)', () => {
  it('🔴 画面が無くても繋ぎ、繋がった合図 (null) と、書かれた File の合図を出す', async () => {
    const pdsUrl = fakeFirehose(`${NSID.batch}/${batchRkey(FILE, ACTOR, 1)}`);
    const channel = headlessLiveChannel([pdsUrl]);
    const hints: LiveHint[] = [];
    channel.onHint((h) => hints.push(h));
    const stop = channel.start();
    await until(() => hints.length >= 2);
    expect(channel.isConnected()).toBe(true);
    expect(hints).toEqual([{ fileId: null }, { fileId: FILE }]);
    stop();
    expect(channel.isConnected()).toBe(false);
  });

  it('切れたら繋ぎ直す', async () => {
    const pdsUrl = fakeFirehose('app.bsky.feed.post/x');
    const channel = headlessLiveChannel([pdsUrl], { reconnectMinMs: 10 });
    let opened = 0;
    channel.onHint(() => {
      if (channel.isConnected()) opened++;
    });
    const stop = channel.start();
    await until(() => opened === 1);
    // 相手が切る (PDS の再起動に当たる)
    for (const ws of sockets) ws.close();
    await until(() => opened === 2);
    stop();
    expect(opened).toBe(2);
  });
});
