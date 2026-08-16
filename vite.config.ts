import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error -- module Node ESM runtime-tested directly by the corrective-wave suite.
import { createRfc3161Middleware } from './scripts/lib/rfc3161-timestamp.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'cartularia-rfc3161-dev-gateway',
      configureServer(server) {
        server.middlewares.use('/api/timestamps', createRfc3161Middleware())
      },
    },
  ],
})
