import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(dirname(fileURLToPath(import.meta.url)), 'src/content.ts'),
      formats: ['iife'],
      name: 'RoverContent',
      fileName: () => 'content.js'
    }
  }
});
