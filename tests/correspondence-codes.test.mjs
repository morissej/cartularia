import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCorrespondenceCode, isCorrespondenceCode } from '../src/domain/correspondenceCodes.ts';
import { emptyPersonalVaultPayload, migratePersonalVaultPayload } from '../src/personalVault/types.ts';

test('les codes de correspondance sont générés selon le même contrat sécurisé', () => {
  for (const kind of ['client', 'transmission', 'location', 'manager', 'person']) {
    const code = generateCorrespondenceCode(kind);
    assert.equal(isCorrespondenceCode(kind, code), true, `${kind}: ${code}`);
  }
  assert.match(generateCorrespondenceCode('object', 'Rolex'), /^ROL-[A-F0-9]{8}$/);
});

test('un nouveau coffre possède un client principal unique lié au nom utilisateur', () => {
  const payload = emptyPersonalVaultPayload('Atlas');
  assert.equal(payload.userName, 'Atlas');
  assert.equal(payload.owners.filter((owner) => owner.linkedToUserName).length, 1);
  assert.equal(isCorrespondenceCode('client', payload.owners[0].clientNumber), true);
});

test('la migration retire les saisies objet des plans et lieux ainsi que les pourcentages', () => {
  const migrated = migratePersonalVaultPayload({
    schemaVersion: 'personal-vault@2.0.0',
    userAlias: 'Atlas',
    owners: [{ id: 'owner', label: 'Principal', type: 'Personne physique', fields: [], objectCodes: ['ROL-12345678'] }],
    transmissionPlans: [{ id: 'plan', name: 'Plan', notes: '', objectCodes: ['ROL-12345678'], recipients: [{ id: 'r', firstName: 'A', lastName: 'B', address: '', email: '', phone: '', percentage: 50 }] }],
    storage: [{ id: 'place', codeName: 'Maison', preciseLocation: '', contents: '', securityAndConditions: '', objectCodes: ['ROL-12345678'] }],
    updatedAt: '2026-01-01T00:00:00.000Z',
  }, 'Atlas');
  assert.equal(migrated.schemaVersion, 'personal-vault@3.0.0');
  assert.equal('objectCodes' in migrated.transmissionPlans[0], false);
  assert.equal('percentage' in migrated.transmissionPlans[0].recipients[0], false);
  assert.equal('objectCodes' in migrated.storage[0], false);
  assert.equal(isCorrespondenceCode('transmission', migrated.transmissionPlans[0].transmissionCode), true);
  assert.equal(isCorrespondenceCode('location', migrated.storage[0].locationCode), true);
  assert.equal(isCorrespondenceCode('person', migrated.transmissionPlans[0].recipients[0].recipientCode), true);
});
