import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { DEMO_ACCOUNT, DEMO_CARTULARIES } from '../../src/data/demoCartularies.ts';
import { buildDemoAssetDocuments, buildDemoCartularyEnvelope, buildDemoRegistryItem } from '../../src/data/demoCartularyDocuments.ts';
import { CANONICALIZATION_VERSION, canonicalize, sha256Digest } from './canonical-json.mjs';
import { SCHEMA_CONTRACT_DIGEST_VERSION, schemaContractDigest, verifySchemaCatalog } from './schema-catalog-files.mjs';

export const DEMO_REPAIR_VERSION = 'demo-data-repair-v1';
export const DEMO_PURPOSE = 'public_read_only_demo';
const SCHEMA_PATH = 'schemaCatalog/watch/versions/1.6.0';
const ORG_PATH = `organizations/${DEMO_ACCOUNT.organizationId}`;
const REGISTRY_PATH = `registries/${DEMO_ACCOUNT.registryId}`;
const COLLECTION_PATH = `${REGISTRY_PATH}/collections/${DEMO_ACCOUNT.collectionId}`;
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const READ_ONLY_PERMISSIONS = ['organization.read', 'membership.read', 'registry.read', 'access.read', 'cartulary.read', 'cartulary.export'];
const equal = (a, b) => a === b || (a !== undefined && b !== undefined && canonicalize(a) === canonicalize(b));
const fail = (detail) => { throw new Error(`Réparation démo refusée : ${detail}`); };
const requireValue = (condition, detail) => { if (!condition) fail(detail); };
const sameSet = (actual, expected) => Array.isArray(actual) && equal([...actual].sort(), [...expected].sort());
const seedEventId = (id) => `evt_demo_${createHash('sha256').update(id).digest('hex').slice(0, 20)}`;
const repairEventId = (id) => `evt_${DEMO_REPAIR_VERSION.replaceAll('-', '_')}_${createHash('sha256').update(id).digest('hex').slice(0, 20)}`;

export function demoRepairOptions(argv, env) {
  // A misspelled --data-only must never fall through to the Auth-writing seed.
  requireValue(argv.every((arg) => ['--data-only', '--apply', '--allow-remote'].includes(arg) || arg.startsWith('--backup-dir=')), 'option inconnue.');
  const dataOnly = argv.includes('--data-only');
  const apply = argv.includes('--apply');
  const backupArg = argv.find((arg) => arg.startsWith('--backup-dir='));
  requireValue(!apply || dataOnly, '--apply exige --data-only.');
  requireValue(!backupArg || dataOnly, '--backup-dir exige --data-only.');
  const firestoreEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const authEmulator = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST);
  requireValue(firestoreEmulator === authEmulator, 'les émulateurs Auth et Firestore doivent être configurés ensemble.');
  const projectId = env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID || (firestoreEmulator ? 'cartularia-demo-local' : null);
  if (dataOnly) {
    requireValue(Boolean(projectId), 'GCLOUD_PROJECT ou FIREBASE_PROJECT_ID explicite requis.');
    requireValue(!env.GCLOUD_PROJECT || !env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT === env.FIREBASE_PROJECT_ID, 'identifiants de projet contradictoires.');
    requireValue(firestoreEmulator || argv.includes('--allow-remote'), '--allow-remote requis hors émulateurs, même pour la simulation.');
    requireValue(!apply || (backupArg && isAbsolute(backupArg.slice('--backup-dir='.length))), '--apply exige --backup-dir=/chemin/absolu/existant.');
  }
  return { dataOnly, apply, projectId, usesEmulator: firestoreEmulator, backupDirectory: backupArg?.slice('--backup-dir='.length) };
}

// This interface deliberately accepts no Auth mutation method.
export async function resolveExistingDemoUser(readAuth, registryEmail) {
  let user;
  try { user = await readAuth.getUserByEmail(registryEmail); }
  catch (error) {
    if (error?.code === 'auth/user-not-found') fail('le compte Auth doit déjà exister ; aucune création ne sera effectuée.');
    throw error;
  }
  requireValue(user && typeof user.uid === 'string' && /^[^/]+$/.test(user.uid), 'UID Auth invalide.');
  requireValue(user.email === registryEmail && user.disabled === false && user.emailVerified === true, 'compte Auth absent, désactivé ou non vérifié ; aucune réactivation.');
  requireValue(Object.keys(user.customClaims || {}).length === 0, 'le compte Auth porte des rôles personnalisés inattendus.');
  return { uid: user.uid, email: user.email };
}

// Typed values preserve nanosecond timestamps and do not confuse ordinary maps
// with serializer tags. Unsupported types fail before any remote write.
export function encodeBackupValue(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return { type: 'scalar', value };
  if (typeof value === 'number' && Number.isFinite(value)) return { type: 'scalar', value };
  if (value instanceof Timestamp) return { type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return { type: 'array', value: value.map(encodeBackupValue) };
  if (value && Object.getPrototypeOf(value) === Object.prototype) return {
    type: 'map', value: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeBackupValue(entry)])),
  };
  fail('type Firestore inattendu dans la sauvegarde ; intervention manuelle nécessaire.');
}

export function decodeBackupValue(value) {
  if (value.type === 'scalar') return value.value;
  if (value.type === 'timestamp') return new Timestamp(value.seconds, value.nanoseconds);
  if (value.type === 'array') return value.value.map(decodeBackupValue);
  if (value.type === 'map') return Object.fromEntries(Object.entries(value.value).map(([key, entry]) => [key, decodeBackupValue(entry)]));
  fail('type de sauvegarde inconnu.');
}

const onlyExpectedFields = (data, expected, flexible = {}, metadata = ['createdAt', 'updatedAt']) => {
  for (const [key, value] of Object.entries(data)) {
    if (metadata.includes(key)) continue;
    requireValue(Object.hasOwn(expected, key) || Object.hasOwn(flexible, key), `champ inattendu ${key}.`);
    requireValue(flexible[key] ? flexible[key](value) : equal(value, expected[key]), `valeur non fictive ou non reconnue pour ${key}.`);
  }
};

const docData = (state, path) => {
  const document = state.documents[path];
  requireValue(Boolean(document), `document requis absent : ${path}.`);
  return document.data;
};
const requireFields = (data, expected, path) => {
  for (const [key, value] of Object.entries(expected)) requireValue(equal(data[key], value), `${path} : ${key} hors périmètre.`);
};

function verifyAuditChain(state, root, uid) {
  const path = `cartularies/${root.id}/auditEvents`;
  const events = state.queries[path].map((eventPath) => docData(state, eventPath)).sort((a, b) => a.sequence - b.sequence);
  requireValue(events.length >= 1 && events.length <= 2, `${root.id} : historique non limité au seed et à cette réparation.`);
  let previous = ZERO_HASH;
  events.forEach((stored, index) => {
    const { hash, occurredAt: timestamp, occurredAtIso, ...rest } = stored;
    const event = { ...rest, occurredAt: occurredAtIso };
    requireValue(timestamp instanceof Timestamp && timestamp.toDate().toISOString() === occurredAtIso, `${root.id} : date d'audit invalide.`);
    requireFields(event, {
      eventId: index === 0 ? seedEventId(root.id) : repairEventId(root.id),
      cartularyId: root.id, sequence: index + 1, previousEventHash: previous,
      action: index === 0 ? 'cartulary.demo.created' : 'cartulary.demo.data_repaired',
      actor: { uid, role: index === 0 ? 'demo_seed' : 'demo_data_repair' },
      resource: { type: 'cartulary', id: root.id },
      canonicalizationVersion: CANONICALIZATION_VERSION,
      requestId: index === 0 ? `seed_demo_${root.id}` : `${DEMO_REPAIR_VERSION}_${root.id}`,
      beforeDigest: index === 0 ? null : previous,
    }, path);
    requireValue(/^sha256:[a-f0-9]{64}$/.test(event.afterDigest) && hash === sha256Digest({ previousEventHash: previous, event }), `${root.id} : chaîne d'audit incohérente.`);
    previous = hash;
  });
  requireValue(root.integritySequence === events.length && root.revision === events.length && root.integrityHead === previous, `${root.id} : révision ou tête d'intégrité incohérente.`);
}

export function assertDemoRepairScope(state, user, schema) {
  const { uid, email } = user;
  const version = docData(state, SCHEMA_PATH);
  const expectedDigest = schemaContractDigest(schema);
  requireFields(version, { schemaId: 'watch', assetType: 'watch', version: '1.6.0', catalogDigest: expectedDigest, contractDigestVersion: SCHEMA_CONTRACT_DIGEST_VERSION }, SCHEMA_PATH);
  requireValue(['active', 'baseline'].includes(version.status), 'watch@1.6.0 doit être publié.');
  const deployedSchema = { ...version, sections: version.sectionIds, fields: schema.sections.flatMap((id) => state.queries[`${SCHEMA_PATH}/sections/${id}/fields`].map((path) => docData(state, path))) };
  requireValue(schemaContractDigest(deployedSchema) === expectedDigest, 'le contrat déployé watch@1.6.0 diffère du catalogue local.');
  requireFields(docData(state, `users/${uid}`), { uid, email, status: 'active', accountPurpose: DEMO_PURPOSE }, `users/${uid}`);
  requireFields(docData(state, ORG_PATH), { id: DEMO_ACCOUNT.organizationId, name: 'Collection de démonstration Cartularia', status: 'active' }, ORG_PATH);
  const membership = docData(state, `${ORG_PATH}/memberships/${uid}`);
  requireFields(membership, { uid, organizationId: DEMO_ACCOUNT.organizationId, roles: ['guest'], status: 'active', scopes: { registryIds: [DEMO_ACCOUNT.registryId] }, revokedAt: null, accountPurpose: DEMO_PURPOSE }, 'adhésion');
  requireValue(sameSet(membership.permissions, READ_ONLY_PERMISSIONS), 'les droits du compte ne sont pas exactement en lecture seule.');
  requireValue(sameSet(state.queries[`${ORG_PATH}/memberships`], [`${ORG_PATH}/memberships/${uid}`]), 'membre supplémentaire dans l’organisation démo.');
  requireFields(docData(state, REGISTRY_PATH), { id: DEMO_ACCOUNT.registryId, organizationId: DEMO_ACCOUNT.organizationId, status: 'active', visibility: 'secret', itemCount: 5, accountPurpose: DEMO_PURPOSE }, REGISTRY_PATH);
  requireValue(sameSet(state.queries.organizationRegistries, [REGISTRY_PATH]), 'registre supplémentaire dans l’organisation démo.');
  requireValue(sameSet(state.queries.organizationCartularies, DEMO_CARTULARIES.map(({ id }) => `cartularies/${id}`)), 'Cartulaires inattendus ou manquants dans l’organisation démo.');
  requireValue(sameSet(state.queries[`${REGISTRY_PATH}/items`], DEMO_CARTULARIES.map(({ id }) => `${REGISTRY_PATH}/items/${id}`)), 'projections inattendues ou manquantes dans le registre démo.');
  requireValue(sameSet(state.queries[`${REGISTRY_PATH}/collections`], [COLLECTION_PATH]), 'collection supplémentaire ou absente.');
  const collection = docData(state, COLLECTION_PATH);
  requireFields(collection, { id: DEMO_ACCOUNT.collectionId, registryId: DEMO_ACCOUNT.registryId, organizationId: DEMO_ACCOUNT.organizationId, status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [], publishedAt: null }, COLLECTION_PATH);
  requireValue(['Demo Montres', 'Les cinq icônes'].includes(collection.name) && ['Demo Montres', 'Les cinq icônes'].includes(collection.websiteTitle), 'nom de collection personnalisé ; conservation requise.');
  requireValue(collection.description === DEMO_ACCOUNT.collectionDescription, 'description de collection personnalisée ; conservation requise.');

  for (const cartulary of DEMO_CARTULARIES) {
    const path = `cartularies/${cartulary.id}`;
    const root = docData(state, path);
    const expected = { ...buildDemoCartularyEnvelope(cartulary, uid, root.integrityHead), schemaDigest: expectedDigest, demo: true, demoDisclaimer: 'Exemplaire, documents, historique et valeurs fictifs.' };
    requireFields(root, Object.fromEntries(['id', 'organizationId', 'registryId', 'collectionId', 'assetType', 'schemaId', 'schemaVersion', 'schemaDigest', 'accountHolderId', 'publicCode', 'lifecycleStatus', 'defaultVisibility', 'publicationStatus', 'demo'].map((key) => [key, expected[key]])), path);
    verifyAuditChain(state, root, uid);
    const oldOrCurrentPrimary = (value) => value === null || value === `${cartulary.id}-main` || value === expected.primaryAssetId;
    onlyExpectedFields(root, expected, {
      revision: (value) => value === root.integritySequence,
      integritySequence: (value) => value === 1 || value === 2,
      costBasis: (value) => value === cartulary.purchasePrice || value === expected.costBasis,
      objectCode: (value) => value === '' || value === expected.objectCode,
      primaryAssetId: oldOrCurrentPrimary,
    });
    const item = docData(state, `${REGISTRY_PATH}/items/${cartulary.id}`);
    const expectedItem = buildDemoRegistryItem(cartulary, item.contentHash);
    requireFields(item, { cartularyId: cartulary.id, organizationId: DEMO_ACCOUNT.organizationId, registryId: DEMO_ACCOUNT.registryId, assetType: 'watch', collectionId: DEMO_ACCOUNT.collectionId }, 'projection');
    requireValue(/^sha256:[a-f0-9]{64}$/.test(item.contentHash), 'empreinte de projection invalide.');
    onlyExpectedFields(item, expectedItem, {
      sourceRevision: (value) => value === root.revision,
      costBasis: (value) => value === cartulary.purchasePrice || value === expectedItem.costBasis,
      objectCode: (value) => value === null || value === '' || value === expectedItem.objectCode,
      netValuation: (value) => value === null || value === expectedItem.netValuation,
      netAfterTaxValuation: (value) => value === null || value === expectedItem.netAfterTaxValuation,
      primaryAssetId: oldOrCurrentPrimary,
    }, ['generatedAt', 'updatedAt']);
    const assets = buildDemoAssetDocuments(cartulary);
    for (const assetPath of state.queries[`${path}/assets`]) {
      const data = docData(state, assetPath);
      const expectedAsset = assets.find((asset) => `${path}/assets/${asset.id}` === assetPath);
      requireValue(Boolean(expectedAsset), `${assetPath} : média inconnu, aucun remplacement autorisé.`);
      requireFields(data, { id: expectedAsset.id, cartularyId: cartulary.id, organizationId: DEMO_ACCOUNT.organizationId, sourceRefs: [`source_${cartulary.id}`], visibility: 'secret' }, assetPath);
      onlyExpectedFields(data, expectedAsset);
    }
  }
  return expectedDigest;
}

const ROOT_FIELDS = ['objectCode', 'valuationCurrency', 'purchasePrice', 'costBasis', 'grossValuation', 'saleCostAmount', 'taxAmount', 'netValuation', 'netAfterTaxValuation', 'primaryAssetId'];
const differences = (current, desired) => Object.fromEntries(Object.entries(desired).filter(([key, value]) => !equal(current[key], value)));

export function buildDemoRepairPlan(state, user, schema, occurredAt) {
  const schemaDigest = assertDemoRepairScope(state, user, schema);
  const changes = [];
  const collectionPatch = differences(docData(state, COLLECTION_PATH), { name: DEMO_ACCOUNT.collectionName, websiteTitle: DEMO_ACCOUNT.collectionName });
  if (Object.keys(collectionPatch).length) changes.push({ path: COLLECTION_PATH, operation: 'update', data: collectionPatch });
  for (const cartulary of DEMO_CARTULARIES) {
    const rootPath = `cartularies/${cartulary.id}`;
    const root = docData(state, rootPath);
    const expectedRoot = buildDemoCartularyEnvelope(cartulary, user.uid, root.integrityHead);
    const rootPatch = differences(root, Object.fromEntries(ROOT_FIELDS.map((key) => [key, expectedRoot[key]])));
    const itemPath = `${REGISTRY_PATH}/items/${cartulary.id}`;
    const item = docData(state, itemPath);
    const desiredItem = buildDemoRegistryItem(cartulary, item.contentHash);
    desiredItem.sourceRevision = root.revision;
    const itemPatch = differences(item, desiredItem);
    const assetChanges = buildDemoAssetDocuments(cartulary).flatMap((asset) => {
      const path = `${rootPath}/assets/${asset.id}`;
      if (!state.documents[path]) return [{ path, operation: 'create', data: asset }];
      const patch = differences(state.documents[path].data, asset);
      return Object.keys(patch).length ? [{ path, operation: 'update', data: patch }] : [];
    });
    if (!Object.keys(rootPatch).length && !Object.keys(itemPatch).length && !assetChanges.length) continue;
    requireValue(root.integritySequence === 1, `${root.id} : une réparation v1 existe déjà mais les données divergent ; nouvelle migration explicite nécessaire.`);
    const contentHash = sha256Digest({ repairVersion: DEMO_REPAIR_VERSION, schemaDigest, cartularyId: cartulary.id, rootPatch, registryItem: desiredItem, assets: buildDemoAssetDocuments(cartulary) });
    const event = {
      eventId: repairEventId(root.id), cartularyId: root.id, sequence: 2, occurredAt,
      actor: { uid: user.uid, role: 'demo_data_repair' }, action: 'cartulary.demo.data_repaired',
      resource: { type: 'cartulary', id: root.id }, beforeDigest: root.integrityHead,
      afterDigest: contentHash, previousEventHash: root.integrityHead,
      canonicalizationVersion: CANONICALIZATION_VERSION, requestId: `${DEMO_REPAIR_VERSION}_${root.id}`,
    };
    const hash = sha256Digest({ previousEventHash: root.integrityHead, event });
    changes.push(...assetChanges,
      { path: rootPath, operation: 'update', data: { ...rootPatch, revision: 2, integritySequence: 2, integrityHead: hash } },
      { path: itemPath, operation: 'update', data: { ...itemPatch, sourceRevision: 2, contentHash } },
      { path: `${rootPath}/auditEvents/${event.eventId}`, operation: 'create', data: { ...event, occurredAt: Timestamp.fromDate(new Date(occurredAt)), occurredAtIso: occurredAt, hash }, audit: true },
    );
  }
  requireValue(changes.length < 450, 'lot trop volumineux pour une transaction bornée.');
  return { repairVersion: DEMO_REPAIR_VERSION, schemaDigest, uid: user.uid, occurredAt, changes };
}

export async function readDemoRepairState(firestore, reader, uid, schema) {
  const documents = {};
  const queries = {};
  const add = (snapshot) => {
    if (snapshot.exists) documents[snapshot.ref.path] = { data: snapshot.data(), updateTime: snapshot.updateTime };
  };
  const readDoc = async (path) => add(await reader.get(firestore.doc(path)));
  const readQuery = async (name, query, maximum) => {
    // Read one extra record to detect scope drift, never an unbounded collection.
    const result = await reader.get(query.limit(maximum + 1));
    queries[name] = result.docs.map((snapshot) => snapshot.ref.path).sort();
    result.docs.forEach(add);
  };
  await Promise.all([SCHEMA_PATH, `users/${uid}`, ORG_PATH, REGISTRY_PATH, COLLECTION_PATH].map(readDoc));
  await Promise.all([
    readQuery('organizationRegistries', firestore.collection('registries').where('organizationId', '==', DEMO_ACCOUNT.organizationId), 1),
    readQuery('organizationCartularies', firestore.collection('cartularies').where('organizationId', '==', DEMO_ACCOUNT.organizationId), 5),
    ...[[`${ORG_PATH}/memberships`, 1], [`${REGISTRY_PATH}/items`, 5], [`${REGISTRY_PATH}/collections`, 1]].map(([path, maximum]) => readQuery(path, firestore.collection(path), maximum)),
    ...schema.sections.map((id) => {
      const path = `${SCHEMA_PATH}/sections/${id}/fields`;
      return readQuery(path, firestore.collection(path), schema.fields.filter((field) => field.sectionId === id).length);
    }),
    ...DEMO_CARTULARIES.flatMap((cartulary) => [
      readQuery(`cartularies/${cartulary.id}/assets`, firestore.collection(`cartularies/${cartulary.id}/assets`), buildDemoAssetDocuments(cartulary).length),
      readQuery(`cartularies/${cartulary.id}/auditEvents`, firestore.collection(`cartularies/${cartulary.id}/auditEvents`), 2),
    ]),
  ]);
  return { documents, queries };
}

export const demoRepairFingerprint = (state) => sha256Digest(encodeBackupValue(state));

export function saveDemoRepairBackup(directory, projectId, state, plan) {
  requireValue(isAbsolute(directory), 'répertoire de sauvegarde absolu requis.');
  const backupDirectory = mkdtempSync(join(realpathSync(directory), `${DEMO_REPAIR_VERSION}-`));
  const payload = {
    format: 'cartularia-demo-repair-backup@1', projectId, repairVersion: DEMO_REPAIR_VERSION,
    stateFingerprint: demoRepairFingerprint(state),
    // Include absent targets so rollback knows precisely which creations to undo.
    before: plan.changes.map(({ path }) => ({ path, existed: Boolean(state.documents[path]), document: state.documents[path] ? encodeBackupValue(state.documents[path]) : null })),
    guards: encodeBackupValue(state), plan: encodeBackupValue(plan),
  };
  const backup = { ...payload, digest: sha256Digest(payload) };
  const path = join(backupDirectory, 'backup.json');
  const descriptor = openSync(path, 'wx', 0o600);
  try { writeFileSync(descriptor, JSON.stringify(backup, null, 2)); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  const persisted = JSON.parse(readFileSync(path, 'utf8'));
  const { digest, ...persistedPayload } = persisted;
  requireValue(digest === sha256Digest(persistedPayload), 'sauvegarde illisible ou empreinte incorrecte.');
  return { path, digest };
}

export async function runDemoDataRepair({ firestore, readAuth, registryEmail, options, backup = saveDemoRepairBackup, schema: suppliedSchema }) {
  const schema = suppliedSchema || verifySchemaCatalog(new URL('../../firebase/schema-catalog/', import.meta.url)).find(({ schema: artifact }) => artifact.schemaId === 'watch' && artifact.version === '1.6.0')?.schema;
  requireValue(Boolean(schema), 'contrat local watch@1.6.0 absent.');
  const user = await resolveExistingDemoUser(readAuth, registryEmail);
  const reader = { get: (reference) => reference.get() };
  const state = await readDemoRepairState(firestore, reader, user.uid, schema);
  const plan = buildDemoRepairPlan(state, user, schema, new Date().toISOString());
  const summary = { mode: options.apply ? 'apply' : 'dry-run', projectId: options.projectId, auth: 'read-only / unchanged', uid: user.uid, writes: plan.changes.map(({ path, operation }) => ({ path, operation })), schemaDigest: plan.schemaDigest };
  if (!options.apply || plan.changes.length === 0) return { ...summary, applied: false };
  requireValue(Boolean(options.backupDirectory), 'sauvegarde obligatoire avant application.');
  const saved = backup(options.backupDirectory, options.projectId, state, plan);
  // Recheck Auth without modifying it after the local backup, then protect every
  // Firestore guard + query against both changed documents and phantom targets.
  const currentUser = await resolveExistingDemoUser(readAuth, registryEmail);
  requireValue(currentUser.uid === user.uid, 'le compte Auth a changé pendant la préparation.');
  await firestore.runTransaction(async (transaction) => {
    const freshState = await readDemoRepairState(firestore, transaction, user.uid, schema);
    requireValue(demoRepairFingerprint(freshState) === demoRepairFingerprint(state), 'les données ont changé depuis la sauvegarde ; aucune écriture appliquée.');
    for (const change of plan.changes) {
      const data = change.audit ? change.data : { ...change.data, updatedAt: FieldValue.serverTimestamp(), ...(change.operation === 'create' ? { createdAt: FieldValue.serverTimestamp() } : {}) };
      if (change.operation === 'create') transaction.create(firestore.doc(change.path), data);
      else transaction.update(firestore.doc(change.path), data);
    }
  });
  return { ...summary, applied: true, backup: saved };
}
