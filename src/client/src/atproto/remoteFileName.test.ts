import { describe, expect, test } from 'bun:test';
import type { Batch, BatchId, Did, FileId, NodeId } from '@conversensus/shared';
import { fileNameFromBatches, remoteFileRef, splitRef } from './remoteFileName';

const A = 'did:plc:alice' as Did;
const F = '11111111-1111-4111-8111-111111111111' as FileId;

let seq = 0;
const b = (clock: number, ops: Batch['ops'], actor = `${A}#dev-1`): Batch => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId,
  actor,
  clock,
  timestamp: 0,
  ops,
});

const setName = (name: string): Batch['ops'] => [
  { kind: 'file.setName', name },
];

describe('fileNameFromBatches', () => {
  test('file.setName の名前を返す', () => {
    expect(fileNameFromBatches([b(1, setName('test file'))])).toBe('test file');
  });

  test('最後の改名を採る — 最初で止めると古い名前が出る', () => {
    const batches = [b(1, setName('古い名前')), b(5, setName('新しい名前'))];
    expect(fileNameFromBatches(batches)).toBe('新しい名前');
  });

  test('順序は clock で決まる — 配列の並びではない', () => {
    // remote から返る順に依存すると、読むたびに名前が変わる
    const batches = [b(5, setName('新しい名前')), b(1, setName('古い名前'))];
    expect(fileNameFromBatches(batches)).toBe('新しい名前');
  });

  test('clock が同じなら actor と id で決まる — projection と同じ全順序', () => {
    // 改名が競合したとき、画面と中身が食い違わないための性質である
    const x = b(3, setName('あ'), `${A}#dev-1`);
    const y = b(3, setName('い'), 'did:plc:bob#dev-1');
    expect(fileNameFromBatches([x, y])).toBe(fileNameFromBatches([y, x]));
  });

  test('名前を決める op が無ければ null', () => {
    const batches = [
      b(1, [{ kind: 'node.add', target: 'n1' as NodeId, content: 'x' }]),
    ];
    expect(fileNameFromBatches(batches)).toBeNull();
  });

  test('batch が無ければ null', () => {
    expect(fileNameFromBatches([])).toBeNull();
  });

  test('渡された配列を並べ替えない', () => {
    // 呼び出し側が同じ配列を別の用途に使う
    const batches = [b(5, setName('新')), b(1, setName('古'))];
    const clocks = batches.map((x) => x.clock);
    fileNameFromBatches(batches);
    expect(batches.map((x) => x.clock)).toEqual(clocks);
  });
});

describe('remoteFileRef', () => {
  test('往復する', () => {
    expect(splitRef(remoteFileRef(A, F))).toEqual({ repo: A, fileId: F });
  });

  test('DID に `:` があっても割れる', () => {
    // 最後の `/` で割る。DID には `:` はあるが `/` は無い
    expect(splitRef(remoteFileRef('did:plc:x:y' as Did, F)).repo).toBe(
      'did:plc:x:y',
    );
  });
});
