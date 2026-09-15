import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import {
  PRESENTATION_REGENERATION_USAGE,
  PresentationRegenerationError,
  applyPresentationRegeneration,
  bundleFileSystemPath,
  describeBundleThumbnail,
  isRegenerableCartularyId,
  parsePresentationRegenerationArgs,
  planPresentationRegeneration,
  runPresentationRegenerationCli,
} from '../scripts/lib/presentation-regeneration-command.mjs';
import { PRIVATE_UPLOAD_VERIFICATION_VERSION } from '../scripts/lib/private-upload-command.mjs';
import { presentationVariantPath, validRegistryThumbnail } from '../scripts/lib/presentation-variants.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const UID = 'owner_v3_regeneration';
const OTHER_UID = 'owner_v3_stranger';
const CARTULARY = 'cart_v3_regeneration_object_0a1b';
const REGISTRY = 'reg_v3_regeneration';
const ORGANIZATION = 'org_v3_regeneration';
const REMOTE_ENV = { GCLOUD_PROJECT: 'cartularia-prod-simule' };
const EMULATOR_ENV = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };

const createMemoryStorage = () => {
  const blobs = new Map();
  const journal = [];
  const bucket = {
    file: (path) => ({
      name: path,
      save: async (bytes, options) => { blobs.set(path, { bytes: Buffer.from(bytes), options }); journal.push(`save:${path}`); },
      download: async (options) => {
        if (!blobs.has(path)) throw Object.assign(new Error(`No such object: ${path}`), { code: 404 });
        if (options?.destination) { await writeFile(options.destination, blobs.get(path).bytes); return []; }
        return [blobs.get(path).bytes];
      },
      exists: async () => [blobs.has(path)],
    }),
    getFiles: async ({ prefix }) => [[...blobs.keys()].filter((name) => name.startsWith(prefix)).sort().map((name) => bucket.file(name))],
  };
  return { blobs, journal, storage: { bucket: () => bucket } };
};

const image = (width, height, background = '#5a4a3a') => sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();

/** Objet de recette : trois binaires image (un sans dérivé, un déjà courant, un rejeté), un PDF, deux assets, un item. */
const seed = async () => {
  const firestore = createMemoryFirestore();
  const memory = createMemoryStorage();
  const bucket = memory.storage.bucket();
  const binaries = {};
  const addBinary = async (binaryId, bytes, overrides = {}) => {
    const digest = digestOf(bytes);
    const storagePath = `private-drafts/${UID}/${CARTULARY}/${binaryId}/${digest.replace('sha256:', '')}/original`;
    await bucket.file(storagePath).save(bytes, { metadata: { contentType: 'image/jpeg', metadata: { ownerUid: UID, cartularyId: CARTULARY, binaryId, sha256: digest, kind: 'media' } } });
    await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${binaryId}`).set({
      ownerUid: UID, cartularyId: CARTULARY, binaryId, kind: 'media', fileName: `${binaryId}.jpg`, mimeType: 'image/jpeg', size: bytes.length, sha256: digest, storagePath,
      deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION, ...overrides,
    });
    binaries[binaryId] = { digest, storagePath };
  };
  await addBinary('bin_missing', await image(900, 600));
  const current = await image(640, 400, '#123456');
  await addBinary('bin_current', current);
  const currentVariantPath = presentationVariantPath(UID, CARTULARY, 'bin_current', 240);
  const currentVariant = await sharp(current).resize({ width: 240 }).webp().toBuffer();
  await bucket.file(currentVariantPath).save(currentVariant, { metadata: { metadata: { derivativeId: 'presentation-v3-240.webp' } } });
  await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_current`).set({
    presentationDerivative: {
      storagePath: `private-derivatives/${UID}/${CARTULARY}/bin_current/presentation-v2.webp`, mimeType: 'image/webp', sourceSha256: binaries.bin_current.digest,
      variantsVersion: 'presentation-v3',
      variants: [{ width: 240, height: 150, storagePath: currentVariantPath, sha256: digestOf(currentVariant), size: currentVariant.length, mimeType: 'image/webp' }],
      thumbnail: { dataUrl: `data:image/webp;base64,${currentVariant.toString('base64')}`, width: 240, height: 150, sha256: digestOf(currentVariant) },
    },
  }, { merge: true });
  await addBinary('bin_rejected', await image(300, 200), { verificationStatus: 'rejected', uploadStatus: 'failed' });
  await addBinary('bin_pdf', Buffer.from('%PDF-1.7 fixture %%EOF'), { fileName: 'dossier.pdf', mimeType: 'application/pdf', detectedFormat: 'pdf' });
  await firestore.doc(`cartularies/${CARTULARY}`).set({ id: CARTULARY, accountHolderId: UID, registryId: REGISTRY, organizationId: ORGANIZATION, revision: 7 });
  await firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}`).set({ ownerUid: UID, status: 'active' });
  await firestore.doc(`cartularies/${CARTULARY}/assets/asset_missing`).set({ id: 'asset_missing', binaryId: 'bin_missing', mediaKind: 'image', displayName: 'Photo principale' });
  await firestore.doc(`cartularies/${CARTULARY}/assets/asset_current`).set({ id: 'asset_current', binaryId: 'bin_current', mediaKind: 'image', displayName: 'Photo secondaire' });
  await firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).set({ cartularyId: CARTULARY, registryId: REGISTRY, primaryAssetId: 'asset_missing', contentHash: 'sha256:item', revision: 7, updatedAt: 'avant' });
  await firestore.doc(`cartularies/cart_v3_untouched`).set({ id: 'cart_v3_untouched', accountHolderId: UID, registryId: REGISTRY });
  return { firestore, ...memory, binaries };
};

test('arguments : cartulary obligatoire et conforme, cart_demo_* refusé, options validées', () => {
  assert.equal(parsePresentationRegenerationArgs([], REMOTE_ENV).code, 'cartulary_required');
  assert.equal(parsePresentationRegenerationArgs(['--cartulary', 'Cart-Invalide'], REMOTE_ENV).code, 'invalid_cartulary_id');
  assert.equal(parsePresentationRegenerationArgs(['--cartulary', 'cart_demo_rolex_submariner_124060'], REMOTE_ENV).code, 'demo_cartulary_refused');
  assert.equal(parsePresentationRegenerationArgs(['--cartulary', CARTULARY, '--limit', '0'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parsePresentationRegenerationArgs(['--cartulary', CARTULARY, '--bundle-thumbnail', 'https://x/y.webp'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parsePresentationRegenerationArgs(['--cartulary', CARTULARY, '--bundle-asset', 'a'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parsePresentationRegenerationArgs(['--cartulary', CARTULARY, '--inconnu'], REMOTE_ENV).code, 'invalid_argument');
  const parsed = parsePresentationRegenerationArgs(['--cartulary', CARTULARY, '--expect-owner', UID, '--binary', 'b1', '--binary=b2', '--limit=3', '--force', '--allow-remote', '--execute'], REMOTE_ENV);
  assert.equal(parsed.ok, true);
  assert.deepEqual({ ...parsed.options }, { help: false, cartularyId: CARTULARY, expectedOwner: UID, allowRemote: true, execute: true, force: true, limit: 3, binaryIds: ['b1', 'b2'], bundleThumbnailPath: null, bundleAssetId: null, projectId: 'cartularia-prod-simule', usesEmulator: false });
  assert.equal(parsePresentationRegenerationArgs(['--cartulary', CARTULARY], EMULATOR_ENV).options.usesEmulator, true);
  assert.equal(isRegenerableCartularyId('cart_demo_x'), false);
  assert.equal(isRegenerableCartularyId('cart_iwc_flieger_utc_2002'), true);
  assert.match(PRESENTATION_REGENERATION_USAGE, /--bundle-thumbnail/);
});

test('plan (lecture seule) : classement des binaires, table binaire → assets, vignette d’item prévue, aucune écriture', async () => {
  const env = await seed();
  const journalBefore = env.journal.length;
  const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, expectedOwner: UID });
  assert.equal(plan.ok, true);
  assert.equal(plan.ownerUid, UID);
  assert.equal(plan.registryId, REGISTRY);
  assert.equal(plan.primaryAssetId, 'asset_missing');
  assert.equal(plan.existingThumbnailKind, null);
  assert.deepEqual(Object.fromEntries(plan.binaries.map((binary) => [binary.binaryId, [binary.status, binary.reason ?? null, binary.assetIds]])), {
    bin_missing: ['to_generate', null, ['asset_missing']],
    bin_current: ['already_current', null, ['asset_current']],
    bin_rejected: ['skipped', 'not_accepted', []],
    bin_pdf: ['skipped', 'not_image', []],
  });
  assert.deepEqual(plan.counts, { to_generate: 1, already_current: 1, skipped: 2 });
  assert.deepEqual(plan.toGenerate, ['bin_missing']);
  assert.equal(plan.plannedItemThumbnail, 'inline');
  assert.equal(env.journal.length, journalBefore);
  assert.equal(env.firestore.dump()[`cartularies/${CARTULARY}/assets/asset_missing`].privatePresentation, undefined);
  const restricted = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_current', 'bin_absent'], force: true });
  assert.deepEqual(restricted.binaries.map((binary) => [binary.binaryId, binary.status]), [['bin_current', 'to_generate'], ['bin_absent', 'skipped']]);
  await assert.rejects(planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, expectedOwner: OTHER_UID }), { code: 'owner_mismatch' });
  await assert.rejects(planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: 'cart_v3_absent' }), { code: 'root_missing' });
  await assert.rejects(planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: 'cart_demo_rolex_submariner_124060' }), { code: 'demo_cartulary_refused' });
  await env.firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}`).set({ status: 'inactive' });
  const inactive = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY });
  assert.ok(inactive.warnings.some((warning) => warning.startsWith('private_draft_not_active')));
});

test('exécution : variantes + inline + miroirs pour l’objet seulement, item inchangé hors thumbnail, rejeu already_current', async () => {
  const env = await seed();
  const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY });
  const applied = await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.summary, { generated: 1, failed: 0, alreadyCurrent: 0, skipped: 0, mirrored: 2, assetsMirrored: 2, itemThumbnail: 'inline', firestoreWrites: 3 });
  assert.deepEqual(applied.results.map((result) => [result.binaryId, result.status, result.variants.length]), [['bin_missing', 'generated', 3]]);
  const dump = env.firestore.dump();
  const manifest = dump[`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_missing`];
  assert.equal(manifest.verificationStatus, 'accepted');
  assert.equal(manifest.verificationVersion, PRIVATE_UPLOAD_VERIFICATION_VERSION);
  assert.equal(manifest.presentationDerivative.variantsVersion, 'presentation-v3');
  assert.equal(dump[`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_rejected`].verificationStatus, 'rejected', 'jamais promu');
  assert.equal(dump[`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_rejected`].presentationDerivative, undefined);
  assert.equal(dump[`cartularies/${CARTULARY}/assets/asset_missing`].privatePresentation.binaryId, 'bin_missing');
  assert.equal(dump[`cartularies/${CARTULARY}/assets/asset_current`].privatePresentation.binaryId, 'bin_current', 'un binaire déjà courant est aussi miroité');
  const item = dump[`registries/${REGISTRY}/items/${CARTULARY}`];
  assert.equal(item.thumbnail.kind, 'inline');
  assert.equal(item.thumbnail.assetId, 'asset_missing');
  assert.equal(validRegistryThumbnail(item.thumbnail), true);
  assert.equal(item.thumbnailStatus, 'ready');
  assert.equal(item.updatedAt, 'avant');
  assert.equal(item.revision, 7);
  assert.equal(item.contentHash, 'sha256:item');
  assert.equal(dump['cartularies/cart_v3_untouched'].thumbnail, undefined);
  const writtenPaths = env.journal.filter((entry) => entry.startsWith('save:')).map((entry) => entry.slice(5));
  assert.ok(writtenPaths.every((path) => path.startsWith(`private-drafts/${UID}/${CARTULARY}/`) || path.startsWith(`private-derivatives/${UID}/${CARTULARY}/`)), 'écritures Storage limitées au chemin de l’objet');
  const replay = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY });
  assert.deepEqual(replay.counts, { already_current: 2, skipped: 2 });
  assert.equal(replay.existingThumbnailKind, 'inline');
  // Idempotence stricte (tour 4, point 6) : second passage identique → 0 écriture Firestore, 0 écriture Storage.
  const writes = countWrites(env.firestore);
  const journalBefore = env.journal.length;
  const again = await applyPresentationRegeneration({ firestore: writes.firestore, storage: env.storage, plan: replay });
  assert.equal(again.summary.firestoreWrites, 0);
  assert.equal(writes.count(), 0, 'aucun set/update/create Firestore au second passage');
  assert.equal(env.journal.length, journalBefore, 'aucune écriture Storage au second passage');
  assert.deepEqual(env.firestore.dump(), dump);
});

/** Firestore de test enveloppé : compte chaque écriture (set/update/create) passée par doc(...) ou une transaction. */
const countWrites = (firestore) => {
  let count = 0;
  const wrapRef = (ref) => ({
    ...ref,
    set: async (...args) => { count += 1; return ref.set(...args); },
    update: async (...args) => { count += 1; return ref.update(...args); },
    create: async (...args) => { count += 1; return ref.create(...args); },
    collection: (name) => wrapCollection(ref.collection(name)),
  });
  const wrapCollection = (collection) => ({ ...collection, doc: (id) => wrapRef(collection.doc(id)), where: (...args) => wrapCollection(collection.where(...args)) });
  return {
    count: () => count,
    firestore: {
      ...firestore,
      doc: (path) => wrapRef(firestore.doc(path)),
      collection: (path) => wrapCollection(firestore.collection(path)),
      runTransaction: (operation) => firestore.runTransaction((transaction) => operation({
        ...transaction,
        set: (...args) => { count += 1; return transaction.set(...args); },
        update: (...args) => { count += 1; return transaction.update(...args); },
        create: (...args) => { count += 1; return transaction.create(...args); },
      })),
    },
  };
};

test('échec sharp sur l’asset primaire : variantsFailure consigné, thumbnailStatus « failed » sur l’item, acceptation intacte (décision (d))', async () => {
  const env = await seed();
  // L'original du binaire primaire est remplacé par des octets que sharp refuse (empreinte et taille cohérentes avec le manifeste).
  const corrupt = Buffer.from('ceci n’est pas une image jpeg');
  const digest = digestOf(corrupt);
  const storagePath = `private-drafts/${UID}/${CARTULARY}/bin_missing/${digest.replace('sha256:', '')}/original`;
  await env.storage.bucket().file(storagePath).save(corrupt, { metadata: { contentType: 'image/jpeg', metadata: {} } });
  await env.firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_missing`).set({ size: corrupt.length, sha256: digest, storagePath }, { merge: true });
  const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_missing'] });
  assert.deepEqual(plan.toGenerate, ['bin_missing']);
  const applied = await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
  assert.equal(applied.ok, false);
  assert.equal(applied.summary.failed, 1);
  assert.equal(applied.summary.itemThumbnail, null);
  assert.deepEqual(applied.mirrors.map((mirror) => [mirror.binaryId, mirror.status, mirror.thumbnailStatus]), [['bin_missing', 'failure_recorded', 'failed']]);
  const dump = env.firestore.dump();
  const manifest = dump[`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_missing`];
  assert.equal(manifest.verificationStatus, 'accepted', 'jamais dégradé');
  assert.ok(manifest.presentationDerivative.variantsFailure);
  const item = dump[`registries/${REGISTRY}/items/${CARTULARY}`];
  assert.equal(item.thumbnailStatus, 'failed');
  assert.equal(item.thumbnail, undefined);
  assert.equal(item.updatedAt, 'avant');
  assert.equal(dump[`cartularies/${CARTULARY}/assets/asset_missing`].privatePresentation, undefined);
});

test('bundle : --bundle-asset différent de primaryAssetId, ou item sans primaryAssetId → bundle_asset_mismatch, aucune écriture (N32)', async () => {
  const env = await seed();
  const bundleBytes = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#456' } }).webp().toBuffer();
  const path = '/assets/IWC/derivatives/Focus Shift White Front.240.webp';
  const readBundleFile = async () => bundleBytes;
  const attempt = async (options) => {
    const before = env.firestore.dump();
    const journalBefore = env.journal.length;
    await assert.rejects(async () => {
      const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_pdf'], bundleThumbnailPath: path, readBundleFile, ...options });
      await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
    }, (error) => error instanceof PresentationRegenerationError && error.code === 'bundle_asset_mismatch');
    assert.deepEqual(env.firestore.dump(), before, 'aucune écriture Firestore');
    assert.equal(env.journal.length, journalBefore, 'aucune écriture Storage');
  };
  await attempt({ bundleAssetId: 'asset_current' });
  await env.firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).set({ primaryAssetId: null }, { merge: true });
  await attempt({});
  await attempt({ bundleAssetId: 'asset_missing' });
  // Avec l'asset primaire : posée une fois (thumbnail + thumbnailStatus), puis rejeu sans écriture.
  await env.firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).set({ primaryAssetId: 'asset_missing' }, { merge: true });
  const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_pdf'], bundleThumbnailPath: path, bundleAssetId: 'asset_missing', readBundleFile });
  const applied = await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
  assert.equal(applied.summary.firestoreWrites, 1);
  const item = env.firestore.dump()[`registries/${REGISTRY}/items/${CARTULARY}`];
  assert.equal(item.thumbnail.kind, 'bundle');
  assert.equal(item.thumbnail.assetId, 'asset_missing');
  assert.equal(item.thumbnailStatus, 'ready');
  const writes = countWrites(env.firestore);
  const replay = await planPresentationRegeneration({ firestore: writes.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_pdf'], bundleThumbnailPath: path, readBundleFile });
  const again = await applyPresentationRegeneration({ firestore: writes.firestore, storage: env.storage, plan: replay });
  assert.equal(again.summary.firestoreWrites, 0);
  assert.equal(writes.count(), 0);
});

test('bundle : le chemin d’item garde la forme encodée du catalogue généré ; le fichier est lu sous public/ après décodage, jamais hors de public/', async () => {
  assert.equal(bundleFileSystemPath('/assets/IWC/derivatives/Focus%20Shift%20White%20Front.240.webp'), 'assets/IWC/derivatives/Focus Shift White Front.240.webp');
  assert.equal(bundleFileSystemPath('/assets/demo-watches/derivatives/rolex-submariner/main.240.webp'), 'assets/demo-watches/derivatives/rolex-submariner/main.240.webp');
  assert.equal(bundleFileSystemPath('/assets/IWC/derivatives/%2E%2E/%2E%2E/secret.webp'), null, 'remontée encodée refusée');
  assert.equal(bundleFileSystemPath('/assets/IWC/derivatives/..%2Fx.webp'), null, 'séparateur encodé refusé');
  assert.equal(bundleFileSystemPath('/assets/IWC/derivatives/%E0%A4%A.webp'), null, 'encodage invalide refusé');
  assert.equal(bundleFileSystemPath('/other/x.webp'), null);
  assert.equal(bundleFileSystemPath('/assets/IWC/derivatives/x.jpg'), null);
  // Le chemin encodé du catalogue traverse plan → item tel quel, et sha256 = fichier réellement lu sur disque.
  const env = await seed();
  const encodedPath = '/assets/IWC/derivatives/Focus%20Shift%20White%20Front.240.webp';
  const diskBytes = await readFile(new URL(`../public/${bundleFileSystemPath(encodedPath)}`, import.meta.url));
  const readBundleFile = async (requested) => (bundleFileSystemPath(requested) === bundleFileSystemPath(encodedPath) ? diskBytes : null);
  const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_pdf'], bundleThumbnailPath: encodedPath, readBundleFile });
  assert.equal(plan.bundle.path, encodedPath);
  assert.equal(plan.bundle.sha256, digestOf(diskBytes));
  assert.equal(plan.bundle.bytes, diskBytes.length);
  assert.ok(plan.bundle.width <= 240 && plan.bundle.height <= 240);
  await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
  const item = env.firestore.dump()[`registries/${REGISTRY}/items/${CARTULARY}`];
  assert.equal(item.thumbnail.path, encodedPath);
  assert.equal(validRegistryThumbnail(item.thumbnail), true);
});

test('bundle (IWC) : item.thumbnail kind bundle depuis public/<path>, sans Storage ; fichier absent ou trop grand refusé', async () => {
  const env = await seed();
  const bundleBytes = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#888' } }).webp().toBuffer();
  const path = '/assets/IWC/derivatives/Focus Shift White Front.240.webp';
  const readBundleFile = async (requested) => (requested === path ? bundleBytes : null);
  const journalBefore = env.journal.length;
  const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_pdf'], bundleThumbnailPath: path, readBundleFile });
  assert.equal(plan.plannedItemThumbnail, 'bundle');
  assert.deepEqual(plan.bundle, { kind: 'bundle', path, width: 240, height: 160, assetId: 'asset_missing', sha256: digestOf(bundleBytes), bytes: bundleBytes.length });
  const applied = await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
  assert.equal(applied.summary.itemThumbnail, 'bundle');
  assert.equal(env.journal.length, journalBefore, 'aucune écriture Storage pour une vignette bundle');
  const item = env.firestore.dump()[`registries/${REGISTRY}/items/${CARTULARY}`];
  assert.deepEqual(item.thumbnail, { kind: 'bundle', path, width: 240, height: 160, assetId: 'asset_missing', sha256: digestOf(bundleBytes) });
  assert.equal(item.updatedAt, 'avant');
  await assert.rejects(planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, bundleThumbnailPath: '/assets/IWC/derivatives/absent.240.webp', readBundleFile }), { code: 'bundle_file_missing' });
  const large = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#888' } }).webp().toBuffer();
  await assert.rejects(describeBundleThumbnail({ path: '/assets/IWC/derivatives/x.480.webp', bytes: large, assetId: 'a' }), { code: 'bundle_file_invalid' });
  await assert.rejects(describeBundleThumbnail({ path, bytes: Buffer.from('not webp'), assetId: 'a' }), { code: 'bundle_file_invalid' });
});

/** K7 « écritures limitées aux chemins de l'objet » (tour 3, N18) : sans projection d'item, --bundle-thumbnail est refusé avant toute écriture, jamais de registries/null/items/… */
test('bundle : item absent (racine sans registryId, ou registryId sans projection) → item_missing, aucune écriture Firestore ni Storage', async () => {
  const env = await seed();
  const bundleBytes = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#123' } }).webp().toBuffer();
  const path = '/assets/IWC/derivatives/x.240.webp';
  const readBundleFile = async () => bundleBytes;
  const attempt = async (cartularyId) => {
    const before = env.firestore.dump();
    const journalBefore = env.journal.length;
    const run = async () => {
      const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId, bundleThumbnailPath: path, bundleAssetId: 'asset_main', readBundleFile });
      await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
    };
    await assert.rejects(run, (error) => error instanceof PresentationRegenerationError && error.code === 'item_missing');
    const after = env.firestore.dump();
    assert.deepEqual(after, before, 'aucune écriture Firestore');
    assert.ok(Object.keys(after).every((key) => !key.startsWith('registries/null/')), 'jamais de document fantôme registries/null/items/*');
    assert.equal(env.journal.length, journalBefore, 'aucune écriture Storage');
  };
  // (a) racine sans registryId : le chemin d'item est indéterminé.
  await env.firestore.doc('cartularies/cart_iwc_no_item').set({ id: 'cart_iwc_no_item', accountHolderId: UID });
  await env.firestore.doc(`privateDrafts/${UID}/cartularies/cart_iwc_no_item`).set({ ownerUid: UID, status: 'active' });
  await attempt('cart_iwc_no_item');
  // (b) racine avec registryId mais projection registries/{r}/items/{id} absente : rien à poser, rien à créer.
  await env.firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).delete();
  await attempt(CARTULARY);
  assert.equal(env.firestore.dump()[`registries/${REGISTRY}/items/${CARTULARY}`], undefined);
});

test('CLI : garde-fous distants, simulation par défaut, exécution sur --execute, rapport sans dataUrl', async () => {
  const env = await seed();
  const capture = () => { const chunks = []; return { write: (chunk) => chunks.push(String(chunk)), text: () => chunks.join('') }; };
  const run = (argv, environment = EMULATOR_ENV) => {
    const stdout = capture(); const stderr = capture();
    return runPresentationRegenerationCli({ argv, env: environment, firestore: env.firestore, storage: env.storage, stdout, stderr }).then((result) => ({ ...result, stdout: stdout.text(), stderr: stderr.text() }));
  };
  assert.equal((await run(['--cartulary', CARTULARY], {})).exitCode, 1);
  assert.match((await run(['--cartulary', CARTULARY], {})).stderr, /project_required/);
  assert.match((await run(['--cartulary', CARTULARY], REMOTE_ENV)).stderr, /remote_not_allowed/);
  assert.match((await run(['--cartulary', 'cart_demo_rolex_submariner_124060'])).stderr, /demo_cartulary_refused/);
  assert.match((await run(['--help'])).stdout, /Utilisation/);
  const simulated = await run(['--cartulary', CARTULARY, '--expect-owner', UID]);
  assert.equal(simulated.exitCode, 0);
  assert.equal(simulated.report.event, 'PRESENTATION_REGENERATION_PLAN');
  assert.equal(simulated.report.dryRun, true);
  assert.equal(env.firestore.dump()[`cartularies/${CARTULARY}/assets/asset_missing`].privatePresentation, undefined);
  const executed = await run(['--cartulary', CARTULARY, '--expect-owner', UID, '--execute']);
  assert.equal(executed.exitCode, 0);
  assert.equal(executed.report.event, 'PRESENTATION_REGENERATION_APPLIED');
  assert.equal(executed.report.applied.summary.generated, 1);
  assert.doesNotMatch(executed.stdout, /data:image\/webp;base64/, 'le rapport ne contient jamais les octets de vignette');
  assert.equal(env.firestore.dump()[`cartularies/${CARTULARY}/assets/asset_missing`].privatePresentation.version, 'presentation-v3');
  const mismatch = await run(['--cartulary', CARTULARY, '--expect-owner', OTHER_UID, '--execute']);
  assert.equal(mismatch.exitCode, 1);
  assert.match(mismatch.stderr, /owner_mismatch/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Tour 5 — couverture relevée par les relecteurs (mutant M6g) et rejeu sans --force après un refus de sharp.
// ---------------------------------------------------------------------------------------------------------------------

test('tour 5 M6g : vignette bundle identique mais thumbnailStatus ≠ ready sur l’item → le script répare le statut (1 écriture), puis rejeu à 0', async () => {
  const env = await seed();
  const bundleBytes = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#456' } }).webp().toBuffer();
  const path = '/assets/IWC/derivatives/Focus%20Shift%20White%20Front.240.webp';
  const readBundleFile = async () => bundleBytes;
  const run = async () => {
    const writes = countWrites(env.firestore);
    const plan = await planPresentationRegeneration({ firestore: writes.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_pdf'], bundleThumbnailPath: path, readBundleFile });
    const applied = await applyPresentationRegeneration({ firestore: writes.firestore, storage: env.storage, plan });
    return { applied, count: writes.count() };
  };
  const first = await run();
  assert.equal(first.applied.summary.firestoreWrites, 1);
  await env.firestore.doc(`registries/${REGISTRY}/items/${CARTULARY}`).set({ thumbnailStatus: 'pending' }, { merge: true });
  const repair = await run();
  assert.equal(repair.applied.summary.firestoreWrites, 1, 'statut réparé');
  assert.equal(repair.count, 1);
  assert.equal(env.firestore.dump()[`registries/${REGISTRY}/items/${CARTULARY}`].thumbnailStatus, 'ready');
  const replay = await run();
  assert.equal(replay.count, 0);
});

test('tour 5 : rejeu du script sans --force sur un binaire dont sharp a refusé l’original → skipped:failure_recorded, aucune écriture ; --force le rejoue', async () => {
  const env = await seed();
  const corrupt = Buffer.from('ceci n’est pas une image jpeg');
  const digest = digestOf(corrupt);
  const storagePath = `private-drafts/${UID}/${CARTULARY}/bin_corrupt/${digest.replace('sha256:', '')}/original`;
  await env.storage.bucket().file(storagePath).save(corrupt, { metadata: { contentType: 'image/jpeg', metadata: {} } });
  await env.firestore.doc(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_corrupt`).set({
    ownerUid: UID, cartularyId: CARTULARY, binaryId: 'bin_corrupt', kind: 'media', fileName: 'bin_corrupt.jpg', mimeType: 'image/jpeg', size: corrupt.length, sha256: digest, storagePath,
    deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
  });
  await env.firestore.doc(`cartularies/${CARTULARY}/assets/asset_missing`).set({ binaryId: 'bin_corrupt' }, { merge: true });
  const plan = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_corrupt'] });
  assert.deepEqual(plan.toGenerate, ['bin_corrupt']);
  const applied = await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan });
  assert.equal(applied.ok, false);
  assert.deepEqual(applied.results.map((entry) => [entry.binaryId, entry.status]), [['bin_corrupt', 'failed']]);
  const manifest1 = env.firestore.dump()[`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_corrupt`];
  assert.equal(manifest1.presentationDerivative.variantsFailure, 'variants_processing_failed');
  assert.equal(manifest1.verificationStatus, 'accepted', 'acceptation intacte');
  // Rejeu sans --force : l'échec consigné n'est pas retenté (même règle que la seconde passe du backlog), rien n'est écrit.
  const replay = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_corrupt'] });
  assert.deepEqual(replay.binaries.map((binary) => [binary.binaryId, binary.status, binary.reason ?? null]), [['bin_corrupt', 'skipped', 'failure_recorded']]);
  assert.deepEqual(replay.toGenerate, []);
  assert.deepEqual(replay.counts, { skipped: 1 });
  const writes = countWrites(env.firestore);
  const journalBefore = env.journal.length;
  const again = await applyPresentationRegeneration({ firestore: writes.firestore, storage: env.storage, plan: replay });
  assert.equal(again.ok, true, 'un rejeu sans nouvelle tentative ne signale aucun échec');
  assert.equal(again.summary.firestoreWrites, 0);
  assert.equal(writes.count(), 0, 'aucune écriture Firestore au rejeu');
  assert.equal(env.journal.length, journalBefore, 'aucune écriture Storage au rejeu');
  const manifest2 = env.firestore.dump()[`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/bin_corrupt`];
  assert.equal(manifest2.presentationDerivative.variantsGeneratedAt, manifest1.presentationDerivative.variantsGeneratedAt, 'manifeste non réécrit');
  // --force : nouvelle tentative (toujours refusée par sharp : échec compté, manifeste horodaté à nouveau).
  const forced = await planPresentationRegeneration({ firestore: env.firestore, storage: env.storage, cartularyId: CARTULARY, binaryIds: ['bin_corrupt'], force: true });
  assert.deepEqual(forced.toGenerate, ['bin_corrupt']);
  const forcedRun = await applyPresentationRegeneration({ firestore: env.firestore, storage: env.storage, plan: forced });
  assert.equal(forcedRun.summary.failed, 1);
});
