import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { PRIVATE_BINARY_MIGRATION_HELP, migratePrivateBinaryVerification, parsePrivateBinaryMigrationArgs } from './lib/private-binary-migration.mjs';

let app;
let firestore;
try {
  const options = parsePrivateBinaryMigrationArgs(process.argv.slice(2));
  if (options.help) console.log(PRIVATE_BINARY_MIGRATION_HELP);
  else {
    const firestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    const storageEmulator = Boolean(process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST);
    if (firestoreEmulator !== storageEmulator) throw new Error('Configurez ensemble les émulateurs Firestore et Storage, ou aucun des deux.');
    app = initializeApp({ projectId: options.projectId, storageBucket: options.bucketName,
      ...(firestoreEmulator ? {} : { credential: applicationDefault() }),
    }, 'private-binary-migration');
    firestore = getFirestore(app);
    const result = await migratePrivateBinaryVerification({ ...options, firestore, storage: getStorage(app) });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.counts.blocked > 0 ? 2 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Migration interrompue.');
  process.exitCode = 1;
} finally {
  if (firestore) await firestore.terminate();
  if (app) await deleteApp(app);
}
