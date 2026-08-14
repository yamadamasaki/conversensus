/**
 * デーモンを Tauri の sidecar 用バイナリへコンパイルする (Phase 8 S2)
 *
 * **Tauri は sidecar のファイル名に target triple の接尾辞を要求する**
 * (`conversensusd-aarch64-apple-darwin`)。名前が合わないとバンドルに入らず,
 * アプリは起動直後に「sidecar が無い」で落ちる。
 *
 * triple は **`rustc` に訊く**。ハードコードすると別の Mac (Intel) で黙って
 * 間違ったものを作る — 名前が合っていればバンドルには入るので, 実行して初めて分かる。
 */

const OUT_DIR = 'src-tauri/binaries';
const BASE_NAME = 'conversensusd';
const ENTRY = 'src/server/src/index.ts';

/** `rustc -vV` の `host:` 行から target triple を取る */
async function targetTriple(): Promise<string> {
  const proc = Bun.spawn(['rustc', '-vV'], { stdout: 'pipe' });
  const text = await new Response(proc.stdout).text();
  const host = text
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length)
    .trim();
  if (!host) throw new Error('rustc から target triple を取得できませんでした');
  return host;
}

const triple = await targetTriple();
const outfile = `${OUT_DIR}/${BASE_NAME}-${triple}`;

const build = Bun.spawn(
  ['bun', 'build', '--compile', ENTRY, '--outfile', outfile],
  { stdout: 'inherit', stderr: 'inherit' },
);
const code = await build.exited;
if (code !== 0) process.exit(code);

const size = (await Bun.file(outfile).stat()).size;
console.log(`${outfile} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
