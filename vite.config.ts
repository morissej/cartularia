import { readdirSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error -- module Node ESM runtime-tested directly by the corrective-wave suite.
import { createRfc3161Middleware } from './scripts/lib/rfc3161-timestamp.mjs'

// V7, décision (c) : les copies de conflit « nom N.ext » que la synchronisation du poste dépose dans public/ (124 le 16 septembre 2026,
// toutes sous public/assets/IWC/derivatives/) sont recopiées telles quelles dans dist/ puis livrées à Hosting (128 en ligne). Elles sont
// retirées de dist/ après l'écriture du bundle, récursivement (fichiers « nom N.ext », puis dossiers « nom N » vides) ; l'opération est
// journalisée, jamais bloquante. Seconde garde, indépendante : hosting.ignore "**/* +([0-9]).*" dans firebase.json et firebase.personal.json
// (extglob de minimatch, équivalent du « \d+ » ci-dessous : le motif « [0-9] » d'une classe laissait livrer « nom 12.ext », relecture V7).
// Verrous : tests/performance-v7.test.mjs (greffon exercé sur un dossier témoin), scripts/measure-pf0-build.mjs (numberedCopies === 0).
const NUMBERED_COPY_FILE = / \d+\.[^/]+$/
const NUMBERED_COPY_DIRECTORY = / \d+$/
export const removeNumberedCopies = (directory: string): number => {
  let removed = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      removed += removeNumberedCopies(path)
      if (NUMBERED_COPY_DIRECTORY.test(entry.name) && readdirSync(path).length === 0) {
        rmSync(path, { recursive: true })
        removed += 1
      }
    } else if (NUMBERED_COPY_FILE.test(entry.name)) {
      rmSync(path)
      removed += 1
    }
  }
  return removed
}
export const numberedCopiesPlugin = (): Plugin => {
  let outDir = resolve('dist')
  return {
    name: 'cartularia-copies-numerotees',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const removed = removeNumberedCopies(outDir)
      if (removed > 0) {
        console.warn(`[cartularia] ${removed} copie(s) numérotée(s) retirée(s) de ${basename(outDir)}/ (synchronisation de poste, voir le journal V7).`)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    numberedCopiesPlugin(),
    {
      name: 'cartularia-rfc3161-dev-gateway',
      configureServer(server) {
        server.middlewares.use('/api/timestamps', createRfc3161Middleware())
      },
    },
  ],
  build: {
    // V7 (V-B5) : une police n'est jamais incorporée en data: dans la feuille (le preload de index.html doit viser un fichier) —
    // piège mesuré sous le seuil par défaut de 4 096 octets ; sans effet aux tailles réelles (31 à 132 ko), règle écrite et testée.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    rolldownOptions: {
      output: {
        // V7 (V-B2, décision D7) : découpage explicite par bibliothèque. Sans ces groupes, rolldown isole chaque icône lucide partagée
        // dans son propre fichier (36 morceaux « icône seule » sur a4ce595, 94 morceaux JS). Le groupe react, prioritaire, garde React
        // hors d'icons-*.js et produit un morceau react-*.js dont l'empreinte ne change qu'avec React (cache stable entre déploiements,
        // préchargé par index.html) ; l'entrée applicative tombe de 210 ko à 20 ko. Récursion par défaut (includeDependenciesRecursively
        // non posé : la valeur false exige preserveEntrySignatures + strictExecutionOrder et fait importer l'entrée par icons-*.js).
        // Verrous : tests/performance-v7.test.mjs (groupes) et scripts/measure-pf0-build.mjs (un seul icons-*.js, un seul react-*.js).
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
