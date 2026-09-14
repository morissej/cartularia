import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { runDemoPublicationCli } from './lib/demo-publication-command.mjs';

/**
 * Publication réelle du mini-site d'un objet de démonstration (Submariner DEMO-ROL-124060 en V2) :
 * dérivés WebP dans Storage, publications/{code} + blocks + mediaAccess, seals/{code}, racine
 * patchée et événement d'audit, comme la fonction publishCartularyWebsite mais par une commande
 * Admin exécutée par Jérôme (le compte démo partagé ne peut ni ne doit publier). Simulation par
 * défaut ; l'application exige --apply ET --confirm-demo-publication ; --revoke retire. Toute la
 * logique, l'analyse des arguments, l'aide (--help) et les garde-fous sont dans
 * scripts/lib/demo-publication-command.mjs (runDemoPublicationCli, testé en mémoire) ; ce script
 * ne garde que l'initialisation Firebase, différée jusqu'après la validation des arguments : hors
 * émulateur le projet doit être explicite (GCLOUD_PROJECT ou FIREBASE_PROJECT_ID, sinon
 * project_required avant toute initialisation) et --allow-remote est obligatoire même en simulation.
 */
const firebaseApp = ({ projectId, usesEmulator }) => {
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (usesEmulator ? null : `${projectId}.firebasestorage.app`);
  return getApps()[0] || initializeApp({
    projectId,
    ...(storageBucket ? { storageBucket } : {}),
    ...(usesEmulator ? {} : { credential: applicationDefault() }),
  });
};

const { exitCode } = await runDemoPublicationCli({
  argv: process.argv.slice(2),
  env: process.env,
  firestore: (context) => getFirestore(firebaseApp(context)),
  // Sous émulateur sans émulateur Storage configuré, aucun bucket : simulation possible, application refusée (storage_required).
  bucket: (context) => (context.usesEmulator && !process.env.STORAGE_EMULATOR_HOST && !process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? null
    : getStorage(firebaseApp(context)).bucket()),
});
process.exitCode = exitCode;
