import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-personal',
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'personal-vault.html') },
  },
});
