/**
 * テスト用: 置き場所の lock を取りに行くプロセス (#391、`dataDirLock.test.ts`)。
 *
 * 引数の置き場所の lock を、引数の時刻に揃って取りに行き、取れたら `held`、断られたら `busy` を標準出力に書く。取れたら放さずに
 * 待つ (試験が止める)。放すと、遅れて起動した他のプロセスが正しく取れてしまい、取り合いを試せない
 */

import { lockDataDir } from '../dataDirLock';

/** 取れた lock を持っておく上限 (試験が止め損ねても、いつかは終わる) */
const HOLD_MS = 30_000;

const dir = process.argv[2];
if (!dir) throw new Error('置き場所を渡す');
// 揃って取りに行く時刻 (ミリ秒)。起動の遅れを均し、取り合いの窓に重ねる
const startAt = Number(process.argv[3] ?? 0);
while (Date.now() < startAt) {
  // 最後の数ミリ秒は待ち続けて揃える
  if (startAt - Date.now() > 5) await Bun.sleep(1);
}
try {
  lockDataDir(dir);
  console.log('held');
  await Bun.sleep(HOLD_MS);
} catch {
  console.log('busy');
}
