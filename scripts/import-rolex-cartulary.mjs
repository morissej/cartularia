import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { processCartularySyncRequest } from './lib/live-sync-command.mjs';
import { runRolexDossierCli } from './lib/rolex-dossier-command.mjs';

/**
 * Seed du dossier Rolex du pilote (ADR-029) : Cartulaire autoritaire + projection Registre si la
 * racine n'existe pas (émulateur ou --allow-create), puis brouillon privé du propriétaire et
 * synchronisation. Idempotent. Toute la logique, l'analyse des arguments, l'aide (--help) et les
 * garde-fous sont dans scripts/lib/rolex-dossier-command.mjs (runRolexDossierCli, testé en
 * mémoire) ; ce script ne garde que l'initialisation Firebase (différée jusqu'après la validation
 * des arguments) et l'appel. Le projet vient des options validées : hors émulateur il doit être
 * explicite (GCLOUD_PROJECT ou FIREBASE_PROJECT_ID, sinon project_required avant toute
 * initialisation), aucun projet distant n'est choisi par défaut ici.
 */
let storage;
const { exitCode } = await runRolexDossierCli({
  argv: process.argv.slice(2),
  env: process.env,
  firestore: ({ projectId, usesEmulator }) => {
    const app = getApps()[0] || initializeApp({ projectId, storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`, ...(usesEmulator ? {} : { credential: applicationDefault() }) });
    storage = getStorage(app);
    return getFirestore(app);
  },
  processSyncRequest: (options) => {
    if (Boolean(process.env.FIRESTORE_EMULATOR_HOST) !== Boolean(process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST)) {
      throw new Error('Configurez ensemble les émulateurs Firestore et Storage avant la synchronisation.');
    }
    return processCartularySyncRequest({ ...options, storage });
  },
});
process.exitCode = exitCode;
