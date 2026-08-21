import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectId = 'cartularia-personal-vault-test';
const accountId = 'a'.repeat(64);
let environment;

const validDocument = (uid = 'vault-owner') => ({
  schemaVersion: 'encrypted-personal-account@2.0.0',
  ownerUid: uid,
  accountId,
  version: 2,
  algorithm: 'AES-GCM',
  keyDerivation: 'PBKDF2-SHA-256',
  iterations: 600000,
  salt: 'c2VwYXJhdGUtc2FsdA==',
  iv: 'c2VwYXJhdGUtaXY=',
  ciphertext: 'Y2hpeGZyZS1zYW5zLXRleHRlLWNsYWly',
  updatedAt: new Date(),
});

before(async () => {
  const [host = '127.0.0.1', portValue = '8280'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(portValue), rules: readFileSync(new URL('../personal-firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => environment.cleanup());
beforeEach(async () => environment.clearFirestore());

test('seul le propriétaire peut écrire et relire son coffre patrimonial unique', async () => {
  const owner = environment.authenticatedContext('vault-owner').firestore();
  const outsider = environment.authenticatedContext('outsider').firestore();
  const reference = doc(owner, 'vaultUsers', 'vault-owner', 'vault', 'profile');
  await assertSucceeds(getDoc(reference));
  await assertSucceeds(setDoc(reference, validDocument()));
  await assertSucceeds(getDoc(reference));
  await assertFails(getDoc(doc(outsider, 'vaultUsers', 'vault-owner', 'vault', 'profile')));
});

test('les Rules refusent le texte clair et les champs personnels additionnels', async () => {
  const owner = environment.authenticatedContext('vault-owner').firestore();
  const reference = doc(owner, 'vaultUsers', 'vault-owner', 'vault', 'profile');
  await assertFails(setDoc(reference, { ...validDocument(), ownerName: 'Nom en clair' }));
  await assertFails(setDoc(reference, { ...validDocument(), ciphertext: { ownerName: 'Nom en clair' } }));
});
