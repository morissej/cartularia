import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { IWC_CARTULARY_ID } from '../src/domain/cartularyIds.ts';
import { PRIVATE_UPLOAD_VERIFICATION_VERSION } from './lib/private-upload-command.mjs';

const OWNER_UID = process.env.CARTULARIA_OWNER_UID || 'wave1-owner';
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : null);
const usesEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');
if (!projectId || !storageBucket) throw new Error('Projet Firebase et bucket requis.');
if (!usesEmulators && !allowRemote) throw new Error('Vérification distante interrompue : passez --allow-remote.');

const app = getApps()[0] || initializeApp({
  projectId,
  storageBucket,
  ...(usesEmulators ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);
const bucket = getStorage(app).bucket(storageBucket);
const rootRef = firestore.doc(`cartularies/${IWC_CARTULARY_ID}`);
const draftRef = firestore.doc(`privateDrafts/${OWNER_UID}/cartularies/${IWC_CARTULARY_ID}`);

const [root, registryItem, request, states, assets, binaries, storageFiles] = await Promise.all([
  rootRef.get(),
  firestore.doc(`registries/reg_collection_privee/items/${IWC_CARTULARY_ID}`).get(),
  firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).get(),
  draftRef.collection('state').get(),
  rootRef.collection('assets').get(),
  draftRef.collection('binaries').get(),
  bucket.getFiles({ prefix: `private-drafts/${OWNER_UID}/${IWC_CARTULARY_ID}/` }),
]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
assert(root.exists, 'Racine du Cartulaire absente.');
assert(registryItem.exists, 'Projection du Registre absente.');
assert(
  request.data()?.status === 'processed' && ['updated', 'no_change'].includes(request.data()?.outcome),
  'Synchronisation non finalisée.',
);
assert(Number(root.data()?.revision) >= 4, 'Révision du Cartulaire inférieure à 4.');
assert(registryItem.data()?.sourceRevision === root.data()?.revision, 'Révisions Cartulaire/Registre divergentes.');
assert(registryItem.data()?.primaryAssetId === root.data()?.primaryAssetId, 'Média principal divergent dans le Registre.');

const stateMap = new Map(states.docs.map((document) => [document.id, JSON.parse(document.data().value)]));
const media = stateMap.get('cartularia-media-assets-v3');
const specifications = stateMap.get('cartularia-specification-groups');
const conditions = stateMap.get('cartularia-condition-entries');
const retained = stateMap.get('cartularia-retained-valuation');
assert(Array.isArray(media) && media.length === 33, `Catalogue média attendu : 33, obtenu : ${media?.length}.`);
assert(media.filter((asset) => asset.tags?.includes('main-photo')).length === 1, 'Une seule photo principale est attendue.');
assert(media.filter((asset) => asset.type === 'image').length === 26, '26 images sont attendues.');
assert(media.filter((asset) => asset.type === 'video').length === 1, 'Une vidéo est attendue.');
assert(media.filter((asset) => asset.type === 'document').length === 6, 'Six documents sont attendus.');
assert(media.every((asset) => /^sha256:[a-f0-9]{64}$/.test(asset.hash)), 'Empreinte média absente ou invalide.');
assert(Array.isArray(conditions) && conditions.length === 6, 'Six entrées de preuve sont attendues.');
assert(retained?.amount === 2500 && retained?.taxAmount === 0, 'Valeur prudente non appliquée.');
const specificationItems = new Map(specifications.flatMap((group) => group.items).map((item) => [item.id, item.value]));
assert(specificationItems.get('height') === '13,5 mm', 'Épaisseur corrigée non appliquée.');
assert(String(specificationItems.get('base-caliber')).includes('2893-2'), 'Divergence du calibre non documentée.');

const referencedBinaryIds = new Set(media.flatMap((asset) => typeof asset.binaryId === 'string' ? [asset.binaryId] : []));
const binaryData = binaries.docs
  .filter((document) => referencedBinaryIds.has(document.id))
  .map((document) => document.data());
assert(referencedBinaryIds.size === 28, `28 références binaires attendues, obtenu : ${referencedBinaryIds.size}.`);
assert(binaryData.length === 28, `28 binaires privés référencés attendus, obtenu : ${binaryData.length}.`);
assert(binaryData.every((binary) => binary.uploadStatus === 'ready'), 'Un binaire privé n’est pas prêt.');
assert(binaryData.every((binary) => binary.verificationStatus === 'accepted'), 'Un binaire privé n’est pas accepté.');
assert(binaryData.every((binary) => binary.verificationVersion === PRIVATE_UPLOAD_VERIFICATION_VERSION), 'Version de vérification binaire divergente.');
assert(binaryData.every((binary) => /^sha256:[a-f0-9]{64}$/.test(binary.sha256)), 'Empreinte binaire invalide.');

const assetData = assets.docs.map((document) => document.data()).filter((asset) => asset.liveSyncManaged === true && asset.projectionStatus === 'active');
assert(assetData.length === 33, `33 actifs synchronisés attendus, obtenu : ${assetData.length}.`);
assert(assetData.filter((asset) => asset.processingState === 'ready').length === 28, '28 actifs prêts sont attendus.');
assert(assetData.filter((asset) => asset.processingState === 'pending_binary_reingest').length === 5, 'Cinq rapports texte indexés sans binaire sont attendus.');
assert(assetData.every((asset) => asset.visibility === 'secret'), 'Un actif du dossier n’est pas Secret.');
assert(root.data()?.primaryAssetId === media.find((asset) => asset.tags?.includes('main-photo'))?.id, 'Photo principale racine divergente.');

const originalFiles = storageFiles[0].filter((file) => (
  file.name.endsWith('/original')
  && [...referencedBinaryIds].some((binaryId) => file.name.includes(`/${binaryId}/`))
));
assert(originalFiles.length === 28, `28 originaux référencés sont attendus dans Storage, obtenu : ${originalFiles.length}.`);

console.log(JSON.stringify({
  event: 'IWC_DOSSIER_VERIFIED',
  projectId,
  cartularyId: IWC_CARTULARY_ID,
  revision: root.data().revision,
  integritySequence: root.data().integritySequence,
  registrySourceRevision: registryItem.data().sourceRevision,
  stateDocuments: states.size,
  media: { total: media.length, images: 26, videos: 1, documents: 6 },
  privateBinaries: binaryData.length,
  archivedBinariesPreserved: binaries.size - binaryData.length,
  activeAssets: assetData.length,
  readyAssets: assetData.filter((asset) => asset.processingState === 'ready').length,
  indexedTextReports: assetData.filter((asset) => asset.processingState === 'pending_binary_reingest').length,
  visibility: 'secret',
  primaryAssetId: root.data().primaryAssetId,
}, null, 2));
