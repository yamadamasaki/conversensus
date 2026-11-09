import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

/** 子のプロセスがこれより長くかかったら、終わらなかったとみなす */
const CHILD_TIMEOUT_MS = 30_000;
/** headless の workspace の根。ここで走らせると、repo の根の preload (happy-dom) が効かない */
const HEADLESS_ROOT = join(import.meta.dir, '..', '..');

/**
 * 本体は `httpMcp.domfree-test.ts`。happy-dom が `Response` を差し替えるので、`Bun.serve` が
 * 返された `Response` を読めない (計画 S4)。**DOM の無いプロセス**で走らせる — 常駐の agent が実際に走るのも
 * DOM の無いプロセスである
 */
describe('serveMcpHttp (段 5 S4): DOM の無いプロセスで', () => {
  it(
    '🔴 httpMcp.domfree-test.ts がすべて通る',
    async () => {
      const child = Bun.spawn(
        ['bun', 'test', './src/resident/httpMcp.domfree-test.ts'],
        { cwd: HEADLESS_ROOT, stdout: 'pipe', stderr: 'pipe' },
      );
      const exited = await Promise.race([
        child.exited,
        Bun.sleep(CHILD_TIMEOUT_MS).then(() => 'timeout' as const),
      ]);
      if (exited === 'timeout') child.kill();
      // bun test は結果を stderr に書く
      const report = await new Response(child.stderr).text();
      expect({ exited, report: exited === 0 ? '' : report }).toEqual({
        exited: 0,
        report: '',
      });
      expect(report).toMatch(/\b0 fail\b/);
      expect(report).not.toMatch(/\b0 pass\b/);
    },
    CHILD_TIMEOUT_MS + 5_000,
  );
});
