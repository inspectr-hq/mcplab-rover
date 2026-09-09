import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        rover: resolve(dirname(fileURLToPath(import.meta.url)), 'rover.html'),
        background: resolve(dirname(fileURLToPath(import.meta.url)), 'src/background.ts'),
        content: resolve(dirname(fileURLToPath(import.meta.url)), 'src/content.ts')
      },
      output: {
        intro: '(() => {',
        outro: '})();',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
