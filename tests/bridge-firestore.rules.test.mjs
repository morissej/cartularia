import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocFromServer, setDoc, updateDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { requireEmulatorEndpoint } from './helpers/require-emulator.mjs';

let environment;
const projectId = process.env.CODE_BRIDGE_PROJECT_ID || 'cartularia-code-bridge-test';
let revision = 0;
const account = (stamp) => ({ schemaVersion: 'code-account-link@1.0.0', ownerUid: 'owner', primaryClientNumber: 'CLI-A1B2C3D4', codeRevision: stamp, updatedAt: new Date() });
const publishDoc = (reference, data) => {
  const batch = writeBatch(reference.firestore);
  const stamp = new Timestamp(1_700_000_000, ++revision * 1_000_000);
  if (reference.path.endsWith('/account/profile')) batch.set(reference, { ...data, codeRevision: stamp });
  else {
    batch.set(doc(reference.firestore, 'codeAccounts/owner/account/profile'), account(stamp));
    batch.set(reference, { ...data, sourceRevision: stamp });
  }
  return batch.commit();
};
const publish = (db, records, stamp, removed = []) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'codeAccounts/owner/account/profile'), account(stamp));
  for (const [path, data] of records) batch.set(doc(db, 'codeAccounts/owner/' + path), { ...data, sourceRevision: stamp });
  for (const path of removed) batch.delete(doc(db, 'codeAccounts/owner/' + path));
  return batch.commit();
};
const base = (ownerUid, code) => ({
  schemaVersion: 'code-correspondence@1.0.0', ownerUid, code, updatedAt: new Date(),
});

before(async () => {
  const { host, port } = requireEmulatorEndpoint('FIRESTORE_EMULATOR_HOST');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: readFileSync(new URL('../bridge-firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => environment.cleanup());
beforeEach(async () => environment.clearFirestore());

test('la base pont accepte uniquement les codes du compte authentifié', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const outsider = environment.authenticatedContext('outsider').firestore();
  const client = doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-A1B2C3D4');
  await assertSucceeds(publishDoc(client, { ...base('owner', 'CLI-A1B2C3D4'), objectCodes: [] }));
  await assertSucceeds(publishDoc(doc(owner, 'codeAccounts', 'owner', 'account', 'profile'), {
    schemaVersion: 'code-account-link@1.0.0', ownerUid: 'owner', primaryClientNumber: 'CLI-A1B2C3D4', updatedAt: new Date(),
  }));
  await assertSucceeds(getDoc(client));
  await assertFails(getDoc(doc(outsider, 'codeAccounts', 'owner', 'clients', 'CLI-A1B2C3D4')));
});

test('la base pont refuse toute identité et tout code libre', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  await assertFails(publishDoc(doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-A1B2C3D4'), {
    ...base('owner', 'CLI-A1B2C3D4'), objectCodes: [], ownerName: 'Donnée interdite',
  }));
  await assertFails(publishDoc(doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-B1C2D3E4'), {
    ...base('owner', 'CLI-B1C2D3E4'), objectCodes: ['ROL-1234ABCD'],
  }));
  const protectedClient = doc(owner, 'codeAccounts', 'owner', 'clients', 'CLI-C1D2E3F4');
  await environment.withSecurityRulesDisabled(async (context) => publishDoc(
    doc(context.firestore(), 'codeAccounts', 'owner', 'clients', 'CLI-C1D2E3F4'),
    { ...base('owner', 'CLI-C1D2E3F4'), objectCodes: ['ROL-1234ABCD'] },
  ));
  await assertFails(publishDoc(protectedClient, { ...base('owner', 'CLI-C1D2E3F4'), objectCodes: ['ROL-FFFFFFFF'] }));
  await assertFails(publishDoc(doc(owner, 'codeAccounts', 'owner', 'locations', 'Maison'), base('owner', 'Maison')));
});

test('les codes transmission, lieu, personne et gestionnaire ont des espaces séparés', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  await assertSucceeds(publishDoc(doc(owner, 'codeAccounts', 'owner', 'transmissions', 'TRN-A1B2C3D4'), base('owner', 'TRN-A1B2C3D4')));
  await assertSucceeds(publishDoc(doc(owner, 'codeAccounts', 'owner', 'locations', 'LIE-A1B2C3D4'), { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' }));
  await assertSucceeds(publishDoc(doc(owner, 'codeAccounts', 'owner', 'people', 'PER-A1B2C3D4'), { ...base('owner', 'PER-A1B2C3D4'), genericLabel: 'Personne 1' }));
  await assertSucceeds(publishDoc(doc(owner, 'codeAccounts', 'owner', 'managers', 'GES-A1B2C3D4'), base('owner', 'GES-A1B2C3D4')));
});

test('les libellés génériques ne peuvent pas contenir une identité libre', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  await assertFails(publishDoc(doc(owner, 'codeAccounts', 'owner', 'locations', 'LIE-A1B2C3D4'), { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Maison Paris' }));
  await assertFails(publishDoc(doc(owner, 'codeAccounts', 'owner', 'people', 'PER-A1B2C3D4'), { ...base('owner', 'PER-A1B2C3D4'), genericLabel: 'Jean Dupont' }));
});

test('AC04 : anciennes générations, rejeux et clients non versionnés ne modifient pas les codes récents', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const code = { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' };
  const latest = new Timestamp(1_700_000_000, 200_000_000);
  await assertSucceeds(publish(owner, [['locations/LIE-A1B2C3D4', code]], latest));
  for (const old of [new Timestamp(1_700_000_000, 1_000_000), latest]) await assertFails(publish(owner, [], old, ['locations/LIE-A1B2C3D4']));
  await assertFails(setDoc(doc(owner, 'codeAccounts/owner/locations/LIE-A1B2C3D4'), code));
  await assertFails(setDoc(doc(owner, 'codeAccounts/owner/locations/LIE-A1B2C3D4'), { ...code, sourceRevision: latest }));
  await assertFails(deleteDoc(doc(owner, 'codeAccounts/owner/locations/LIE-A1B2C3D4')));
  await assertFails(deleteDoc(doc(owner, 'codeAccounts/owner/account/profile')));
  assert.equal((await getDoc(doc(owner, 'codeAccounts/owner/locations/LIE-A1B2C3D4'))).exists(), true);
  await assertSucceeds(publish(owner, [], new Timestamp(1_700_000_000, 201_000_000), ['locations/LIE-A1B2C3D4']));
  assert.equal((await getDoc(doc(owner, 'codeAccounts/owner/locations/LIE-A1B2C3D4'))).exists(), false);
});
test('AC04 : une opération invalide annule toute la génération puis une reprise correcte réussit', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const stamp = new Timestamp(1_700_000_000, 200_000_000);
  await assertFails(publish(owner, [
    ['locations/LIE-A1B2C3D4', { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' }],
    ['people/PER-A1B2C3D4', { ...base('owner', 'PER-A1B2C3D4'), genericLabel: 'Identité interdite' }],
  ], stamp));
  assert.equal((await getDoc(doc(owner, 'codeAccounts/owner/locations/LIE-A1B2C3D4'))).exists(), false);
  assert.equal((await getDoc(doc(owner, 'codeAccounts/owner/account/profile'))).exists(), false);
  await assertSucceeds(publish(owner, [['locations/LIE-A1B2C3D4', { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' }]], stamp));
});
test('AC04 : les documents historiques restent lisibles et migrent vers une génération ordonnée', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(); const legacy = { ...account(new Timestamp(1_700_000_000, 1_000_000)) }; delete legacy.codeRevision;
    await setDoc(doc(db, 'codeAccounts/owner/account/profile'), legacy);
    await setDoc(doc(db, 'codeAccounts/owner/locations/LIE-A1B2C3D4'), { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' });
  });
  await assertSucceeds(getDoc(doc(owner, 'codeAccounts/owner/locations/LIE-A1B2C3D4')));
  await assertSucceeds(publish(owner, [['locations/LIE-A1B2C3D4', { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' }]], new Timestamp(1_700_000_000, 200_000_000)));
});

test('AC04 : une publication bornée à 450 écritures respecte aussi les limites des Rules', async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const records = Array.from({ length: 449 }, (_, index) => {
    const code = `GES-${index.toString(16).padStart(8, '0').toUpperCase()}`;
    return [`managers/${code}`, base('owner', code)];
  });
  await assertSucceeds(publish(owner, records, new Timestamp(1_700_000_000, 200_000_000)));
  assert.equal((await getDoc(doc(owner, 'codeAccounts/owner/managers/GES-000001C0'))).exists(), true);
});

const setBridgeAccess = (access) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'accountAccess/owner'), access));

test('F02 : le guard pont coupe une session ouverte et ne peut être modifié par son propriétaire', async () => {
  const db = environment.authenticatedContext('owner', { firebase: { sign_in_provider: 'password' }, auth_time: 1_000 }).firestore();
  const location = doc(db, 'codeAccounts/owner/locations/LIE-A1B2C3D4');
  await assertSucceeds(publishDoc(location, { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' }));
  await assertSucceeds(getDocFromServer(location));
  await setBridgeAccess({ status: 'suspended', validAfter: 1_000 });
  await assertFails(getDocFromServer(location));
  await assertFails(publishDoc(location, { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 2' }));
  await assertFails(publish(db, [], new Timestamp(1_800_000_000, 0), ['locations/LIE-A1B2C3D4']));
  const guard = doc(db, 'accountAccess/owner');
  await assertFails(getDocFromServer(guard));
  await assertFails(updateDoc(guard, { status: 'active', validAfter: 0 }));
  await assertFails(deleteDoc(guard));
  await assertFails(setDoc(doc(db, 'accountAccess/owner/memberships/owner'), { uid: 'owner' }));
});

test('F02 : le pont réactivé exige une nouvelle auth_time locale et conserve ses publications atomiques', async () => {
  await setBridgeAccess({ status: 'active', validAfter: 1_000 });
  for (const authTime of [999, 1_000, '1001', null]) {
    const db = environment.authenticatedContext('owner', { firebase: { sign_in_provider: 'password' }, auth_time: authTime, iat: 2_000 }).firestore();
    await assertFails(publishDoc(doc(db, 'codeAccounts/owner/account/profile'), account(new Timestamp(1_700_000_000, 0))));
  }
  const fresh = environment.authenticatedContext('owner', { firebase: { sign_in_provider: 'password' }, auth_time: 1_001 }).firestore();
  const location = doc(fresh, 'codeAccounts/owner/locations/LIE-A1B2C3D4');
  await assertSucceeds(publishDoc(location, { ...base('owner', 'LIE-A1B2C3D4'), genericLabel: 'Lieu 1' }));
  await assertSucceeds(getDocFromServer(location));
});

test('F02 : les guards pont ne sont jamais créés côté client et un document malformé ferme l’accès', async () => {
  const db = environment.authenticatedContext('owner', { firebase: { sign_in_provider: 'password' }, auth_time: 1_001 }).firestore();
  await assertFails(setDoc(doc(db, 'accountAccess/owner'), { status: 'active', validAfter: 0 }));
  for (const access of [{ status: 'active' }, { status: 'active', validAfter: '1000' }, { status: 'active', validAfter: -1 }]) {
    await setBridgeAccess(access);
    await assertFails(getDocFromServer(doc(db, 'codeAccounts/owner/account/profile')));
  }
});

test('F02 : le pont contrôle aussi la date de création du jeton de récupération', async () => {
  await setBridgeAccess({ status: 'active', validAfter: 1_000 });
  for (const issuedAt of [undefined, 1_000, '1001']) {
    const db = environment.authenticatedContext('owner', {
      firebase: { sign_in_provider: 'custom' }, auth_time: 1_005,
      ...(issuedAt === undefined ? {} : { cartulariaRecoveryIssuedAt: issuedAt }),
    }).firestore();
    await assertFails(publishDoc(doc(db, 'codeAccounts/owner/account/profile'), account(new Timestamp(1_700_000_000, 0))));
  }
  const fresh = environment.authenticatedContext('owner', {
    firebase: { sign_in_provider: 'custom' }, auth_time: 1_005, cartulariaRecoveryIssuedAt: 1_001,
  }).firestore();
  await assertSucceeds(publishDoc(doc(fresh, 'codeAccounts/owner/account/profile'), account(new Timestamp(1_700_000_000, 0))));
});
