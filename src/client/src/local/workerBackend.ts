/**
 * ローカル正典の Worker を呼ぶバックエンド (step3 Phase 2 D3)
 *
 * `LocalBackend` の 9 関数を Worker への RPC にする。起動は `startWorkerBackend` で、
 * **保存領域が開けたかを先に確かめてから**画面を出す (開けなかったら編集させない, D5)。
 */

import type { LocalBackend } from './backend';
import type {
  BackendMethod,
  RequestBody,
  WorkerRequest,
  WorkerResponse,
} from './worker/protocol';

export type WorkerBackendStart =
  | {
      ok: true;
      backend: LocalBackend;
      runDriverContract: () => Promise<string[]>;
    }
  | { ok: false; reason: string };

export function startWorkerBackend(): Promise<WorkerBackendStart> {
  const worker = new Worker(
    new URL('./worker/localStore.worker.ts', import.meta.url),
    { type: 'module' },
  );
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const request = (message: RequestBody) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id } satisfies WorkerRequest);
    });

  const call =
    (method: BackendMethod) =>
    (...args: unknown[]) =>
      request({ kind: 'call', method, args });

  const backend = {
    fetchFiles: call('fetchFiles'),
    fetchLocalFileIds: call('fetchLocalFileIds'),
    createFile: call('createFile'),
    postImportFile: call('postImportFile'),
    pushBatches: call('pushBatches'),
    pushReceivedBatches: call('pushReceivedBatches'),
    fetchBatches: call('fetchBatches'),
    putBlob: call('putBlob'),
    fetchBlob: call('fetchBlob'),
  } as unknown as LocalBackend;

  return new Promise((resolveStart) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.kind === 'ready') {
        resolveStart({
          ok: true,
          backend,
          runDriverContract: () =>
            request({ kind: 'driverContract' }) as Promise<string[]>,
        });
        return;
      }
      if (message.kind === 'unavailable') {
        resolveStart({ ok: false, reason: message.reason });
        worker.terminate();
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.kind === 'result') entry.resolve(message.value);
      else entry.reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      resolveStart({
        ok: false,
        reason: `Worker を起動できない: ${event.message}`,
      });
    };
  });
}
