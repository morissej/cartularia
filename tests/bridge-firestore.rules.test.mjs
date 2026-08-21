import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let environment;
const projectId = process.env.CODE_BRIDGE_PROJECT_ID || 'cartularia-code-bridge-test';
const base = (ownerUid, code) => ({
  schemaVersion: 'code-correspondence@1.0.0', ownerUid, code, updatedAt: new Date(),
});

before(async () => {
  const [host = '127.0.0.1', portValue = '8380'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(portValue), rules: readFileSync(new URL('../bridge-firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => environment.cleanup());
beforeEach(async () => environment.clearFirestore());

test('la base pont accepte uniquement les codes du compte authentifié', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const outsider = environment.authenticatedContext('outsider').firestore();
  const client = doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-A1B2C3D4');
  await assertSucceeds(setDoc(client, { ...base('owner', 'CLI-A1B2C3D4'), objectCodes: [] }));
  await assertSucceeds(setDoc(doc(owner, 'codeAccounts', 'owner', 'account', 'profile'), {
    schemaVersion: 'code-account-link@1.0.0', ownerUid: 'owner', primaryClientNumber: 'CLI-A1B2C3D4', updatedAt: new Date(),
  }));
  await assertSucceeds(getDoc(client));
  await assertFails(getDoc(doc(outsider, 'codeAccounts', 'owner', 'clients', 'CLI-A1B2C3D4')));
});

test('la base pont refuse toute identité et tout code libre', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  await assertFails(setDoc(doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-A1B2C3D4'), {
    ...base('owner', 'CLI-A1B2C3D4'), objectCodes: [], ownerName: 'Donnée interdite',
  }));
  await assertFails(setDoc(doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-B1C2D3E4'), {
    ...base('owner', 'CLI-B1C2D3E4'), objectCodes: ['ROL-1234ABCD'],
  }));
  const protectedClient = doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-C1D2E3F4');
  await environment.withSecurityRulesDisabled(async (context) => setDoc(
    doc(context.firestore(), 'codeAccounts', 'owner', 'clients', 'CLI-C1D2E3F4'),
    { ...base('owner', 'CLI-C1D2E3F4'), objectCodes: ['ROL-1234ABCD'] },
  ));
  await assertFails(setDoc(protectedClient, { ...base('owner', 'CLI-C1D2E3F4'), objectCodes: ['ROL-FFFFFFFF'] }));
  await assertFails(setDoc(doc(owner, 'codeAccounts', 'owner', 'locations', 'Maison'), base('owner', 'Maison')));
});

test('les codes transmission, lieu, personne et gestionnaire ont des espaces séparés', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  await assertSucceeds(setDoc(doc(owner, 'codeAccounts', 'owner', 'transmissions', 'TRN-A1B2C3D4'), base('owner', 'TRN-A1B2C3D4')));
  await assertSucceeds(setDoc(doc(owner, 'codeAccounts', 'owner', 'locations', 'LIE-A1B2C3D4'), { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' }));
  await assertSucceeds(setDoc(doc(owner, 'codeAccounts', 'owner', 'people', 'PER-A1B2C3D4'), { ...base('owner', 'PER-A1B2C3D4'), genericLabel: 'Personne 1' }));
  await assertSucceeds(setDoc(doc(owner, 'codeAccounts', 'owner', 'managers', 'GES-A1B2C3D4'), base('owner', 'GES-A1B2C3D4')));
});

test('les libellés génériques ne peuvent pas contenir une identité libre', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  await assertFails(setDoc(doc(owner, 'codeAccounts', 'owner', 'locations', 'LIE-A1B2C3D4'), { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Maison Paris' }));
  await assertFails(setDoc(doc(owner, 'codeAccounts', 'owner', 'people', 'PER-A1B2C3D4'), { ...base('owner', 'PER-A1B2C3D4'), genericLabel: 'Jean Dupont' }));
});
