import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

/** 子のプロセスがこれより長くかかったら、終わらなかったとみなす */
const EXIT_TIMEOUT_MS = 20_000;

describe('Headless: DOM の無い bun (H3)', () => {
  it(
    '🔴 素の bun のプロセスで参加・受信・書き込みが一周し、終われば自分でプロセスが終わる',
    async () => {
      const child = Bun.spawn(
        ['bun', 'run', join(import.meta.dir, 'testing', 'domFreeRun.ts')],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const exited = await Promise.race([
        child.exited,
        Bun.sleep(EXIT_TIMEOUT_MS).then(() => 'timeout' as const),
      ]);
      if (exited === 'timeout') child.kill();
      const stdout = await new Response(child.stdout).text();
      const stderr = await new Response(child.stderr).text();
      expect({ exited, stderr: exited === 0 ? '' : stderr }).toEqual({
        exited: 0,
        stderr: '',
      });
      const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
      expect(line).toBeDefined();
      const result = JSON.parse((line ?? '').slice('RESULT '.length));
      expect(result).toEqual({ contents: ['agent が書いた'], unhandled: [] });
    },
    EXIT_TIMEOUT_MS + 5_000,
  );
});
