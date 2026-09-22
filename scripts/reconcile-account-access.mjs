import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ACCOUNT_ACCESS_RECONCILIATION_HELP, parseAccountAccessReconcileArgs, reconcileAccountAccess, resolveStaleAccountAccessOperation } from './lib/account-access-reconciliation.mjs';

// No project/environment fallback, no startup access before CLI validation, and no Auth writes.
let app;
let firestore;
try {
  const options = parseAccountAccessReconcileArgs(process.argv.slice(2));
  if (options.help) {
    console.log(ACCOUNT_ACCESS_RECONCILIATION_HELP);
  } else {
    const authEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
    const firestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    if (authEmulator !== firestoreEmulator) throw new Error('Configurez ensemble les émulateurs Auth et Firestore, ou aucun des deux.');
    app = initializeApp({ projectId: options.projectId, ...(authEmulator ? {} : { credential: applicationDefault() }) }, `account-access-reconciliation-${options.projectId}`);
    firestore = getFirestore(app);
    const result = options.resolvePending
      ? await resolveStaleAccountAccessOperation({ ...options, firestore })
      : await reconcileAccountAccess({ ...options, auth: getAuth(app), firestore });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.counts.error > 0 ? 1 : result.counts.manual > 0 ? 2 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Réconciliation interrompue.');
  process.exitCode = 1;
} finally {
  if (firestore) await firestore.terminate();
  if (app) await deleteApp(app);
}
