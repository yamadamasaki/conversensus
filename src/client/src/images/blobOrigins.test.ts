import { describe, expect, test } from 'bun:test';
import type {
  Actor,
  Batch,
  BatchId,
  BlobCid,
  Did,
  MimeType,
  NodeId,
  Op,
} from '@conversensus/shared';
import { GENESIS_ACTOR } from '@conversensus/shared';
import { collectBlobOrigins } from './blobOrigins';
import { imagePropertiesOf } from './imageBlob';

const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;
const CID = 'bafkrei-one' as BlobCid;
const OTHER = 'bafkrei-two' as BlobCid;
const PNG = 'image/png' as MimeType;

const ref = (cid: BlobCid) => ({
  $type: 'blob' as const,
  ref: { $link: cid },
  mimeType: PNG,
  size: 3,
});

const addImage = (target: string, cid: BlobCid): Op => ({
  kind: 'node.add',
  target: target as NodeId,
  content: '',
  nodeType: 'image',
  properties: imagePropertiesOf(ref(cid)),
});

const addText = (target: string): Op => ({
  kind: 'node.add',
  target: target as NodeId,
  content: 'ただの文字',
});

let seq = 0;
const batch = (actor: string, clock: number, ops: Op[]): Batch => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId,
  actor: actor as Actor,
  clock,
  timestamp: 0,
  ops,
});
const by = (did: Did, clock: number, ops: Op[]) =>
  batch(`${did}#dev-1`, clock, ops);

describe('collectBlobOrigins', () => {
  test('画像を載せた batch の actor が由来になる', () => {
    const origins = collectBlobOrigins([by(BOB, 1, [addImage('n1', CID)])]);
    expect(origins.get(CID)).toBe(BOB);
  });

  test('同じ人の複数端末は 1 人として数える — 名簿は DID 単位である', () => {
    const origins = collectBlobOrigins([
      batch(`${BOB}#dev-2`, 1, [addImage('n1', CID)]),
    ]);
    expect(origins.get(CID)).toBe(BOB);
  });

  test('画像を持たない op からは何も出ない', () => {
    expect(collectBlobOrigins([by(BOB, 1, [addText('n1')])]).size).toBe(0);
  });

  test('cid ごとに別の由来を持つ', () => {
    const origins = collectBlobOrigins([
      by(ALICE, 1, [addImage('n1', CID)]),
      by(BOB, 2, [addImage('n2', OTHER)]),
    ]);
    expect(origins.get(CID)).toBe(ALICE);
    expect(origins.get(OTHER)).toBe(BOB);
  });

  test('⚠️ 同じ cid を 2 人が載せたら, 最初の 1 人を採る', () => {
    // どちらの repo からでも引けるので結果は変わらないが、**誰の手元でも同じ URL を
    // 叩く**ことは要る。clock 順の先頭を採ることで決定論になる
    const origins = collectBlobOrigins([
      by(BOB, 5, [addImage('n2', CID)]),
      by(ALICE, 1, [addImage('n1', CID)]),
    ]);
    expect(origins.get(CID)).toBe(ALICE);
  });

  test('⚠️ 入力の順序で結論が変わらない', () => {
    const ops = [
      by(BOB, 5, [addImage('n2', CID)]),
      by(ALICE, 1, [addImage('n1', CID)]),
    ];
    expect(collectBlobOrigins(ops).get(CID)).toBe(
      collectBlobOrigins([...ops].reverse()).get(CID),
    );
  });

  test('genesis の batch は由来にならない', () => {
    // `GENESIS_ACTOR` は DID ではないので repo を名指しできない
    const origins = collectBlobOrigins([
      batch(GENESIS_ACTOR, 1, [addImage('n1', CID)]),
    ]);
    expect(origins.size).toBe(0);
  });

  test('未ログインで書かれた batch は由来にならない', () => {
    // 未ログインの actor は `local#<deviceId>`。DID が無いので repo を指せない。
    // 由来が入らなければ呼び出し側は自分の repo に落ちる — 従来どおりである
    const origins = collectBlobOrigins([
      batch('local#dev-1', 1, [addImage('n1', CID)]),
    ]);
    expect(origins.size).toBe(0);
  });
});
