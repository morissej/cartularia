/**
 * Revue du propriétaire dans la synchronisation autoritaire (V5 point 4, lot B) — sans émulateur.
 *
 * `processCartularySyncRequest` (scripts/lib/live-sync-command.mjs) tourne sur le Firestore en mémoire
 * (tests/helpers/memory-firestore.mjs) : chaîne d'audit réelle (import + synchronisations), projection et
 * `contentHash` réels, quota et transaction réels. Le cas émulateur équivalent vit dans tests/live-sync.test.mjs
 * (`npm run test:live-sync`) ; celui-ci verrouille la logique sans dépendre de Java.
 * Relecture du lot B : la demande porte un `requestId` de forme production (`sync_…`, src/persistence/cloudDraft.ts),
 * distinct du jeton d'opération (UUID côté client) — l'événement d'audit dérive de la demande, jamais du jeton (F3) ;
 * chaque condition d'`assertOwnerEditor` est verrouillée séparément (F2).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIwcImportBundle, IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { markCartularySyncRequestFailed, processCartularySyncRequest, REVIEW_CONFIRMED_ACTION } from '../scripts/lib/live-sync-command.mjs';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { sha256Digest } from '../scripts/lib/canonical-json.mjs';
import { buildCartularyReviewDecision, CartularyReviewError, cartularyNeedsReview, REVIEW_OPERATION_KIND, REVIEW_STATE_KEY } from '../scripts/lib/cartulary-review-policy.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const OWNER = 'wave1-owner';
const ID = IWC_CARTULARY_ID;
const ROOT_PATH = `cartularies/${ID}`;
const ITEM_PATH = `registries/reg_collection_privee/items/${ID}`;
const DRAFT_PATH = `privateDrafts/${OWNER}/cartularies/${ID}`;
const REQUEST_PATH = `cartularySyncRequests/${ID}`;
const IMPORT_AT = '2026-09-15T08:00:00.000Z';
const FIRST_SYNC_AT = '2026-09-15T08:05:00.000Z';
const REVIEW_AT = '2026-09-15T10:00:00.000Z';
const SECOND_REVIEW_AT = '2026-09-15T11:00:00.000Z';
const LATER_SYNC_AT = '2026-09-15T12:00:00.000Z';

const seed = async () => {
  const firestore = createMemoryFirestore({
    'organizations/org_demo': { id: 'org_demo', status: 'active' },
    'registries/reg_collection_privee': { id: 'reg_collection_privee', organizationId: 'org_demo', status: 'active', itemCount: 0 },
    'registries/reg_collection_privee/collections/col_pilots': { id: 'col_pilots', registryId: 'reg_collection_privee', organizationId: 'org_demo', status: 'active' },
    'registries/reg_collection_privee/collections/col_after_review': { id: 'col_after_review', registryId: 'reg_collection_privee', organizationId: 'org_demo', status: 'draft' },
    [`organizations/org_demo/memberships/${OWNER}`]: {
      uid: OWNER, organizationId: 'org_demo', roles: ['account_holder', 'legal_owner'], status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] }, permissions: ['registry.read', 'cartulary.read', 'cartulary.edit', 'publication.manage'],
    },
    'schemaCatalog/watch/versions/1.3.0': { schemaId: 'watch', assetType: 'watch', version: '1.3.0', status: 'baseline' },
    [DRAFT_PATH]: { ownerUid: OWNER, cartularyId: ID, status: 'active' },
  });
  await importCartularyBundle({ firestore, bundle: buildIwcImportBundle(), requestId: 'test-review-import-v1', actorId: OWNER, occurredAt: IMPORT_AT });
  return firestore;
};

let stateClock = 100;
const writeState = (firestore, key, value, { revision = 1 } = {}) => firestore.doc(`${DRAFT_PATH}/state/${key}`).set({
  ownerUid: OWNER, cartularyId: ID, key, value: JSON.stringify(value), deleted: false, revision, clientUpdatedAt: (stateClock += 1),
});
const requestSync = (firestore, requestId, reason = 'private_draft_synchronized') => firestore.doc(REQUEST_PATH).set({
  requestDocumentId: ID, requestId, ownerUid: OWNER, cartularyId: ID, reason, status: 'pending',
});
const sync = (firestore, occurredAt) => processCartularySyncRequest({ firestore, requestDocumentId: ID, occurredAt });
const root = (firestore) => firestore.dump()[ROOT_PATH];
const item = (firestore) => firestore.dump()[ITEM_PATH];
const auditEvents = async (firestore) => (await firestore.collection(`${ROOT_PATH}/auditEvents`).orderBy('sequence').get()).docs.map((document) => document.data());
const chainOf = async (firestore) => verifyAuditChain({ events: await auditEvents(firestore), integrityHead: root(firestore).integrityHead, integritySequence: root(firestore).integritySequence });
/** Motif de tests/live-sync.test.mjs l.189-190 : aides de présentation et horodatages hors contentHash. */
const projectionOf = (record) => {
  const { thumbnail: _thumbnail, primaryMediaKind: _kind, thumbnailStatus: _status, contentHash, generatedAt: _generatedAt, updatedAt: _updatedAt, ...projection } = record;
  return { contentHash, projection };
};
/** Identifiant de demande de forme production (cloudDraft.ts : `sync_<ts36>_<16 hex>`, motif des règles `^sync_[a-z0-9_]{16,96}$`). */
let requestClock = 0;
const nextRequestId = () => `sync_${(requestClock += 1).toString(36).padStart(8, '0')}_${'0123456789abcdef'}`;
/** Le lecteur unique écrit la décision et le marqueur dans la même transaction (genericCartulary.ts, B5) puis demande la synchronisation. */
const writeReview = async (firestore, { level, token, requestId = nextRequestId(), baseRevision = root(firestore).revision, revision = 1, decision = buildCartularyReviewDecision({ baseRevision, level }) }) => {
  assert.notEqual(requestId, token, 'la demande et le jeton sont deux identifiants distincts, comme en production');
  await writeState(firestore, REVIEW_STATE_KEY, decision, { revision });
  await writeState(firestore, 'cartularia-generic-operation', { kind: REVIEW_OPERATION_KIND, token }, { revision });
  await requestSync(firestore, requestId);
  return requestId;
};
const rejectsWithCode = (promise, code, name = 'CartularyReviewError') => assert.rejects(promise, (error) => {
  assert.equal(error.name, name);
  assert.equal(error.code, code);
  if (name === 'CartularyReviewError') assert.ok(error instanceof CartularyReviewError);
  return true;
});
const withoutVolatile = (record) => {
  const { updatedAt: _updatedAt, liveStateUpdatedAt: _liveStateUpdatedAt, ...rest } = record;
  return rest;
};

test('une synchronisation sans marqueur ne touche ni le statut, ni le palier, ni la date de revue (compatibilité)', async () => {
  const firestore = await seed();
  await writeState(firestore, 'cartularia-user-alias', 'Alias avant revue');
  await requestSync(firestore, 'sync_review_plain_00000000000001');
  const result = await sync(firestore, FIRST_SYNC_AT);
  assert.deepEqual([result.status, result.outcome, result.revision], ['processed', 'updated', 2]);
  const after = root(firestore);
  assert.deepEqual([after.lifecycleStatus, after.completenessLevel, after.lastVerifiedAt, after.userAlias], ['review', 'imported_unreviewed', null, 'Alias avant revue']);
  assert.deepEqual([item(firestore).lifecycleStatus, item(firestore).completenessLevel], ['review', 'imported_unreviewed']);
  assert.equal(cartularyNeedsReview(after), true);
  assert.equal(cartularyNeedsReview(item(firestore)), true);
  const events = await auditEvents(firestore);
  assert.deepEqual(events.map((event) => event.action), ['cartulary.created', 'cartulary.live_state.synced']);
  assert.deepEqual(events.at(-1).resource, { type: 'liveState', id: 'current' });
  assert.equal(events.at(-1).eventId, `evt_${sha256Digest('cartulary.live_state.synced:sync_review_plain_00000000000001').slice(7, 31)}`, 'graine d’eventId inchangée pour la synchronisation ordinaire');
  assert.equal((await chainOf(firestore)).valid, true);
});

test('revue partielle : racine active/partial datée par le serveur, projection et contentHash, événement cartulary.review.confirmed, rejeu no_change, mise à jour en dossier complet', async () => {
  const firestore = await seed();
  await writeState(firestore, 'cartularia-user-alias', 'Alias avant revue');
  await requestSync(firestore, 'sync_review_plain_00000000000001');
  await sync(firestore, FIRST_SYNC_AT);
  const before = root(firestore);
  assert.equal(before.revision, 2);

  // Une affectation de Collection héritée déposée en même temps que la revue n'est pas réappliquée (genericContext).
  await writeState(firestore, 'cartularia-collection-id', 'col_after_review');
  const token = 'e7a4c1d2-3b5f-4a6e-9c8d-0f1e2d3c4b5a';
  const requestId = await writeReview(firestore, { level: 'partial', token });
  const result = await sync(firestore, REVIEW_AT);
  assert.deepEqual([result.status, result.outcome, result.revision], ['processed', 'updated', 3]);

  const after = root(firestore);
  assert.deepEqual([after.lifecycleStatus, after.completenessLevel, after.lastVerifiedAt], ['active', 'partial', REVIEW_AT], 'review → active, palier choisi, heure serveur');
  assert.equal(after.lastGenericOperationToken, token, 'jeton consommé : idempotence sans reviewDigest');
  assert.equal(after.collectionId, 'col_pilots', 'aucune Collection héritée réappliquée pendant une revue (genericContext, comme pour media et sections)');
  assert.equal(cartularyNeedsReview(after), false);
  const untouched = ['displayTitle', 'makerName', 'modelName', 'referenceCode', 'manufactureYear', 'userAlias', 'objectCode', 'primaryAssetId', 'possessionStatus', 'publicationStatus', 'defaultVisibility', 'schemaId', 'schemaVersion', 'accountHolderId'];
  assert.deepEqual(untouched.map((key) => after[key]), untouched.map((key) => before[key]), 'la revue ne réécrit rien d’autre');
  const changedKeys = Object.keys(withoutVolatile(after)).filter((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key])).sort();
  assert.deepEqual(changedKeys, ['completenessLevel', 'integrityHead', 'integritySequence', 'lastGenericOperationToken', 'lastVerifiedAt', 'legacyCollectionDigest', 'lifecycleStatus', 'liveStateDigest', 'revision']);

  // Projection : le Registre suit ; lastVerifiedAt n'y entre pas (D3-a) ; contentHash porte les nouvelles valeurs.
  const projected = item(firestore);
  assert.deepEqual([projected.lifecycleStatus, projected.completenessLevel, projected.sourceRevision, projected.projectionStatus], ['active', 'partial', 3, 'active']);
  assert.equal('lastVerifiedAt' in projected, false, 'liste blanche ADR-015 inchangée');
  assert.equal(cartularyNeedsReview(projected), false, 'le compteur « À revoir » du Registre décroît');
  const { contentHash, projection } = projectionOf(projected);
  assert.equal(contentHash, sha256Digest(projection), 'contentHash = sha256Digest(projection) hors aides de présentation');
  assert.equal(contentHash, result.contentHash);
  assert.equal(JSON.stringify(projected).includes(OWNER), false, 'aucun uid dans l’item');

  // Chaîne d'audit : un événement dédié, ressource = le Cartulaire, eventId dérivé de l'action et de la demande — jamais du jeton.
  const events = await auditEvents(firestore);
  const reviewEvent = events.at(-1);
  assert.equal(REVIEW_CONFIRMED_ACTION, 'cartulary.review.confirmed');
  assert.deepEqual([reviewEvent.action, reviewEvent.resource, reviewEvent.sequence, reviewEvent.requestId], [REVIEW_CONFIRMED_ACTION, { type: 'cartulary', id: ID }, 3, requestId]);
  assert.deepEqual(reviewEvent.actor, { uid: OWNER, role: 'legal_owner' });
  assert.equal(reviewEvent.eventId, `evt_${sha256Digest(`${REVIEW_CONFIRMED_ACTION}:${requestId}`).slice(7, 31)}`);
  assert.notEqual(reviewEvent.eventId, `evt_${sha256Digest(`${REVIEW_CONFIRMED_ACTION}:${token}`).slice(7, 31)}`, 'la graine est la demande, pas le jeton');
  assert.equal(JSON.stringify(reviewEvent).includes(token), false, 'le jeton d’opération n’entre pas dans la chaîne de preuves');
  assert.equal(reviewEvent.occurredAtIso, REVIEW_AT);
  assert.equal(reviewEvent.afterDigest, after.liveStateDigest);
  const chain = await chainOf(firestore);
  assert.deepEqual([chain.valid, chain.eventCount], [true, 3]);
  const request = firestore.dump()[REQUEST_PATH];
  assert.deepEqual([request.status, request.outcome, request.sourceRevision, request.auditEventId, request.contentHash], ['processed', 'updated', 3, reviewEvent.eventId, contentHash]);
  // La décision reste recopiée dans liveState comme toute clé de brouillon ; elle est inerte une fois le jeton consommé.
  assert.equal(JSON.parse(firestore.dump()[`${ROOT_PATH}/liveState/${REVIEW_STATE_KEY}`].value).level, 'partial');

  // Rejeu du même brouillon : no_change, aucune nouvelle révision, date conservée, aucun événement supplémentaire.
  await requestSync(firestore, 'sync_review_replay_0000000000002', 'manual_retry');
  const replay = await sync(firestore, SECOND_REVIEW_AT);
  assert.deepEqual([replay.status, replay.outcome, replay.revision], ['processed', 'no_change', 3]);
  assert.deepEqual([root(firestore).revision, root(firestore).lastVerifiedAt, root(firestore).completenessLevel], [3, REVIEW_AT, 'partial']);
  assert.equal((await chainOf(firestore)).eventCount, 3);

  // « Mettre à jour la revue » : nouveau jeton, palier complet, date mise à jour, statut toujours actif.
  const secondToken = 'op_review_complete_00000000002';
  await writeReview(firestore, { level: 'complete', token: secondToken, requestId: 'sync_review_update_0000000000004', revision: 2 });
  const updated = await sync(firestore, SECOND_REVIEW_AT);
  assert.deepEqual([updated.outcome, updated.revision], ['updated', 4]);
  assert.deepEqual([root(firestore).lifecycleStatus, root(firestore).completenessLevel, root(firestore).lastVerifiedAt, root(firestore).lastGenericOperationToken], ['active', 'complete', SECOND_REVIEW_AT, secondToken]);
  assert.deepEqual([item(firestore).lifecycleStatus, item(firestore).completenessLevel], ['active', 'complete']);
  const secondChain = await chainOf(firestore);
  assert.deepEqual([secondChain.valid, secondChain.eventCount, (await auditEvents(firestore)).at(-1).action], [true, 4, REVIEW_CONFIRMED_ACTION]);

  // Synchronisation ordinaire ultérieure (jeton consommé, clé cartularia-review inerte) : la revue est conservée telle quelle.
  await writeState(firestore, 'cartularia-user-alias', 'Alias après revue', { revision: 2 });
  await requestSync(firestore, 'sync_review_later_00000000000003');
  const later = await sync(firestore, LATER_SYNC_AT);
  assert.deepEqual([later.outcome, later.revision], ['updated', 5]);
  const final = root(firestore);
  assert.deepEqual([final.userAlias, final.lifecycleStatus, final.completenessLevel, final.lastVerifiedAt], ['Alias après revue', 'active', 'complete', SECOND_REVIEW_AT]);
  assert.equal((await auditEvents(firestore)).at(-1).action, 'cartulary.live_state.synced');
  assert.equal((await chainOf(firestore)).valid, true);
});

test('une décision périmée est refusée en revision_conflict : racine et Registre intacts, code recopié sur la demande', async () => {
  const firestore = await seed();
  await writeState(firestore, 'cartularia-user-alias', 'Alias');
  await requestSync(firestore, 'sync_review_plain_00000000000001');
  await sync(firestore, FIRST_SYNC_AT);
  const before = firestore.dump();
  const token = 'op_review_stale_0000000000000009';
  const requestId = await writeReview(firestore, { level: 'partial', token, baseRevision: before[ROOT_PATH].revision - 1 });
  await rejectsWithCode(sync(firestore, REVIEW_AT), 'revision_conflict');
  assert.deepEqual(root(firestore), before[ROOT_PATH], 'racine intacte');
  assert.deepEqual(item(firestore), before[ITEM_PATH], 'projection intacte');
  assert.equal((await chainOf(firestore)).eventCount, 2);
  await markCartularySyncRequestFailed({ firestore, requestDocumentId: ID, requestId, error: new CartularyReviewError('revision_conflict', 'périmée') });
  assert.deepEqual([firestore.dump()[REQUEST_PATH].status, firestore.dump()[REQUEST_PATH].errorCode], ['failed', 'revision_conflict']);
  // Rejouée avec la révision courante, la même décision passe : le conflit n'est pas persistant au-delà du rejeu.
  await writeReview(firestore, { level: 'partial', token: 'op_review_retry_000000000000010', revision: 2 });
  assert.equal((await sync(firestore, SECOND_REVIEW_AT)).outcome, 'updated');
  assert.deepEqual([root(firestore).lifecycleStatus, root(firestore).completenessLevel, root(firestore).lastVerifiedAt], ['active', 'partial', SECOND_REVIEW_AT]);
});

test('un Cartulaire suspendu, cédé ou archivé refuse la revue (review_not_allowed) sans rien écrire', async () => {
  for (const lifecycleStatus of ['suspended', 'transferred', 'archived']) {
    const firestore = await seed();
    await firestore.doc(ROOT_PATH).update({ lifecycleStatus });
    const before = firestore.dump();
    await writeReview(firestore, { level: 'complete', token: `op_review_denied_${lifecycleStatus}_0001` });
    await rejectsWithCode(sync(firestore, REVIEW_AT), 'review_not_allowed');
    assert.deepEqual(root(firestore), before[ROOT_PATH], lifecycleStatus);
    assert.equal(firestore.dump()[ITEM_PATH], undefined, `${lifecycleStatus} : aucune projection écrite`);
    assert.equal((await chainOf(firestore)).eventCount, 1, lifecycleStatus);
  }
});

test('assertOwnerEditor verrouille chaque condition séparément : sans legal_owner, sans cartulary.edit, suspendu, Registre hors périmètre ou autre uid → permission_denied sans rien écrire', async () => {
  const membershipPath = `organizations/org_demo/memberships/${OWNER}`;
  const variants = {
    'sans legal_owner': { roles: ['account_holder'] },
    'sans cartulary.edit': { permissions: ['registry.read', 'cartulary.read', 'publication.manage'] },
    'adhésion suspendue': { status: 'suspended' },
    'Registre hors périmètre': { scopes: { registryIds: ['reg_autre'] } },
    'autre uid': { uid: 'wave1-other' },
  };
  for (const [label, patch] of Object.entries(variants)) {
    const firestore = await seed();
    await firestore.doc(membershipPath).set(patch, { merge: true });
    const before = firestore.dump();
    await writeReview(firestore, { level: 'complete', token: `op_review_denied_${Object.keys(variants).indexOf(label)}_00000001` });
    await rejectsWithCode(sync(firestore, REVIEW_AT), 'permission_denied', 'LiveSyncCommandError');
    assert.deepEqual(root(firestore), before[ROOT_PATH], `${label} : racine intacte`);
    assert.equal(firestore.dump()[ITEM_PATH], undefined, `${label} : aucune projection écrite`);
    assert.equal((await chainOf(firestore)).eventCount, 1, `${label} : aucun événement`);
    assert.equal(firestore.dump()[`${ROOT_PATH}/liveState/${REVIEW_STATE_KEY}`], undefined, `${label} : décision non recopiée`);
  }
  // Témoin : l'adhésion intacte accepte la même revue.
  const firestore = await seed();
  await writeReview(firestore, { level: 'complete', token: 'op_review_granted_0000000000001' });
  assert.deepEqual([(await sync(firestore, REVIEW_AT)).outcome, root(firestore).completenessLevel], ['updated', 'complete']);
});

test('une décision hors contrat est refusée en invalid_review ; un genre inconnu reste invalid_generic_operation', async () => {
  const firestore = await seed();
  const before = firestore.dump();
  await writeReview(firestore, { level: 'partial', token: 'op_review_invalid_000000000011', decision: { version: 1, baseRevision: 1, level: 'total', decisionSource: 'human_confirmed' } });
  await rejectsWithCode(sync(firestore, REVIEW_AT), 'invalid_review');
  assert.deepEqual(root(firestore), before[ROOT_PATH]);
  await writeReview(firestore, { level: 'partial', token: 'op_review_client_0000000000012', revision: 2, decision: { ...buildCartularyReviewDecision({ baseRevision: 1, level: 'partial' }), reviewedAt: REVIEW_AT } });
  await rejectsWithCode(sync(firestore, REVIEW_AT), 'invalid_review');
  assert.deepEqual(root(firestore), before[ROOT_PATH], 'aucune date client acceptée');
  await writeState(firestore, 'cartularia-generic-operation', { kind: 'audit', token: 'op_unknown_kind_00000000000013' }, { revision: 3 });
  await requestSync(firestore, 'op_unknown_kind_00000000000013');
  await rejectsWithCode(sync(firestore, REVIEW_AT), 'invalid_generic_operation', 'LiveSyncCommandError');
  assert.deepEqual(root(firestore), before[ROOT_PATH]);
});

test('le marqueur review sans décision ne lève rien : la synchronisation consomme le jeton sans changer le statut', async () => {
  const firestore = await seed();
  await writeState(firestore, 'cartularia-generic-operation', { kind: REVIEW_OPERATION_KIND, token: 'op_review_orphan_000000000014' });
  await requestSync(firestore, 'op_review_orphan_000000000014');
  const result = await sync(firestore, REVIEW_AT);
  assert.deepEqual([result.outcome, result.revision], ['updated', 2]);
  assert.deepEqual([root(firestore).lifecycleStatus, root(firestore).completenessLevel, root(firestore).lastVerifiedAt, root(firestore).lastGenericOperationToken], ['review', 'imported_unreviewed', null, 'op_review_orphan_000000000014']);
  assert.equal((await auditEvents(firestore)).at(-1).action, 'cartulary.live_state.synced', 'aucun événement de revue sans décision');
});
