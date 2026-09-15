import { readFile, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { bundleFileSystemPath, runPresentationRegenerationCli } from './lib/presentation-regeneration-command.mjs';

/**
 * Rattrapage Admin des dérivés de présentation d'un Cartulaire (variantes presentation-v3-*.webp + vignette inline,
 * miroirs assets.privatePresentation et items.thumbnail). Simulation par défaut ; --execute applique ; hors émulateur
 * --allow-remote est obligatoire même en simulation. Toute la logique, l'aide (--help) et les garde-fous sont dans
 * scripts/lib/presentation-regeneration-command.mjs (testé en mémoire) ; ce script ne garde que l'initialisation
 * Firebase, différée jusqu'après la validation des arguments. Le bucket est lu comme run-private-upload-backlog.mjs
 * (FIREBASE_STORAGE_BUCKET, sinon VITE_FIREBASE_STORAGE_BUCKET du .env).
 */
const readLocalValue = (name) => {
  try {
    return readFileSync(new URL('../.env', import.meta.url), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  } catch {
    return undefined;
  }
};

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
// Le chemin de bundle a la forme du catalogue généré (segments encodés) ; il est décodé pour lire le fichier sous public/.
const readBundleFile = (publicPath) => new Promise((resolve) => {
  const relativePath = bundleFileSystemPath(publicPath);
  if (!relativePath) { resolve(null); return; }
  readFile(join(publicDirectory, relativePath), (error, bytes) => resolve(error ? null : bytes));
});

const storageBucket = ({ usesEmulator }) => process.env.FIREBASE_STORAGE_BUCKET
  || readLocalValue('VITE_FIREBASE_STORAGE_BUCKET')
  || (usesEmulator ? null : undefined);

const firebaseApp = (context) => {
  const bucket = storageBucket(context);
  return getApps()[0] || initializeApp({
    projectId: context.projectId,
    ...(bucket ? { storageBucket: bucket } : {}),
    ...(context.usesEmulator ? {} : { credential: applicationDefault() }),
  });
};

const { exitCode } = await runPresentationRegenerationCli({
  argv: process.argv.slice(2),
  env: process.env,
  firestore: (context) => getFirestore(firebaseApp(context)),
  storage: (context) => getStorage(firebaseApp(context)),
  bucketName: (context) => storageBucket(context) || undefined,
  readBundleFile,
});
process.exitCode = exitCode;
