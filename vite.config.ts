import { defineConfig } from 'vite';

export default defineConfig({
  css: {
    postcss: {},
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
