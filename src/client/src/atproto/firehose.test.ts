import { describe, expect, test } from 'bun:test';
import { encode, Tagged } from 'cborg';
import fc from 'fast-check';
import { decodeFirehoseFrame, firehoseUrlOf } from './firehose';

/** ヘッダと本文を続けた 1 フレーム (PDS が送る形) */
const frame = (header: unknown, body: unknown) =>
  new Uint8Array([...encode(header), ...encode(body)]);

/** CID の代わり。tag 42 の中身は読まないので、バイト列なら何でもよい */
const cid = () => new Tagged(42, new Uint8Array([0, 1, 113, 18, 32]));

const commitBody = (repo: string, paths: string[]) => ({
  seq: 1,
  repo,
  rev: '3l3qo2vutsw2b',
  time: '2026-10-11T00:00:00.000Z',
  commit: cid(),
  blocks: new Uint8Array([1, 2, 3]),
  ops: paths.map((path) => ({ action: 'create', path, cid: cid() })),
  blobs: [],
  rebase: false,
  tooBig: false,
});

describe('decodeFirehoseFrame (#252)', () => {
  test('commit から DID と、書いた record の collection と rkey を取り出す', () => {
    const decoded = decodeFirehoseFrame(
      frame(
        { op: 1, t: '#commit' },
        commitBody('did:plc:alice', [
          'app.conversensus.v2.batch/file-1~actor~0000000001',
          'app.conversensus.v2.judgment/file-1~actor~0000000002',
        ]),
      ),
    );
    expect(decoded).toEqual({
      did: 'did:plc:alice',
      paths: [
        {
          collection: 'app.conversensus.v2.batch',
          rkey: 'file-1~actor~0000000001',
        },
        {
          collection: 'app.conversensus.v2.judgment',
          rkey: 'file-1~actor~0000000002',
        },
      ],
    });
  });

  test.each([
    ['#identity', { op: 1, t: '#identity' }, { seq: 1, did: 'did:plc:alice' }],
    [
      '#account',
      { op: 1, t: '#account' },
      { seq: 1, did: 'did:plc:alice', active: true },
    ],
    ['エラーのフレーム', { op: -1 }, { error: 'FutureCursor' }],
  ])('%s は合図にならない (null)', (_name, header, body) => {
    expect(decodeFirehoseFrame(frame(header, body))).toBeNull();
  });

  test('path に collection が無い op は飛ばす', () => {
    const decoded = decodeFirehoseFrame(
      frame(
        { op: 1, t: '#commit' },
        commitBody('did:plc:alice', ['nocollection', '/x']),
      ),
    );
    expect(decoded?.paths).toEqual([]);
  });

  test('∀ バイト列. 投げずに、解けなければ null を返す', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const decoded = decodeFirehoseFrame(bytes);
        expect(decoded === null || typeof decoded.did === 'string').toBe(true);
      }),
    );
  });
});

describe('firehoseUrlOf', () => {
  test('https の PDS は wss、http (開発) は ws にする', () => {
    expect(firehoseUrlOf('https://pds.conversensus.site')).toBe(
      'wss://pds.conversensus.site/xrpc/com.atproto.sync.subscribeRepos',
    );
    expect(firehoseUrlOf('http://localhost:3000')).toBe(
      'ws://localhost:3000/xrpc/com.atproto.sync.subscribeRepos',
    );
  });
});
