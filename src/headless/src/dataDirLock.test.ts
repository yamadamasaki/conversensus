import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockDataDir } from './dataDirLock';

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'headless-lock-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** 終わったプロセスの pid (落ちたプロセスの lock を作るため) */
async function deadPid(): Promise<number> {
  const child = Bun.spawn(['true']);
  await child.exited;
  return child.pid;
}

/** 落ちた lock を同時に取り直しに来るプロセスの数 */
const CONTENDERS = 8;
/** 取り合いのプロセスが揃って取りに行くまでの時間 (起動にかかる時間より長く) */
const START_DELAY_MS = 1500;

/** このテストのプロセスとは別の pid (生きていても死んでいても「他人」) */
const OTHER_PID = 1;

describe('lockDataDir', () => {
  test('取って放すと lock の file が消え、また取れる', () => {
    const dir = newDir();
    const unlock = lockDataDir(dir);
    expect(existsSync(join(dir, 'lock'))).toBe(true);
    unlock();
    expect(existsSync(join(dir, 'lock'))).toBe(false);
    lockDataDir(dir)();
  });

  test('生きた別のプロセスが持っていれば断る', () => {
    const dir = newDir();
    const unlock = lockDataDir(dir); // このプロセス (生きている) が持つ
    expect(() => lockDataDir(dir, OTHER_PID)).toThrow(/別のプロセス/);
    unlock();
  });

  test('落ちたプロセスの lock は取り直す', async () => {
    const dir = newDir();
    writeFileSync(join(dir, 'lock'), String(await deadPid()));
    const unlock = lockDataDir(dir);
    unlock();
    expect(existsSync(join(dir, 'lock'))).toBe(false);
  });

  test('壊れた lock (pid でない) は取り直す', () => {
    const dir = newDir();
    writeFileSync(join(dir, 'lock'), 'こわれた');
    lockDataDir(dir)();
  });

  test('放すのは自分の lock だけ (奪われた後に放しても、相手の lock を消さない)', async () => {
    const dir = newDir();
    const dead = await deadPid();
    const unlockDead = lockDataDir(dir, dead);
    const unlockMine = lockDataDir(dir); // dead は死んでいるので取り直す
    unlockDead();
    expect(existsSync(join(dir, 'lock'))).toBe(true);
    unlockMine();
  });

  test('🔴 落ちた lock を同時に取り直しに来ても、取れるのは 1 つだけ (上書きしない、#391)', async () => {
    const dir = newDir();
    writeFileSync(join(dir, 'lock'), String(await deadPid()));
    const contender = join(import.meta.dir, 'testing', 'lockContender.ts');
    // 揃って取りに行く時刻。起動にかかる時間より先にする
    const startAt = Date.now() + START_DELAY_MS;
    const children = Array.from({ length: CONTENDERS }, () =>
      Bun.spawn(['bun', contender, dir, String(startAt)], { stdout: 'pipe' }),
    );
    // 最初の行 (held か busy) だけを読む。取れたプロセスは持ったまま待つので、読んだら止める
    const firstLine = async (stdout: ReadableStream<Uint8Array>) => {
      const reader = stdout.getReader();
      let text = '';
      while (!text.includes('\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text.trim();
    };
    const results = await Promise.all(children.map((c) => firstLine(c.stdout)));
    for (const c of children) c.kill();
    await Promise.all(children.map((c) => c.exited));
    expect(results.filter((r) => r === 'held')).toHaveLength(1);
    expect(results.filter((r) => r === 'busy')).toHaveLength(CONTENDERS - 1);
    // 取り直しの lock は残らない
    expect(readdirSync(dir).filter((f) => f.includes('recover'))).toEqual([]);
  });
});
