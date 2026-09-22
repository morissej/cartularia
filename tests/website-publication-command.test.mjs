import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getWebsitePublicationState, publishWebsite, revokeWebsite, validateWebsiteRequest } from '../scripts/lib/website-publication-command.mjs';

// The command integration below uses an atomic in-memory transaction adapter.
// Storage Rules and real Firebase transactions are validated separately in emulator tests.
function harness() {
  const records = new Map();
  const blobs = new Map();
  const snapshot = (ref) => ({ exists: records.has(ref.path), id: ref.path.split('/').at(-1), ref, data: () => records.get(ref.path) });
  const doc = (path) => ({ path, collection: (id) => collection(`${path}/${id}`), get: async () => snapshot(doc(path)),
    set: async (data, options) => records.set(path, options?.merge ? { ...records.get(path), ...data } : data),
    create: async (data) => { if (records.has(path)) throw Object.assign(new Error('exists'), { code: 6 }); records.set(path, data); },
  });
  const collection = (path, maximum = Infinity) => ({ path, doc: (id) => doc(`${path}/${id}`), limit: (count) => collection(path, count), get: async () => { const docs = [...records.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).slice(0, maximum).map((key) => snapshot(doc(key))); return { docs, size: docs.length }; } });
  const firestore = { doc, collection, runTransaction: async (callback) => {
    const mutations = [];
    const transaction = { get: (ref) => ref.get(), set: (ref, data) => mutations.push(() => records.set(ref.path, data)),
      update: (ref, data) => mutations.push(() => records.set(ref.path, { ...records.get(ref.path), ...data })),
      create: (ref, data) => mutations.push(() => { assert.ok(!records.has(ref.path)); records.set(ref.path, data); }),
      delete: (ref) => mutations.push(() => records.delete(ref.path)),
    };
    const result = await callback(transaction); mutations.forEach((apply) => apply()); return result;
  } };
  const bucket = { name: 'publication-test.appspot.com', file: (path) => ({ getMetadata: async () => {
    if (!blobs.has(path)) throw Object.assign(new Error('missing'), { code: 404 });
    return [{ name: path, bucket: bucket.name, generation: '1', size: String(blobs.get(path).bytes.length), ...blobs.get(path).metadata }];
  }, download: async () => { assert.ok(blobs.has(path), `blob ${path}`); return [blobs.get(path).bytes]; },
    save: async (bytes, options) => blobs.set(path, { bytes, options }), delete: async () => blobs.delete(path),
  }) };
  records.set('cartularies/cart_test', { id: 'cart_test', accountHolderId: 'owner_test', organizationId: 'org_test', registryId: 'reg_test', publicCode: 'OBJ-PUBLIC', revision: 1, assetType: 'car', schemaId: 'car', schemaVersion: '1.0.0', displayTitle: 'Objet de collection', makerName: 'Atelier', modelName: 'Modèle', referenceCode: 'REF-1' });
  records.set('users/owner_test', { status: 'active' });
  records.set('organizations/org_test/memberships/owner_test', { uid: 'owner_test', status: 'active', roles: ['legal_owner'], permissions: ['publication.manage'], scopes: { registryIds: ['reg_test'] } });
  const derivativePath = 'private-derivatives/owner_test/cart_test/binary_test/presentation.webp';
  const original = Buffer.from('previously inspected original fixture');
  const sha256 = `sha256:${createHash('sha256').update(original).digest('hex')}`;
  const storagePath = `private-drafts/owner_test/cart_test/binary_test/${sha256.slice(7)}/original`;
  const verificationIdentity = { schemaVersion: 'private-binary-identity@1.0.0', ownerUid: 'owner_test', cartularyId: 'cart_test', binaryId: 'binary_test', storagePath, sha256, size: original.length, bucket: bucket.name, generation: '1' };
  records.set('privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test', { ...verificationIdentity, verificationIdentity, kind: 'media', mimeType: 'image/jpeg', deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', publicationEligible: true, presentationDerivative: { storagePath: derivativePath, metadataStripped: true, mimeType: 'image/webp', sourceSha256: sha256 } });
  blobs.set(storagePath, { bytes: original, metadata: { contentType: 'image/jpeg', metadata: { ownerUid: 'owner_test', cartularyId: 'cart_test', binaryId: 'binary_test', sha256, kind: 'media' } } });
  blobs.set(derivativePath, { bytes: Buffer.from('RIFF0000WEBPverified presentation fixture') });
  return { firestore, bucket, records, blobs, requestAuth: { uid: 'owner_test' } };
}
const request = (overrides = {}) => ({ cartularyId: 'cart_test', requestId: 'website_test1', expectedRevision: 1, confirmed: true, confirmedNonPersonalMedia: true, blocks: [{ id: 'media-hero', title: 'Présentation', payload: { heading: 'Objet' }, assets: [{ assetId: 'asset_test', binaryId: 'binary_test' }] }], ...overrides });

test('sélection arbitraire autorisée ; données privées et absence de consentement refusées', () => {
  assert.equal(validateWebsiteRequest(request()).blocks.length, 1);
  assert.throws(() => validateWebsiteRequest(request({ confirmed: false })), { code: 'invalid_argument' });
  assert.throws(() => validateWebsiteRequest(request({ confirmedNonPersonalMedia: false })), { code: 'media_consent_required' });
  assert.throws(() => validateWebsiteRequest(request({ blocks: [{ id: 'cover-owner', title: 'Identité', payload: {}, assets: [] }] })), { code: 'invalid_blocks' });
  assert.throws(() => validateWebsiteRequest(request({ blocks: [{ id: 'media-hero', title: 'Photo', payload: { serialNumber: 'secret' }, assets: [] }] })), { code: 'secret_field_detected' });
});

test('publication multiasset, rejeu stable, désélection et retrait suppriment les anciens binaires', async () => {
  const env = harness();
  const first = await publishWebsite({ ...env, input: request() });
  assert.equal(first.status, 'published'); assert.equal(first.revision, 3);
  assert.deepEqual(first.selectedAssetIds, ['asset_test']);
  assert.deepEqual((await getWebsitePublicationState({ ...env, cartularyId: 'cart_test' })).selectedAssetIds, ['asset_test']);
  const publicPath = [...env.blobs.keys()].find((path) => path.startsWith('public/'));
  assert.ok(publicPath);
  const metadata = env.blobs.get(publicPath).options.metadata;
  assert.equal(metadata.metadata.firebaseStorageDownloadTokens, '');
  assert.equal(metadata.cacheControl, 'private, no-store, max-age=0');
  assert.ok(env.records.get('publications/OBJ-PUBLIC/mediaAccess/asset_test').derivativeIds.length);
  const replay = await publishWebsite({ ...env, input: request() });
  assert.equal(replay.revision, first.revision);
  const updated = await publishWebsite({ ...env, input: request({ requestId: 'website_test2', expectedRevision: first.revision, blocks: [{ id: 'condition-summary', title: 'État', payload: { paragraphs: ['Bon état'] }, assets: [] }] }) });
  assert.equal(env.blobs.has(publicPath), false);
  assert.equal(env.records.has('publications/OBJ-PUBLIC/mediaAccess/asset_test'), false);
  assert.equal(env.records.has('publications/OBJ-PUBLIC/blocks/media-hero'), false);
  assert.equal(env.records.has('publications/OBJ-PUBLIC/blocks/condition-summary'), true);
  const final = await revokeWebsite({ ...env, input: request({ requestId: 'website_revoke', expectedRevision: updated.revision }) });
  assert.equal(final.status, 'revoked');
  assert.deepEqual(final.selectedAssetIds, []);
  assert.equal(env.records.has('publications/OBJ-PUBLIC/blocks/condition-summary'), false);
  const again = await revokeWebsite({ ...env, input: request({ requestId: 'website_revoke', expectedRevision: updated.revision }) });
  assert.equal(again.revision, final.revision);
  const latePublicationReplay = await publishWebsite({ ...env, input: request() });
  assert.equal(latePublicationReplay.status, 'revoked');
  assert.equal(latePublicationReplay.revision, final.revision);
});

test('révision périmée et substitution de requête refusées sans toucher la copie publiée', async () => {
  const env = harness();
  await assert.rejects(publishWebsite({ ...env, input: request({ expectedRevision: 99 }) }), { code: 'revision_conflict' });
  assert.equal([...env.blobs.keys()].some((path) => path.startsWith('public/')), false);
  await publishWebsite({ ...env, input: request() });
  await assert.rejects(publishWebsite({ ...env, input: request({ blocks: [{ id: 'condition-summary', title: 'État', payload: {}, assets: [] }] }) }), { code: 'request_reused' });
});

test('vidéos et documents sans dérivé vérifié ne publient jamais leur original', async () => {
  for (const mimeType of ['video/mp4', 'application/pdf']) {
    const env = harness();
    const record = env.records.get('privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test');
    record.presentationDerivative.mimeType = mimeType;
    await assert.rejects(publishWebsite({ ...env, input: request() }), { code: 'derivative_not_ready' });
    assert.equal([...env.blobs.keys()].some((path) => path.startsWith('public/')), false);
  }
});

test('un PDF reconstruit validé est publiable ; les documents personnels et copies altérées sont refusés', async () => {
  const env = harness();
  const record = env.records.get('privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test');
  const bytes = Buffer.from('%PDF-1.7\nverified rasterized fixture\n%%EOF');
  Object.assign(record.presentationDerivative, { mimeType: 'application/pdf', processingMethod: 'pdf_rasterized_v1', pageCount: 1, size: bytes.length, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
  env.blobs.set(record.presentationDerivative.storagePath, { bytes });
  record.kind = 'owner_document';
  await assert.rejects(publishWebsite({ ...env, input: request() }), { code: 'personal_document' });
  record.kind = 'condition_attachment';
  env.blobs.get(record.storagePath).metadata.metadata.kind = 'condition_attachment';
  env.blobs.set(record.presentationDerivative.storagePath, { bytes: Buffer.from('%PDF-1.7 altered') });
  await assert.rejects(publishWebsite({ ...env, input: request() }), { code: 'derivative_integrity' });
  env.blobs.set(record.presentationDerivative.storagePath, { bytes });
  await publishWebsite({ ...env, input: request() });
  assert.equal(env.records.get('publications/OBJ-PUBLIC/blocks/media-hero').assets[0].mediaKind, 'document');
});

test('P3 : antidatation, substitution et original absent ne permettent aucune nouvelle publication', async () => {
  for (const tamper of [
    (env, record) => { delete record.verificationIdentity; delete record.verificationVersion; record.clientUpdatedAt = 1; },
    (env, record) => { record.sha256 = `sha256:${'b'.repeat(64)}`; },
    (env, record) => { record.storagePath = record.storagePath.replace('/binary_test/', '/another_binary/'); },
    (env, record) => { env.blobs.delete(record.storagePath); },
    (env, record) => { env.blobs.get(record.storagePath).metadata.generation = '2'; },
  ]) {
    const env = harness();
    const record = env.records.get('privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test');
    tamper(env, record);
    await assert.rejects(publishWebsite({ ...env, input: request() }), { code: 'derivative_not_ready' });
    assert.equal(env.records.has('publications/OBJ-PUBLIC'), false);
    assert.equal([...env.blobs.keys()].some((path) => path.startsWith('public/')), false);
  }
});

test('P3 : une préparation mise en cache ne contourne pas la nouvelle vérification de l’original', async () => {
  const env = harness();
  const operationPath = 'cartularies/cart_test/websiteOperations/website_test1';
  const record = env.records.get('privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test');
  const ref = { assetId: 'asset_test', binaryId: 'binary_test', verificationIdentity: record.verificationIdentity, derivativeId: 'cached_derivative', byteSize: 20 };
  env.records.set(operationPath, { signature: createHash('sha256').update(JSON.stringify(request())).digest('hex'), previousPaths: [], refs: [ref], complete: false });
  env.blobs.delete(record.storagePath);
  await assert.rejects(publishWebsite({ ...env, input: request() }), { code: 'derivative_not_ready' });
  assert.equal(env.records.has('publications/OBJ-PUBLIC'), false);
});

test('retrait interrompu, double demande concurrente et refresh : inventaire immuable puis reprise des anciennes copies', async () => {
  const env = harness(); const published = await publishWebsite({ ...env, input: request() });
  const publicPath = [...env.blobs.keys()].find((path) => path.startsWith('public/'));
  const cleanupPath = 'cartularies/cart_test/websiteCleanup/website_revoke_concurrent';
  const realDoc = env.firestore.doc; let reads = 0; let releaseSecond;
  const resumeSecond = new Promise((resolve) => { releaseSecond = resolve; });
  env.firestore.doc = (path) => { const ref = realDoc(path); if (path !== cleanupPath) return ref; return { ...ref, get: async () => {
    const snapshot = await ref.get(); reads += 1;
    // Request B observed "absent" before A created its immutable inventory,
    // but resumes only after A has revoked the projection and removed blocks.
    if (reads === 2) await resumeSecond;
    return snapshot;
  } }; };
  const realFile = env.bucket.file;
  env.bucket.file = (path) => ({ ...realFile(path), delete: async () => { throw new Error('Storage unavailable'); } });
  const input = request({ requestId: 'website_revoke_concurrent', expectedRevision: published.revision });
  const first = revokeWebsite({ ...env, input });
  const second = revokeWebsite({ ...env, input });
  await assert.rejects(first, { code: 'media_cleanup_pending' }); releaseSecond();
  await assert.rejects(second, { code: 'media_cleanup_pending' });
  assert.deepEqual(env.records.get(cleanupPath).paths, [publicPath]);
  const refreshed = await getWebsitePublicationState({ ...env, cartularyId: 'cart_test' });
  assert.equal(refreshed.status, 'revoked'); assert.equal(refreshed.cleanupPending, true); assert.equal(refreshed.pendingCleanupCount, 1); assert.equal(env.blobs.has(publicPath), true);
  env.bucket.file = realFile;
  const resumed = await revokeWebsite({ ...env, input: request({ requestId: 'website_new_after_refresh', expectedRevision: refreshed.revision, cleanupOnly: true }) });
  assert.equal(resumed.status, 'revoked'); assert.equal(resumed.cleanupPending, false); assert.equal(env.blobs.has(publicPath), false);
});

test('nettoyage interrompu après mise à jour reste visible et bloque une nouvelle publication avant suppression', async () => {
  const env = harness(); const first = await publishWebsite({ ...env, input: request() });
  const publicPath = [...env.blobs.keys()].find((path) => path.startsWith('public/'));
  const realFile = env.bucket.file;
  env.bucket.file = (path) => ({ ...realFile(path), delete: async () => { throw new Error('Storage unavailable'); } });
  const withoutMedia = [{ id: 'condition-summary', title: 'État', payload: {}, assets: [] }];
  await assert.rejects(publishWebsite({ ...env, input: request({ requestId: 'website_update_fail', expectedRevision: first.revision, blocks: withoutMedia }) }), { code: 'media_cleanup_pending' });
  const refreshed = await getWebsitePublicationState({ ...env, cartularyId: 'cart_test' });
  assert.equal(refreshed.status, 'published'); assert.equal(refreshed.cleanupPending, true);
  const next = request({ requestId: 'website_new_update', expectedRevision: refreshed.revision, blocks: withoutMedia });
  await assert.rejects(publishWebsite({ ...env, input: next }), { code: 'media_cleanup_pending' });
  assert.equal(env.records.has('cartularies/cart_test/websiteOperations/website_new_update'), false);
  env.bucket.file = realFile;
  const published = await publishWebsite({ ...env, input: next });
  assert.equal(published.status, 'published'); assert.equal(published.cleanupPending, false); assert.equal(env.blobs.has(publicPath), false);
});


async function interruptAfterPreparation(env) {
  const normalTransaction = env.firestore.runTransaction;
  let count = 0;
  env.firestore.runTransaction = async (callback) => {
    if (++count === 2) throw new Error('Interrupted before approval.');
    return normalTransaction(callback);
  };
  await assert.rejects(publishWebsite({ ...env, input: request() }), /Interrupted before approval/);
  env.firestore.runTransaction = normalTransaction;
  assert.ok(env.records.get('cartularies/cart_test/websiteOperations/website_test1').refs.length);
  assert.equal(env.records.has('publications/OBJ-PUBLIC'), false);
}

test('P3 : une préparation interrompue reprend uniquement avec la même identité attestée', async () => {
  const env = harness();
  await interruptAfterPreparation(env);
  const cached = env.records.get('cartularies/cart_test/websiteOperations/website_test1').refs[0];
  assert.equal(cached.binaryId, 'binary_test');
  assert.deepEqual(cached.verificationIdentity, env.records.get('privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test').verificationIdentity);
  const result = await publishWebsite({ ...env, input: request() });
  assert.equal(result.status, 'published');
  const published = env.records.get('publications/OBJ-PUBLIC/blocks/media-hero').assets[0];
  assert.equal(published.derivativeId, cached.derivativeId);
  assert.equal('verificationIdentity' in published, false);
  assert.equal(JSON.stringify(env.records.get('publications/OBJ-PUBLIC')).includes('owner_test'), false);
  const approval = [...env.records.entries()].find(([path]) => path.includes('/publicationApprovals/'))[1];
  assert.deepEqual(approval.blocks[0].assetRefs, [{ assetId: cached.assetId, derivativeId: cached.derivativeId }]);
});

test('P3 : un original réattesté différent ne valide jamais une copie préparée pour l’ancien original', async () => {
  const env = harness();
  await interruptAfterPreparation(env);
  const manifestPath = 'privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test';
  const previous = env.records.get(manifestPath);
  const nextBytes = Buffer.from('independently verified replacement original');
  const sha256 = `sha256:${createHash('sha256').update(nextBytes).digest('hex')}`;
  const storagePath = `private-drafts/owner_test/cart_test/binary_test/${sha256.slice(7)}/original`;
  const verificationIdentity = { ...previous.verificationIdentity, storagePath, sha256, size: nextBytes.length, generation: '2' };
  env.records.set(manifestPath, { ...previous, ...verificationIdentity, verificationIdentity, presentationDerivative: null, publicationEligible: false });
  env.blobs.delete(previous.storagePath);
  env.blobs.set(storagePath, { bytes: nextBytes, metadata: { generation: '2', contentType: 'image/jpeg', metadata: {
    ownerUid: 'owner_test', cartularyId: 'cart_test', binaryId: 'binary_test', sha256, kind: 'media',
  } } });
  await assert.rejects(publishWebsite({ ...env, input: request() }), (error) => error.code === 'derivative_not_ready' && /original a changé/.test(error.message));
  assert.equal(env.records.has('publications/OBJ-PUBLIC'), false);
  assert.equal(env.records.has('cartularies/cart_test/publicationApprovals/approval_' + createHash('sha256').update('website_test1').digest('hex').slice(0, 24)), false);
  assert.equal(env.records.get('cartularies/cart_test').revision, 1);
});

test('P3 : un ancien cache sans identité refuse la reprise et demande une nouvelle publication', async () => {
  const env = harness();
  await interruptAfterPreparation(env);
  const cached = env.records.get('cartularies/cart_test/websiteOperations/website_test1').refs[0];
  delete cached.verificationIdentity;
  await assert.rejects(publishWebsite({ ...env, input: request() }), (error) => error.code === 'derivative_not_ready' && /nouvelle demande/.test(error.message));
  assert.equal(env.records.has('publications/OBJ-PUBLIC'), false);
});


for (const reason of ['publication ineligible', 'metadata not stripped', 'unsafe processing', 'derivative from another original']) {
  test(`P3 : un cache ne contourne pas la condition actuelle ${reason}`, async () => {
    const env = harness();
    await interruptAfterPreparation(env);
    const record = env.records.get('privateDrafts/owner_test/cartularies/cart_test/binaries/binary_test');
    if (reason === 'publication ineligible') record.publicationEligible = false;
    if (reason === 'metadata not stripped') record.presentationDerivative.metadataStripped = false;
    if (reason === 'unsafe processing') record.presentationDerivative.mimeType = 'application/octet-stream';
    if (reason === 'derivative from another original') record.presentationDerivative.sourceSha256 = `sha256:${'f'.repeat(64)}`;
    await assert.rejects(publishWebsite({ ...env, input: request() }), { code: 'derivative_not_ready' });
    assert.equal(env.records.has('publications/OBJ-PUBLIC'), false);
    assert.equal(env.records.get('cartularies/cart_test').revision, 1);
  });
}
