/**
 * S0-4 spike の page (投棄可)。`?vfs=opfs|sahpool&rows=N&mode=write|read|hold` で 1 回測り、
 * 結果を `window.__spike` に置く (Playwright が読む)。
 */

const params = new URLSearchParams(location.search);
const request = {
  vfs: params.get('vfs') ?? 'sahpool',
  rows: Number(params.get('rows') ?? '1000'),
  mode: params.get('mode') ?? 'write',
};

async function storageInfo() {
  const persisted = await navigator.storage?.persisted?.();
  const persist = await navigator.storage?.persist?.();
  const estimate = await navigator.storage?.estimate?.();
  return {
    crossOriginIsolated: self.crossOriginIsolated,
    persistedBefore: persisted,
    persistGranted: persist,
    usage: estimate?.usage,
    quota: estimate?.quota,
  };
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
});
worker.onmessage = async (event) => {
  const result = { ...event.data, storage: await storageInfo() };
  (window as unknown as { __spike: unknown }).__spike = result;
  document.body.textContent = JSON.stringify(result, null, 2);
};
worker.onerror = (event) => {
  (window as unknown as { __spike: unknown }).__spike = {
    error: `worker error: ${event.message}`,
  };
};
worker.postMessage(request);
