import assert from 'node:assert/strict';
import test from 'node:test';
import { attachObjectCodeToClient, CodeBridgeCommandError } from '../scripts/lib/code-bridge-command.mjs';

const fakeFirestore = (initial) => {
  let data = structuredClone(initial);
  const reference = { path: `codeAccounts/${initial.ownerUid}/clients/${initial.code}` };
  return {
    doc: () => reference,
    runTransaction: async (callback) => callback({
      get: async () => ({ exists: true, data: () => structuredClone(data) }),
      update: (_ref, patch) => { data = { ...data, ...patch }; },
    }),
    read: () => data,
  };
};

test('le service autoritaire rattache un code objet sans donnée personnelle', async () => {
  const firestore = fakeFirestore({ ownerUid: 'bridge-account-1', code: 'CLI-A1B2C3D4', objectCodes: [] });
  const result = await attachObjectCodeToClient({ firestore, accountUid: 'bridge-account-1', clientNumber: 'CLI-A1B2C3D4', objectCode: 'ROL-1234ABCD' });
  assert.deepEqual(result.objectCodes, ['ROL-1234ABCD']);
  assert.deepEqual(firestore.read().objectCodes, ['ROL-1234ABCD']);
  assert.equal(JSON.stringify(firestore.read()).includes('name'), false);
});

test('le service refuse les identifiants libres et les doublons restent idempotents', async () => {
  const firestore = fakeFirestore({ ownerUid: 'bridge-account-1', code: 'CLI-A1B2C3D4', objectCodes: ['ROL-1234ABCD'] });
  const result = await attachObjectCodeToClient({ firestore, accountUid: 'bridge-account-1', clientNumber: 'CLI-A1B2C3D4', objectCode: 'ROL-1234ABCD' });
  assert.deepEqual(result.objectCodes, ['ROL-1234ABCD']);
  await assert.rejects(
    attachObjectCodeToClient({ firestore, accountUid: 'bridge-account-1', clientNumber: 'CLIENT LIBRE', objectCode: 'ROL-1234ABCD' }),
    (error) => error instanceof CodeBridgeCommandError && error.code === 'invalid_client_number',
  );
});
