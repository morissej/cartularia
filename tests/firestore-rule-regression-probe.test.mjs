import { readFileSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { requireEmulatorEndpoint } from './helpers/require-emulator.mjs';

const { host, port } = requireEmulatorEndpoint('FIRESTORE_EMULATOR_HOST');
const rulesPath = process.env.CARTULARIA_FIRESTORE_RULES_PATH
  ? new URL(`file://${process.env.CARTULARIA_FIRESTORE_RULES_PATH}`)
  : new URL('../firestore.rules', import.meta.url);
const projectId = process.env.CARTULARIA_RULES_PROJECT_ID || process.env.GCLOUD_PROJECT || 'cartularia-wave1-test';
let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: readFileSync(rulesPath, 'utf8') },
  });
  await environment.clearFirestore();
  if (process.env.CARTULARIA_REGRESSION_PROBE_MARKER) {
    writeFileSync(process.env.CARTULARIA_REGRESSION_PROBE_MARKER, 'probe-connected\n');
  }
});

after(async () => environment?.cleanup());

test('une session anonyme ne peut pas lire un profil utilisateur', async () => {
  const firestore = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(firestore, 'users', 'probe-user')));
});
