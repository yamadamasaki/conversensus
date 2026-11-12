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
 *
 * **取り直すのは 1 つのプロセスだけ** (#391)。落ちた lock を見た 2 つのプロセスがどちらも上書きすると、両方が
 * 開いてしまう。落ちた lock を置き換えてよいのは、**取り直しの lock** (`lock.recover`、これも排他で作る) を
 * 持つプロセスだけにする。持ったら持ち主をもう一度見て、まだ落ちたままなら置き換える。取り直しの最中に
 * 来たプロセスは断られる (すぐ取り直されるので)。取り直しの lock が落ちたプロセスのものなら消して試し直す
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** lock の file 名 (`dataDir` の中) */
const LOCK_FILE = 'lock';
/** 取り直しの lock の file 名 (`lock` の隣) */
const RECOVER_SUFFIX = '.recover';
/** 取り直しを試す回数 (落ちた取り直しの lock を消したとき) */
const MAX_ATTEMPTS = 5;

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
  const busy = (holder: number) =>
    new Error(
      `[headless] この置き場所 (${dataDir}) は別のプロセス (pid ${holder}) が使っている。` +
        'MCP server と CLI を同じ置き場所で同時に動かさない',
    );
  /** 生きた他人の pid か */
  const othersAlive = (holder: number | null): holder is number =>
    holder !== null && holder !== pid && alive(holder);

  const recover = `${path}${RECOVER_SUFFIX}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (createExclusive(path, pid)) return release(path, pid);
    const holder = holderOf(path);
    if (othersAlive(holder)) throw busy(holder);
    // 落ちたプロセスの lock (か壊れた lock)。取り直しの lock を持ってから置き換える
    if (!createExclusive(recover, pid)) {
      const recovering = holderOf(recover);
      // 他のプロセスが取り直している。すぐ取り直されるので断る
      if (othersAlive(recovering)) throw busy(recovering);
      // 取り直しの途中で落ちたプロセスの lock。消して試し直す
      rmSync(recover, { force: true });
      continue;
    }
    try {
      // 持ったので、もう一度見る (見てから持つまでの間に、他のプロセスが取り直し終えたかもしれない)
      const now = holderOf(path);
      if (othersAlive(now)) throw busy(now);
      writeFileSync(path, String(pid));
      return release(path, pid);
    } finally {
      if (holderOf(recover) === pid) rmSync(recover, { force: true });
    }
  }
  throw new Error(
    `[headless] この置き場所 (${dataDir}) の lock を取れなかった (取り直しの lock が繰り返し残っていた)`,
  );
}

/** 無ければ作って pid を書く。あれば false */
function createExclusive(path: string, pid: number): boolean {
  try {
    writeFileSync(path, String(pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** lock を放す関数。**自分の lock だけ**を消す (落ちたと見なされて奪われた後でも、新しい持ち主の lock を消さない) */
function release(path: string, pid: number): () => void {
  return () => {
    if (holderOf(path) === pid) rmSync(path, { force: true });
  };
}
