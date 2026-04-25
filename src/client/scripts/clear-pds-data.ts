/**
 * PDS 上のアプリケーションデータを全削除する (アカウント情報は残す)
 *
 * 使用方法:
 *   bun run clear-pds-data
 *
 * 環境変数:
 *   ATPROTO_PDS_URL       PDS の URL (デフォルト: http://localhost:2583)
 *   ATPROTO_IDENTIFIER    ハンドルまたは DID
 *   ATPROTO_PASSWORD      パスワード
 *   DRY_RUN=1             削除せずに対象レコード数だけ表示する
 */

import { AtpAgent } from '@atproto/api';

const COLLECTIONS = [
  'app.conversensus.graph.file',
  'app.conversensus.graph.sheet',
  'app.conversensus.graph.node',
  'app.conversensus.graph.edge',
  'app.conversensus.graph.nodeLayout',
  'app.conversensus.graph.edgeLayout',
  'app.conversensus.graph.branch',
  'app.conversensus.graph.commit',
  'app.conversensus.graph.merge',
] as const;

const PDS_URL = process.env.ATPROTO_PDS_URL ?? 'http://localhost:2583';
const DRY_RUN = process.env.DRY_RUN === '1';

async function listAll(
  agent: AtpAgent,
  did: string,
  collection: string,
): Promise<Array<{ uri: string }>> {
  const records: Array<{ uri: string }> = [];
  let cursor: string | undefined;
  do {
    const res = await agent.api.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: 100,
      cursor,
    });
    records.push(...res.data.records);
    cursor = res.data.cursor;
  } while (cursor);
  return records;
}

function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

async function main() {
  const identifier = process.env.ATPROTO_IDENTIFIER;
  const password = process.env.ATPROTO_PASSWORD;

  if (!identifier || !password) {
    console.error(
      'ATPROTO_IDENTIFIER と ATPROTO_PASSWORD を環境変数で指定してください',
    );
    process.exit(1);
  }

  const agent = new AtpAgent({ service: PDS_URL });

  console.log(`PDS: ${PDS_URL}`);
  console.log(`ログイン中: ${identifier}`);
  const loginRes = await agent.login({ identifier, password });
  const did = loginRes.data.did;
  console.log(`DID: ${did}`);
  if (DRY_RUN) console.log('[DRY RUN モード: 削除しません]');
  console.log('');

  let totalDeleted = 0;

  for (const collection of COLLECTIONS) {
    const records = await listAll(agent, did, collection);
    const shortName = collection.split('.').at(-1) ?? collection;

    if (records.length === 0) {
      console.log(`  ${shortName}: 0 件`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${shortName}: ${records.length} 件 (スキップ)`);
      continue;
    }

    process.stdout.write(`  ${shortName}: ${records.length} 件を削除中...`);
    for (const record of records) {
      await agent.api.com.atproto.repo.deleteRecord({
        repo: did,
        collection,
        rkey: rkeyFromUri(record.uri),
      });
    }
    console.log(' 完了');
    totalDeleted += records.length;
  }

  console.log('');
  if (!DRY_RUN) console.log(`合計 ${totalDeleted} 件削除しました`);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
