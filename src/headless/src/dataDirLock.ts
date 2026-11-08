/**
 * 置き場所 (`dataDir`) の lock (agent 段 3 M3, 計画 F8)
 *
 * 1 つの置き場所 = 1 つの端末 (actor) で、正典の SQLite と `storage.json` をプロセスが握る。
 * MCP server が動いている間に CLI を同じ置き場所で開くと、2 つのプロセスが同じ発番器から番号を
 * 出し、**同じ actor の seq が重なる**。それを開く時点で断る。
 *
 * lock は `dataDir/lock` に pid を書いた file。作るのは排他 (`wx`) で、あれば持ち主の pid が
 * 生きているかを見る。**落ちたプロセスの lock は取り直す** — 残った lock のせいで二度と開けなく
 * なるより、死んだ pid を確かめて奪う方がよい。
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** lock の file 名 (`dataDir` の中) */
const LOCK_FILE = 'lock';

/** その pid のプロセスが生きているか (signal 0 は存在の確認だけをする) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM は「在るが signal を送る権限が無い」= 生きている
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function holderOf(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8'), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * 置き場所の lock を取る。他の生きたプロセスが持っていれば例外。
 * @returns lock を放す関数
 */
export function lockDataDir(dataDir: string, pid = process.pid): () => void {
  const path = join(dataDir, LOCK_FILE);
  try {
    writeFileSync(path, String(pid), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const holder = holderOf(path);
    if (holder !== null && holder !== pid && alive(holder)) {
      throw new Error(
        `[headless] この置き場所 (${dataDir}) は別のプロセス (pid ${holder}) が使っている。` +
          'MCP server と CLI を同じ置き場所で同時に動かさない',
      );
    }
    // 落ちたプロセスの lock (か壊れた lock)。取り直す
    writeFileSync(path, String(pid));
  }
  return () => {
    if (holderOf(path) === pid) rmSync(path, { force: true });
  };
}
