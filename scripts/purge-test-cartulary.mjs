import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { runTestCartularyPurgeCli } from './lib/test-cartulary-purge-command.mjs';

/**
 * Purge d'un Cartulaire DE TEST (cart_audit_* / cart_test_*) et de toutes ses traces (item du
 * Registre, projection, racine, brouillon privé, Storage, demandes, reçus d'horodatage ; publication
 * et sceau seulement avec --purge-publication). Simulation par défaut ; l'exécution exige --execute
 * ET --confirm-test-purge. Toute la logique, l'analyse des arguments, l'aide (--help) et les
 * garde-fous sont dans scripts/lib/test-cartulary-purge-command.mjs (runTestCartularyPurgeCli,
 * testé en mémoire) ; ce script ne garde que l'initialisation Firebase, différée jusqu'après la
 * validation des arguments : hors émulateur le projet doit être explicite (GCLOUD_PROJECT ou
 * FIREBASE_PROJECT_ID, sinon project_required avant toute initialisation) et --allow-remote est
 * obligatoire même en simulation.
 */
const firebaseApp = ({ projectId, usesEmulator }) => {
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (usesEmulator ? null : `${projectId}.firebasestorage.app`);
  return getApps()[0] || initializeApp({
    projectId,
    ...(storageBucket ? { storageBucket } : {}),
    ...(usesEmulator ? {} : { credential: applicationDefault() }),
  });
};

const { exitCode } = await runTestCartularyPurgeCli({
  argv: process.argv.slice(2),
  env: process.env,
  firestore: (context) => getFirestore(firebaseApp(context)),
  // Sous émulateur sans émulateur Storage configuré, aucun bucket : l'étape Storage est ignorée et signalée.
  bucket: (context) => (context.usesEmulator && !process.env.STORAGE_EMULATOR_HOST && !process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? null
    : getStorage(firebaseApp(context)).bucket()),
});
process.exitCode = exitCode;
