// S2-6 spike 専用 (投棄可)。loopback client は 127.0.0.1 で開く必要がある
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
});
