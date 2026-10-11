import { describe, expect, test } from 'bun:test';
import { CausalClock, type FileId } from '@conversensus/shared';
import {
  recallOwnJudgmentPoint,
  rememberOwnJudgmentPoint,
} from './ownJudgmentPoint';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const OTHER = '22222222-2222-4222-8222-222222222222' as FileId;
const ALICE = 'did:plc:alice#dev-1';
const LOCAL = 'local#dev-1';

/** 読み書きを手で見られる保存領域 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('ownJudgmentPoint (#261 の窓 1)', () => {
  test('覚えた点を File ごとに読み戻す', () => {
    const storage = memoryStorage();
    rememberOwnJudgmentPoint(FILE, { actor: ALICE, seq: 4, clock: 9 }, storage);
    expect(recallOwnJudgmentPoint(FILE, ALICE, storage)).toEqual({
      actor: ALICE,
      seq: 4,
      clock: 9,
    });
    expect(recallOwnJudgmentPoint(OTHER, ALICE, storage)).toBeNull();
  });

  test('別の actor の点は下限にしない (seq は actor ごとの連番)', () => {
    const storage = memoryStorage();
    rememberOwnJudgmentPoint(FILE, { actor: LOCAL, seq: 4, clock: 9 }, storage);
    expect(recallOwnJudgmentPoint(FILE, ALICE, storage)).toBeNull();
  });

  test('前に覚えた点より小さければ覚え直さない', () => {
    const storage = memoryStorage();
    rememberOwnJudgmentPoint(FILE, { actor: ALICE, seq: 5, clock: 9 }, storage);
    rememberOwnJudgmentPoint(FILE, { actor: ALICE, seq: 3, clock: 4 }, storage);
    expect(recallOwnJudgmentPoint(FILE, ALICE, storage)?.seq).toBe(5);
  });

  test('壊れた値・保存領域が無いときは無いものとする', () => {
    const storage = memoryStorage();
    storage.setItem(`conversensus.ownJudgmentPoint.${FILE}`, '{壊れている');
    expect(recallOwnJudgmentPoint(FILE, ALICE, storage)).toBeNull();
    expect(recallOwnJudgmentPoint(FILE, ALICE, null)).toBeNull();
    // 書けなくても判断を書くことは止めない
    expect(() =>
      rememberOwnJudgmentPoint(FILE, { actor: ALICE, seq: 1, clock: 1 }, null),
    ).not.toThrow();
  });

  test('読み戻した点を下限にした発番器は、その点の後から振る', () => {
    // 再読み込みの後に File を開いた直後 (最初の受信サイクルの前) の編集にあたる
    const storage = memoryStorage();
    rememberOwnJudgmentPoint(
      FILE,
      { actor: ALICE, seq: 7, clock: 12 },
      storage,
    );
    const own = recallOwnJudgmentPoint(FILE, ALICE, storage);
    const clock = new CausalClock(ALICE);
    if (own) clock.restore([{ ...own, deps: {} }]);
    const stamp = clock.issue();
    expect(stamp.seq).toBe(8);
    expect(stamp.clock).toBe(13);
  });
});
