import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocFromServer, setDoc, updateDoc } from 'firebase/firestore';
import { requireEmulatorEndpoint } from './helpers/require-emulator.mjs';

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
  const { host, port } = requireEmulatorEndpoint('FIRESTORE_EMULATOR_HOST');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: readFileSync(new URL('../personal-firestore.rules', import.meta.url), 'utf8') },
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

const setPersonalAccess = (access) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'accountAccess/vault-owner'), access));

test('F02 : le guard du Coffre coupe lecture, écriture et suppression de sa session indépendante déjà ouverte', async () => {
  const db = environment.authenticatedContext('vault-owner', { firebase: { sign_in_provider: 'password' }, auth_time: 1_000 }).firestore();
  const vault = doc(db, 'vaultUsers/vault-owner/vault/profile');
  await assertSucceeds(setDoc(vault, validDocument()));
  await assertSucceeds(getDocFromServer(vault));
  await setPersonalAccess({ status: 'suspended', validAfter: 1_000 });
  await assertFails(getDocFromServer(vault));
  await assertFails(setDoc(vault, validDocument()));
  await assertFails(deleteDoc(vault));
  const guard = doc(db, 'accountAccess/vault-owner');
  await assertFails(getDocFromServer(guard));
  await assertFails(updateDoc(guard, { status: 'active', validAfter: 0 }));
  await assertFails(deleteDoc(guard));
  await assertFails(setDoc(doc(db, 'accountAccess/vault-owner/memberships/vault-owner'), { uid: 'vault-owner' }));
});

test('F02 : réactiver le Coffre conserve le cutoff et n’exige aucun profil Registre', async () => {
  await setPersonalAccess({ status: 'active', validAfter: 1_000 });
  for (const authTime of [999, 1_000, '1001', null]) {
    const db = environment.authenticatedContext('vault-owner', { firebase: { sign_in_provider: 'password' }, auth_time: authTime, iat: 2_000 }).firestore();
    await assertFails(setDoc(doc(db, 'vaultUsers/vault-owner/vault/profile'), validDocument()));
  }
  const fresh = environment.authenticatedContext('vault-owner', { firebase: { sign_in_provider: 'password' }, auth_time: 1_001 }).firestore();
  const vault = doc(fresh, 'vaultUsers/vault-owner/vault/profile');
  await assertSucceeds(setDoc(vault, validDocument()));
  await assertSucceeds(getDocFromServer(vault));
  await assertSucceeds(deleteDoc(vault));
});

test('F02 : créer soi-même un guard ou exploiter un guard Coffre malformé reste interdit', async () => {
  const db = environment.authenticatedContext('vault-owner', { firebase: { sign_in_provider: 'password' }, auth_time: 1_001 }).firestore();
  await assertFails(setDoc(doc(db, 'accountAccess/vault-owner'), { status: 'active', validAfter: 0 }));
  for (const access of [{ status: 'active' }, { status: 'active', validAfter: '1000' }, { status: 'active', validAfter: -1 }]) {
    await setPersonalAccess(access);
    await assertFails(getDocFromServer(doc(db, 'vaultUsers/vault-owner/vault/profile')));
  }
});

test('F02 : un ancien jeton de récupération Coffre ne redevient pas valide lors de son échange', async () => {
  await setPersonalAccess({ status: 'active', validAfter: 1_000 });
  for (const issuedAt of [undefined, 1_000, '1001']) {
    const db = environment.authenticatedContext('vault-owner', {
      firebase: { sign_in_provider: 'custom' }, auth_time: 1_005,
      ...(issuedAt === undefined ? {} : { cartulariaRecoveryIssuedAt: issuedAt }),
    }).firestore();
    await assertFails(setDoc(doc(db, 'vaultUsers/vault-owner/vault/profile'), validDocument()));
  }
  const fresh = environment.authenticatedContext('vault-owner', {
    firebase: { sign_in_provider: 'custom' }, auth_time: 1_005, cartulariaRecoveryIssuedAt: 1_001,
  }).firestore();
  await assertSucceeds(setDoc(doc(fresh, 'vaultUsers/vault-owner/vault/profile'), validDocument()));
});
