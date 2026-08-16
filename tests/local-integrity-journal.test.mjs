import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBytesHash, IntegrityJournal } from '../src/utils/integrityJournal.ts';
import { sha256Digest } from '../scripts/lib/canonical-json.mjs';
import { verifyLocalIntegrityBundle } from '../scripts/lib/local-integrity-verifier.mjs';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const snapshot = (model = 'Flieger UTC') => ({
  identity: { brand: 'IWC', model },
  media: [{ id: 'main-photo', hash: `sha256:${'a'.repeat(64)}`, tags: ['main-photo'] }],
  publication: { website: [], community: [], report: [] },
});

test('un instantané canonique crée une révision unique et idempotente', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_test', storage });
  await journal.ready();
  const [first, replay] = await Promise.all([
    journal.reconcileSnapshot(snapshot()),
    journal.reconcileSnapshot(snapshot()),
  ]);
  assert.equal([first, replay].filter(Boolean).length, 1);
  assert.equal(journal.getProofState().revision, 1);
  assert.equal(journal.getEvents().length, 1);
  assert.equal((await journal.verifyIntegrity()).isValid, true);
});

test('deux instances concurrentes partagent des séquences monotones', async () => {
  const storage = new MemoryStorage();
  const firstJournal = new IntegrityJournal({ cartularyId: 'cart_concurrent', storage });
  const secondJournal = new IntegrityJournal({ cartularyId: 'cart_concurrent', storage });
  await Promise.all([firstJournal.ready(), secondJournal.ready()]);
  await firstJournal.reconcileSnapshot(snapshot());
  await Promise.all([
    firstJournal.logEvent('ACCESS_CARTULARY', 'owner', 'Premier accès', { requestId: 'access-tab-one' }),
    secondJournal.logEvent('ACCESS_CARTULARY', 'owner', 'Second accès', { requestId: 'access-tab-two' }),
  ]);
  const verifier = new IntegrityJournal({ cartularyId: 'cart_concurrent', storage });
  await verifier.ready();
  assert.deepEqual(verifier.getEvents().map((event) => event.sequence), [1, 2, 3]);
  assert.equal(new Set(verifier.getEvents().map((event) => event.hash)).size, 3);
  assert.equal((await verifier.verifyIntegrity()).isValid, true);
});

test('un requestId rejoué ne crée ni événement ni séquence supplémentaire', async () => {
  const storage = new MemoryStorage();
  const firstJournal = new IntegrityJournal({ cartularyId: 'cart_idempotent', storage });
  const secondJournal = new IntegrityJournal({ cartularyId: 'cart_idempotent', storage });
  await Promise.all([firstJournal.ready(), secondJournal.ready()]);
  const [first, replay] = await Promise.all([
    firstJournal.logEvent('ACCESS_CARTULARY', 'owner', 'Accès', { requestId: 'access-same-session' }),
    secondJournal.logEvent('ACCESS_CARTULARY', 'owner', 'Accès', { requestId: 'access-same-session' }),
  ]);
  assert.equal(first.id, replay.id);
  const verifier = new IntegrityJournal({ cartularyId: 'cart_idempotent', storage });
  await verifier.ready();
  assert.equal(verifier.getEvents().length, 1);
  assert.equal((await verifier.verifyIntegrity()).isValid, true);
});

test('chaque changement d’état crée une nouvelle révision et change le digest', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_revision', storage });
  await journal.ready();
  await journal.reconcileSnapshot(snapshot());
  const firstDigest = journal.getProofState().contentDigest;
  const event = await journal.reconcileSnapshot(snapshot('Mark XVIII'));
  assert.equal(event?.revision, 2);
  assert.equal(event?.beforeDigest, firstDigest);
  assert.notEqual(event?.afterDigest, firstDigest);
  assert.equal(journal.getProofState().revision, 2);
  assert.equal((await journal.verifyIntegrity()).isValid, true);
});

test('un retour à un contenu antérieur crée une nouvelle révision au lieu de rejouer un ancien événement', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_revert', storage });
  await journal.ready();
  await journal.reconcileSnapshot(snapshot());
  await journal.reconcileSnapshot(snapshot('Mark XVIII'));
  const reverted = await journal.reconcileSnapshot(snapshot());
  assert.equal(reverted?.revision, 3);
  assert.deepEqual(journal.getEvents().map((event) => event.revision), [1, 2, 3]);
  assert.equal((await journal.verifyIntegrity()).isValid, true);
});

test('un requestId réutilisé avec une autre intention est refusé', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_request_conflict', storage });
  await journal.ready();
  await journal.logEvent('ACCESS_CARTULARY', 'owner', 'Accès', { requestId: 'same-id' });
  await assert.rejects(
    journal.logEvent('EXPORT_PDF', 'owner', 'Export', { requestId: 'same-id' }),
    /Conflit d'idempotence/,
  );
  assert.equal(journal.getEvents().length, 1);
});

test('une altération d’événement est détectée', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_tamper', storage });
  await journal.ready();
  await journal.reconcileSnapshot(snapshot());
  await journal.logEvent('EXPORT_PDF', 'owner', 'Export', { requestId: 'export-tamper-test' });
  journal.simulateTampering(1, 'Valeur falsifiée');
  const verification = await journal.verifyIntegrity();
  assert.equal(verification.isValid, false);
  assert.ok(verification.errors.some((error) => error.code === 'event_hash_mismatch'));
});

test('un journal legacy rompu est conservé, classé et référencé par la nouvelle chaîne', async () => {
  const storage = new MemoryStorage();
  storage.setItem('cartularia_audit_events', JSON.stringify([
    {
      id: 'genesis-evt', sequence: 0, hash: 'genesis-placeholder', previousHash: '0',
      timestamp: '2026-08-01T00:00:00.000Z', action: 'INITIALIZE_CARTULARY', actorId: 'system', details: 'Genesis', version: '1.0',
    },
    {
      id: 'evt-one', sequence: 1, hash: 'broken-one', previousHash: 'genesis-placeholder',
      timestamp: '2026-08-01T00:01:00.000Z', action: 'ACCESS_CARTULARY', actorId: 'owner', details: 'Accès', version: '1.1',
    },
    {
      id: 'evt-two', sequence: 1, hash: 'broken-two', previousHash: 'genesis-placeholder',
      timestamp: '2026-08-01T00:01:00.000Z', action: 'ACCESS_CARTULARY', actorId: 'owner', details: 'Accès', version: '1.1',
    },
  ]));
  const journal = new IntegrityJournal({ cartularyId: 'cart_legacy', storage });
  await journal.ready();
  assert.deepEqual(journal.getProofState().legacyStatuses, ['legacy_broken']);
  assert.equal(journal.getEvents()[0].action, 'legacy.journal.imported');
  assert.equal(journal.getEvents()[0].revision, 0);
  assert.equal((await journal.verifyIntegrity()).isValid, true);
});

test('un état v2 illisible est archivé comme invérifiable avant initialisation', async () => {
  const storage = new MemoryStorage();
  storage.setItem('cartularia-integrity-v2:cart_invalid_state', '{"formatVersion":');
  const journal = new IntegrityJournal({ cartularyId: 'cart_invalid_state', storage });
  await journal.ready();
  assert.deepEqual(journal.getProofState().legacyStatuses, ['legacy_unverifiable']);
  assert.equal(journal.getEvents()[0].action, 'legacy.journal.imported');
  const bundle = await journal.exportPortableBundle(snapshot());
  assert.equal(verifyLocalIntegrityBundle(bundle).valid, true);
});

test('une corruption du stockage pendant la session bloque les écritures puis reste migrable', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_runtime_corruption', storage });
  await journal.ready();
  const currentSnapshot = snapshot();
  await journal.reconcileSnapshot(currentSnapshot);
  storage.setItem('cartularia-integrity-v2:cart_runtime_corruption', '{corrompu');
  const broken = await journal.verifyIntegrity();
  assert.equal(broken.isValid, false);
  assert.ok(broken.errors.some((error) => error.code === 'state_storage_invalid'));
  await assert.rejects(
    journal.logEvent('EXPORT_PDF', 'owner', 'Ne doit pas écraser la corruption'),
    /absent ou illisible/,
  );
  await journal.migrateBrokenJournal(currentSnapshot);
  const migrated = await journal.verifyIntegrity();
  assert.equal(migrated.isValid, true);
  assert.deepEqual(migrated.legacyStatuses, ['legacy_unverifiable']);
});

test('l’export portable est vérifiable indépendamment et toute altération échoue', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_export', storage });
  await journal.ready();
  const currentSnapshot = snapshot();
  await journal.reconcileSnapshot(currentSnapshot);
  await journal.createLocalTestTimestamp();
  const bundle = await journal.exportPortableBundle(currentSnapshot);
  const valid = verifyLocalIntegrityBundle(bundle);
  assert.equal(valid.valid, true);
  const altered = structuredClone(bundle);
  altered.snapshot.identity.model = 'Falsifié';
  const invalid = verifyLocalIntegrityBundle(altered);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.code === 'snapshot_digest_mismatch'));

  const fabricatedReceipt = structuredClone(bundle);
  fabricatedReceipt.receipts[0].merkleRoot = `sha256:${'f'.repeat(64)}`;
  fabricatedReceipt.receipts[0].tokenDigest = sha256Digest({
    merkleRoot: fabricatedReceipt.receipts[0].merkleRoot,
    timestamp: fabricatedReceipt.receipts[0].timestamp,
    protocol: fabricatedReceipt.receipts[0].protocol,
  });
  const unknownRoot = verifyLocalIntegrityBundle(fabricatedReceipt);
  assert.equal(unknownRoot.valid, false);
  assert.ok(unknownRoot.errors.some((error) => error.code === 'timestamp_root_unknown'));

  const malformedEvent = structuredClone(bundle);
  malformedEvent.events[0] = null;
  const malformed = verifyLocalIntegrityBundle(malformedEvent);
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.some((error) => error.code === 'malformed_event'));
});

test('un reçu RFC 3161 vérifié couvre une racine connue et ses octets restent contrôlés', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_rfc3161', storage });
  await journal.ready();
  await journal.reconcileSnapshot(snapshot());
  const merkleRoot = await journal.getMerkleRoot();
  const requestBytes = new TextEncoder().encode('requête-rfc3161-de-test');
  const tokenBytes = new TextEncoder().encode('réponse-rfc3161-de-test');
  const receipt = {
    receiptId: 'tsr_browser_contract_001',
    protocol: 'rfc3161-v1',
    status: 'ExternalReceipt',
    provider: 'TSA de test contractuel',
    tsaEndpoint: 'https://tsa.example.test',
    digest: merkleRoot,
    requestId: 'timestamp-browser-contract-001',
    requestBase64: Buffer.from(requestBytes).toString('base64'),
    requestSha256: await computeBytesHash(requestBytes),
    tokenBase64: Buffer.from(tokenBytes).toString('base64'),
    tokenSha256: await computeBytesHash(tokenBytes),
    issuedAt: '2026-08-16T08:00:00.000Z',
    policyOid: '1.2.3.4',
    serialNumber: '0x01',
    hashAlgorithm: 'sha256',
    nonce: '0x02',
    signerSubject: 'CN=TSA de test',
    signerIssuer: 'CN=Racine de test',
    signerCertificateSha256: `sha256:${'b'.repeat(64)}`,
    verificationStatus: 'trusted_rfc3161',
    signatureVerified: true,
    chainVerified: true,
    nonceMatched: true,
    qualified: false,
    qualificationStatus: 'not_assessed',
    publicAnchoringStatus: 'deferred',
    validationEvidence: {
      verifiedAt: '2026-08-16T08:00:01.000Z',
      verifier: 'openssl ts -verify',
      trustStore: 'test-root',
    },
  };
  const stored = await journal.attachExternalTimestamp(receipt);
  assert.equal(stored.merkleRoot, merkleRoot);
  assert.equal(stored.anchoredContentDigest, journal.getProofState().contentDigest);
  assert.equal((await journal.verifyIntegrity()).isValid, true);

  const portable = await journal.exportPortableBundle(snapshot());
  const altered = structuredClone(portable);
  altered.receipts[0].tokenBase64 = Buffer.from('jeton-altéré').toString('base64');
  const verification = verifyLocalIntegrityBundle(altered);
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => error.code === 'timestamp_token_mismatch'));
});

test('une revendication eIDAS qualifiée sans preuve de liste de confiance est refusée', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_false_qtsa', storage });
  await journal.ready();
  await journal.reconcileSnapshot(snapshot());
  const bytes = new TextEncoder().encode('fixture');
  const digest = await computeBytesHash(bytes);
  await assert.rejects(
    journal.attachExternalTimestamp({
      receiptId: 'tsr_false_qtsa_001',
      protocol: 'rfc3161-v1', status: 'ExternalReceipt', provider: 'Faux QTSA', tsaEndpoint: 'https://tsa.example.test',
      digest: await journal.getMerkleRoot(), requestId: 'timestamp-false-qtsa-001',
      requestBase64: Buffer.from(bytes).toString('base64'), requestSha256: digest,
      tokenBase64: Buffer.from(bytes).toString('base64'), tokenSha256: digest,
      issuedAt: '2026-08-16T08:00:00.000Z', policyOid: '1.2.3', serialNumber: '1', hashAlgorithm: 'sha256', nonce: '2',
      signerSubject: 'CN=Faux', signerIssuer: 'CN=Faux', signerCertificateSha256: `sha256:${'c'.repeat(64)}`,
      verificationStatus: 'qualified_eidas', signatureVerified: true, chainVerified: true, nonceMatched: true,
      qualified: true, qualificationStatus: 'QTSA', publicAnchoringStatus: 'deferred',
      validationEvidence: { verifiedAt: '2026-08-16T08:00:01.000Z', verifier: 'fixture', trustStore: 'fixture' },
    }),
    /liste de confiance/,
  );
});

test('une chaîne rompue est archivée sans réécriture avant de repartir du contenu courant', async () => {
  const storage = new MemoryStorage();
  const journal = new IntegrityJournal({ cartularyId: 'cart_rollover', storage });
  await journal.ready();
  const currentSnapshot = snapshot();
  await journal.reconcileSnapshot(currentSnapshot);
  await journal.logEvent('EXPORT_PDF', 'owner', 'Export', { requestId: 'export-before-break' });
  journal.simulateTampering(1, 'Événement falsifié');
  assert.equal((await journal.verifyIntegrity()).isValid, false);
  await journal.migrateBrokenJournal(currentSnapshot);
  const verification = await journal.verifyIntegrity();
  assert.equal(verification.isValid, true);
  assert.deepEqual(verification.legacyStatuses, ['legacy_broken']);
  assert.equal(journal.getProofState().revision, 1);
  assert.deepEqual(journal.getEvents().map((event) => event.action), [
    'legacy.journal.imported',
    'cartulary.snapshot.initialized',
  ]);
  const bundle = await journal.exportPortableBundle(currentSnapshot);
  assert.equal(verifyLocalIntegrityBundle(bundle).valid, true);
});
