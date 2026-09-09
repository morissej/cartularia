import { FieldValue } from 'firebase-admin/firestore';
import { IWC_CARTULARY_ID, ROLEX_CARTULARY_ID } from '../../src/domain/cartularyIds.ts';

/**
 * Purge d'un Cartulaire DE TEST (identifiant cart_audit_* ou cart_test_*) créé depuis le Registre :
 * aucun chemin de suppression n'existe dans le produit (règles delete:false partout sauf reminders),
 * ce script est le seul à retirer un objet de test et toutes ses traces. Logique complète, analyse
 * des arguments, aide et garde-fous ici (testés en mémoire) ; scripts/purge-test-cartulary.mjs ne
 * garde que l'initialisation Firebase et l'appel.
 *
 * Ordre d'exécution (chaque étape idempotente, journalisée) :
 *   (a) transaction : registries/{reg}/items/{id} supprimé et itemCount décrémenté seulement si
 *       l'item existe (jamais négatif) — l'item AVANT la racine, sinon la page Preuves du Registre
 *       échoue pour tout le Registre (src/services/registryIntegrity.ts) ;
 *   (b) integrityProjections/{id} ;
 *   (c) suppression récursive de cartularies/{id} ;
 *   (d) suppression récursive de privateDrafts/{uid}/cartularies/{id} ;
 *   (e) Storage : private-drafts/{uid}/{id}/ et private-derivatives/{uid}/{id}/ ; public/{code}/
 *       seulement avec --purge-publication ;
 *   (f) cartularyCreateRequests/{id}, cartularySyncRequests/{id}, timestampRequests et
 *       timestampReceipts (cartularyId == id) ;
 *   (g) publications/{code} (+ blocks, mediaAccess) et seals/{code} seulement avec --purge-publication.
 * Jamais touchés : timestampRateLimits, organisations, utilisateurs, autres Cartulaires.
 * Rapprochement du code public : la racine (objectCode/publicCode), publications/{code}.cartularyId et
 * seals/{code}.cartularyId sont comparés à --cartulary (public_code_mismatch) ; racine absente,
 * --purge-publication exige qu'une publication ou un sceau rattache le code à l'objet (public_code_unproven).
 */

export class TestCartularyPurgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const TEST_CARTULARY_ID_PATTERN = /^cart_(audit|test)_[a-z0-9_]+$/;
export const PROTECTED_CARTULARY_IDS = Object.freeze([IWC_CARTULARY_ID, ROLEX_CARTULARY_ID]);
const DEMO_CARTULARY_PREFIX = 'cart_demo_';
const PUBLIC_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,60}$/;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BATCH_SIZE = 400;
const BOOLEAN_FLAGS = new Map([
  ['--allow-remote', 'allowRemote'],
  ['--execute', 'execute'],
  ['--confirm-test-purge', 'confirmTestPurge'],
  ['--purge-publication', 'purgePublication'],
]);
const VALUE_FLAGS = new Map([
  ['--cartulary', 'cartularyId'],
  ['--expect-public-code', 'expectedPublicCode'],
  ['--expect-owner', 'expectedOwner'],
]);

export const TEST_CARTULARY_PURGE_USAGE = `Utilisation :
  node scripts/purge-test-cartulary.mjs --cartulary <id> --expect-public-code <code> [--expect-owner <uid>]
                                        [--allow-remote] [--execute --confirm-test-purge] [--purge-publication]

Options :
  --cartulary <id>            OBLIGATOIRE : identifiant du Cartulaire de test, conforme à
                              ^cart_(audit|test)_[a-z0-9_]+$ ; IWC, Rolex et cart_demo_* sont refusés
                              (not_a_test_cartulary), rien n'est lu.
  --expect-public-code <code> OBLIGATOIRE : code public attendu, comparé à objectCode/publicCode de la
                              racine (public_code_mismatch sinon, rien n'est écrit) ; il désigne aussi
                              publications/{code}, seals/{code} et le préfixe Storage public/{code}/.
  --expect-owner <uid>        facultatif : comparé à accountHolderId de la racine, ou au propriétaire relu dans les demandes si la racine est absente (owner_mismatch sinon) ;
                              sert de repli pour localiser le brouillon privé si la racine est absente.
  --allow-remote              OBLIGATOIRE hors émulateur, même en simulation (remote_not_allowed sinon).
  --execute                   applique la purge ; exige aussi --confirm-test-purge (confirmation_required).
  --confirm-test-purge        confirmation explicite, après revue du plan de simulation.
  --purge-publication         supprime aussi publications/{code} (+ blocks, mediaAccess), seals/{code} et
                              public/{code}/ ; sans ce drapeau ils sont conservés (statut revoked) et un
                              préfixe public/{code}/ non vide bloque le plan (public_storage_not_empty).
                              Racine absente : refusé si ni publication ni sceau ne rattache le code à
                              --cartulary (public_code_unproven).
  --help, -h                  cette aide.

Variables :
  GCLOUD_PROJECT / FIREBASE_PROJECT_ID  projet Firebase : OBLIGATOIRE hors émulateur, même en simulation
                              (project_required, Firebase jamais initialisé, aucun repli implicite).
  FIREBASE_STORAGE_BUCKET     bucket Storage (défaut hors émulateur : <projet>.firebasestorage.app).
  FIRESTORE_EMULATOR_HOST     présent → émulateur.

Plan (simulation par défaut, aucune écriture) : inventaire compté de tout ce qui sera supprimé
(racine et chaque sous-collection, item du Registre et itemCount, integrityProjections, brouillon privé,
préfixes Storage, demandes, reçus d'horodatage), conservé (publication et sceau revoked sans
--purge-publication, timestampRateLimits) ou BLOQUANT (rien n'est écrit, code 1) :
  anchoring_receipt_reference   reçu d'ancrage integrityBatches/*/receipts (non reproductible) ;
  export_reference              cartularyExports référençant l'objet ;
  community_reference           communityPublications référençant l'objet ;
  collection_publication_reference  collectionPublications/*/items référençant l'objet ;
  publication_published         publication encore en statut published : retirer d'abord ;
  seal_published                sceau dont le statut n'est pas revoked (un sceau actif porte issued) ;
  request_in_flight             demande create/sync/timestamp en pending/processing ;
  public_storage_not_empty      public/{code}/ non vide sans --purge-publication ;
  public_code_mismatch / owner_mismatch  racine, publications/{code} ou seals/{code} (cartularyId)
                                ne correspondant pas à --cartulary / --expect-owner ;
  public_code_unproven          racine absente et ni publication ni sceau ne rattache le code à
                                --cartulary : --purge-publication refusé (sceau et public/{code}/ intacts).
Racine absente sans aucun résidu : « déjà purgé », code 0. Racine absente avec résidus (item orphelin,
brouillon, demandes…) : les résidus sont nettoyés.

Séquence de production (identifiants de la session Firebase CLI ; JAMAIS exécutée par les tests) :
  1. simulation, relire l'inventaire et les bloquants :
     GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/purge-test-cartulary.mjs \\
       --cartulary <id> --expect-public-code <code> --expect-owner <uid> --allow-remote
  2. exécution, après revue du plan :
     GCLOUD_PROJECT=<projet> node scripts/run-with-firebase-cli-adc.mjs -- node scripts/purge-test-cartulary.mjs \\
       --cartulary <id> --expect-public-code <code> --expect-owner <uid> --allow-remote --execute --confirm-test-purge
  3. second passage (simulation) : tout doit être « absent » (alreadyPurged true, code 0).

Sortie : un objet JSON unique sur stdout (TEST_CARTULARY_PURGE_PLAN en simulation,
TEST_CARTULARY_PURGE_APPLIED après exécution), compteurs et chemins seulement, jamais de valeur
d'état ; en erreur TEST_CARTULARY_PURGE_FAILED sur stderr, code 1.`;

const fail = (code, message) => { throw new TestCartularyPurgeError(code, message); };
const usageError = (code, message) => ({ ok: false, code, message });
const isInFlight = (status) => typeof status === 'string' && (status.startsWith('pending') || status === 'processing');
const docStatus = (snapshot) => (snapshot.exists ? snapshot.data()?.status ?? null : null);
const rootPublicCode = (data) => data?.objectCode || data?.publicCode || null;

/* ----------------------------------------------------------------------------------------------
 * Arguments (fonction pure)
 * -------------------------------------------------------------------------------------------- */

export const isTestCartularyId = (cartularyId) => typeof cartularyId === 'string'
  && TEST_CARTULARY_ID_PATTERN.test(cartularyId)
  && !PROTECTED_CARTULARY_IDS.includes(cartularyId)
  && !cartularyId.startsWith(DEMO_CARTULARY_PREFIX);

export const parseTestCartularyPurgeArgs = (argv = [], env = {}) => {
  const usesEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const explicitProject = [env.GCLOUD_PROJECT, env.FIREBASE_PROJECT_ID].find((value) => typeof value === 'string' && value.trim()) ?? null;
  const options = {
    help: false,
    cartularyId: null,
    expectedPublicCode: null,
    expectedOwner: null,
    allowRemote: false,
    execute: false,
    confirmTestPurge: false,
    purgePublication: false,
    projectId: explicitProject ? explicitProject.trim() : usesEmulator ? 'cartularia-wave2-local' : null,
    usesEmulator,
  };
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.includes('=') ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)] : [argument, undefined];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (BOOLEAN_FLAGS.has(argument)) {
      options[BOOLEAN_FLAGS.get(argument)] = true;
    } else if (VALUE_FLAGS.has(flag)) {
      const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (typeof value !== 'string' || !value || value.startsWith('--')) return usageError('invalid_argument', `${flag} attend une valeur.`);
      options[VALUE_FLAGS.get(flag)] = value.trim();
    } else {
      unknown.push(argument);
    }
  }
  if (options.help) return { ok: true, options };
  if (unknown.length) return usageError('invalid_argument', `Option inconnue : ${unknown.join(' ')}.`);
  if (!options.cartularyId) return usageError('invalid_argument', '--cartulary <id> est obligatoire.');
  if (!isTestCartularyId(options.cartularyId)) {
    return usageError('not_a_test_cartulary', `${options.cartularyId} n’est pas un Cartulaire de test (attendu ^cart_(audit|test)_[a-z0-9_]+$ ; IWC, Rolex et cart_demo_* sont refusés) : rien n’est lu.`);
  }
  if (!options.expectedPublicCode) return usageError('invalid_argument', '--expect-public-code <code> est obligatoire.');
  if (!PUBLIC_CODE_PATTERN.test(options.expectedPublicCode)) return usageError('invalid_argument', 'Code public attendu invalide (majuscules, chiffres et tirets).');
  if (options.expectedOwner !== null && !UID_PATTERN.test(options.expectedOwner)) return usageError('invalid_argument', 'Identifiant de propriétaire attendu invalide.');
  if (options.execute && !options.confirmTestPurge) return usageError('confirmation_required', '--execute exige --confirm-test-purge après revue du plan de simulation : rien n’est écrit.');
  return { ok: true, options };
};

/* ----------------------------------------------------------------------------------------------
 * Parcours récursif (listCollections / listDocuments) : inventaire et suppression testables
 * -------------------------------------------------------------------------------------------- */

/** Inventaire compté de toutes les sous-collections d'un document (documents « manquants » porteurs de descendants inclus). */
const inventoryDocument = async (ref, collections = []) => {
  const subcollections = await ref.listCollections();
  for (const subcollection of subcollections) {
    const children = await subcollection.listDocuments();
    collections.push({ path: subcollection.path, count: children.length });
    for (const child of children) await inventoryDocument(child, collections);
  }
  return collections;
};
const collectDocumentRefs = async (ref, refs = []) => {
  const subcollections = await ref.listCollections();
  for (const subcollection of subcollections) {
    for (const child of await subcollection.listDocuments()) await collectDocumentRefs(child, refs);
  }
  refs.push(ref);
  return refs;
};
const deleteRefs = async (firestore, refs) => {
  for (let index = 0; index < refs.length; index += BATCH_SIZE) {
    const batch = firestore.batch();
    for (const ref of refs.slice(index, index + BATCH_SIZE)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
};
/** Supprime récursivement un document et ses descendants ; retourne le nombre de documents retirés (0 : absent). */
const deleteDocumentTree = async (firestore, ref) => {
  const snapshot = await ref.get();
  const refs = await collectDocumentRefs(ref);
  if (!snapshot.exists && refs.length === 1) return 0;
  return deleteRefs(firestore, refs);
};
const countTree = (collections) => collections.reduce((total, entry) => total + entry.count, 0);
const groupParentId = (snapshot, depth) => {
  let current = snapshot.ref.parent;
  for (let index = 0; index < depth; index += 1) current = current?.parent;
  return current?.id ?? null;
};
/**
 * Requête de groupe (items, receipts) avec repli par parcours explicite : hors émulateur, une requête
 * collectionGroup filtrée exige un index de portée COLLECTION_GROUP (absent de firestore.indexes.json
 * pour cartularyId) ; en cas d'échec le plan parcourt les parents (listDocuments, sans index) plutôt
 * que d'ignorer une référence bloquante. Le repli est signalé (warning collection_group_fallback).
 */
const collectionGroupOrScan = async ({ firestore, group, cartularyId, scan, warnings }) => {
  try {
    return (await firestore.collectionGroup(group).where('cartularyId', '==', cartularyId).get()).docs;
  } catch (error) {
    warnings.push({ code: 'collection_group_fallback', group, message: `collectionGroup(${group}) indisponible (${error?.code ?? 'erreur'}) : parcours explicite des parents.` });
    return scan();
  }
};
const firestoreDoc = (parent, childPath) => childPath.split('/').reduce((ref, segment, index) => (index % 2 === 0 ? ref.collection(segment) : ref.doc(segment)), parent);
const existingChildren = async (parents, childPath) => (await Promise.all(parents.map((parent) => firestoreDoc(parent, childPath).get()))).filter((snapshot) => snapshot.exists);
const storagePrefixes = ({ ownerUid, cartularyId, publicCode }) => [
  ...(ownerUid ? [
    { prefix: `private-drafts/${ownerUid}/${cartularyId}/`, kind: 'private' },
    { prefix: `private-derivatives/${ownerUid}/${cartularyId}/`, kind: 'private' },
  ] : []),
  { prefix: `public/${publicCode}/`, kind: 'public' },
];

/* ----------------------------------------------------------------------------------------------
 * Plan (lecture seule)
 * -------------------------------------------------------------------------------------------- */

export const planTestCartularyPurge = async ({
  firestore,
  bucket = null,
  cartularyId,
  expectedPublicCode,
  expectedOwner = null,
  purgePublication = false,
}) => {
  if (!isTestCartularyId(cartularyId)) fail('not_a_test_cartulary', `${cartularyId} n’est pas un Cartulaire de test : rien n’est lu.`);
  if (typeof expectedPublicCode !== 'string' || !PUBLIC_CODE_PATTERN.test(expectedPublicCode)) fail('invalid_argument', 'Code public attendu invalide.');
  const blockers = [];
  const warnings = [];
  const block = (code, path, message, count = 1) => blockers.push({ code, path, count, message });
  const publicCode = expectedPublicCode;

  // Racine
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const rootSnapshot = await rootRef.get();
  const rootData = rootSnapshot.exists ? rootSnapshot.data() : null;
  const root = {
    path: rootRef.path,
    exists: rootSnapshot.exists,
    revision: rootData?.revision ?? null,
    publicCode: rootPublicCode(rootData),
    registryId: rootData?.registryId ?? null,
    organizationId: rootData?.organizationId ?? null,
    accountHolderId: rootData?.accountHolderId ?? null,
    schemaVersion: rootData?.schemaVersion ?? null,
    lifecycleStatus: rootData?.lifecycleStatus ?? null,
    publicationStatus: rootData?.publicationStatus ?? null,
    // Inventaire même si la racine est absente : des sous-collections orphelines sont des résidus.
    subcollections: await inventoryDocument(rootRef),
  };
  root.descendantCount = countTree(root.subcollections);
  if (rootData && root.publicCode !== expectedPublicCode) {
    block('public_code_mismatch', rootRef.path, `Le code public de la racine ne correspond pas à --expect-public-code : rien n’est écrit.`);
  }
  if (rootData && expectedOwner && root.accountHolderId !== expectedOwner) {
    block('owner_mismatch', rootRef.path, 'accountHolderId de la racine ne correspond pas à --expect-owner : rien n’est écrit.');
  }

  // Demandes (create / sync) : statut et repli pour le propriétaire
  const createRef = firestore.doc(`cartularyCreateRequests/${cartularyId}`);
  const syncRef = firestore.doc(`cartularySyncRequests/${cartularyId}`);
  const [createSnapshot, syncSnapshot] = await Promise.all([createRef.get(), syncRef.get()]);
  const requests = {
    create: { path: createRef.path, exists: createSnapshot.exists, status: docStatus(createSnapshot) },
    sync: { path: syncRef.path, exists: syncSnapshot.exists, status: docStatus(syncSnapshot) },
    timestamp: [],
  };
  for (const request of [requests.create, requests.sync]) {
    if (request.exists && isInFlight(request.status)) block('request_in_flight', request.path, `Demande en cours (${request.status}) : attendez son issue ; rien n’est écrit.`);
  }
  const ownerUid = root.accountHolderId
    ?? (typeof createSnapshot.data()?.ownerUid === 'string' ? createSnapshot.data().ownerUid : null)
    ?? (typeof syncSnapshot.data()?.ownerUid === 'string' ? syncSnapshot.data().ownerUid : null)
    ?? expectedOwner;
  // Racine absente : le propriétaire relu dans une demande doit coïncider avec --expect-owner, sinon
  // le brouillon d'un autre compte serait programmé à la suppression.
  if (!rootData && expectedOwner && ownerUid && ownerUid !== expectedOwner) {
    block('owner_mismatch', ownerUid === createSnapshot.data()?.ownerUid ? createRef.path : syncRef.path, 'Le propriétaire relu dans la demande ne correspond pas à --expect-owner : rien n’est écrit.');
  }
  if (!ownerUid) warnings.push({ code: 'owner_unknown', message: 'Propriétaire introuvable (racine et demandes absentes, pas de --expect-owner) : brouillon privé et préfixes Storage privés non inspectés.' });

  // Item du Registre (collectionGroup items : registres et publications de Collection)
  const groupItems = await collectionGroupOrScan({
    firestore,
    group: 'items',
    cartularyId,
    warnings,
    scan: async () => {
      const registries = root.registryId ? [firestore.doc(`registries/${root.registryId}`)] : await firestore.collection('registries').listDocuments();
      const publications = await firestore.collection('collectionPublications').listDocuments();
      return existingChildren([...registries, ...publications], `items/${cartularyId}`);
    },
  });
  const registryItemSnapshots = groupItems.filter((snapshot) => groupParentId(snapshot, 2) === 'registries');
  const collectionPublicationItems = groupItems.filter((snapshot) => groupParentId(snapshot, 2) === 'collectionPublications');
  for (const item of collectionPublicationItems) block('collection_publication_reference', item.ref.path, 'Une publication de Collection référence encore l’objet : retirer la Collection publique d’abord ; rien n’est écrit.');
  const registryIdsFound = [...new Set(registryItemSnapshots.map((snapshot) => snapshot.ref.parent.parent.id))];
  const registryId = root.registryId ?? registryIdsFound[0] ?? null;
  if (registryIdsFound.some((id) => id !== registryId)) block('ambiguous_registry_item', registryIdsFound.map((id) => `registries/${id}/items/${cartularyId}`).join(' '), 'L’objet est projeté dans plusieurs Registres : vérification manuelle requise ; rien n’est écrit.', registryIdsFound.length);
  const registryRef = registryId ? firestore.doc(`registries/${registryId}`) : null;
  const itemRef = registryId ? firestore.doc(`registries/${registryId}/items/${cartularyId}`) : null;
  const [registrySnapshot, itemSnapshot] = registryId ? await Promise.all([registryRef.get(), itemRef.get()]) : [null, null];
  const registry = {
    registryId,
    path: registryRef?.path ?? null,
    exists: Boolean(registrySnapshot?.exists),
    itemCount: Number.isInteger(registrySnapshot?.data()?.itemCount) ? registrySnapshot.data().itemCount : null,
    itemPath: itemRef?.path ?? null,
    itemExists: Boolean(itemSnapshot?.exists),
    projectionStatus: itemSnapshot?.exists ? itemSnapshot.data()?.projectionStatus ?? null : null,
    decrement: Boolean(itemSnapshot?.exists) && Number.isInteger(registrySnapshot?.data()?.itemCount) && registrySnapshot.data().itemCount > 0,
  };

  // Projection d'intégrité
  const projectionRef = firestore.doc(`integrityProjections/${cartularyId}`);
  const projectionSnapshot = await projectionRef.get();
  const integrityProjection = { path: projectionRef.path, exists: projectionSnapshot.exists };

  // Brouillon privé
  const draftRef = ownerUid ? firestore.doc(`privateDrafts/${ownerUid}/cartularies/${cartularyId}`) : null;
  const draftSnapshot = draftRef ? await draftRef.get() : null;
  const draftCollections = draftRef ? await inventoryDocument(draftRef) : [];
  const draft = {
    ownerUid,
    path: draftRef?.path ?? null,
    exists: Boolean(draftSnapshot?.exists),
    status: draftSnapshot?.exists ? draftSnapshot.data()?.status ?? null : null,
    stateCount: draftCollections.find((entry) => entry.path === `${draftRef?.path}/state`)?.count ?? 0,
    binaryCount: draftCollections.find((entry) => entry.path === `${draftRef?.path}/binaries`)?.count ?? 0,
    subcollections: draftCollections,
    descendantCount: countTree(draftCollections),
  };

  // Storage
  const storage = { available: Boolean(bucket), prefixes: [] };
  for (const { prefix, kind } of storagePrefixes({ ownerUid, cartularyId, publicCode })) {
    let fileCount = null;
    if (bucket) {
      const [files] = await bucket.getFiles({ prefix });
      fileCount = files.length;
    }
    const action = kind === 'public' && !purgePublication ? 'keep' : 'delete';
    storage.prefixes.push({ prefix, kind, fileCount, action });
    if (kind === 'public' && !purgePublication && fileCount > 0) block('public_storage_not_empty', prefix, `${fileCount} fichier(s) sous public/${publicCode}/ sans --purge-publication : rien n’est écrit.`, fileCount);
  }
  if (!bucket) warnings.push({ code: 'storage_unavailable', message: 'Aucun bucket Storage injecté : préfixes non inventoriés, étape Storage ignorée à l’exécution.' });

  // Horodatage : demandes et reçus (cartularyId) ; timestampRateLimits jamais touché
  const [timestampRequests, timestampReceipts] = await Promise.all([
    firestore.collection('timestampRequests').where('cartularyId', '==', cartularyId).get(),
    firestore.collection('timestampReceipts').where('cartularyId', '==', cartularyId).get(),
  ]);
  requests.timestamp = timestampRequests.docs.map((snapshot) => ({ path: snapshot.ref.path, status: docStatus(snapshot) }));
  for (const request of requests.timestamp) {
    if (isInFlight(request.status)) block('request_in_flight', request.path, `Demande d’horodatage en cours (${request.status}) : rien n’est écrit.`);
  }
  const receipts = timestampReceipts.docs.map((snapshot) => ({ path: snapshot.ref.path }));

  // Publication et sceau
  const publicationRef = firestore.doc(`publications/${publicCode}`);
  const sealRef = firestore.doc(`seals/${publicCode}`);
  const [publicationSnapshot, sealSnapshot, blocks, mediaAccess] = await Promise.all([
    publicationRef.get(), sealRef.get(), publicationRef.collection('blocks').listDocuments(), publicationRef.collection('mediaAccess').listDocuments(),
  ]);
  const publication = {
    path: publicationRef.path,
    exists: publicationSnapshot.exists,
    status: docStatus(publicationSnapshot),
    blockCount: blocks.length,
    mediaAccessCount: mediaAccess.length,
    action: purgePublication ? 'delete' : 'keep',
  };
  const seal = { path: sealRef.path, exists: sealSnapshot.exists, status: docStatus(sealSnapshot), action: purgePublication ? 'delete' : 'keep' };
  // Rapprochement du code public avec l'objet : publications/{code}.cartularyId ET seals/{code}.cartularyId
  // (tous deux écrits à la projection) sont comparés à --cartulary ; un document étranger bloque.
  const publicationCartularyId = publicationSnapshot.data()?.cartularyId;
  const sealCartularyId = sealSnapshot.data()?.cartularyId;
  if (publicationSnapshot.exists && typeof publicationCartularyId === 'string' && publicationCartularyId !== cartularyId) {
    block('public_code_mismatch', publicationRef.path, 'publications/{code} appartient à un autre Cartulaire : rien n’est écrit.');
  }
  if (sealSnapshot.exists && typeof sealCartularyId === 'string' && sealCartularyId !== cartularyId) {
    block('public_code_mismatch', sealRef.path, 'seals/{code} appartient à un autre Cartulaire : rien n’est écrit.');
  }
  if (publication.status === 'published') block('publication_published', publicationRef.path, 'Le mini-site est encore publié : retirez-le d’abord ; rien n’est écrit.');
  // Un sceau actif porte le statut 'issued' (projection) ; seul 'revoked' (retrait) autorise la purge.
  if (seal.exists && seal.status !== 'revoked') block('seal_published', sealRef.path, `Le sceau public n’est pas révoqué (statut ${seal.status ?? 'absent'}) : retirez la publication d’abord ; rien n’est écrit.`);
  // Preuve que le code appartient à l'objet : racine (objectCode/publicCode), sinon publication ou sceau.
  const publicCodeProof = rootData && root.publicCode === expectedPublicCode ? 'root'
    : publicationSnapshot.exists && publicationCartularyId === cartularyId ? 'publication'
      : sealSnapshot.exists && sealCartularyId === cartularyId ? 'seal'
        : null;

  // Références bloquantes : ancrage, export, communauté
  const [anchoringReceipts, exports, community] = await Promise.all([
    collectionGroupOrScan({
      firestore,
      group: 'receipts',
      cartularyId,
      warnings,
      scan: async () => {
        const batches = await firestore.collection('integrityBatches').listDocuments();
        const matches = await Promise.all(batches.map((batch) => batch.collection('receipts').where('cartularyId', '==', cartularyId).get()));
        return matches.flatMap((result) => result.docs);
      },
    }),
    firestore.collection('cartularyExports').where('cartularyId', '==', cartularyId).get(),
    firestore.collection('communityPublications').where('cartularyId', '==', cartularyId).get(),
  ]);
  const references = {
    anchoringReceipts: anchoringReceipts.filter((snapshot) => groupParentId(snapshot, 2) === 'integrityBatches').map((snapshot) => snapshot.ref.path),
    exports: exports.docs.map((snapshot) => snapshot.ref.path),
    community: community.docs.map((snapshot) => snapshot.ref.path),
    collectionPublications: collectionPublicationItems.map((snapshot) => snapshot.ref.path),
  };
  for (const path of references.anchoringReceipts) block('anchoring_receipt_reference', path, 'Un reçu d’ancrage public référence l’objet (ancrage non reproductible) : rien n’est écrit.');
  for (const path of references.exports) block('export_reference', path, 'Un export portable référence l’objet : rien n’est écrit.');
  for (const path of references.community) block('community_reference', path, 'Une publication communautaire référence l’objet : rien n’est écrit.');

  const privateFiles = storage.prefixes.filter((entry) => entry.kind === 'private').reduce((total, entry) => total + (entry.fileCount ?? 0), 0);
  const publicFiles = storage.prefixes.find((entry) => entry.kind === 'public')?.fileCount ?? 0;
  // Hors racine, --purge-publication n'est accepté que si publication ou sceau prouve que le code est
  // celui de l'objet : sans preuve, un sceau ou un préfixe public/{code}/ pourrait appartenir à un autre.
  if (purgePublication && !publicCodeProof && (publication.exists || seal.exists || publicFiles > 0)) {
    block('public_code_unproven', `public/${publicCode}/`, 'Racine absente et ni publications/{code} ni seals/{code} ne rattache le code public à --cartulary : --purge-publication refusé, rien n’est écrit.', (publication.exists ? 1 : 0) + (seal.exists ? 1 : 0) + publicFiles);
  }
  const residues = {
    rootDescendants: root.descendantCount,
    registryItem: registry.itemExists ? 1 : 0,
    integrityProjection: integrityProjection.exists ? 1 : 0,
    draft: (draft.exists ? 1 : 0) + draft.descendantCount,
    privateFiles,
    publicFiles: purgePublication ? publicFiles : 0,
    requests: (requests.create.exists ? 1 : 0) + (requests.sync.exists ? 1 : 0) + requests.timestamp.length,
    receipts: receipts.length,
    publication: purgePublication ? (publication.exists ? 1 : 0) + publication.blockCount + publication.mediaAccessCount + (seal.exists ? 1 : 0) : 0,
  };
  const residueCount = Object.values(residues).reduce((total, value) => total + value, 0);
  const alreadyPurged = !root.exists && residueCount === 0 && blockers.length === 0;
  return {
    cartularyId,
    publicCode,
    publicCodeProof,
    ownerUid,
    registryId,
    organizationId: root.organizationId,
    flags: { purgePublication, expectedOwner },
    root,
    registry,
    integrityProjection,
    draft,
    storage,
    requests,
    receipts,
    publication,
    seal,
    references,
    residues,
    residueCount,
    alreadyPurged,
    blockers,
    warnings,
    ok: blockers.length === 0,
  };
};

/* ----------------------------------------------------------------------------------------------
 * Exécution (ordre imposé, étapes idempotentes)
 * -------------------------------------------------------------------------------------------- */

export const applyTestCartularyPurge = async ({ firestore, bucket = null, plan }) => {
  if (!plan || !isTestCartularyId(plan.cartularyId)) fail('not_a_test_cartulary', 'Plan invalide : rien n’est écrit.');
  if (plan.blockers.length) fail('plan_blocked', `Plan bloqué (${plan.blockers.map((entry) => entry.code).join(', ')}) : rien n’est écrit.`);
  const { cartularyId, publicCode, ownerUid } = plan;
  const purgePublication = plan.flags.purgePublication;
  const steps = [];
  const record = (step, result) => { steps.push({ step, ...result }); return result; };

  // (a) item du Registre + itemCount, en transaction, seulement si l'item existe (jamais négatif)
  if (plan.registry.itemPath) {
    const itemRef = firestore.doc(plan.registry.itemPath);
    const registryRef = firestore.doc(plan.registry.path);
    record('registry_item', await firestore.runTransaction(async (transaction) => {
      const [item, registry] = await Promise.all([transaction.get(itemRef), transaction.get(registryRef)]);
      if (!item.exists) return { status: 'absent', path: itemRef.path, itemCountBefore: registry.data()?.itemCount ?? null, itemCountAfter: registry.data()?.itemCount ?? null };
      const before = registry.exists && Number.isInteger(registry.data().itemCount) ? registry.data().itemCount : null;
      transaction.delete(itemRef);
      const decremented = before !== null && before > 0;
      if (decremented) transaction.update(registryRef, { itemCount: before - 1, updatedAt: FieldValue.serverTimestamp() });
      return { status: 'deleted', path: itemRef.path, itemCountBefore: before, itemCountAfter: decremented ? before - 1 : before };
    }));
  } else {
    record('registry_item', { status: 'absent', path: null, itemCountBefore: null, itemCountAfter: null });
  }

  // (b) projection d'intégrité
  {
    const ref = firestore.doc(plan.integrityProjection.path);
    const snapshot = await ref.get();
    if (snapshot.exists) await ref.delete();
    record('integrity_projection', { status: snapshot.exists ? 'deleted' : 'absent', path: ref.path });
  }

  // (c) racine récursive
  {
    const ref = firestore.doc(`cartularies/${cartularyId}`);
    const deleted = await deleteDocumentTree(firestore, ref);
    record('cartulary_root', { status: deleted ? 'deleted' : 'absent', path: ref.path, documentCount: deleted });
  }

  // (d) brouillon privé récursif
  if (ownerUid) {
    const ref = firestore.doc(`privateDrafts/${ownerUid}/cartularies/${cartularyId}`);
    const deleted = await deleteDocumentTree(firestore, ref);
    record('private_draft', { status: deleted ? 'deleted' : 'absent', path: ref.path, documentCount: deleted });
  } else {
    record('private_draft', { status: 'skipped_owner_unknown', path: null, documentCount: 0 });
  }

  // (e) Storage par préfixe
  for (const { prefix, kind } of storagePrefixes({ ownerUid, cartularyId, publicCode })) {
    if (!bucket) { record('storage', { status: 'skipped_no_bucket', prefix, fileCount: 0 }); continue; }
    if (kind === 'public' && !purgePublication) { record('storage', { status: 'kept', prefix, fileCount: (await bucket.getFiles({ prefix }))[0].length }); continue; }
    const [files] = await bucket.getFiles({ prefix });
    if (files.length) await bucket.deleteFiles({ prefix, force: true });
    record('storage', { status: files.length ? 'deleted' : 'absent', prefix, fileCount: files.length });
  }

  // (f) demandes et reçus d'horodatage
  for (const [step, path] of [['create_request', `cartularyCreateRequests/${cartularyId}`], ['sync_request', `cartularySyncRequests/${cartularyId}`]]) {
    const ref = firestore.doc(path);
    const snapshot = await ref.get();
    if (snapshot.exists) await ref.delete();
    record(step, { status: snapshot.exists ? 'deleted' : 'absent', path });
  }
  for (const [step, collection] of [['timestamp_requests', 'timestampRequests'], ['timestamp_receipts', 'timestampReceipts']]) {
    const matching = await firestore.collection(collection).where('cartularyId', '==', cartularyId).get();
    const refs = matching.docs.map((snapshot) => snapshot.ref);
    if (refs.length) await deleteRefs(firestore, refs);
    record(step, { status: refs.length ? 'deleted' : 'absent', path: collection, documentCount: refs.length, paths: refs.map((ref) => ref.path) });
  }

  // (g) publication et sceau, seulement avec --purge-publication
  if (purgePublication) {
    const publicationRef = firestore.doc(`publications/${publicCode}`);
    const deleted = await deleteDocumentTree(firestore, publicationRef);
    record('publication', { status: deleted ? 'deleted' : 'absent', path: publicationRef.path, documentCount: deleted });
    const sealRef = firestore.doc(`seals/${publicCode}`);
    const sealSnapshot = await sealRef.get();
    if (sealSnapshot.exists) await sealRef.delete();
    record('seal', { status: sealSnapshot.exists ? 'deleted' : 'absent', path: sealRef.path });
  } else {
    record('publication', { status: 'kept', path: `publications/${publicCode}`, documentCount: 0 });
    record('seal', { status: 'kept', path: `seals/${publicCode}` });
  }

  const summary = steps.reduce((totals, entry) => ({ ...totals, [entry.status]: (totals[entry.status] ?? 0) + 1 }), {});
  return { cartularyId, steps, summary, ok: true };
};

/* ----------------------------------------------------------------------------------------------
 * Rapport et CLI
 * -------------------------------------------------------------------------------------------- */

/** Rapport JSON unique : compteurs et chemins seulement, jamais de valeur d'état. */
export const describeTestCartularyPurgeRun = ({ plan, applied = null, dryRun = applied === null, projectId = null, usesEmulator = null }) => ({
  event: applied ? 'TEST_CARTULARY_PURGE_APPLIED' : 'TEST_CARTULARY_PURGE_PLAN',
  projectId,
  usesEmulator,
  dryRun,
  cartularyId: plan.cartularyId,
  publicCode: plan.publicCode,
  publicCodeProof: plan.publicCodeProof,
  ownerUid: plan.ownerUid,
  registryId: plan.registryId,
  organizationId: plan.organizationId,
  flags: plan.flags,
  alreadyPurged: plan.alreadyPurged,
  root: plan.root,
  registry: plan.registry,
  integrityProjection: plan.integrityProjection,
  draft: plan.draft,
  storage: plan.storage,
  requests: plan.requests,
  receipts: plan.receipts,
  publication: plan.publication,
  seal: plan.seal,
  references: plan.references,
  residues: plan.residues,
  residueCount: plan.residueCount,
  blockers: plan.blockers,
  warnings: plan.warnings,
  applied: applied ? { steps: applied.steps, summary: applied.summary } : null,
  ok: applied ? applied.ok : plan.ok,
});

export const runTestCartularyPurge = async ({ firestore, bucket = null, cartularyId, expectedPublicCode, expectedOwner = null, purgePublication = false, execute = false, projectId = null, usesEmulator = null }) => {
  const plan = await planTestCartularyPurge({ firestore, bucket, cartularyId, expectedPublicCode, expectedOwner, purgePublication });
  const applied = execute && plan.ok && !plan.alreadyPurged ? await applyTestCartularyPurge({ firestore, bucket, plan }) : null;
  return { plan, applied, report: describeTestCartularyPurgeRun({ plan, applied, dryRun: !execute, projectId, usesEmulator }) };
};

/**
 * CLI complet sans initialisation Firebase : `firestore` et `bucket` sont des instances ou des
 * fabriques appelées seulement après validation des arguments et des garde-fous distants.
 * Hors émulateur : projet explicite obligatoire (project_required) et --allow-remote obligatoire
 * même en simulation (remote_not_allowed) ; l'exécution exige --execute ET --confirm-test-purge.
 */
export const runTestCartularyPurgeCli = async ({ argv = [], env = {}, firestore, bucket = null, stdout = process.stdout, stderr = process.stderr }) => {
  const failWith = (code, message) => {
    stderr.write(`${JSON.stringify({ event: 'TEST_CARTULARY_PURGE_FAILED', code, message })}\n`);
    return { exitCode: 1, report: null };
  };
  const parsed = parseTestCartularyPurgeArgs(argv, env);
  if (!parsed.ok) return failWith(parsed.code, `${parsed.message}\n${TEST_CARTULARY_PURGE_USAGE}`);
  const { options } = parsed;
  if (options.help) {
    stdout.write(`${TEST_CARTULARY_PURGE_USAGE}\n`);
    return { exitCode: 0, report: null };
  }
  if (!options.usesEmulator && !options.projectId) {
    return failWith('project_required', `Hors émulateur, GCLOUD_PROJECT ou FIREBASE_PROJECT_ID doit désigner explicitement le projet, même en simulation : aucun repli sur un projet distant par défaut.\n${TEST_CARTULARY_PURGE_USAGE}`);
  }
  if (!options.usesEmulator && !options.allowRemote) {
    return failWith('remote_not_allowed', 'Purge interrompue : hors émulateur, --allow-remote est obligatoire même en simulation (identifiants Admin).');
  }
  try {
    const context = { projectId: options.projectId, usesEmulator: options.usesEmulator };
    const store = typeof firestore === 'function' ? await firestore(context) : firestore;
    if (!store) fail('firestore_unavailable', 'Aucune instance Firestore.');
    const storage = typeof bucket === 'function' ? await bucket(context) : bucket;
    const { report } = await runTestCartularyPurge({
      firestore: store,
      bucket: storage,
      cartularyId: options.cartularyId,
      expectedPublicCode: options.expectedPublicCode,
      expectedOwner: options.expectedOwner,
      purgePublication: options.purgePublication,
      execute: options.execute && options.confirmTestPurge,
      projectId: options.projectId,
      usesEmulator: options.usesEmulator,
    });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: report.ok ? 0 : 1, report };
  } catch (error) {
    return failWith(error?.code || 'purge_failed', error?.message || String(error));
  }
};
