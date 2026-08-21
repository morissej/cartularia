import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REGISTRY_FORBIDDEN_STATE_KEYS,
  isRegistrySafeBinaryKind,
  isRegistrySafeStateKey,
  normalizeObjectCode,
  normalizeStorageCodeReferences,
  normalizeTransmissionCodeReferences,
  registryPrivacyLinkIsComplete,
} from '../src/domain/personalDataBoundary.ts';
import { decryptPersonalPayload, encryptPersonalPayload, vaultAccountDocumentId, vaultAuthenticationEmail } from '../src/personalVault/crypto.ts';

test('le Registre refuse toutes les anciennes clés personnelles', () => {
  for (const key of REGISTRY_FORBIDDEN_STATE_KEYS) assert.equal(isRegistrySafeStateKey(key), false, key);
  assert.equal(isRegistrySafeStateKey('cartularia-storage-code-names'), true);
  assert.equal(isRegistrySafeStateKey('cartularia-transmission-code-references'), true);
  assert.equal(isRegistrySafeBinaryKind('owner_document'), false);
  assert.equal(isRegistrySafeBinaryKind('media'), true);
});

test('les sélections du Cartulaire ne conservent que code générique et note', () => {
  assert.deepEqual(normalizeStorageCodeReferences([{ id: 's1', correspondenceCode: 'LIE-A1B2C3D4', codeName: 'Lieu 1', note: 'Étagère haute', address: 'interdit' }]), [
    { id: 's1', correspondenceCode: 'LIE-A1B2C3D4', codeName: 'Lieu 1', note: 'Étagère haute' },
  ]);
  assert.deepEqual(normalizeTransmissionCodeReferences([{ id: 't1', correspondenceCode: 'PER-A1B2C3D4', codeName: 'Personne 1', note: 'Prévenir' }]), [
    { id: 't1', correspondenceCode: 'PER-A1B2C3D4', codeName: 'Personne 1', note: 'Prévenir' },
  ]);
});

test('la référence commune reste pseudonyme et normalisée', () => {
  assert.equal(normalizeObjectCode(' obj 12/34 '), 'OBJ1234');
  assert.equal(registryPrivacyLinkIsComplete({ userAlias: 'Atlas', objectCode: 'OBJ1234' }), true);
  assert.equal(registryPrivacyLinkIsComplete({ userAlias: 'Al', objectCode: 'OBJ1234' }), false);
});

test('le Coffre chiffre le compte patrimonial sans dépendre d’un objet', async () => {
  const payload = { owners: [{ name: 'Donnée sensible' }], storage: ['Adresse précise'], objectCodes: ['OBJ1234'] };
  const envelope = await encryptPersonalPayload({ payload, password: 'mot-de-passe-dedie-2026', userAlias: 'Atlas' });
  assert.equal(JSON.stringify(envelope).includes('Donnée sensible'), false);
  assert.deepEqual(await decryptPersonalPayload({ envelope, password: 'mot-de-passe-dedie-2026', userAlias: 'Atlas' }), payload);
  await assert.rejects(decryptPersonalPayload({ envelope, password: 'autre-mot-de-passe-2026', userAlias: 'Atlas' }));
});

test('les identifiants Firebase ne révèlent ni pseudonyme ni patrimoine', async () => {
  const email = await vaultAuthenticationEmail('Atlas');
  const accountId = await vaultAccountDocumentId('Atlas');
  assert.match(email, /^[a-f0-9]{64}@access\.cartularia\.invalid$/);
  assert.match(accountId, /^[a-f0-9]{64}$/);
  assert.equal(email.includes('atlas'), false);
  assert.equal(accountId.includes('atlas'), false);
});
