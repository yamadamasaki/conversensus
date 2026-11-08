import { describe, expect, test } from 'bun:test';
import {
  ADDRESSEE_PROPERTY,
  type Batch,
  CLOSED_PROPERTY,
  type FileId,
  type Op,
  SENT_PROPERTY,
} from '@conversensus/shared';
import { detectArrivedRequests } from './requestArrival';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const SHEET = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const ALICE = 'did:plc:alice';
const AGENT = 'did:plc:agent';
const BOB = 'did:plc:bob';

let clock = 0;
/** batch を 1 つ作る。clock は作った順 (畳み込みの順序) */
function batch(actor: string, ops: Op[], sheetId?: string): Batch {
  clock += 1;
  return {
    id: crypto.randomUUID(),
    actor: `${actor}#dev`,
    clock,
    seq: clock,
    deps: {},
    timestamp: clock,
    ...(sheetId && { sheetId }),
    ops,
  } as unknown as Batch;
}

/** alice が Sheet と、宛先 `addressee` の依頼 node を作った (受信の前から手元にある) */
function made(addressee: string[]): Batch[] {
  return [
    batch(ALICE, [{ kind: 'sheet.create', target: SHEET, name: 'S' } as Op]),
    batch(
      ALICE,
      [
        {
          kind: 'node.add',
          target: REQ,
          content: '要約して',
          properties: { [ADDRESSEE_PROPERTY]: addressee },
        } as unknown as Op,
      ],
      SHEET,
    ),
  ];
}
const setProp = (actor: string, name: string, value: unknown) =>
  batch(
    actor,
    [{ kind: 'node.setProperty', target: REQ, name, value } as Op],
    SHEET,
  );

const detect = (local: Batch[], incoming: Batch[], viewer = AGENT) =>
  detectArrivedRequests({ fileId: FILE, local, incoming, viewer });

describe('detectArrivedRequests', () => {
  test('他の人が自分宛てに送った依頼を、何回目か・送った人・本文つきで返す', () => {
    expect(detect(made([AGENT]), [setProp(ALICE, SENT_PROPERTY, 1)])).toEqual([
      {
        fileId: FILE,
        sheetId: SHEET as never,
        nodeId: REQ as never,
        sent: 1,
        content: '要約して',
        from: ALICE,
      },
    ]);
  });

  test('宛先が空 (不特定) なら参加者の誰にでも届く', () => {
    expect(
      detect(made([]), [setProp(ALICE, SENT_PROPERTY, 1)], BOB),
    ).toHaveLength(1);
  });

  test('宛先に入っていなければ届かない', () => {
    expect(
      detect(made([AGENT]), [setProp(ALICE, SENT_PROPERTY, 1)], BOB),
    ).toEqual([]);
  });

  test('自分が (別の端末から) 送ったものは出さない', () => {
    expect(detect(made([]), [setProp(ALICE, SENT_PROPERTY, 1)], ALICE)).toEqual(
      [],
    );
  });

  test('受信の前から同じ回数なら出さない。送り直すとまた出る', () => {
    const local = [...made([AGENT]), setProp(ALICE, SENT_PROPERTY, 1)];
    expect(detect(local, [])).toEqual([]);
    expect(
      detect(local, [setProp(ALICE, SENT_PROPERTY, 2)]).map((a) => a.sent),
    ).toEqual([2]);
  });

  test('同じ受信で閉じられたものは出さない', () => {
    expect(
      detect(made([AGENT]), [
        setProp(ALICE, SENT_PROPERTY, 1),
        setProp(ALICE, CLOSED_PROPERTY, true),
      ]),
    ).toEqual([]);
  });

  test('sent を書いた op が無ければ何も返さない (畳まない)', () => {
    expect(detect(made([AGENT]), [setProp(ALICE, 'priority', 'high')])).toEqual(
      [],
    );
  });

  test('依頼ではない node の sent は数えない', () => {
    const local = [
      batch(ALICE, [{ kind: 'sheet.create', target: SHEET, name: 'S' } as Op]),
      batch(
        ALICE,
        [{ kind: 'node.add', target: REQ, content: 'ただの node' } as Op],
        SHEET,
      ),
    ];
    expect(detect(local, [setProp(ALICE, SENT_PROPERTY, 1)])).toEqual([]);
  });
});
