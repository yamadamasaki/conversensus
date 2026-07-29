/**
 * テスト専用: pre-Phase-6 の legacy snapshot を `DATA_DIR` に直接置く (step1 Phase 6 p6-5a)
 *
 * p6-5a で **production から snapshot の書込は消えた** (`storage.ts` に `writeFile` は
 * もう無い)。しかし移行 (p6-0 の一括移行 / `migrateFileToOplog`) の入力は
 * 「snapshot だけが在り op-log を持たないファイル」であり、それは
 * **endpoint 経由では作れない状態**である — p6-1 以降 `POST /files` は op-log を作るため。
 *
 * よって「移行が要る唯一の状況 (Phase 6 より前に作られたファイル)」を再現する手段が
 * テストには要る。それをテスト側のヘルパとして持つことで、production の書込口を
 * 「テストのためだけに生かしておく」事態を避ける。
 *
 * 移行そのものが退役するとき、このヘルパも一緒に消える。
 */

import { join } from 'node:path';
import type { GraphFile } from '@conversensus/shared';

/**
 * `DATA_DIR` に `<id>.json` を書く。
 *
 * **`DATA_DIR` の指定を必須にしている** — 未指定なら storage.ts と同じ既定
 * (リポジトリ直下の `data/`) に書いてしまい、テストが開発者の実データを汚す。
 */
export async function writeLegacySnapshot(file: GraphFile): Promise<void> {
  const dir = process.env.DATA_DIR;
  if (!dir)
    throw new Error(
      'writeLegacySnapshot: DATA_DIR が未設定です (テスト用の一時ディレクトリを指定してください)',
    );
  await Bun.write(join(dir, `${file.id}.json`), JSON.stringify(file, null, 2));
}
