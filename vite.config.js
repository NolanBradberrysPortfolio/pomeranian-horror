import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pomeranian-horror/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022'
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  }
});
