/**
 * テスト用: `claude` の代わりに起動される script (agent 段 5 S5)。
 *
 * 受けたもの (引数・作業 directory・stdin・環境変数の名前・`--mcp-config` の中身) を JSON で `--fake-out=<file>` の
 * file に書き、`--fake-mode=<mode>` に従って終わる: `ok` (既定) は 0、`fail` は 3、`hang` は終わらない (時間切れを試す)。
 * MCP の設定は起動の間だけあるので、ここで読んでおく (#386)。
 *
 * 試験の指定は**先頭の引数**で受ける (コマンドの後ろに足す)。環境変数は常駐が決めたものしか渡らない (#390)
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FAKE_FLAG = '--fake-';
const all = process.argv.slice(2);
const fake = (name: string) =>
  all
    .find((a) => a.startsWith(`${FAKE_FLAG}${name}=`))
    ?.slice(`${FAKE_FLAG}${name}=`.length);
/** claude が受けた引数 (試験の指定を除く) */
const argv = all.filter((a) => !a.startsWith(FAKE_FLAG));
const out = fake('out');
if (out) {
  const configPath = argv[argv.indexOf('--mcp-config') + 1];
  writeFileSync(
    out,
    JSON.stringify({
      argv,
      cwd: process.cwd(),
      stdin: await Bun.stdin.text(),
      envNames: Object.keys(process.env).sort(),
      mcpConfig: configPath
        ? JSON.parse(readFileSync(configPath, 'utf8'))
        : null,
    }),
  );
}
const mode = fake('mode') ?? 'ok';
console.log(`fake claude: ${mode}`);
if (mode === 'fail') {
  console.error('fake claude が失敗した');
  process.exit(3);
}
if (mode === 'hang') await new Promise(() => {});
