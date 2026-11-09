/**
 * テスト用: `claude` の代わりに起動される script (agent 段 5 S5)。
 *
 * 受けた引数を JSON で `FAKE_CLAUDE_OUT` の file に書き、`FAKE_CLAUDE_MODE` に従って終わる:
 * `ok` (既定) は 0、`fail` は 3、`hang` は終わらない (時間切れを試す)。
 */

import { writeFileSync } from 'node:fs';

const out = process.env.FAKE_CLAUDE_OUT;
if (out) {
  writeFileSync(
    out,
    JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }),
  );
}
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
console.log(`fake claude: ${mode}`);
if (mode === 'fail') {
  console.error('fake claude が失敗した');
  process.exit(3);
}
if (mode === 'hang') await new Promise(() => {});
