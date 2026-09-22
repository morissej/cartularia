import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-personal',
    emptyOutDir: true,
    // V7 (V-B5, décision D11) : même règle que vite.config.ts — une police n'est jamais incorporée en data: (preload de personal-vault.html).
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    rollupOptions: { input: resolve(import.meta.dirname, 'personal-vault.html') },
  },
});
