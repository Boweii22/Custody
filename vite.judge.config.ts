import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'judge-site'),
  base: '/Custody/',
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, 'public'),
  build: { outDir: resolve(import.meta.dirname, 'dist-judge'), emptyOutDir: true },
});
