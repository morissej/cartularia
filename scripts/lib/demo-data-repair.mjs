import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { DEMO_ACCOUNT, DEMO_CARTULARIES } from '../../src/data/demoCartularies.ts';
import {
  DEMO_REVIEWED_AT, buildDemoAccessDocuments, buildDemoAssetDocuments, buildDemoCartularyEnvelope, buildDemoRegistryItem, buildDemoReminderDocuments,
} from '../../src/data/demoCartularyDocuments.ts';
import { CANONICALIZATION_VERSION, canonicalize, sha256Digest } from './canonical-json.mjs';
import { SCHEMA_CONTRACT_DIGEST_VERSION, schemaContractDigest, verifySchemaCatalog } from './schema-catalog-files.mjs';

// Migrations additives de la voie `--data-only`, dans l'ordre de la chaîne d'audit :
//   v1 (6 septembre 2026) : Galerie, codes objet, coût de revient, nets, nom de Collection ;
//   v2 (13 septembre 2026) : dossiers « Complet » revus, rappels de Suivi et projections d'Accès.
// La v2 accepte ensuite les événements publication.published / publication.revoked signés
// par le seed démo (décision V2 (a)) : le seed reste rejouable après la publication réelle.
export const DEMO_REPAIR_VERSION = 'demo-data-repair-v1';
export const DEMO_ENRICHMENT_VERSION = 'demo-data-enrichment-v2';
export const DEMO_PURPOSE = 'public_read_only_demo';
const SCHEMA_PATH = 'schemaCatalog/watch/versions/1.6.0';
const ORG_PATH = `organizations/${DEMO_ACCOUNT.organizationId}`;
const REGISTRY_PATH = `registries/${DEMO_ACCOUNT.registryId}`;
const COLLECTION_PATH = `${REGISTRY_PATH}/collections/${DEMO_ACCOUNT.collectionId}`;
const ACCESSES_PATH = `${REGISTRY_PATH}/accesses`;
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
// Borne de lecture de l'historique d'un Cartulaire démo : seed, v1, v2 et quelques cycles de publication.
const MAX_AUDIT_EVENTS = 12;
const READ_ONLY_PERMISSIONS = ['organization.read', 'membership.read', 'registry.read', 'access.read', 'cartulary.read', 'cartulary.export'];
const COMPLETENESS_LEVELS = ['imported_unreviewed', 'complete'];
const PUBLICATION_ACTIONS = { 'publication.published': 'published', 'publication.revoked': 'revoked' };
const fail = (detail) => { throw new Error(`Réparation démo refusée : ${detail}`); };
const requireValue = (condition, detail) => { if (!condition) fail(detail); };
// Comparaison canonique tolérant les Timestamp Firestore (accès) ; tout autre type non JSON est refusé.
const equal = (a, b) => a === b || (a !== undefined && b !== undefined && canonicalize(encodeBackupValue(a)) === canonicalize(encodeBackupValue(b)));
const sameSet = (actual, expected) => Array.isArray(actual) && equal([...actual].sort(), [...expected].sort());
const shortId = (id) => createHash('sha256').update(id).digest('hex').slice(0, 20);
const seedEventId = (id) => `evt_demo_${shortId(id)}`;
const repairEventId = (id) => `evt_${DEMO_REPAIR_VERSION.replaceAll('-', '_')}_${shortId(id)}`;
export const enrichmentEventId = (id) => `evt_${DEMO_ENRICHMENT_VERSION.replaceAll('-', '_')}_${shortId(id)}`;
const isoTimestamp = (value) => (value === null ? null : Timestamp.fromDate(new Date(value)));
// Une adresse dont la partie locale est lisible en entier n'est pas une projection masquée.
const looksLikeRawEmail = (label) => /^[^\s@*]+@[^\s@]+$/.test(String(label));

export function demoRepairOptions(argv, env) {
  // A misspelled --data-only must never fall through to the Auth-writing seed.
  requireValue(argv.every((arg) => ['--data-only', '--apply', '--allow-remote', '--expect-no-writes'].includes(arg) || arg.startsWith('--backup-dir=')), 'option inconnue.');
  const dataOnly = argv.includes('--data-only');
  const apply = argv.includes('--apply');
  const expectNoWrites = argv.includes('--expect-no-writes');
  const backupArg = argv.find((arg) => arg.startsWith('--backup-dir='));
  requireValue(!apply || dataOnly, '--apply exige --data-only.');
  requireValue(!backupArg || dataOnly, '--backup-dir exige --data-only.');
  requireValue(!expectNoWrites || (dataOnly && !apply), '--expect-no-writes est une simulation --data-only sans --apply.');
  const firestoreEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const authEmulator = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST);
  requireValue(firestoreEmulator === authEmulator, 'les émulateurs Auth et Firestore doivent être configurés ensemble.');
  // Le seed complet (Auth + racines à revision 1) casserait la chaîne v1/v2 et la publication démo : émulateurs uniquement.
  requireValue(dataOnly || firestoreEmulator, 'le seed complet est réservé aux émulateurs ; utilisez --data-only.');
  const projectId = env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID || (firestoreEmulator ? 'cartularia-demo-local' : null);
  if (dataOnly) {
    requireValue(Boolean(projectId), 'GCLOUD_PROJECT ou FIREBASE_PROJECT_ID explicite requis.');
    requireValue(!env.GCLOUD_PROJECT || !env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT === env.FIREBASE_PROJECT_ID, 'identifiants de projet contradictoires.');
    requireValue(firestoreEmulator || argv.includes('--allow-remote'), '--allow-remote requis hors émulateurs, même pour la simulation.');
    requireValue(!apply || (backupArg && isAbsolute(backupArg.slice('--backup-dir='.length))), '--apply exige --backup-dir=/chemin/absolu/existant.');
  }
  return { dataOnly, apply, expectNoWrites, projectId, usesEmulator: firestoreEmulator, backupDirectory: backupArg?.slice('--backup-dir='.length) };
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

/** Projections d'accès telles qu'écrites en base : dates en Timestamp, empreinte du contenu fictif. */
export const buildDemoAccessProjections = () => buildDemoAccessDocuments().map((access) => ({
  ...access,
  issuedAt: isoTimestamp(access.issuedAt), expiresAt: isoTimestamp(access.expiresAt),
  revokedAt: isoTimestamp(access.revokedAt), lastConsultedAt: isoTimestamp(access.lastConsultedAt),
  contentHash: sha256Digest({ accessVersion: DEMO_ENRICHMENT_VERSION, access }),
}));

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

// Grammaire acceptée : création (seed) ; réparation v1 seulement en position 2 ; enrichissement v2
// au plus une fois ; publications/retraits signés par le seed démo. Le statut de publication de la
// racine doit refléter le dernier événement de publication. Retourne l'état de publication déduit.
function verifyAuditChain(state, root, uid) {
  const path = `cartularies/${root.id}/auditEvents`;
  const events = state.queries[path].map((eventPath) => docData(state, eventPath)).sort((a, b) => a.sequence - b.sequence);
  requireValue(events.length >= 1 && events.length <= MAX_AUDIT_EVENTS, `${root.id} : historique vide ou plus long que ce que la démonstration tolère.`);
  const cartularyResource = { type: 'cartulary', id: root.id };
  let previous = ZERO_HASH;
  let enriched = false;
  let publication = 'none';
  events.forEach((stored, index) => {
    const { hash, occurredAt: timestamp, occurredAtIso, ...rest } = stored;
    const event = { ...rest, occurredAt: occurredAtIso };
    requireValue(timestamp instanceof Timestamp && timestamp.toDate().toISOString() === occurredAtIso, `${root.id} : date d'audit invalide.`);
    const base = { cartularyId: root.id, sequence: index + 1, previousEventHash: previous, beforeDigest: index === 0 ? null : previous, canonicalizationVersion: CANONICALIZATION_VERSION };
    if (index === 0) {
      requireFields(event, { ...base, eventId: seedEventId(root.id), action: 'cartulary.demo.created', actor: { uid, role: 'demo_seed' }, resource: cartularyResource, requestId: `seed_demo_${root.id}` }, path);
    } else if (event.action === 'cartulary.demo.data_repaired') {
      requireValue(index === 1, `${root.id} : réparation v1 hors séquence.`);
      requireFields(event, { ...base, eventId: repairEventId(root.id), actor: { uid, role: 'demo_data_repair' }, resource: cartularyResource, requestId: `${DEMO_REPAIR_VERSION}_${root.id}` }, path);
    } else if (event.action === 'cartulary.demo.enriched') {
      requireValue(!enriched, `${root.id} : enrichissement v2 en double.`);
      requireFields(event, { ...base, eventId: enrichmentEventId(root.id), actor: { uid, role: 'demo_data_enrichment' }, resource: cartularyResource, requestId: `${DEMO_ENRICHMENT_VERSION}_${root.id}` }, path);
      enriched = true;
    } else if (Object.hasOwn(PUBLICATION_ACTIONS, event.action)) {
      requireValue(event.action === 'publication.published' || publication === 'published', `${root.id} : retrait sans publication active.`);
      requireFields(event, { ...base, actor: { uid, role: 'demo_seed' }, resource: { type: 'publication', id: root.publicCode } }, path);
      requireValue(/^evt_[A-Za-z0-9_-]+$/.test(String(event.eventId)) && typeof event.requestId === 'string' && event.requestId.length > 0, `${root.id} : événement de publication mal formé.`);
      publication = PUBLICATION_ACTIONS[event.action];
    } else {
      fail(`${root.id} : action d'audit inconnue ${event.action}.`);
    }
    requireValue(/^sha256:[a-f0-9]{64}$/.test(event.afterDigest) && hash === sha256Digest({ previousEventHash: previous, event }), `${root.id} : chaîne d'audit incohérente.`);
    previous = hash;
  });
  requireValue(root.integritySequence === events.length && root.revision === events.length && root.integrityHead === previous, `${root.id} : révision ou tête d'intégrité incohérente.`);
  requireValue(root.publicationStatus === publication, `${root.id} : statut de publication incohérent avec l'historique.`);
  return { enriched, publication };
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
    requireFields(root, Object.fromEntries(['id', 'organizationId', 'registryId', 'collectionId', 'assetType', 'schemaId', 'schemaVersion', 'schemaDigest', 'accountHolderId', 'publicCode', 'lifecycleStatus', 'defaultVisibility', 'demo'].map((key) => [key, expected[key]])), path);
    verifyAuditChain(state, root, uid);
    const oldOrCurrentPrimary = (value) => value === null || value === `${cartulary.id}-main` || value === expected.primaryAssetId;
    onlyExpectedFields(root, expected, {
      revision: (value) => value === root.integritySequence,
      // Séquence, révision et statut de publication sont déjà épinglés par verifyAuditChain.
      integritySequence: (value) => Number.isInteger(value) && value >= 1,
      publicationStatus: (value) => ['none', 'published', 'revoked'].includes(value),
      completenessLevel: (value) => COMPLETENESS_LEVELS.includes(value),
      lastVerifiedAt: (value) => value === null || value === DEMO_REVIEWED_AT,
      costBasis: (value) => value === cartulary.purchasePrice || value === expected.costBasis,
      objectCode: (value) => value === '' || value === expected.objectCode,
      primaryAssetId: oldOrCurrentPrimary,
    });
    const item = docData(state, `${REGISTRY_PATH}/items/${cartulary.id}`);
    const expectedItem = buildDemoRegistryItem(cartulary, item.contentHash);
    requireFields(item, { cartularyId: cartulary.id, organizationId: DEMO_ACCOUNT.organizationId, registryId: DEMO_ACCOUNT.registryId, assetType: 'watch', collectionId: DEMO_ACCOUNT.collectionId }, 'projection');
    requireValue(/^sha256:[a-f0-9]{64}$/.test(item.contentHash), 'empreinte de projection invalide.');
    onlyExpectedFields(item, expectedItem, {
      // Une publication avance la racine sans reprojeter le Registre : la projection peut être en retard.
      sourceRevision: (value) => Number.isInteger(value) && value >= 1 && value <= root.revision,
      completenessLevel: (value) => COMPLETENESS_LEVELS.includes(value),
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
    const reminders = buildDemoReminderDocuments(cartulary, uid);
    for (const reminderPath of state.queries[`${path}/reminders`]) {
      const expectedReminder = reminders.find((reminder) => `${path}/reminders/${reminder.id}` === reminderPath);
      requireValue(Boolean(expectedReminder), `${reminderPath} : rappel hors périmètre démo ; aucune écriture.`);
      const data = docData(state, reminderPath);
      requireFields(data, { id: expectedReminder.id, cartularyId: cartulary.id, organizationId: DEMO_ACCOUNT.organizationId, visibility: 'secret', createdBy: uid }, reminderPath);
      onlyExpectedFields(data, expectedReminder);
    }
  }
  const accesses = buildDemoAccessProjections();
  for (const accessPath of state.queries[ACCESSES_PATH]) {
    const expectedAccess = accesses.find((access) => `${ACCESSES_PATH}/${access.id}` === accessPath);
    requireValue(Boolean(expectedAccess), `${accessPath} : accès hors périmètre démo ; aucune écriture.`);
    const data = docData(state, accessPath);
    requireValue(!looksLikeRawEmail(data.recipientLabel), `${accessPath} : destinataire non masqué ; aucune donnée personnelle attendue.`);
    requireFields(data, { id: expectedAccess.id, organizationId: DEMO_ACCOUNT.organizationId, registryId: DEMO_ACCOUNT.registryId, projectionStatus: 'active' }, accessPath);
    onlyExpectedFields(data, expectedAccess, {}, ['generatedAt', 'updatedAt']);
  }
  return expectedDigest;
}

const ROOT_FIELDS = ['objectCode', 'valuationCurrency', 'purchasePrice', 'costBasis', 'grossValuation', 'saleCostAmount', 'taxAmount', 'netValuation', 'netAfterTaxValuation', 'primaryAssetId'];
const differences = (current, desired) => Object.fromEntries(Object.entries(desired).filter(([key, value]) => !equal(current[key], value)));
const hasEntries = (patch) => Object.keys(patch).length > 0;

export function buildDemoRepairPlan(state, user, schema, occurredAt) {
  const schemaDigest = assertDemoRepairScope(state, user, schema);
  const changes = [];
  const collectionPatch = differences(docData(state, COLLECTION_PATH), { name: DEMO_ACCOUNT.collectionName, websiteTitle: DEMO_ACCOUNT.collectionName });
  if (hasEntries(collectionPatch)) changes.push({ path: COLLECTION_PATH, operation: 'update', data: collectionPatch });
  for (const cartulary of DEMO_CARTULARIES) {
    const rootPath = `cartularies/${cartulary.id}`;
    const root = docData(state, rootPath);
    const expectedRoot = buildDemoCartularyEnvelope(cartulary, user.uid, root.integrityHead);
    const itemPath = `${REGISTRY_PATH}/items/${cartulary.id}`;
    const item = docData(state, itemPath);
    const migrations = [];

    // v1 : Galerie, codes, montants. Complétude et révision de projection ne lui appartiennent pas.
    const rootPatchV1 = differences(root, Object.fromEntries(ROOT_FIELDS.map((key) => [key, expectedRoot[key]])));
    const desiredItemV1 = { ...buildDemoRegistryItem(cartulary, item.contentHash), completenessLevel: item.completenessLevel, sourceRevision: item.sourceRevision };
    const itemPatchV1 = differences(item, desiredItemV1);
    const assetChanges = buildDemoAssetDocuments(cartulary).flatMap((asset) => {
      const path = `${rootPath}/assets/${asset.id}`;
      if (!state.documents[path]) return [{ path, operation: 'create', data: asset }];
      const patch = differences(state.documents[path].data, asset);
      return hasEntries(patch) ? [{ path, operation: 'update', data: patch }] : [];
    });
    if (hasEntries(rootPatchV1) || hasEntries(itemPatchV1) || assetChanges.length) {
      requireValue(root.integritySequence === 1, `${root.id} : une réparation v1 existe déjà mais les données divergent ; nouvelle migration explicite nécessaire.`);
      migrations.push({
        eventId: repairEventId(root.id), action: 'cartulary.demo.data_repaired', role: 'demo_data_repair', requestId: `${DEMO_REPAIR_VERSION}_${root.id}`,
        rootPatch: rootPatchV1, itemPatch: itemPatchV1,
        digest: sha256Digest({ repairVersion: DEMO_REPAIR_VERSION, schemaDigest, cartularyId: cartulary.id, rootPatch: rootPatchV1, registryItem: desiredItemV1, assets: buildDemoAssetDocuments(cartulary) }),
      });
    }

    // v2 : dossier revu (« Complet ») et rappels de Suivi ; un seul enrichissement par Cartulaire.
    const rootPatchV2 = differences(root, { completenessLevel: 'complete', lastVerifiedAt: DEMO_REVIEWED_AT });
    const itemPatchV2 = differences(item, { completenessLevel: 'complete' });
    const reminders = buildDemoReminderDocuments(cartulary, user.uid);
    const reminderChanges = reminders.filter((reminder) => !state.documents[`${rootPath}/reminders/${reminder.id}`])
      .map((reminder) => ({ path: `${rootPath}/reminders/${reminder.id}`, operation: 'create', data: reminder }));
    if (hasEntries(rootPatchV2) || hasEntries(itemPatchV2) || reminderChanges.length) {
      requireValue(!state.documents[`${rootPath}/auditEvents/${enrichmentEventId(root.id)}`], `${root.id} : un enrichissement v2 existe déjà mais les données divergent ; nouvelle migration explicite nécessaire.`);
      migrations.push({
        eventId: enrichmentEventId(root.id), action: 'cartulary.demo.enriched', role: 'demo_data_enrichment', requestId: `${DEMO_ENRICHMENT_VERSION}_${root.id}`,
        rootPatch: rootPatchV2, itemPatch: itemPatchV2,
        digest: sha256Digest({ enrichmentVersion: DEMO_ENRICHMENT_VERSION, schemaDigest, cartularyId: cartulary.id, rootPatch: rootPatchV2, itemPatch: itemPatchV2, reminders }),
      });
    }
    if (!migrations.length) continue;

    // Chaque migration prolonge la chaîne ; racine et projection reçoivent une seule mise à jour fusionnée.
    let previous = root.integrityHead;
    let sequence = root.integritySequence;
    const rootUpdate = {};
    const itemUpdate = {};
    const eventChanges = [];
    for (const migration of migrations) {
      sequence += 1;
      const event = {
        eventId: migration.eventId, cartularyId: root.id, sequence, occurredAt,
        actor: { uid: user.uid, role: migration.role }, action: migration.action,
        resource: { type: 'cartulary', id: root.id }, beforeDigest: previous,
        afterDigest: migration.digest, previousEventHash: previous,
        canonicalizationVersion: CANONICALIZATION_VERSION, requestId: migration.requestId,
      };
      const hash = sha256Digest({ previousEventHash: previous, event });
      Object.assign(rootUpdate, migration.rootPatch, { revision: sequence, integritySequence: sequence, integrityHead: hash });
      Object.assign(itemUpdate, migration.itemPatch, { sourceRevision: sequence, contentHash: migration.digest });
      eventChanges.push({ path: `${rootPath}/auditEvents/${event.eventId}`, operation: 'create', data: { ...event, occurredAt: Timestamp.fromDate(new Date(occurredAt)), occurredAtIso: occurredAt, hash }, audit: true });
      previous = hash;
    }
    changes.push(...assetChanges,
      { path: rootPath, operation: 'update', data: rootUpdate },
      { path: itemPath, operation: 'update', data: itemUpdate },
      ...eventChanges, ...reminderChanges,
    );
  }
  // Accès : projections de niveau Registre, sans événement d'audit de Cartulaire ; création seulement,
  // un accès existant doit déjà être identique au builder (assertDemoRepairScope).
  for (const access of buildDemoAccessProjections()) {
    const path = `${ACCESSES_PATH}/${access.id}`;
    if (!state.documents[path]) changes.push({ path, operation: 'create', data: access, stamps: ['generatedAt', 'updatedAt'] });
  }
  requireValue(changes.length < 450, 'lot trop volumineux pour une transaction bornée.');
  return { repairVersion: DEMO_REPAIR_VERSION, enrichmentVersion: DEMO_ENRICHMENT_VERSION, schemaDigest, uid: user.uid, occurredAt, changes };
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
    ...[[`${ORG_PATH}/memberships`, 1], [`${REGISTRY_PATH}/items`, 5], [`${REGISTRY_PATH}/collections`, 1], [ACCESSES_PATH, buildDemoAccessDocuments().length]]
      .map(([path, maximum]) => readQuery(path, firestore.collection(path), maximum)),
    ...schema.sections.map((id) => {
      const path = `${SCHEMA_PATH}/sections/${id}/fields`;
      return readQuery(path, firestore.collection(path), schema.fields.filter((field) => field.sectionId === id).length);
    }),
    ...DEMO_CARTULARIES.flatMap((cartulary) => [
      readQuery(`cartularies/${cartulary.id}/assets`, firestore.collection(`cartularies/${cartulary.id}/assets`), buildDemoAssetDocuments(cartulary).length),
      readQuery(`cartularies/${cartulary.id}/reminders`, firestore.collection(`cartularies/${cartulary.id}/reminders`), buildDemoReminderDocuments(cartulary, uid).length),
      readQuery(`cartularies/${cartulary.id}/auditEvents`, firestore.collection(`cartularies/${cartulary.id}/auditEvents`), MAX_AUDIT_EVENTS),
    ]),
  ]);
  return { documents, queries };
}

export const demoRepairFingerprint = (state) => sha256Digest(encodeBackupValue(state));

export function saveDemoRepairBackup(directory, projectId, state, plan) {
  requireValue(isAbsolute(directory), 'répertoire de sauvegarde absolu requis.');
  const backupDirectory = mkdtempSync(join(realpathSync(directory), `${DEMO_ENRICHMENT_VERSION}-`));
  const payload = {
    format: 'cartularia-demo-repair-backup@1', projectId, repairVersion: DEMO_REPAIR_VERSION, enrichmentVersion: DEMO_ENRICHMENT_VERSION,
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

// Horodatages serveur posés à l'écriture : createdAt/updatedAt par défaut, generatedAt/updatedAt pour
// les projections d'accès, aucun pour les événements d'audit (datés par occurredAt).
const stampKeys = (change) => (change.audit ? [] : change.stamps || (change.operation === 'create' ? ['createdAt', 'updatedAt'] : ['updatedAt']));

export async function runDemoDataRepair({ firestore, readAuth, registryEmail, options, backup = saveDemoRepairBackup, schema: suppliedSchema }) {
  const schema = suppliedSchema || verifySchemaCatalog(new URL('../../firebase/schema-catalog/', import.meta.url)).find(({ schema: artifact }) => artifact.schemaId === 'watch' && artifact.version === '1.6.0')?.schema;
  requireValue(Boolean(schema), 'contrat local watch@1.6.0 absent.');
  const user = await resolveExistingDemoUser(readAuth, registryEmail);
  const reader = { get: (reference) => reference.get() };
  const state = await readDemoRepairState(firestore, reader, user.uid, schema);
  const plan = buildDemoRepairPlan(state, user, schema, new Date().toISOString());
  const summary = { mode: options.apply ? 'apply' : 'dry-run', projectId: options.projectId, auth: 'read-only / unchanged', uid: user.uid, writes: plan.changes.map(({ path, operation }) => ({ path, operation })), schemaDigest: plan.schemaDigest };
  requireValue(!options.expectNoWrites || plan.changes.length === 0, `des écritures restent nécessaires alors que --expect-no-writes est demandé : ${plan.changes.map(({ path }) => path).join(', ')}.`);
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
      const data = { ...change.data, ...Object.fromEntries(stampKeys(change).map((key) => [key, FieldValue.serverTimestamp()])) };
      if (change.operation === 'create') transaction.create(firestore.doc(change.path), data);
      else transaction.update(firestore.doc(change.path), data);
    }
  });
  return { ...summary, applied: true, backup: saved };
}
