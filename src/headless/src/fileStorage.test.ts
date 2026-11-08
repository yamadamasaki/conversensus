import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { FileStorage } from './fileStorage';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-storage-'));
  path = join(dir, 'storage.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FileStorage', () => {
  it('file が無ければ空から始める', () => {
    const storage = new FileStorage(path);
    expect(storage.length).toBe(0);
    expect(storage.getItem('a')).toBeNull();
    expect(storage.key(0)).toBeNull();
  });

  it('書いた値は、作り直した後も読める (起動をまたぐ)', () => {
    const first = new FileStorage(path);
    first.setItem('deviceId', 'abc');
    first.setItem('session', '{"did":"did:plc:x"}');
    first.removeItem('session');

    const second = new FileStorage(path);
    expect(second.getItem('deviceId')).toBe('abc');
    expect(second.getItem('session')).toBeNull();
    expect(second.length).toBe(1);
  });

  it('clear は file の中身も空にする', () => {
    const first = new FileStorage(path);
    first.setItem('a', '1');
    first.clear();
    expect(new FileStorage(path).length).toBe(0);
  });

  it('値は文字列として持つ (Storage の決まり)', () => {
    const storage = new FileStorage(path);
    storage.setItem('n', 42 as unknown as string);
    expect(storage.getItem('n')).toBe('42');
  });

  it('一時 file を残さない', () => {
    new FileStorage(path).setItem('a', '1');
    expect(() => readFileSync(`${path}.tmp`)).toThrow();
  });

  it('形の違う file は黙って空にせず、知らせる', () => {
    writeFileSync(path, '[1, 2]');
    expect(() => new FileStorage(path)).toThrow();
  });

  it('どんな書き込みの列でも、作り直した後の中身は Map で同じ列を行った結果と一致する', () => {
    // キーは小さなプールから引く: 広いと同じキーを二度引かず、上書きと削除の後が試されない
    const key = fc.constantFrom('a', 'b', 'c', 'deviceId');
    const action = fc.oneof(
      fc.record({ op: fc.constant('set' as const), key, value: fc.string() }),
      fc.record({ op: fc.constant('remove' as const), key }),
      fc.record({ op: fc.constant('clear' as const) }),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 20 }), (actions) => {
        rmSync(path, { force: true });
        const storage = new FileStorage(path);
        const model = new Map<string, string>();
        for (const a of actions) {
          if (a.op === 'set') {
            storage.setItem(a.key, a.value);
            model.set(a.key, a.value);
          } else if (a.op === 'remove') {
            storage.removeItem(a.key);
            model.delete(a.key);
          } else {
            storage.clear();
            model.clear();
          }
        }
        const reopened = new FileStorage(path);
        expect(reopened.length).toBe(model.size);
        for (const [k, v] of model) expect(reopened.getItem(k)).toBe(v);
      }),
    );
  });
});
