import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  INLINE_THUMBNAIL_MAXIMUM_CHARACTERS,
  PRESENTATION_VARIANT_VERSION,
  PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS,
  assetPresentationMirror,
  binaryPresentationFailed,
  buildImagePresentationSet,
  manifestHasCurrentPresentationVariants,
  presentationVariantPath,
  presentationVariantsFromManifest,
  registryThumbnailFromAsset,
  registryThumbnailFromBundle,
  registryThumbnailFromManifest,
  validInlineThumbnail,
  validPresentationVariantPath,
  validRegistryThumbnail,
} from '../scripts/lib/presentation-variants.mjs';
import {
  PRIVATE_UPLOAD_BACKLOG_LIMIT,
  PRIVATE_UPLOAD_VERIFICATION_VERSION,
  applyPresentationMirrors,
  privateBinaryIsVerified,
  processPrivateDraftUpload,
  processPrivateDraftUploadBacklog,
  regenerateMissingPresentationVariants,
  regeneratePresentationDerivatives,
} from '../scripts/lib/private-upload-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** Faux bucket Storage mémoire : file().save/download/exists/getMetadata, getFiles({ prefix }), journal des écritures. */
const createMemoryStorage = (bucketName = 'cartularia-v3-test.appspot.com') => {
  const blobs = new Map();
  const journal = [];
  const bucket = {
    name: bucketName,
    file: (path) => ({
      name: path,
      save: async (bytes, options) => { blobs.set(path, { bytes: Buffer.from(bytes), options }); journal.push(`save:${path}`); },
      download: async (options) => {
        if (!blobs.has(path)) throw Object.assign(new Error(`No such object: ${path}`), { code: 404 });
        if (options?.destination) { await writeFile(options.destination, blobs.get(path).bytes); return []; }
        return [blobs.get(path).bytes];
      },
      exists: async () => [blobs.has(path)],
      getMetadata: async () => {
        const blob = blobs.get(path);
        return [{ name: path, bucket: bucketName, size: blob.bytes.length, contentType: blob.options?.metadata?.contentType, metadata: blob.options?.metadata?.metadata ?? {} }];
      },
      delete: async () => { blobs.delete(path); },
    }),
    getFiles: async ({ prefix }) => [[...blobs.keys()].filter((name) => name.startsWith(prefix)).sort().map((name) => bucket.file(name))],
  };
  return { blobs, journal, bucket, storage: { bucket: () => bucket } };
};

const UID = 'owner_v3_pipeline';
const CARTULARY = 'cart_v3_pipeline_object';
const REGISTRY = 'reg_v3_pipeline';
const BINARY = 'bin_v3_photo';
const ASSET = 'asset_v3_photo';

const syntheticJpeg = (width, height, extra = {}) => sharp({ create: { width, height, channels: 3, background: extra.background || '#7a5c3a' } })
  .jpeg({ quality: 90 })
  .withMetadata(extra.metadata || {})
  .toBuffer();

const withFile = async (bytes, callback) => {
  const directory = await mkdtemp(join(tmpdir(), 'cartularia-variants-test-'));
  const path = join(directory, 'original');
  try { await writeFile(path, bytes); return await callback(path); } finally { await rm(directory, { recursive: true, force: true }); }
};

const originalPath = (digest) => `private-drafts/${UID}/${CARTULARY}/${BINARY}/${digest.replace('sha256:', '')}/original`;

const seedObject = async ({ firestore, storage }, original, manifestOverrides = {}) => {
  const digest = digestOf(original);
  const path = originalPath(digest);
  await storage.bucket().file(path).save(original, { metadata: { contentType: 'image/jpeg', metadata: { ownerUid: UID, cartularyId: CARTULARY, binaryId: BINARY, sha256: digest, kind: 'media', originalFileName: 'photo.jpg' } } });
  await firestore.doc(`cartularies/${CARTULARY}`).set({ id: CARTULARY, accountHolderId: UID, registryId: REGISTRY, organizationId: 'org_v3', revision: 4 });
  await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}`).set({ ownerUid: UID, cartularyId: CARTULARY, status: 'active' });
  await firestore.doc(`cartularies/${CARTULARY}/assets/${ASSET}`).set({ id: ASSET, binaryId: BINARY, mediaKind: 'image', displayName: 'Photo', projectionStatus: 'active', liveSyncManaged: true });
  await firestore.doc(`cartularies/${CARTULARY}/assets/asset_v3_other`).set({ id: 'asset_v3_other', binaryId: 'bin_v3_other', mediaKind: 'image' });
  await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).set({ cartularyId: CARTULARY, registryId: REGISTRY, primaryAssetId: ASSET, contentHash: 'sha256:item', revision: 4, updatedAt: 'avant', generatedAt: 'avant' });
  await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${BINARY}`).set({
    ownerUid: UID, cartularyId: CARTULARY, binaryId: BINARY, kind: 'media', fileName: 'photo.jpg', mimeType: 'image/jpeg',
    size: original.length, sha256: digest, storagePath: path, deleted: false, revision: 2, clientUpdatedAt: 1_700_000_000_000,
    uploadStatus: 'ready', ...manifestOverrides,
  });
  return { digest, path };
};

const manifestOf = async (firestore) => (await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${BINARY}`).get()).data();

test('buildImagePresentationSet : une seule passe produit 240/480/768/1200 ≤ source, WebP nettoyés, vignette = octets de la 240', async () => {
  const original = await syntheticJpeg(1600, 1200);
  await withFile(original, async (path) => {
    const set = await buildImagePresentationSet({ path });
    assert.equal(set.sourceWidth, 1600);
    assert.deepEqual(set.variants.map((variant) => variant.nominalWidth), [240, 480, 768, 1200]);
    assert.deepEqual(set.variants.map((variant) => variant.width), [240, 480, 768, 1200]);
    assert.deepEqual(set.variants.map((variant) => variant.height), [180, 360, 576, 900]);
    assert.deepEqual(set.variants.map((variant) => variant.derivativeId), ['presentation-v3-240.webp', 'presentation-v3-480.webp', 'presentation-v3-768.webp', 'presentation-v3-1200.webp']);
    for (const variant of set.variants) {
      const metadata = await sharp(variant.bytes).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.exif, undefined);
      assert.equal(metadata.icc, undefined);
      assert.equal(variant.sha256, digestOf(variant.bytes));
      assert.equal(variant.size, variant.bytes.length);
    }
    assert.equal(set.primary.width, 1600);
    assert.equal(set.thumbnail.dataUrl, `data:image/webp;base64,${set.variants[0].bytes.toString('base64')}`);
    assert.equal(set.thumbnail.sha256, set.variants[0].sha256);
    assert.equal(set.thumbnail.width, 240);
    assert.ok(set.thumbnail.dataUrl.length <= INLINE_THUMBNAIL_MAXIMUM_CHARACTERS);
  });
});

test('buildImagePresentationSet : petites images → au moins la plus petite variante, sans agrandissement ; orientation EXIF et alpha respectés', async () => {
  await withFile(await syntheticJpeg(300, 200), async (path) => {
    const set = await buildImagePresentationSet({ path });
    assert.deepEqual(set.variants.map((variant) => [variant.nominalWidth, variant.width]), [[240, 240]]);
  });
  await withFile(await syntheticJpeg(100, 60), async (path) => {
    const set = await buildImagePresentationSet({ path });
    assert.deepEqual(set.variants.map((variant) => [variant.nominalWidth, variant.width, variant.height]), [[240, 100, 60]]);
    assert.equal(set.thumbnail.width, 100);
  });
  await withFile(await syntheticJpeg(600, 300, { metadata: { orientation: 6 } }), async (path) => {
    const set = await buildImagePresentationSet({ path });
    // sourceWidth/Height = dimensions stockées (sémantique historique de imageWidth/imageHeight) ; les dérivés sont redressés.
    assert.deepEqual([set.sourceWidth, set.sourceHeight], [600, 300]);
    assert.deepEqual([set.primary.width, set.primary.height], [300, 600]);
    assert.deepEqual(set.variants.map((variant) => [variant.width, variant.height]), [[240, 480]]);
    // Portrait redressé : la vignette inline est ramenée dans 240 × 240 (grand côté), jamais 240 × 480.
    assert.deepEqual([set.thumbnail.width, set.thumbnail.height], [120, 240]);
    assert.equal(validInlineThumbnail(set.thumbnail), true);
  });
  const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } } }).png().toBuffer();
  await withFile(png, async (path) => {
    const set = await buildImagePresentationSet({ path });
    assert.deepEqual(set.variants.map((variant) => variant.nominalWidth), [240, 480]);
    assert.equal((await sharp(set.variants[1].bytes).metadata()).hasAlpha, true);
  });
});

test('vignette inline trop lourde : ré-encodage plus léger sous 24 000 caractères, empreinte des octets inscrits', async () => {
  // Bruit aléatoire : incompressible, la variante 240 q80 dépasse la limite.
  const noise = Buffer.alloc(240 * 240 * 3);
  for (let index = 0; index < noise.length; index += 1) noise[index] = (index * 2654435761 + (index >> 3) * 40503) & 0xff;
  const original = await sharp(noise, { raw: { width: 240, height: 240, channels: 3 } }).png().toBuffer();
  await withFile(original, async (path) => {
    const set = await buildImagePresentationSet({ path });
    assert.ok(set.variants[0].bytes.toString('base64').length > INLINE_THUMBNAIL_MAXIMUM_CHARACTERS);
    assert.ok(set.thumbnail, 'une vignette doit rester disponible');
    assert.ok(set.thumbnail.dataUrl.length <= INLINE_THUMBNAIL_MAXIMUM_CHARACTERS);
    assert.notEqual(set.thumbnail.sha256, set.variants[0].sha256);
    assert.equal(set.thumbnail.sha256, digestOf(Buffer.from(set.thumbnail.dataUrl.split(',')[1], 'base64')));
  });
});

test('portrait (tour 2, point 2) : vignette inline ramenée dans 240 × 240, manifeste complet, rattrapage idempotent, vignette d’item posée', async () => {
  const original = await syntheticJpeg(600, 900);
  await withFile(original, async (path) => {
    const set = await buildImagePresentationSet({ path });
    assert.deepEqual(set.variants.map((variant) => [variant.width, variant.height]), [[240, 360], [480, 720]]);
    assert.deepEqual([set.thumbnail.width, set.thumbnail.height], [160, 240]);
    assert.notEqual(set.thumbnail.sha256, set.variants[0].sha256, 'portrait : la vignette est ré-encodée depuis la variante 240');
    const bytes = Buffer.from(set.thumbnail.dataUrl.split(',')[1], 'base64');
    assert.equal(set.thumbnail.sha256, digestOf(bytes));
    assert.equal(set.thumbnail.bytes, bytes.length);
    const decoded = await sharp(bytes).metadata();
    assert.deepEqual([decoded.format, decoded.width, decoded.height, decoded.exif], ['webp', 160, 240, undefined]);
    assert.equal(validInlineThumbnail(set.thumbnail), true);
  });

  const firestore = createMemoryFirestore();
  const { storage, journal } = createMemoryStorage();
  await seedObject({ firestore, storage }, original, { verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION });
  const identity = { firestore, storage, uid: UID, cartularyId: CARTULARY, binaryId: BINARY };
  const generated = await regeneratePresentationDerivatives(identity);
  assert.equal(generated.status, 'generated');
  assert.equal(generated.thumbnail, true);
  const manifest = await manifestOf(firestore);
  assert.deepEqual(manifest.presentationDerivative.variants.map((variant) => [variant.width, variant.height]), [[240, 360], [480, 720]]);
  assert.deepEqual([manifest.presentationDerivative.thumbnail.width, manifest.presentationDerivative.thumbnail.height], [160, 240]);
  assert.equal(manifestHasCurrentPresentationVariants(manifest), true, 'un portrait produit un manifeste complet (vignette valide)');
  assert.equal(assetPresentationMirror(manifest, { uid: UID, cartularyId: CARTULARY, binaryId: BINARY }).thumbnail.height, 240);
  assert.deepEqual([registryThumbnailFromManifest(manifest, { assetId: ASSET }).kind, registryThumbnailFromManifest(manifest, { assetId: ASSET }).height], ['inline', 240]);

  const journalBefore = journal.length;
  assert.equal((await regeneratePresentationDerivatives(identity)).status, 'already_current', 'second passage : rien à régénérer');
  assert.equal(journal.length, journalBefore, 'second passage : 0 écriture Storage');
  assert.deepEqual(await regenerateMissingPresentationVariants({ firestore, storage, limit: 10 }), { variantsRegenerated: 0, variantsFailed: 0, mirrored: 0 }, 'le backlog nocturne ne régénère pas un portrait déjà complet');

  const mirrored = await applyPresentationMirrors(identity);
  assert.equal(mirrored.status, 'mirrored');
  assert.equal(mirrored.itemThumbnail, true);
  const item = (await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).get()).data();
  assert.deepEqual([item.thumbnail.kind, item.thumbnail.assetId, item.thumbnail.width, item.thumbnail.height], ['inline', ASSET, 160, 240]);
  assert.equal(validRegistryThumbnail(item.thumbnail), true);
});

test('processPrivateDraftUpload : variantes d’abord (derivativeId = nom complet), presentation-v2 ensuite, manifeste en dernier, aucune clé de premier niveau ajoutée', async () => {
  const firestore = createMemoryFirestore();
  const { storage, blobs, journal } = createMemoryStorage();
  const original = await syntheticJpeg(1000, 700);
  const { digest, path } = await seedObject({ firestore, storage }, original);
  const before = Object.keys(await manifestOf(firestore)).sort();
  const setCalls = [];
  const realDoc = firestore.doc;
  firestore.doc = (documentPath) => {
    const ref = realDoc(documentPath);
    if (!documentPath.endsWith(`/binaries/${BINARY}`)) return ref;
    return { ...ref, set: async (data, options) => { setCalls.push({ journalLength: journal.length, status: data.verificationStatus }); return ref.set(data, options); } };
  };
  const [objectMetadata] = await storage.bucket().file(path).getMetadata();
  const result = await processPrivateDraftUpload({ firestore, storage, object: { name: path, bucket: 'cartularia-v3-test.appspot.com', size: original.length, contentType: 'image/jpeg', metadata: objectMetadata.metadata } });
  assert.equal(result.status, 'accepted');
  assert.equal(result.derivativeCreated, true);

  const expectedVariantPaths = [240, 480, 768].map((width) => presentationVariantPath(UID, CARTULARY, BINARY, width));
  assert.deepEqual(journal.slice(-4), [...expectedVariantPaths.map((variantPath) => `save:${variantPath}`), `save:private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`]);
  const finalSet = setCalls.at(-1);
  assert.equal(finalSet.status, 'accepted');
  assert.equal(finalSet.journalLength, journal.length, 'le manifeste est posé après la dernière écriture Storage');
  for (const variantPath of expectedVariantPaths) {
    const blob = blobs.get(variantPath);
    const metadata = blob.options.metadata;
    assert.equal(metadata.metadata.derivativeId, variantPath.split('/').at(-1));
    assert.equal(metadata.metadata.ownerUid, UID);
    assert.equal(metadata.metadata.binaryId, BINARY);
    assert.equal(metadata.metadata.metadataStripped, 'true');
    assert.equal(metadata.metadata.firebaseStorageDownloadTokens, '');
    assert.equal(metadata.metadata.sourceSha256, digest);
    assert.equal(metadata.cacheControl, 'private, no-store, max-age=0');
    assert.equal(metadata.contentType, 'image/webp');
    assert.equal(blob.options.resumable, false);
  }
  const manifest = await manifestOf(firestore);
  const knownKeys = [...before, 'capturedAtExtracted', 'capturedAtSource', 'derivativeStatus', 'detectedFormat', 'detectedMimeType', 'imageHeight', 'imageWidth', 'malwareScanStatus', 'mediaDecodeStatus', 'metadataPolicy', 'presentationDerivative', 'publicationEligible', 'updatedAt', 'verificationMessage', 'verificationReason', 'verificationStartedAt', 'verificationStatus', 'verificationVersion', 'verifiedAt', 'verifiedSize'];
  assert.deepEqual(Object.keys(manifest).sort(), [...new Set(knownKeys)].sort(), 'variantes et vignette restent imbriquées sous presentationDerivative (règle R4)');
  const derivative = manifest.presentationDerivative;
  assert.equal(derivative.storagePath, `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`);
  assert.equal(derivative.sha256, digestOf(blobs.get(derivative.storagePath).bytes));
  assert.equal(derivative.size, blobs.get(derivative.storagePath).bytes.length);
  assert.equal(derivative.variantsVersion, PRESENTATION_VARIANT_VERSION);
  assert.deepEqual(derivative.variants.map((variant) => variant.storagePath), expectedVariantPaths);
  for (const variant of derivative.variants) {
    assert.deepEqual(Object.keys(variant).sort(), ['height', 'mimeType', 'sha256', 'size', 'storagePath', 'width']);
    assert.equal(variant.sha256, digestOf(blobs.get(variant.storagePath).bytes));
    assert.equal(variant.size, blobs.get(variant.storagePath).bytes.length);
  }
  assert.deepEqual(Object.keys(derivative.thumbnail).sort(), ['dataUrl', 'height', 'sha256', 'width']);
  assert.equal(derivative.thumbnail.sha256, derivative.variants[0].sha256);
  assert.equal(derivative.thumbnail.dataUrl, `data:image/webp;base64,${blobs.get(expectedVariantPaths[0]).bytes.toString('base64')}`);
  assert.equal(manifestHasCurrentPresentationVariants(manifest), true);
  assert.equal(presentationVariantsFromManifest(manifest, { uid: UID, cartularyId: CARTULARY, binaryId: BINARY }).length, 3);
});

test('regeneratePresentationDerivatives : binaire accepté d’époque (sans version, sans dérivé) → variantes + v2, acceptation intacte, puis already_current', async () => {
  const firestore = createMemoryFirestore();
  const { storage, blobs, journal } = createMemoryStorage();
  const original = await syntheticJpeg(1400, 900);
  await seedObject({ firestore, storage }, original, { verificationVersion: null, clientUpdatedAt: 1_700_000_000_000 });
  const identity = { firestore, storage, uid: UID, cartularyId: CARTULARY, binaryId: BINARY };

  const planned = await regeneratePresentationDerivatives({ ...identity, dryRun: true });
  assert.equal(planned.status, 'planned');
  assert.equal(journal.length, 1, 'aucune écriture Storage en simulation');
  assert.equal((await manifestOf(firestore)).presentationDerivative, undefined);

  const generated = await regeneratePresentationDerivatives({ ...identity, now: () => '2026-09-14T10:00:00.000Z' });
  assert.equal(generated.status, 'generated');
  assert.equal(generated.primaryRewritten, true);
  assert.deepEqual(generated.variants, [240, 480, 768, 1200].map((width) => presentationVariantPath(UID, CARTULARY, BINARY, width)));
  const manifest = await manifestOf(firestore);
  assert.equal(manifest.verificationStatus, undefined, 'verificationStatus jamais posé par la régénération');
  assert.equal(manifest.uploadStatus, 'ready');
  assert.equal(manifest.verificationVersion, null, 'verificationVersion jamais touché');
  assert.equal(manifest.derivativeStatus, 'ready');
  assert.equal(manifest.publicationEligible, true);
  assert.equal(manifest.presentationDerivative.variantsGeneratedAt, '2026-09-14T10:00:00.000Z');
  assert.equal(manifest.presentationDerivative.storagePath, `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`);
  assert.equal(manifest.presentationDerivative.sha256, digestOf(blobs.get(manifest.presentationDerivative.storagePath).bytes));
  assert.equal(manifest.presentationDerivative.sourceSha256, manifest.sha256);
  assert.equal(blobs.get(manifest.presentationDerivative.storagePath).options.metadata.metadata.derivativeId, 'presentation-v2');
  assert.equal(manifest.presentationDerivative.variants.length, 4);
  assert.ok(manifest.presentationDerivative.thumbnail.dataUrl.startsWith('data:image/webp;base64,'));

  // Tour 4, point 1 : les miroirs suivent le même prédicat que le classement → un binaire accepté d'époque reçoit
  // assets.privatePresentation, items.thumbnail et thumbnailStatus 'ready' (le rattrapage Rolex pose bien la vignette).
  const mirrored = await applyPresentationMirrors({ firestore, uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
  assert.equal(mirrored.status, 'mirrored');
  assert.deepEqual(mirrored.assets, [ASSET]);
  assert.equal(mirrored.itemThumbnail, true);
  assert.equal(mirrored.thumbnailStatus, 'ready');
  const legacyAsset = (await firestore.doc(`cartularies/${CARTULARY}/assets/${ASSET}`).get()).data();
  assert.equal(legacyAsset.privatePresentation.binaryId, BINARY);
  assert.equal(legacyAsset.privatePresentation.variants.length, 4);
  const legacyItem = (await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).get()).data();
  assert.equal(legacyItem.thumbnail.kind, 'inline');
  assert.equal(legacyItem.thumbnail.assetId, ASSET);
  assert.equal(legacyItem.thumbnailStatus, 'ready');
  assert.equal(legacyItem.updatedAt, 'avant');
  assert.equal((await manifestOf(firestore)).verificationStatus, undefined, 'les miroirs ne promeuvent jamais le manifeste');

  const journalBefore = journal.length;
  const again = await regeneratePresentationDerivatives(identity);
  assert.equal(again.status, 'already_current');
  assert.equal(journal.length, journalBefore);
  const forced = await regeneratePresentationDerivatives({ ...identity, force: true });
  assert.equal(forced.status, 'generated');
  assert.equal(forced.primaryRewritten, false, 'presentation-v2 conforme au manifeste n’est pas réécrit');
});

test('regeneratePresentationDerivatives : accepté 1.1.0 avec presentation-v2 mais sans variantes → variantes ajoutées, champs v2 conservés', async () => {
  const firestore = createMemoryFirestore();
  const { storage, blobs } = createMemoryStorage();
  const original = await syntheticJpeg(900, 600);
  const v2 = await sharp(original).webp().toBuffer();
  const v2Path = `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`;
  await storage.bucket().file(v2Path).save(v2, { metadata: { metadata: { derivativeId: 'presentation-v2' } } });
  const { digest } = await seedObject({ firestore, storage }, original, {
    verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION, derivativeStatus: 'ready', publicationEligible: true,
    presentationDerivative: { storagePath: v2Path, mimeType: 'image/webp', width: 900, height: 600, processingMethod: 'image_reencoded_v1', sha256: digestOf(v2), size: v2.length, metadataStripped: true, sourceSha256: digestOf(original), verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION },
  });
  const result = await regeneratePresentationDerivatives({ firestore, storage, uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
  assert.equal(result.status, 'generated');
  assert.equal(result.primaryRewritten, false);
  const derivative = (await manifestOf(firestore)).presentationDerivative;
  assert.equal(derivative.sha256, digestOf(v2), 'contrat publication intact');
  assert.equal(derivative.size, v2.length);
  assert.equal(derivative.sourceSha256, digest);
  assert.equal(blobs.get(v2Path).bytes.equals(v2), true);
  assert.deepEqual(derivative.variants.map((variant) => variant.width), [240, 480, 768]);
  assert.equal((await manifestOf(firestore)).verificationStatus, 'accepted');
});

test('regeneratePresentationDerivatives : refus sans écriture (digest_mismatch, supprimé, rejeté, PDF, original absent) et échec sharp sans dégradation', async () => {
  const cases = [
    ['deleted', { deleted: true, verificationStatus: 'accepted' }, { status: 'skipped', reason: 'deleted' }],
    ['rejected', { verificationStatus: 'rejected', uploadStatus: 'failed' }, { status: 'skipped', reason: 'not_accepted' }],
    ['pending', { verificationStatus: 'processing', uploadStatus: 'verifying' }, { status: 'skipped', reason: 'not_accepted' }],
    ['pdf', { verificationStatus: 'accepted', fileName: 'dossier.pdf', mimeType: 'application/pdf', detectedFormat: 'pdf' }, { status: 'skipped', reason: 'not_image' }],
  ];
  for (const [label, overrides, expected] of cases) {
    const firestore = createMemoryFirestore();
    const { storage, journal } = createMemoryStorage();
    await seedObject({ firestore, storage }, await syntheticJpeg(400, 300), overrides);
    const result = await regeneratePresentationDerivatives({ firestore, storage, uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
    assert.equal(result.status, expected.status, label);
    assert.equal(result.reason, expected.reason, label);
    assert.equal(journal.length, 1, label);
  }
  {
    const firestore = createMemoryFirestore();
    const { storage, journal, blobs } = createMemoryStorage();
    const original = await syntheticJpeg(400, 300);
    const { path } = await seedObject({ firestore, storage }, original, { verificationStatus: 'accepted' });
    blobs.set(path, { bytes: await syntheticJpeg(400, 300, { background: '#112233' }), options: blobs.get(path).options });
    const result = await regeneratePresentationDerivatives({ firestore, storage, uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
    assert.equal(result.status, 'digest_mismatch');
    assert.equal(journal.length, 1);
    assert.equal((await manifestOf(firestore)).presentationDerivative, undefined);
  }
  {
    const firestore = createMemoryFirestore();
    const { storage, blobs } = createMemoryStorage();
    const original = await syntheticJpeg(400, 300);
    const { path } = await seedObject({ firestore, storage }, original, { verificationStatus: 'accepted' });
    blobs.delete(path);
    const result = await regeneratePresentationDerivatives({ firestore, storage, uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
    assert.equal(result.status, 'original_missing');
  }
  {
    const firestore = createMemoryFirestore();
    const { storage, journal } = createMemoryStorage();
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 7)]);
    await seedObject({ firestore, storage }, corrupt, { verificationStatus: 'accepted', detectedFormat: 'jpeg' });
    const result = await regeneratePresentationDerivatives({ firestore, storage, uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
    assert.equal(result.status, 'failed');
    assert.equal(journal.length, 1, 'aucune écriture Storage après échec sharp');
    const manifest = await manifestOf(firestore);
    assert.equal(manifest.verificationStatus, 'accepted');
    assert.equal(manifest.uploadStatus, 'ready');
    assert.equal(typeof manifest.presentationDerivative.variantsFailure, 'string');
    assert.equal(manifest.presentationDerivative.variantsVersion, null);
    assert.equal(manifestHasCurrentPresentationVariants(manifest), false);
  }
});

test('applyPresentationMirrors : assets.privatePresentation et items.thumbnail (inline) sur le chemin de l’objet, item par ailleurs inchangé', async () => {
  const firestore = createMemoryFirestore();
  const { storage } = createMemoryStorage();
  await seedObject({ firestore, storage }, await syntheticJpeg(800, 500), { verificationStatus: 'accepted' });
  const identity = { firestore, uid: UID, cartularyId: CARTULARY, binaryId: BINARY };
  const before = await applyPresentationMirrors(identity);
  assert.equal(before.status, 'skipped');
  assert.equal(before.reason, 'no_current_variants');
  await regeneratePresentationDerivatives({ ...identity, storage });
  const planned = await applyPresentationMirrors({ ...identity, dryRun: true });
  assert.equal(planned.status, 'planned');
  assert.equal((await firestore.doc(`cartularies/${CARTULARY}/assets/${ASSET}`).get()).data().privatePresentation, undefined);
  const mirrored = await applyPresentationMirrors(identity);
  assert.equal(mirrored.status, 'mirrored');
  assert.deepEqual(mirrored.assets, [ASSET]);
  assert.equal(mirrored.itemThumbnail, true);
  assert.equal(mirrored.thumbnailStatus, 'ready');
  assert.equal(mirrored.writes, 2, 'une écriture item, une écriture asset');
  const asset = (await firestore.doc(`cartularies/${CARTULARY}/assets/${ASSET}`).get()).data();
  assert.equal(asset.displayName, 'Photo', 'les autres champs de l’asset sont conservés');
  assert.equal(asset.privatePresentation.binaryId, BINARY);
  assert.equal(asset.privatePresentation.version, PRESENTATION_VARIANT_VERSION);
  assert.deepEqual(Object.keys(asset.privatePresentation).sort(), ['binaryId', 'thumbnail', 'variants', 'version']);
  assert.equal(asset.privatePresentation.variants.length, 3);
  assert.equal((await firestore.doc(`cartularies/${CARTULARY}/assets/asset_v3_other`).get()).data().privatePresentation, undefined);
  const item = (await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).get()).data();
  assert.equal(item.updatedAt, 'avant');
  assert.equal(item.revision, 4);
  assert.equal(item.contentHash, 'sha256:item');
  assert.equal(item.thumbnail.kind, 'inline');
  assert.equal(item.thumbnail.assetId, ASSET);
  assert.equal(item.thumbnail.sha256, asset.privatePresentation.thumbnail.sha256);
  assert.deepEqual(Object.keys(item.thumbnail).sort(), ['assetId', 'dataUrl', 'height', 'kind', 'sha256', 'width']);
  assert.equal(validRegistryThumbnail(item.thumbnail), true);
  assert.equal(item.thumbnailStatus, 'ready');

  // Idempotence stricte (tour 4, point 6) : contenu identique → aucune écriture Firestore au second passage.
  const dumpBefore = firestore.dump();
  const again = await applyPresentationMirrors(identity);
  assert.equal(again.status, 'mirrored');
  assert.equal(again.writes, 0);
  assert.deepEqual(firestore.dump(), dumpBefore);

  await firestore.doc(`cartularies/${CARTULARY}`).set({ accountHolderId: 'someone_else' }, { merge: true });
  const refused = await applyPresentationMirrors(identity);
  assert.equal(refused.status, 'skipped');
  assert.equal(refused.reason, 'owner_mismatch');
});

test('applyPresentationMirrors : échec définitif consigné → thumbnailStatus « failed » sur l’item, sans vignette ni miroir, idempotent (K3 étendu, décision (d))', async () => {
  const firestore = createMemoryFirestore();
  const { storage } = createMemoryStorage();
  await seedObject({ firestore, storage }, await syntheticJpeg(300, 200), {
    verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
    presentationDerivative: { variantsVersion: null, variants: [], thumbnail: null, variantsFailure: 'invalid_dimensions', variantsGeneratedAt: '2026-09-15T00:00:00.000Z' },
  });
  const identity = { firestore, uid: UID, cartularyId: CARTULARY, binaryId: BINARY };
  const recorded = await applyPresentationMirrors(identity);
  assert.equal(recorded.status, 'failure_recorded');
  assert.equal(recorded.thumbnailStatus, 'failed');
  assert.equal(recorded.itemThumbnail, false);
  assert.deepEqual(recorded.assets, []);
  assert.equal(recorded.writes, 1);
  const item = (await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).get()).data();
  assert.equal(item.thumbnailStatus, 'failed');
  assert.equal(item.thumbnail, undefined, 'aucune vignette inventée');
  assert.equal(item.updatedAt, 'avant');
  assert.equal((await firestore.doc(`cartularies/${CARTULARY}/assets/${ASSET}`).get()).data().privatePresentation, undefined);
  const again = await applyPresentationMirrors(identity);
  assert.equal(again.writes, 0);
  // Original rejeté par la vérification : même état honnête.
  await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${BINARY}`).set({ verificationStatus: 'rejected', uploadStatus: 'failed', presentationDerivative: null }, { merge: true });
  await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).set({ thumbnailStatus: 'pending' }, { merge: true });
  const rejected = await applyPresentationMirrors(identity);
  assert.equal(rejected.status, 'failure_recorded');
  assert.equal((await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).get()).data().thumbnailStatus, 'failed');
});

test('backlog : la seconde passe régénère les binaires acceptés sans variantes, sans re-vérifier ni dégrader, dans la limite', async () => {
  const firestore = createMemoryFirestore();
  const { storage, journal } = createMemoryStorage();
  await seedObject({ firestore, storage }, await syntheticJpeg(700, 400), { verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION });
  const otherDigest = digestOf(Buffer.from('other'));
  const otherPath = `private-drafts/${UID}/${CARTULARY}/bin_v3_second/${otherDigest.replace('sha256:', '')}/original`;
  const second = await syntheticJpeg(500, 300, { background: '#224466' });
  await storage.bucket().file(otherPath.replace(otherDigest.replace('sha256:', ''), digestOf(second).replace('sha256:', ''))).save(second, { metadata: { contentType: 'image/jpeg', metadata: {} } });
  await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_v3_second`).set({
    ownerUid: UID, cartularyId: CARTULARY, binaryId: 'bin_v3_second', kind: 'media', fileName: 'second.jpg', mimeType: 'image/jpeg', size: second.length, sha256: digestOf(second),
    storagePath: otherPath.replace(otherDigest.replace('sha256:', ''), digestOf(second).replace('sha256:', '')), deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
  });
  const first = await regenerateMissingPresentationVariants({ firestore, storage, limit: 1 });
  assert.deepEqual(first, { variantsRegenerated: 1, variantsFailed: 0, mirrored: 1 });
  const statuses = [BINARY, 'bin_v3_second'].map(async (binaryId) => (await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${binaryId}`).get()).data());
  const [manifestA, manifestB] = await Promise.all(statuses);
  assert.equal([manifestA, manifestB].filter((manifest) => manifestHasCurrentPresentationVariants(manifest)).length, 1);
  assert.ok([manifestA, manifestB].every((manifest) => manifest.verificationStatus === 'accepted' && manifest.uploadStatus === 'ready'));
  assert.equal((await firestore.doc(`cartularies/${CARTULARY}/assets/${ASSET}`).get()).data().privatePresentation?.binaryId, BINARY);

  const journalBefore = journal.length;
  const whole = await processPrivateDraftUploadBacklog({ firestore, storage, limit: 10 });
  assert.equal(whole.inspected, 0, 'un binaire déjà en 1.1.0 n’est jamais re-vérifié');
  assert.equal(whole.variantsRegenerated, 1);
  assert.ok(journal.length > journalBefore);
  assert.deepEqual(await regenerateMissingPresentationVariants({ firestore, storage, limit: 10 }), { variantsRegenerated: 0, variantsFailed: 0, mirrored: 0 });
});

test('backlog, première passe (G5 tranché, tour 4 point 8) : un binaire accepté en 1.0.0 ou rejeté n’est jamais repassé par processPrivateDraftUpload ; seuls les jamais vérifiés le sont', async () => {
  const firestore = createMemoryFirestore();
  const { storage, bucket } = createMemoryStorage();
  // A : accepté sous private-upload@1.0.0, sans variantes (parc Rolex) — seconde passe seulement.
  const accepted = await syntheticJpeg(600, 400);
  await seedObject({ firestore, storage }, accepted, { verificationStatus: 'accepted', verificationVersion: 'private-upload@1.0.0', derivativeStatus: 'ready' });
  const seedOther = async (binaryId, bytes, manifest) => {
    const digest = digestOf(bytes);
    const path = `private-drafts/${UID}/${CARTULARY}/${binaryId}/${digest.replace('sha256:', '')}/original`;
    await bucket.file(path).save(bytes, { metadata: { contentType: 'image/jpeg', metadata: { ownerUid: UID, cartularyId: CARTULARY, binaryId, sha256: digest, kind: 'media', originalFileName: `${binaryId}.jpg` } } });
    await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${binaryId}`).set({
      ownerUid: UID, cartularyId: CARTULARY, binaryId, kind: 'media', fileName: `${binaryId}.jpg`, mimeType: 'image/jpeg', size: bytes.length, sha256: digest, storagePath: path,
      deleted: false, revision: 1, clientUpdatedAt: Date.now(), ...manifest,
    });
  };
  // B : rejeté sous 1.0.0 — jamais repassé (ni réhabilité ni re-dégradé).
  await seedOther('bin_v3_rejected_old', await syntheticJpeg(320, 200, { background: '#331100' }), { uploadStatus: 'failed', verificationStatus: 'rejected', verificationVersion: 'private-upload@1.0.0', verificationReason: 'inspection_failed' });
  // C : jamais vérifié (transfert terminé, aucune vérification) — première passe.
  await seedOther('bin_v3_never', await syntheticJpeg(400, 300, { background: '#003311' }), { uploadStatus: 'ready', verificationStatus: null, verificationVersion: null });
  const verifying = [];
  const realDoc = firestore.doc;
  firestore.doc = (documentPath) => {
    const ref = realDoc(documentPath);
    if (!documentPath.includes('/binaries/')) return ref;
    return { ...ref, set: async (data, options) => { if (data.verificationStatus === 'processing') verifying.push(documentPath.split('/').at(-1)); return ref.set(data, options); } };
  };
  const result = await processPrivateDraftUploadBacklog({ firestore, storage, limit: 10 });
  firestore.doc = realDoc;
  assert.equal(result.inspected, 1, 'seul le binaire jamais vérifié passe par la première passe');
  assert.equal(result.accepted, 1);
  assert.deepEqual(verifying, ['bin_v3_never'], 'A (accepté 1.0.0) et B (rejeté) ne passent jamais par « verifying »');
  const manifestA = await manifestOf(firestore);
  assert.equal(manifestA.verificationStatus, 'accepted');
  assert.equal(manifestA.verificationVersion, 'private-upload@1.0.0', 'version jamais touchée : ni re-vérification ni dégradation');
  assert.equal(manifestHasCurrentPresentationVariants(manifestA), true, 'la seconde passe a produit ses variantes');
  const manifestB = (await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_v3_rejected_old`).get()).data();
  assert.equal(manifestB.verificationStatus, 'rejected');
  assert.equal(manifestB.verificationVersion, 'private-upload@1.0.0');
  const manifestC = (await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_v3_never`).get()).data();
  assert.equal(manifestC.verificationStatus, 'accepted');
  assert.equal(manifestC.verificationVersion, PRIVATE_UPLOAD_VERIFICATION_VERSION);
  assert.equal(result.variantsRegenerated, 1, 'A seulement : C a reçu ses variantes à la vérification');
  assert.deepEqual(await processPrivateDraftUploadBacklog({ firestore, storage, limit: 10 }), { inspected: 0, accepted: 0, rejected: 0, variantsRegenerated: 0, variantsFailed: 0, mirrored: 0 });
});

test('fonctions pures : chemins v3 seulement, miroirs et vignettes valides, v2 jamais admis côté client', () => {
  assert.equal(validPresentationVariantPath(presentationVariantPath('u', 'c', 'b', 480), 'u', 'c', 'b'), true);
  assert.equal(validPresentationVariantPath('private-derivatives/u/c/b/presentation-v2.webp', 'u', 'c', 'b'), false);
  assert.equal(validPresentationVariantPath('private-derivatives/u/c/other/presentation-v3-480.webp', 'u', 'c', 'b'), false);
  assert.equal(validPresentationVariantPath('private-derivatives/u/c/b/presentation-v3-999.webp', 'u', 'c', 'b'), false);
  const thumbnail = { dataUrl: 'data:image/webp;base64,UklGRg==', width: 240, height: 160, sha256: `sha256:${'a'.repeat(64)}` };
  const variants = [{ width: 240, height: 160, storagePath: presentationVariantPath('u', 'c', 'b', 240), sha256: `sha256:${'b'.repeat(64)}`, size: 1200, mimeType: 'image/webp' }];
  const manifest = { binaryId: 'b', deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', presentationDerivative: { storagePath: 'private-derivatives/u/c/b/presentation-v2.webp', variantsVersion: 'presentation-v3', variants, thumbnail } };
  assert.deepEqual(assetPresentationMirror(manifest, { uid: 'u', cartularyId: 'c', binaryId: 'b' }), { binaryId: 'b', version: 'presentation-v3', variants, thumbnail });
  assert.equal(assetPresentationMirror({ ...manifest, verificationStatus: 'rejected' }), null);
  assert.equal(assetPresentationMirror({ ...manifest, deleted: true }), null);
  // Tour 4, point 1 : un seul prédicat « binaire vérifié » (privateBinaryIsVerified) pour le rattrapage ET les miroirs :
  // accepté d'époque (aucune version, prêt, antérieur au seuil) → miroir et vignette d'item ; transfert inachevé → rien.
  const legacy = { ...manifest, verificationStatus: undefined, verificationVersion: null, clientUpdatedAt: PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS - 1 };
  assert.equal(privateBinaryIsVerified(legacy), true);
  assert.deepEqual(assetPresentationMirror(legacy, { uid: 'u', cartularyId: 'c', binaryId: 'b' }), { binaryId: 'b', version: 'presentation-v3', variants, thumbnail });
  assert.deepEqual(registryThumbnailFromManifest(legacy, { assetId: 'a1' }), { kind: 'inline', ...thumbnail, assetId: 'a1' });
  assert.equal(assetPresentationMirror({ ...legacy, clientUpdatedAt: PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS + 1 }), null, 'sans version et postérieur au seuil : jamais vérifié');
  assert.equal(assetPresentationMirror({ ...manifest, uploadStatus: 'verifying' }), null, 'transfert inachevé : même prédicat que le rattrapage');
  assert.equal(registryThumbnailFromManifest({ ...manifest, uploadStatus: 'verifying' }, { assetId: 'a1' }), null);
  assert.equal(binaryPresentationFailed({ ...manifest, presentationDerivative: { variantsFailure: 'invalid_dimensions', variants: [] } }), true);
  assert.equal(binaryPresentationFailed({ ...manifest, verificationStatus: 'rejected', uploadStatus: 'failed' }), true);
  assert.equal(binaryPresentationFailed(manifest), false);
  assert.equal(binaryPresentationFailed(null), false);
  assert.equal(assetPresentationMirror(manifest, { uid: 'someone', cartularyId: 'c', binaryId: 'b' }), null, 'variantes d’un autre propriétaire ignorées');
  assert.equal(assetPresentationMirror({ ...manifest, presentationDerivative: { storagePath: 'x' } }), null);
  assert.deepEqual(registryThumbnailFromManifest(manifest, { assetId: 'a1' }), { kind: 'inline', ...thumbnail, assetId: 'a1' });
  assert.equal(registryThumbnailFromManifest(manifest, { assetId: '' }), null);
  assert.deepEqual(registryThumbnailFromAsset({ privatePresentation: assetPresentationMirror(manifest) }, 'a1'), { kind: 'inline', ...thumbnail, assetId: 'a1' });
  assert.equal(registryThumbnailFromAsset({ presentationDerivative: { url: '/assets/x.jpg' } }, 'a1'), null);
  const bundle = registryThumbnailFromBundle({ path: '/assets/IWC/derivatives/Focus Shift White Front.240.webp', width: 240, height: 160, assetId: 'a1', sha256: `sha256:${'c'.repeat(64)}` });
  assert.equal(bundle.kind, 'bundle');
  assert.equal(validRegistryThumbnail(bundle), true);
  assert.equal(registryThumbnailFromBundle({ path: '/assets/IWC/derivatives/x.480.webp', width: 480, height: 320, assetId: 'a1', sha256: `sha256:${'c'.repeat(64)}` }), null);
  assert.equal(registryThumbnailFromBundle({ path: 'https://evil.example/x.webp', width: 240, height: 160, assetId: 'a1', sha256: `sha256:${'c'.repeat(64)}` }), null);
  assert.equal(validRegistryThumbnail({ kind: 'inline', dataUrl: 'data:image/png;base64,AAAA', width: 240, height: 160, assetId: 'a1', sha256: `sha256:${'a'.repeat(64)}` }), false);
  assert.equal(validRegistryThumbnail({ kind: 'inline', ...thumbnail, dataUrl: `data:image/webp;base64,${'A'.repeat(INLINE_THUMBNAIL_MAXIMUM_CHARACTERS)}`, assetId: 'a1' }), false);
});

test('tour 5 point 1 (G5) : binaire accepté d’époque (aucun verificationStatus, version null, antérieur au seuil) jamais repassé par la première passe', async () => {
  // Cas « null » du parc Rolex : la garde de backlogNeedsVerification passe par privateBinaryIsVerified ; sans elle,
  // processPrivateDraftUpload (aucune garde interne) reposerait 'verifying' puis pourrait rejeter → dégradation.
  const firestore = createMemoryFirestore();
  const { storage } = createMemoryStorage();
  await seedObject({ firestore, storage }, await syntheticJpeg(600, 400), { verificationStatus: undefined, verificationVersion: null, clientUpdatedAt: PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS - 1 });
  assert.equal(privateBinaryIsVerified(await manifestOf(firestore)), true);
  const result = await processPrivateDraftUploadBacklog({ firestore, storage, limit: 10 });
  assert.equal(result.inspected, 0, 'accepté d’époque : jamais re-vérifié');
  const manifest = await manifestOf(firestore);
  assert.equal(manifest.verificationStatus, undefined, 'jamais re-vérifié ni dégradé');
  assert.equal(manifest.verificationVersion, null);
  assert.equal(manifest.uploadStatus, 'ready');
  assert.equal(result.variantsRegenerated, 1, 'la seconde passe produit ses variantes');
});

test('tour 5 point 3 (K7) : seconde passe du backlog, sharp refuse l’original → thumbnailStatus failed sur l’item, jamais « en préparation » perpétuel', async () => {
  const firestore = createMemoryFirestore();
  const { storage } = createMemoryStorage();
  const corrupt = Buffer.from('pas une image');
  await seedObject({ firestore, storage }, corrupt, { verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION });
  const result = await regenerateMissingPresentationVariants({ firestore, storage, limit: 10 });
  assert.deepEqual(result, { variantsRegenerated: 0, variantsFailed: 1, mirrored: 0 });
  const manifest = await manifestOf(firestore);
  assert.ok(manifest.presentationDerivative.variantsFailure);
  assert.equal(manifest.verificationStatus, 'accepted', 'aucune dégradation de la vérification');
  const item = (await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).get()).data();
  assert.equal(item.thumbnailStatus, 'failed', 'l’échec nocturne est consigné sur l’item sans attendre la prochaine modification');
  assert.equal(item.thumbnail ?? null, null);
});

// ---------------------------------------------------------------------------------------------------------------------
// Tour 5 — couverture relevée par les relecteurs (mutants M8f/M8d, MK7d, M2s).
// ---------------------------------------------------------------------------------------------------------------------

test('tour 5 M8f/M8d : première passe bornée à PRIVATE_UPLOAD_BACKLOG_LIMIT = 10 manifestes jamais vérifiés par nuit', async () => {
  assert.equal(PRIVATE_UPLOAD_BACKLOG_LIMIT, 10);
  const firestore = createMemoryFirestore();
  const { storage, bucket } = createMemoryStorage();
  await seedObject({ firestore, storage }, await syntheticJpeg(300, 200), { verificationStatus: null, verificationVersion: null, clientUpdatedAt: Date.now() });
  for (let index = 0; index < 11; index += 1) {
    const binaryId = `bin_v3_never_${String(index).padStart(2, '0')}`;
    const bytes = await syntheticJpeg(300, 200, { background: `#${(0x100000 + index * 0x0f0f0f).toString(16).slice(0, 6)}` });
    const digest = digestOf(bytes);
    const path = `private-drafts/${UID}/${CARTULARY}/${binaryId}/${digest.replace('sha256:', '')}/original`;
    await bucket.file(path).save(bytes, { metadata: { contentType: 'image/jpeg', metadata: { ownerUid: UID, cartularyId: CARTULARY, binaryId, sha256: digest, kind: 'media', originalFileName: `${binaryId}.jpg` } } });
    await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${binaryId}`).set({
      ownerUid: UID, cartularyId: CARTULARY, binaryId, kind: 'media', fileName: `${binaryId}.jpg`, mimeType: 'image/jpeg', size: bytes.length, sha256: digest, storagePath: path,
      deleted: false, revision: 1, clientUpdatedAt: Date.now(), uploadStatus: 'ready', verificationStatus: null, verificationVersion: null,
    });
  }
  const first = await processPrivateDraftUploadBacklog({ firestore, storage });
  assert.equal(first.inspected, 10, '12 jamais vérifiés : 10 au plus par passe (limite par défaut)');
  const second = await processPrivateDraftUploadBacklog({ firestore, storage });
  assert.equal(second.inspected, 2);
});

test('tour 5 MK7d : la seconde passe ne reprend jamais un binaire portant variantsFailure (original pourtant valide) — aucune écriture Firestore ni Storage', async () => {
  const firestore = createMemoryFirestore();
  const { storage, journal } = createMemoryStorage();
  await seedObject({ firestore, storage }, await syntheticJpeg(600, 400), {
    verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
    presentationDerivative: { variantsVersion: null, variants: [], thumbnail: null, variantsFailure: 'variants_processing_failed', variantsGeneratedAt: '2026-09-14T00:00:00.000Z' },
  });
  const before = firestore.dump();
  const journalBefore = journal.length;
  const result = await regenerateMissingPresentationVariants({ firestore, storage, limit: 10 });
  assert.deepEqual(result, { variantsRegenerated: 0, variantsFailed: 0, mirrored: 0 });
  assert.deepEqual(firestore.dump(), before, 'aucune écriture Firestore (pas de retentative nocturne, § 2.6)');
  assert.equal(journal.length, journalBefore);
});

test('tour 5 M2s : échec consigné sur le binaire mais vignette bundle valide sur l’item (IWC après P4) → thumbnailStatus reste « ready », aucune écriture', async () => {
  const firestore = createMemoryFirestore();
  const { storage } = createMemoryStorage();
  await seedObject({ firestore, storage }, await syntheticJpeg(600, 400), {
    verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
    presentationDerivative: { variantsVersion: null, variants: [], thumbnail: null, variantsFailure: 'variants_processing_failed', variantsGeneratedAt: '2026-09-14T00:00:00.000Z' },
  });
  const bundle = { kind: 'bundle', path: '/assets/IWC/derivatives/Focus%20Shift%20White%20Front.240.webp', width: 240, height: 160, assetId: ASSET, sha256: digestOf(Buffer.from('bundle')) };
  await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).set({ thumbnail: bundle, thumbnailStatus: 'ready' }, { merge: true });
  const result = await applyPresentationMirrors({ firestore, uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
  assert.equal(result.status, 'failure_recorded');
  assert.equal(result.thumbnailStatus, 'ready', 'une vignette bundle valide sur l’asset primaire prime sur l’échec du binaire');
  assert.equal(result.writes, 0);
  const item = (await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).get()).data();
  assert.deepEqual(item.thumbnail, bundle);
  assert.equal(item.thumbnailStatus, 'ready');
});
