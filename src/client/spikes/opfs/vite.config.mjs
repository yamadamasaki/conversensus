// S0-4 spike 専用 (投棄可)。`SPIKE_COI=1` で COOP/COEP を付ける — `opfs` VFS の前提。
import { defineConfig } from 'vite';

const crossOriginIsolation = process.env.SPIKE_COI === '1';

export default defineConfig({
  root: import.meta.dirname,
  server: {
    headers: crossOriginIsolation
      ? {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        }
      : {},
  },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
});
