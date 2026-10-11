import { afterEach, describe, expect, test } from 'bun:test';
import type { Actor, FileId } from '@conversensus/shared';
import { encode, Tagged } from 'cborg';
import { batchRkey } from '../atproto/batchRkey';
import { NSID } from '../atproto/types';
import { LiveChannel, type LiveHint, type SocketHandlers } from './liveChannel';

const FILE_A = '00000000-0000-4000-8000-00000000000a' as FileId;
const PDS = 'https://pds.example';

/** 開いた socket。テストが知らせを手で出す */
type FakeSocket = { url: string; handlers: SocketHandlers; closed: boolean };

/** PDS が送る commit のフレーム */
function commitFrame(paths: string[]): ArrayBuffer {
  const cid = new Tagged(42, new Uint8Array([0, 1]));
  const bytes = new Uint8Array([
    ...encode({ op: 1, t: '#commit' }),
    ...encode({
      seq: 1,
      repo: 'did:plc:bob',
      ops: paths.map((path) => ({ action: 'create', path, cid })),
      blocks: new Uint8Array(),
    }),
  ]);
  return bytes.buffer;
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function setup(initiallyActive = true) {
  const sockets: FakeSocket[] = [];
  let active = initiallyActive;
  let onActivity = () => {};
  const channel = new LiveChannel({
    pdsUrls: [PDS],
    createSocket: (url, handlers) => {
      const socket: FakeSocket = { url, handlers, closed: false };
      sockets.push(socket);
      return {
        close: () => {
          socket.closed = true;
        },
      };
    },
    isActive: () => active,
    watchActivity: (onChange) => {
      onActivity = onChange;
      return () => {};
    },
    reconnectMinMs: 5,
    reconnectMaxMs: 20,
  });
  const hints: LiveHint[] = [];
  channel.onHint((hint) => hints.push(hint));
  stops.push(channel.start());
  return {
    channel,
    sockets,
    hints,
    setActive: (next: boolean) => {
      active = next;
      onActivity();
    },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LiveChannel (#252)', () => {
  test('PDS の firehose に繋ぎ、繋がったら「取りこぼしたかもしれない」と知らせる', () => {
    const { channel, sockets, hints } = setup();
    expect(sockets.map((s) => s.url)).toEqual([
      'wss://pds.example/xrpc/com.atproto.sync.subscribeRepos',
    ]);
    expect(channel.isConnected()).toBe(false);
    sockets[0]?.handlers.onOpen();
    expect(channel.isConnected()).toBe(true);
    expect(hints).toEqual([{ fileId: null }]);
  });

  test('グラフの op-log と判断ログの書き込みは、その File への合図にする。ほかの collection は合図にしない', () => {
    const { sockets, hints } = setup();
    sockets[0]?.handlers.onOpen();
    hints.length = 0;
    const rkey = batchRkey(FILE_A, 'did:plc:bob#dev' as Actor, 1);
    sockets[0]?.handlers.onMessage(
      commitFrame([
        `${NSID.batch}/${rkey}`,
        `${NSID.judgment}/${rkey}`,
        `app.bsky.feed.post/3l3qo2vutsw2b`,
        `${NSID.folder}/whatever`,
      ]),
    );
    // 同じ File への書き込みが 1 つの commit に並んでも、合図は 1 つ
    expect(hints).toEqual([{ fileId: FILE_A }]);
  });

  test('切れたら知らせ、間隔を延ばしながら繋ぎ直す', async () => {
    const { channel, sockets, hints } = setup();
    sockets[0]?.handlers.onOpen();
    hints.length = 0;
    sockets[0]?.handlers.onClose();
    expect(channel.isConnected()).toBe(false);
    expect(hints).toEqual([{ fileId: null }]);

    await wait(10); // 最初の間隔 (5ms) の後に繋ぎ直す
    expect(sockets).toHaveLength(2);
    // 繋がらないまま切れたら、次は倍の間隔
    sockets[1]?.handlers.onClose();
    await wait(6);
    expect(sockets).toHaveLength(2);
    await wait(10);
    expect(sockets).toHaveLength(3);
  });

  test('繋がらないまま切れても、合図は出さない (繋がっていた間の延長が無いので)', () => {
    const { sockets, hints } = setup();
    sockets[0]?.handlers.onClose();
    expect(hints).toEqual([]);
  });

  test('背後に回る・オフラインになると切り、戻ると繋ぎ直す', () => {
    const { channel, sockets, hints, setActive } = setup();
    sockets[0]?.handlers.onOpen();
    hints.length = 0;

    setActive(false);
    expect(sockets[0]?.closed).toBe(true);
    expect(channel.isConnected()).toBe(false);
    expect(hints).toEqual([{ fileId: null }]);

    setActive(true);
    expect(sockets).toHaveLength(2);
  });

  test('見ていない間に始めたら繋がず、見たときに繋ぐ', () => {
    const { sockets, setActive } = setup(false);
    expect(sockets).toHaveLength(0);
    setActive(true);
    expect(sockets).toHaveLength(1);
  });

  test('止めたら切り、繋ぎ直さない', async () => {
    const { sockets } = setup();
    sockets[0]?.handlers.onOpen();
    const stop = stops.pop();
    stop?.();
    expect(sockets[0]?.closed).toBe(true);
    // 切った後に届いた閉じた知らせでは、繋ぎ直さない
    sockets[0]?.handlers.onClose();
    await wait(10);
    expect(sockets).toHaveLength(1);
  });
});
