import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IWC_CARTULARY_ID, ROLEX_CARTULARY_ID } from '../src/domain/cartularyIds.ts';
import { normalizeWatchCreationProfile } from '../src/persistence/storedStateValidation.ts';
import { buildCreationBundle } from '../scripts/lib/create-cartulary-command.mjs';
import {
  buildIwcCreationProfile,
  buildIwcEditableCopy,
  IWC_ORIGIN_TITLE,
  IWC_PUBLIC_CODE,
  IWC_SENSITIVITY_PRICES,
  IWC_UPDATE_DATE,
} from '../scripts/lib/iwc-dossier-values.mjs';
import {
  applyIwcProfileKeys,
  creationProfileValuationEffects,
  describeDifference,
  describeIwcProfilePlan,
  describeOwnerMembership,
  describeRootValuation,
  describeValuationKeys,
  IWC_EDITABLE_COPY_KEY,
  IWC_PROFILE_KEYS,
  IWC_PROFILE_KEYS_USAGE,
  IWC_PROFILE_SYNC_REASON,
  IWC_VALUATION_STATE_KEYS,
  iwcProfileWarnings,
  loadIwcProfileContext,
  parseIwcProfileKeysArgs,
  planIwcProfileKeys,
  REPORT_CLASSIFICATION,
  resolveIwcOwner,
  runIwcProfileKeysCli,
  SAME_CONTENT_MARKER,
  shortDigestOf,
} from '../scripts/lib/iwc-profile-keys-command.mjs';
import { processCartularySyncRequest } from '../scripts/lib/live-sync-command.mjs';
import { ZERO_AUDIT_HASH } from '../scripts/lib/audit-verifier.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const OWNER = 'uid_reel_prod';
const ID = IWC_CARTULARY_ID;
const ROLEX_PUBLIC_CODE = 'ROL-487D9CAD';
const DRAFT = `privateDrafts/${OWNER}/cartularies/${ID}`;
const STATE = `${DRAFT}/state`;
const SYNC = `cartularySyncRequests/${ID}`;
const MEMBERSHIP = `organizations/org_demo/memberships/${OWNER}`;
const NOW = Date.parse('2026-09-08T09:00:00.000Z');
const REQUEST_ID = 'iwc_profile_keys_20260908_0123456789ab';
const REMOTE_ENV = { GCLOUD_PROJECT: 'projet-fictif' };
const SIMPLE_KEYS = ['cartularia-creation-profile', 'cartularia-public-code', 'cartularia-sensitivity-prices'];

const editableCopyWithoutTitle = () => {
  const { originTitle: _title, ...rest } = buildIwcEditableCopy();
  return rest;
};
const stateDocument = (key, value, { revision = 3, deleted = false, ownerUid = OWNER, cartularyId = ID } = {}) => ({
  ownerUid, cartularyId, key, value: JSON.stringify(value), deleted, revision, clientUpdatedAt: 1756425600000, updatedAt: 'ts-2026-08-29',
});
const rootDocument = (id, extra = {}) => ({
  id, accountHolderId: OWNER, registryId: 'reg_collection_privee', organizationId: 'org_demo', schemaId: 'watch', schemaVersion: '1.3.0',
  publicCode: IWC_PUBLIC_CODE, objectCode: IWC_PUBLIC_CODE, makerName: 'IWC Schaffhausen',
  revision: 7, valuationCurrency: 'EUR', liveStateDigest: `sha256:${'1'.repeat(64)}`, legacyMediaDigest: `sha256:${'2'.repeat(64)}`, legacyCollectionDigest: `sha256:${'3'.repeat(64)}`, ...extra,
});
/** Racine Rolex telle que créée depuis le Registre (publicCode et objectCode ROL-487D9CAD). */
const rolexDocuments = () => ({
  [`cartularies/${ROLEX_CARTULARY_ID}`]: rootDocument(ROLEX_CARTULARY_ID, { publicCode: ROLEX_PUBLIC_CODE, objectCode: ROLEX_PUBLIC_CODE, makerName: 'Rolex', revision: 13 }),
  [`privateDrafts/${OWNER}/cartularies/${ROLEX_CARTULARY_ID}`]: { ownerUid: OWNER, cartularyId: ROLEX_CARTULARY_ID, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1', purgeAfter: null, lastActiveAt: 'ts-before', updatedAt: 'ts-before' },
  [`privateDrafts/${OWNER}/cartularies/${ROLEX_CARTULARY_ID}/state/cartularia-editable-copy`]: stateDocument('cartularia-editable-copy', { heroSummary: 'GMT-Master' }, { revision: 2, cartularyId: ROLEX_CARTULARY_ID }),
  [`privateDrafts/${OWNER}/cartularies/${ROLEX_CARTULARY_ID}/state/cartularia-public-code`]: stateDocument('cartularia-public-code', ROLEX_PUBLIC_CODE, { revision: 1, cartularyId: ROLEX_CARTULARY_ID }),
});
/** Membership tel qu'exigé par assertOwnerEditor (live-sync-command.mjs) ; `null` pour ne pas le seeder. */
const membershipDocument = (extra = {}) => ({
  uid: OWNER, organizationId: 'org_demo', status: 'active', roles: ['legal_owner'], permissions: ['cartulary.edit', 'publication.manage'], scopes: { registryIds: ['reg_collection_privee'] }, ...extra,
});
const seed = ({ editableCopy = editableCopyWithoutTitle(), root = {}, draft = {}, syncStatus = 'processed', membership = membershipDocument(), documents = {} } = {}) => createMemoryFirestore({
  [`cartularies/${ID}`]: rootDocument(ID, root),
  ...(membership ? { [MEMBERSHIP]: membership } : {}),
  [DRAFT]: { ownerUid: OWNER, cartularyId: ID, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1', purgeAfter: null, lastActiveAt: 'ts-before', updatedAt: 'ts-before', ...draft },
  [`${STATE}/cartularia-editable-copy`]: stateDocument('cartularia-editable-copy', editableCopy, { revision: 2 }),
  [`${STATE}/cartularia-media-assets-v3`]: stateDocument('cartularia-media-assets-v3', [{ id: 'iwc-asset-1', binaryId: 'iwc_bin_1', hash: 'sha256:abc', tags: ['main-photo'] }]),
  [`${STATE}/cartularia-purchase`]: stateDocument('cartularia-purchase', { date: '2002-03-08', purchasePrice: 3200 }),
  [`${STATE}/cartularia-retained-valuation`]: stateDocument('cartularia-retained-valuation', { amount: 2500, saleCostAmount: 375, taxAmount: 0 }),
  [`${DRAFT}/binaries/iwc_bin_1`]: { binaryId: 'iwc_bin_1', sha256: 'sha256:abc', uploadStatus: 'ready', verificationStatus: 'accepted', revision: 1 },
  ...(syncStatus ? { [SYNC]: { requestDocumentId: ID, requestId: 'sync_prev', ownerUid: OWNER, cartularyId: ID, status: syncStatus, outcome: syncStatus === 'processed' ? 'updated' : null, reason: 'private_draft_synchronized', processedAt: '2026-08-30T10:00:00.000Z' } } : {}),
  ...documents,
});
const serverDate = () => new Date(NOW + 500);
const run = async (firestore, { cartularyId = ID, overrideUid = null, dryRun = false, requestSync = false, allowPartial = false, beforeApply = null } = {}) => {
  const owner = await resolveIwcOwner({ firestore, cartularyId, overrideUid });
  const context = await loadIwcProfileContext({ firestore, ownerUid: owner.ownerUid, cartularyId });
  const plan = planIwcProfileKeys({ states: context.states, now: () => NOW });
  if (beforeApply) await beforeApply();
  const result = await applyIwcProfileKeys({ firestore, cartularyId, ownerUid: owner.ownerUid, plan, dryRun, requestSync, allowPartial, now: () => NOW, requestId: REQUEST_ID, serverTimestamp: serverDate });
  return { owner, context, plan, result };
};
const changedPaths = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
  .sort();
const actions = (plan) => Object.fromEntries(plan.entries.map((entry) => [entry.key, entry.action]));
const rejectsWithCode = (promise, code, extra = {}) => assert.rejects(promise, (error) => {
  assert.equal(error.name, 'IwcProfileKeysCommandError');
  assert.equal(error.code, code);
  for (const [field, value] of Object.entries(extra)) assert.equal(error[field], value, field);
  return true;
});
const cliCapture = () => {
  const out = [];
  const err = [];
  return {
    stdout: { write: (chunk) => out.push(String(chunk)) },
    stderr: { write: (chunk) => err.push(String(chunk)) },
    out: () => out.join(''),
    err: () => err.join(''),
    report: () => JSON.parse(out.join('')),
  };
};
const cliRun = async (firestore, argv, env = REMOTE_ENV) => {
  const capture = cliCapture();
  const outcome = await runIwcProfileKeysCli({ argv, env, firestore, stdout: capture.stdout, stderr: capture.stderr, now: () => NOW, requestId: REQUEST_ID });
  return { ...outcome, capture };
};
const SECRET_LITERALS = ['2715537', '3200', 'Aldebert', '1000,2000', '[1000'];
const assertNoValueLeak = (report) => {
  const serialized = JSON.stringify(report);
  for (const literal of SECRET_LITERALS) assert.ok(!serialized.includes(literal), `valeur exposée dans le rapport : ${literal}`);
  assert.doesNotMatch(serialized, /nextValue|currentPreview|sha256:[0-9a-f]{64}/);
};

test('(a) les valeurs IWC partagées sont un profil de création valide, aux littéraux attendus, sérialisé dans l’ordre du 29/08/2026', () => {
  const profile = buildIwcCreationProfile();
  assert.deepEqual(normalizeWatchCreationProfile(profile), profile, 'accepté tel quel par normalizeWatchCreationProfile');
  const bundle = buildCreationBundle({
    requestData: { cartularyId: ID, organizationId: 'org_demo', registryId: 'reg_collection_privee', publicCode: IWC_PUBLIC_CODE, ownerUid: OWNER },
    profile,
    media: [{ id: 'asset_x', binaryId: 'bin_x', type: 'image', name: 'x.jpg', mimeType: 'image/jpeg', tags: ['main-photo'], storagePath: `private-drafts/${OWNER}/x/bin_x/abc/original` }],
  });
  assert.equal(bundle.envelope.id, ID);
  assert.equal(bundle.envelope.schemaVersion, '1.6.0');
  assert.ok(bundle.sections.length > 0);
  assert.equal(IWC_PUBLIC_CODE, 'OP-4892-XZ9');
  assert.deepEqual([...IWC_SENSITIVITY_PRICES], [3200, 3600, 4000, 4400, 4800]);
  assert.equal(IWC_ORIGIN_TITLE, 'Une montre de pilote pensée pour voyager');
  assert.equal(IWC_UPDATE_DATE, '2026-08-29');
  assert.equal(profile.assertedAt, '2026-08-29T00:00:00.000Z');
  assert.equal(profile.description, buildIwcEditableCopy().heroSummary);
  assert.ok(JSON.stringify(buildIwcEditableCopy()).startsWith('{"originTitle":'), 'ordre des clés conservé');
  assert.notEqual(buildIwcEditableCopy(), buildIwcEditableCopy(), 'copies fraîches');
  assert.deepEqual([...IWC_PROFILE_KEYS], ['cartularia-creation-profile', 'cartularia-public-code', 'cartularia-sensitivity-prices', 'cartularia-editable-copy']);
});

test('(b) le propriétaire vient de accountHolderId ; surcharge égale acceptée, différente refusée ; racine ou brouillon manquants refusés sans écriture', async () => {
  const firestore = seed();
  const before = firestore.dump();
  const deduced = await resolveIwcOwner({ firestore, cartularyId: ID });
  assert.equal(deduced.ownerUid, OWNER);
  assert.equal(deduced.ownerSource, 'root');
  assert.deepEqual(deduced.target, { cartularyId: ID, isDefaultId: true, matchedBy: 'publicCode' });
  assert.deepEqual(deduced.root, {
    id: ID, revision: 7, accountHolderId: OWNER, organizationId: 'org_demo', registryId: 'reg_collection_privee', publicCode: IWC_PUBLIC_CODE, objectCode: IWC_PUBLIC_CODE, makerName: 'IWC Schaffhausen', schemaId: 'watch', schemaVersion: '1.3.0', valuationCurrency: 'EUR',
    valuation: { purchasePrice: null, costBasis: null, grossValuation: null, netValuation: null, valuationCurrency: 'EUR', present: [] },
    hasLiveStateDigest: true, hasLegacyMediaDigest: true, hasLegacyCollectionDigest: true,
  }, 'ni lastGenericOperationToken ni autre jeton dans le rapport');
  assert.deepEqual(deduced.membership, { path: MEMBERSHIP, exists: true, ok: true, missing: [] }, 'précondition de synchronisation lue');
  const byDefault = await resolveIwcOwner({ firestore });
  assert.equal(byDefault.target.cartularyId, IWC_CARTULARY_ID, 'cible par défaut : IWC_CARTULARY_ID');
  const overridden = await resolveIwcOwner({ firestore, cartularyId: ID, overrideUid: OWNER });
  assert.equal(overridden.ownerSource, 'env');
  await rejectsWithCode(resolveIwcOwner({ firestore, cartularyId: ID, overrideUid: 'wave1-owner' }), 'owner_mismatch', { requestedUid: 'wave1-owner', rootOwnerUid: OWNER });
  await assert.rejects(resolveIwcOwner({ firestore, cartularyId: ID, overrideUid: 'wave1-owner' }), (error) => {
    assert.doesNotMatch(error.message, /wave1-owner|uid_reel_prod/, 'les uid restent hors du message (journaux de session)');
    return true;
  });
  await rejectsWithCode(resolveIwcOwner({ firestore, cartularyId: 'cart_absent_000000' }), 'cartulary_not_found');
  await rejectsWithCode(loadIwcProfileContext({ firestore, ownerUid: 'wave1-owner', cartularyId: ID }), 'draft_not_ready');
  assert.deepEqual(firestore.dump(), before, 'aucune écriture');

  await rejectsWithCode(resolveIwcOwner({ firestore: seed({ root: { deletedAt: '2026-09-01T00:00:00.000Z' } }), cartularyId: ID }), 'cartulary_deleted');
  await rejectsWithCode(resolveIwcOwner({ firestore: seed({ root: { accountHolderId: '' } }), cartularyId: ID }), 'owner_unknown');
  await rejectsWithCode(loadIwcProfileContext({ firestore: seed({ draft: { status: 'purged' } }), ownerUid: OWNER, cartularyId: ID }), 'draft_not_ready');
  for (const status of ['pending', 'processing']) {
    const busy = seed({ syncStatus: status });
    const snapshot = busy.dump();
    await rejectsWithCode(run(busy), 'sync_in_progress', { stage: 'context', syncStatus: status, syncRequestId: 'sync_prev' });
    assert.deepEqual(busy.dump(), snapshot, `aucune écriture pendant une synchro ${status}`);
  }
});

test('(b bis) garde de cible : une racine Rolex ou une racine sans code de marque étrangère est refusée (not_iwc_cartulary) sans écriture', async () => {
  // Racine Rolex sous l'identifiant IWC (mauvaise cible malgré l'identifiant par défaut).
  const rolexUnderIwcId = seed({ root: { publicCode: ROLEX_PUBLIC_CODE, objectCode: ROLEX_PUBLIC_CODE, makerName: 'Rolex' } });
  let snapshot = rolexUnderIwcId.dump();
  await rejectsWithCode(resolveIwcOwner({ firestore: rolexUnderIwcId, cartularyId: ID }), 'not_iwc_cartulary');
  assert.deepEqual(rolexUnderIwcId.dump(), snapshot);

  // Racine Rolex de production sous son identifiant, ciblée explicitement.
  const withRolex = seed({ documents: rolexDocuments() });
  snapshot = withRolex.dump();
  await rejectsWithCode(run(withRolex, { cartularyId: ROLEX_CARTULARY_ID }), 'not_iwc_cartulary');
  assert.deepEqual(withRolex.dump(), snapshot, 'brouillon Rolex intact');
  assert.equal(withRolex.dump()[`privateDrafts/${OWNER}/cartularies/${ROLEX_CARTULARY_ID}/state/cartularia-creation-profile`], undefined);

  // Seul objectCode présent et IWC : accepté par objectCode.
  const objectCodeOnly = seed({ root: { publicCode: undefined, objectCode: IWC_PUBLIC_CODE, makerName: 'IWC Schaffhausen' } });
  assert.equal((await resolveIwcOwner({ firestore: objectCodeOnly, cartularyId: ID })).target.matchedBy, 'objectCode');
  // publicCode Rolex avec objectCode IWC : incohérent, mais E1 accepte « publicCode ou objectCode » → accepté par objectCode.
  const inconsistent = seed({ root: { publicCode: ROLEX_PUBLIC_CODE, objectCode: IWC_PUBLIC_CODE, makerName: 'Rolex' } });
  assert.equal((await resolveIwcOwner({ firestore: inconsistent, cartularyId: ID })).target.matchedBy, 'objectCode');
  // Un seul code présent et étranger : refusé même si makerName est IWC.
  const foreignCodeIwcMaker = seed({ root: { publicCode: ROLEX_PUBLIC_CODE, objectCode: undefined, makerName: 'IWC Schaffhausen' } });
  await rejectsWithCode(resolveIwcOwner({ firestore: foreignCodeIwcMaker, cartularyId: ID }), 'not_iwc_cartulary');

  // Sans aucun code : makerName IWC accepté, makerName étranger ou absent refusé.
  const makerOnly = seed({ root: { publicCode: undefined, objectCode: undefined, makerName: 'IWC Schaffhausen' } });
  assert.equal((await resolveIwcOwner({ firestore: makerOnly, cartularyId: ID })).target.matchedBy, 'makerName');
  for (const makerName of ['Omega', '', undefined]) {
    const foreign = seed({ root: { publicCode: undefined, objectCode: undefined, makerName } });
    snapshot = foreign.dump();
    await rejectsWithCode(resolveIwcOwner({ firestore: foreign, cartularyId: ID }), 'not_iwc_cartulary');
    assert.deepEqual(foreign.dump(), snapshot);
  }
});

test('(c) le dry-run planifie 3 créations en révision 1 et la fusion d’originTitle en révision N+1 sans rien écrire', async () => {
  const firestore = seed();
  const before = firestore.dump();
  const { plan, result, context } = await run(firestore, { dryRun: true });
  assert.deepEqual(actions(plan), {
    'cartularia-creation-profile': 'create',
    'cartularia-public-code': 'create',
    'cartularia-sensitivity-prices': 'create',
    'cartularia-editable-copy': 'merge_origin_title',
  });
  assert.deepEqual(plan.entries.map((entry) => entry.nextRevision), [1, 1, 1, 3]);
  assert.deepEqual([plan.writes, plan.skipped, plan.blocked], [4, 0, false]);
  assert.equal(plan.plannedAt, '2026-09-08T09:00:00.000Z');
  assert.deepEqual(result, { status: 'planned', completeness: 'complete', writes: 4, keys: [...IWC_PROFILE_KEYS], syncRequested: false, requestId: null });
  assert.deepEqual(context.syncRequest, { exists: true, status: 'processed', outcome: 'updated', requestId: 'sync_prev', reason: 'private_draft_synchronized', processedAt: '2026-08-30T10:00:00.000Z' });
  assert.deepEqual(firestore.dump(), before, 'dry-run : aucune écriture');

  const dryRunWithSync = seed();
  const untouched = dryRunWithSync.dump();
  const planned = await run(dryRunWithSync, { dryRun: true, requestSync: true });
  assert.deepEqual(planned.result, { status: 'planned', completeness: 'complete', writes: 4, keys: [...IWC_PROFILE_KEYS], syncRequested: false, requestId: null });
  assert.deepEqual(dryRunWithSync.dump(), untouched, 'dry-run + request-sync : ni écriture ni demande');
});

test('(d) l’application n’écrit que les quatre clés et le signal d’activité du brouillon, avec horodatage serveur ; un second passage est sans effet', async () => {
  const firestore = seed();
  const before = firestore.dump();
  const { result } = await run(firestore);
  const after = firestore.dump();
  assert.deepEqual(result, { status: 'applied', completeness: 'complete', writes: 4, keys: [...IWC_PROFILE_KEYS], syncRequested: false, requestId: null });
  assert.deepEqual(changedPaths(before, after), [DRAFT, ...IWC_PROFILE_KEYS.map((key) => `${STATE}/${key}`)].sort());
  const { lastActiveAt: _a, updatedAt: _b, ...draftBefore } = before[DRAFT];
  const { lastActiveAt, updatedAt, ...draftAfter } = after[DRAFT];
  assert.deepEqual(draftAfter, draftBefore, 'le document racine du brouillon ne change que par lastActiveAt/updatedAt');
  assert.ok(lastActiveAt instanceof Date && lastActiveAt.getTime() === NOW + 500, 'lastActiveAt : horodatage serveur');
  assert.ok(updatedAt instanceof Date && updatedAt.getTime() === NOW + 500, 'updatedAt du brouillon : horodatage serveur');
  assert.deepEqual(after[`${STATE}/cartularia-media-assets-v3`], before[`${STATE}/cartularia-media-assets-v3`]);
  assert.deepEqual(after[`${DRAFT}/binaries/iwc_bin_1`], before[`${DRAFT}/binaries/iwc_bin_1`]);
  assert.deepEqual(after[SYNC], before[SYNC], 'aucune demande de synchro sans --request-sync');

  for (const [key, expected] of [
    ['cartularia-creation-profile', buildIwcCreationProfile()],
    ['cartularia-public-code', IWC_PUBLIC_CODE],
    ['cartularia-sensitivity-prices', [...IWC_SENSITIVITY_PRICES]],
  ]) {
    const document = after[`${STATE}/${key}`];
    assert.deepEqual(Object.keys(document).sort(), ['cartularyId', 'clientUpdatedAt', 'deleted', 'key', 'ownerUid', 'revision', 'updatedAt', 'value'], 'forme exacte acceptée par firestore.rules (hasOnly)');
    assert.deepEqual({ ownerUid: document.ownerUid, cartularyId: document.cartularyId, key: document.key, deleted: document.deleted, revision: document.revision, clientUpdatedAt: document.clientUpdatedAt }, { ownerUid: OWNER, cartularyId: ID, key, deleted: false, revision: 1, clientUpdatedAt: NOW });
    assert.equal(document.value, JSON.stringify(expected));
    assert.ok(document.updatedAt instanceof Date, `updatedAt de ${key} : horodatage serveur (Date), pas une chaîne ni un nombre`);
    assert.equal(document.updatedAt.getTime(), NOW + 500);
    assert.equal(typeof document.clientUpdatedAt, 'number');
  }
  const copy = after[`${STATE}/cartularia-editable-copy`];
  assert.equal(copy.revision, 3);
  assert.equal(copy.clientUpdatedAt, NOW);
  assert.ok(copy.updatedAt instanceof Date && copy.updatedAt.getTime() === NOW + 500);
  const merged = JSON.parse(copy.value);
  assert.equal(merged.originTitle, IWC_ORIGIN_TITLE);
  assert.deepEqual(Object.keys(merged), ['originTitle', ...Object.keys(editableCopyWithoutTitle())], 'originTitle ajouté, ordre des autres champs conservé');
  const { originTitle: _title, ...mergedRest } = merged;
  assert.deepEqual(mergedRest, JSON.parse(before[`${STATE}/cartularia-editable-copy`].value), 'autres champs inchangés');
  assert.equal(copy.value, JSON.stringify(buildIwcEditableCopy()), 'sérialisation identique au dossier consolidé');

  const second = await run(firestore);
  assert.deepEqual(actions(second.plan), {
    'cartularia-creation-profile': 'noop',
    'cartularia-public-code': 'noop',
    'cartularia-sensitivity-prices': 'noop',
    'cartularia-editable-copy': 'keep_origin_title',
  });
  assert.equal(second.plan.entries.at(-1).expectedDiffers, false);
  assert.deepEqual(second.result, { status: 'applied', completeness: 'complete', writes: 0, keys: [], syncRequested: false, requestId: null });
  assert.deepEqual(firestore.dump(), after, 'second passage : dump identique');
});

test('(d bis) sans injection, les horodatages écrits sont la sentinelle FieldValue.serverTimestamp() sur les quatre clés, le brouillon et la demande (ni {} ni Date)', async () => {
  const { FieldValue } = await import('firebase-admin/firestore');
  const sentinel = FieldValue.serverTimestamp();
  // Le Firestore mémoire clone les données (prototype de la sentinelle perdu, {} en sortie) : on
  // intercepte les données brutes passées à transaction.set/update avant clonage et on les compare
  // avec FieldValue.isEqual, qui distingue la sentinelle d'un objet vide et d'une Date.
  assert.equal(sentinel.isEqual({}), false);
  assert.equal(sentinel.isEqual(new Date(NOW)), false);
  const firestore = seed();
  const rawWrites = new Map();
  const intercepting = {
    ...firestore,
    runTransaction: (operation) => firestore.runTransaction((transaction) => operation({
      ...transaction,
      set: (ref, data, options) => { rawWrites.set(ref.path, data); return transaction.set(ref, data, options); },
      update: (ref, data) => { rawWrites.set(ref.path, data); return transaction.update(ref, data); },
    })),
  };
  const owner = await resolveIwcOwner({ firestore: intercepting, cartularyId: ID });
  const context = await loadIwcProfileContext({ firestore: intercepting, ownerUid: OWNER, cartularyId: ID });
  const plan = planIwcProfileKeys({ states: context.states, now: () => NOW });
  await applyIwcProfileKeys({ firestore: intercepting, cartularyId: ID, ownerUid: owner.ownerUid, plan, requestSync: true, now: () => NOW, requestId: REQUEST_ID });
  assert.deepEqual([...rawWrites.keys()].sort(), [DRAFT, SYNC, ...IWC_PROFILE_KEYS.map((key) => `${STATE}/${key}`)].sort(), 'exactement six écritures');
  for (const key of IWC_PROFILE_KEYS) {
    const data = rawWrites.get(`${STATE}/${key}`);
    assert.ok(data.updatedAt !== undefined && sentinel.isEqual(data.updatedAt), `${key}.updatedAt : sentinelle serverTimestamp`);
    assert.equal(typeof data.clientUpdatedAt, 'number');
  }
  const draftWrite = rawWrites.get(DRAFT);
  assert.ok(sentinel.isEqual(draftWrite.lastActiveAt) && sentinel.isEqual(draftWrite.updatedAt), 'brouillon : lastActiveAt et updatedAt serveur');
  const requestWrite = rawWrites.get(SYNC);
  assert.ok(sentinel.isEqual(requestWrite.requestedAt) && sentinel.isEqual(requestWrite.updatedAt), 'demande : requestedAt et updatedAt serveur');
  assert.equal(firestore.dump()[SYNC].status, 'pending');
});

test('(e) un originTitle existant est conservé ; une clé présente avec une autre valeur ou supprimée est laissée, signalée sans sa valeur, et bloque --apply sans --allow-partial', async () => {
  const withTitle = seed({ editableCopy: { ...editableCopyWithoutTitle(), originTitle: 'Autre titre' } });
  const titled = await run(withTitle);
  assert.equal(titled.plan.entries.at(-1).action, 'keep_origin_title');
  assert.equal(titled.plan.entries.at(-1).expectedDiffers, true);
  assert.deepEqual(titled.plan.entries.at(-1).differingFields, ['originTitle']);
  assert.equal(JSON.parse(withTitle.dump()[`${STATE}/cartularia-editable-copy`].value).originTitle, 'Autre titre');
  assert.equal(withTitle.dump()[`${STATE}/cartularia-editable-copy`].revision, 2, 'aucune écriture sur la copie éditoriale');
  assert.deepEqual(titled.result.keys, SIMPLE_KEYS);
  assert.doesNotMatch(JSON.stringify(describeIwcProfilePlan(titled.plan)), /Autre titre/, 'le titre existant n’est pas exposé');

  const blank = seed({ editableCopy: { originTitle: '   ', ...editableCopyWithoutTitle() } });
  const blanked = await run(blank, { dryRun: true });
  assert.equal(blanked.plan.entries.at(-1).action, 'merge_origin_title', 'un titre vide est complété');
  assert.equal(JSON.parse(blanked.plan.entries.at(-1).nextValue).originTitle, IWC_ORIGIN_TITLE);

  const otherPrices = [1000, 2000, 3000, 4000, 5000];
  const differing = seed({ documents: { [`${STATE}/cartularia-sensitivity-prices`]: stateDocument('cartularia-sensitivity-prices', otherPrices, { revision: 1 }) } });
  const beforeDiffering = differing.dump();
  await rejectsWithCode(run(differing), 'keys_contested');
  assert.deepEqual(differing.dump(), beforeDiffering, '--apply sans --allow-partial : aucune écriture, pas même les clés non contestées');
  const skipped = await run(differing, { dryRun: true });
  assert.equal(actions(skipped.plan)['cartularia-sensitivity-prices'], 'skip_existing');
  assert.deepEqual([skipped.plan.writes, skipped.plan.skipped, skipped.plan.blocked], [3, 1, false]);
  assert.equal(skipped.result.completeness, 'partial');
  const contested = skipped.plan.entries[2];
  assert.deepEqual({ existingDigest: contested.existingDigest, existingBytes: contested.existingBytes, expectedDigest: contested.expectedDigest, expectedBytes: contested.expectedBytes, differingFields: contested.differingFields }, {
    existingDigest: shortDigestOf(JSON.stringify(otherPrices)),
    existingBytes: Buffer.byteLength(JSON.stringify(otherPrices)),
    expectedDigest: shortDigestOf(JSON.stringify([...IWC_SENSITIVITY_PRICES])),
    expectedBytes: Buffer.byteLength(JSON.stringify([...IWC_SENSITIVITY_PRICES])),
    differingFields: ['length=5 (contenu différent)'],
  });
  assert.match(contested.existingDigest, /^[0-9a-f]{12}$/);
  assert.notEqual(contested.existingDigest, contested.expectedDigest);
  assert.equal(contested.currentPreview, undefined, 'plus d’aperçu de valeur');
  assertNoValueLeak(describeIwcProfilePlan(skipped.plan));
  assert.ok(iwcProfileWarnings({ root: skipped.owner.root, plan: skipped.plan }).some((warning) => warning.code === 'keys_skipped'));

  const partial = await run(differing, { allowPartial: true });
  const afterPartial = differing.dump();
  assert.deepEqual(partial.result, { status: 'applied', completeness: 'partial', writes: 3, keys: ['cartularia-creation-profile', 'cartularia-public-code', 'cartularia-editable-copy'], syncRequested: false, requestId: null });
  assert.deepEqual(afterPartial[`${STATE}/cartularia-sensitivity-prices`], beforeDiffering[`${STATE}/cartularia-sensitivity-prices`], 'clé contestée jamais écrasée, même avec --allow-partial');
  assert.deepEqual(changedPaths(beforeDiffering, afterPartial), [DRAFT, `${STATE}/cartularia-creation-profile`, `${STATE}/cartularia-public-code`, `${STATE}/cartularia-editable-copy`].sort());

  const otherProfile = { ...buildIwcCreationProfile(), serialNumber: '9999999', purchasePrice: 1 };
  const profileDiffers = seed({ documents: { [`${STATE}/cartularia-creation-profile`]: stateDocument('cartularia-creation-profile', otherProfile, { revision: 4 }) } });
  const profilePlan = await run(profileDiffers, { dryRun: true });
  assert.deepEqual(profilePlan.plan.entries[0].differingFields, ['purchasePrice', 'serialNumber'], 'noms de champs seulement');
  assert.doesNotMatch(JSON.stringify(describeIwcProfilePlan(profilePlan.plan)), /9999999/);

  const deleted = seed({ documents: { [`${STATE}/cartularia-public-code`]: { ...stateDocument('cartularia-public-code', null, { revision: 2, deleted: true }), value: null } } });
  const tombstoned = await run(deleted, { dryRun: true });
  assert.equal(actions(tombstoned.plan)['cartularia-public-code'], 'skip_existing');
  assert.deepEqual(tombstoned.plan.entries[1].differingFields, ['(clé supprimée)']);
  assert.equal(tombstoned.plan.entries[1].existingDigest, null);
  const tombstoneSnapshot = deleted.dump();
  await rejectsWithCode(run(deleted), 'keys_contested');
  assert.deepEqual(deleted.dump(), tombstoneSnapshot);

  const missingCopy = seed();
  await missingCopy.doc(`${STATE}/cartularia-editable-copy`).delete();
  const snapshotMissing = missingCopy.dump();
  const missingPlan = await run(missingCopy, { dryRun: true });
  assert.equal(missingPlan.plan.entries.at(-1).action, 'missing_editable_copy');
  assert.equal(missingPlan.plan.blocked, true);
  await rejectsWithCode(run(missingCopy), 'plan_blocked');
  assert.deepEqual(missingCopy.dump(), snapshotMissing, 'plan bloqué : aucune écriture');
  const blockedPartial = await run(missingCopy, { allowPartial: true });
  assert.deepEqual(blockedPartial.result.keys, SIMPLE_KEYS, 'plan bloqué + --allow-partial : les trois clés simples sont écrites, la copie éditoriale reste absente');
  assert.equal(missingCopy.dump()[`${STATE}/cartularia-editable-copy`], undefined);
  const blockedWarning = iwcProfileWarnings({ root: blockedPartial.owner.root, plan: blockedPartial.plan }).find((warning) => warning.code === 'editable_copy_blocked');
  assert.match(blockedWarning.message, /missing_editable_copy/, 'avertissement dédié au plan bloqué');
  assert.match(blockedWarning.message, /update:iwc-dossier/);
  assert.ok(!iwcProfileWarnings({ root: skipped.owner.root, plan: skipped.plan }).some((warning) => warning.code === 'editable_copy_blocked'), 'pas d’avertissement de blocage pour un plan seulement contesté');

  const invalidCopy = seed({ documents: { [`${STATE}/cartularia-editable-copy`]: { ...stateDocument('cartularia-editable-copy', null, { revision: 2 }), value: '{pas du json' } } });
  const invalidPlan = await run(invalidCopy, { dryRun: true });
  assert.equal(invalidPlan.plan.entries.at(-1).action, 'invalid_editable_copy');
  assert.equal(invalidPlan.plan.blocked, true);
});

test('(e bis) describeDifference ne rend que des noms de champs, des longueurs ou une nature de différence', () => {
  assert.deepEqual(describeDifference(JSON.stringify({ a: 1, b: 2, c: 3 }), { a: 1, b: 9, d: 4 }), ['b', 'c', 'd']);
  assert.deepEqual(describeDifference(JSON.stringify([1, 2]), [1, 2, 3]), ['length=2 (attendu 3)']);
  assert.deepEqual(describeDifference(JSON.stringify('X-1'), 'OP-4892-XZ9'), ['(valeur string différente)']);
  assert.deepEqual(describeDifference(JSON.stringify({ a: 1 }), [1]), ['(type: object ≠ array)']);
  assert.deepEqual(describeDifference('{oops', {}), ['(JSON illisible)']);
  assert.deepEqual(describeDifference(null, {}), ['(valeur absente ou non textuelle)']);
});

test('(e ter) describeDifference distingue « sérialisation différente, contenu identique » de « contenu différent » ; l’action reste skip_existing dans les deux cas', async () => {
  const profile = buildIwcCreationProfile();
  assert.equal(SAME_CONTENT_MARKER, '(sérialisation différente, contenu identique)');
  assert.deepEqual(describeDifference(JSON.stringify(profile, null, 2), profile), [SAME_CONTENT_MARKER], 'objet indenté : plus une liste vide ambiguë');
  assert.deepEqual(describeDifference('[3200, 3600, 4000, 4400, 4800]', [...IWC_SENSITIVITY_PRICES]), [SAME_CONTENT_MARKER], 'tableau avec espaces');
  assert.deepEqual(describeDifference('3200.0', 3200), [SAME_CONTENT_MARKER], 'notation numérique');
  assert.deepEqual(describeDifference(JSON.stringify({ ...profile, purchasePrice: 1 }, null, 2), profile), ['purchasePrice'], 'contenu différent : noms de champs');
  assert.deepEqual(describeDifference(JSON.stringify([3200, 3600, 4000, 4400, 4801]), [...IWC_SENSITIVITY_PRICES]), ['length=5 (contenu différent)']);
  assert.deepEqual(describeDifference(JSON.stringify(profile), profile), [SAME_CONTENT_MARKER], 'même chaîne : le plan ne l’appelle jamais dans ce cas (noop), mais le marqueur reste cohérent');

  // Propriétaire simulé : même contenu, autre sérialisation (indentée, comme un export manuel), révision 4.
  const reserialized = seed({ documents: {
    [`${STATE}/cartularia-creation-profile`]: { ...stateDocument('cartularia-creation-profile', null, { revision: 4 }), value: JSON.stringify(profile, null, 2) },
    [`${STATE}/cartularia-sensitivity-prices`]: { ...stateDocument('cartularia-sensitivity-prices', null, { revision: 2 }), value: '[3200, 3600, 4000, 4400, 4800]' },
  } });
  const before = reserialized.dump();
  const { plan, result } = await run(reserialized, { dryRun: true });
  assert.deepEqual(actions(plan), {
    'cartularia-creation-profile': 'skip_existing',
    'cartularia-public-code': 'create',
    'cartularia-sensitivity-prices': 'skip_existing',
    'cartularia-editable-copy': 'merge_origin_title',
  }, 'cohérent avec la comparaison de chaînes du client (syncModel.ts) : jamais réécrite');
  assert.deepEqual(plan.entries[0].differingFields, [SAME_CONTENT_MARKER]);
  assert.deepEqual(plan.entries[2].differingFields, [SAME_CONTENT_MARKER]);
  assert.match(plan.entries[0].note, /même contenu sous une autre sérialisation/);
  assert.notEqual(plan.entries[0].existingDigest, plan.entries[0].expectedDigest, 'digests tronqués différents malgré le contenu identique');
  assert.deepEqual([plan.writes, plan.skipped, plan.blocked, result.completeness], [2, 2, false, 'partial']);
  await rejectsWithCode(run(reserialized), 'keys_contested');
  assert.deepEqual(reserialized.dump(), before, 'aucune écriture');
  const partial = await run(reserialized, { allowPartial: true });
  assert.deepEqual(partial.result.keys, ['cartularia-public-code', 'cartularia-editable-copy']);
  assert.deepEqual(reserialized.dump()[`${STATE}/cartularia-creation-profile`], before[`${STATE}/cartularia-creation-profile`], 'la sérialisation existante est conservée octet pour octet');
  assertNoValueLeak(describeIwcProfilePlan(plan));
});

test('(f) tout changement entre le plan et l’application est refusé sans écriture : révision seule, digest à révision égale, suppression seule, propriétaire, cible, racine disparue', async () => {
  let snapshot;
  const revisionOnly = seed();
  await rejectsWithCode(run(revisionOnly, {
    beforeApply: async () => {
      await revisionOnly.doc(`${STATE}/cartularia-editable-copy`).update({ revision: 3 });
      snapshot = revisionOnly.dump();
    },
  }), 'revision_conflict');
  assert.deepEqual(revisionOnly.dump(), snapshot, 'révision seule incrémentée (même valeur, même deleted) : refusé, pas de régression de révision cloud');
  assert.equal(revisionOnly.dump()[`${STATE}/cartularia-editable-copy`].revision, 3);

  const pushedCopy = seed();
  await rejectsWithCode(run(pushedCopy, {
    beforeApply: async () => {
      await pushedCopy.doc(`${STATE}/cartularia-editable-copy`).set(stateDocument('cartularia-editable-copy', { ...editableCopyWithoutTitle(), heroSummary: 'Modifié par le client' }, { revision: 3 }));
      snapshot = pushedCopy.dump();
    },
  }), 'revision_conflict');
  assert.deepEqual(pushedCopy.dump(), snapshot);

  const pushedPrices = seed();
  await rejectsWithCode(run(pushedPrices, {
    beforeApply: async () => {
      await pushedPrices.doc(`${STATE}/cartularia-sensitivity-prices`).set(stateDocument('cartularia-sensitivity-prices', [3200, 3600, 4000, 4400, 4800], { revision: 1 }));
      snapshot = pushedPrices.dump();
    },
  }), 'revision_conflict');
  assert.deepEqual(pushedPrices.dump(), snapshot, 'même une valeur identique poussée entre-temps impose un nouveau plan');

  const sameRevisionOtherDigest = seed();
  await rejectsWithCode(run(sameRevisionOtherDigest, {
    beforeApply: async () => {
      await sameRevisionOtherDigest.doc(`${STATE}/cartularia-editable-copy`).set(stateDocument('cartularia-editable-copy', { ...editableCopyWithoutTitle(), heroSummary: 'Réécrit sans incrément' }, { revision: 2 }));
      snapshot = sameRevisionOtherDigest.dump();
    },
  }), 'revision_conflict');
  assert.deepEqual(sameRevisionOtherDigest.dump(), snapshot, 'révision égale mais digest différent : refusé');

  const tombstonedOnly = seed();
  await rejectsWithCode(run(tombstonedOnly, {
    beforeApply: async () => {
      await tombstonedOnly.doc(`${STATE}/cartularia-editable-copy`).update({ deleted: true });
      snapshot = tombstonedOnly.dump();
    },
  }), 'revision_conflict');
  assert.deepEqual(tombstonedOnly.dump(), snapshot, 'même révision, même valeur, seul deleted a changé : refusé');

  const transferred = seed();
  await assert.rejects(run(transferred, {
    beforeApply: async () => {
      await transferred.doc(`cartularies/${ID}`).update({ accountHolderId: 'uid_nouveau_proprietaire' });
      snapshot = transferred.dump();
    },
  }), (error) => {
    assert.equal(error.code, 'owner_changed');
    assert.deepEqual([error.plannedOwnerUid, error.currentOwnerUid], [OWNER, 'uid_nouveau_proprietaire'], 'les deux uid sont portés par l’erreur');
    assert.doesNotMatch(error.message, /uid_nouveau_proprietaire|uid_reel_prod/, 'mais restent hors du message (journaux de session)');
    return true;
  });
  assert.deepEqual(transferred.dump(), snapshot, 'transfert de propriété concurrent : aucune écriture dans le brouillon de l’ancien propriétaire');

  // Garde de cible relue dans la transaction : racine devenue Rolex entre le plan et l'application.
  for (const rootPatch of [{ publicCode: ROLEX_PUBLIC_CODE, objectCode: ROLEX_PUBLIC_CODE }, { objectCode: ROLEX_PUBLIC_CODE, publicCode: '' }]) {
    const retargeted = seed();
    await rejectsWithCode(run(retargeted, {
      beforeApply: async () => {
        await retargeted.doc(`cartularies/${ID}`).update(rootPatch);
        snapshot = retargeted.dump();
      },
    }), 'not_iwc_cartulary');
    assert.deepEqual(retargeted.dump(), snapshot, `cible modifiée (${Object.keys(rootPatch).join(', ')}) entre le plan et l’application : aucune écriture`);
  }

  const rootDeleted = seed();
  await rejectsWithCode(run(rootDeleted, {
    beforeApply: async () => {
      await rootDeleted.doc(`cartularies/${ID}`).update({ deletedAt: '2026-09-08T09:00:01.000Z' });
      snapshot = rootDeleted.dump();
    },
  }), 'cartulary_gone');
  assert.deepEqual(rootDeleted.dump(), snapshot, 'racine supprimée (deletedAt) entre le plan et l’application : code dédié, aucune écriture');

  const rootGone = seed();
  await rejectsWithCode(run(rootGone, {
    beforeApply: async () => {
      await rootGone.doc(`cartularies/${ID}`).delete();
      snapshot = rootGone.dump();
    },
  }), 'cartulary_gone');
  assert.deepEqual(rootGone.dump(), snapshot, 'racine disparue entre le plan et l’application : aucune écriture');
});

test('(g) la synchronisation n’est demandée qu’avec --request-sync et s’il y a des écritures ; la demande remplace intégralement l’ancienne ; jamais pendant une synchro en cours', async () => {
  const firestore = seed();
  const previous = firestore.dump()[SYNC];
  assert.ok(previous.outcome && previous.processedAt, 'fixture : la demande précédente porte outcome et processedAt');
  const { result } = await run(firestore, { requestSync: true });
  assert.deepEqual(result, { status: 'applied', completeness: 'complete', writes: 4, keys: [...IWC_PROFILE_KEYS], syncRequested: true, requestId: REQUEST_ID });
  const request = firestore.dump()[SYNC];
  assert.deepEqual(Object.keys(request).sort(), ['cartularyId', 'ownerUid', 'reason', 'requestDocumentId', 'requestId', 'requestedAt', 'status', 'updatedAt'], 'demande remplacée intégralement : ni outcome ni processedAt hérités');
  assert.deepEqual({ status: request.status, requestId: request.requestId, ownerUid: request.ownerUid, cartularyId: request.cartularyId, requestDocumentId: request.requestDocumentId, reason: request.reason }, {
    status: 'pending', requestId: REQUEST_ID, ownerUid: OWNER, cartularyId: ID, requestDocumentId: ID, reason: IWC_PROFILE_SYNC_REASON,
  });
  assert.equal(IWC_PROFILE_SYNC_REASON, 'iwc_profile_keys_adr029');
  assert.ok(request.requestedAt instanceof Date && request.updatedAt instanceof Date, 'horodatages serveur');

  await firestore.doc(SYNC).set({ ...request, status: 'processed', outcome: 'updated' });
  const afterProcessed = firestore.dump();
  const second = await run(firestore, { requestSync: true });
  assert.deepEqual(second.result, { status: 'applied', completeness: 'complete', writes: 0, keys: [], syncRequested: false, requestId: null });
  assert.deepEqual(firestore.dump(), afterProcessed, 'sans écriture, aucune demande de synchro');

  const noSync = seed({ syncStatus: null });
  await run(noSync);
  assert.equal(noSync.dump()[SYNC], undefined, 'sans le drapeau, aucune demande créée');

  const generated = seed();
  const owner = await resolveIwcOwner({ firestore: generated, cartularyId: ID });
  const context = await loadIwcProfileContext({ firestore: generated, ownerUid: OWNER, cartularyId: ID });
  const plan = planIwcProfileKeys({ states: context.states, now: () => NOW });
  const applied = await applyIwcProfileKeys({ firestore: generated, cartularyId: ID, ownerUid: owner.ownerUid, plan, requestSync: true, now: () => NOW });
  assert.match(applied.requestId, /^iwc_profile_keys_20260908_[0-9a-f]{12}$/);

  const raced = seed();
  let snapshot;
  await rejectsWithCode(run(raced, {
    requestSync: true,
    beforeApply: async () => {
      await raced.doc(SYNC).set({ requestDocumentId: ID, requestId: 'sync_client', ownerUid: OWNER, cartularyId: ID, status: 'pending', reason: 'private_draft_synchronized' });
      snapshot = raced.dump();
    },
  }), 'sync_in_progress', { stage: 'transaction', syncStatus: 'pending', syncRequestId: 'sync_client' });
  assert.deepEqual(raced.dump(), snapshot, 'synchro devenue pending entre le plan et l’application : aucune écriture');
});

test('(g bis) les avertissements d’exploitation signalent la devise, legacyMediaDigest, la version déclarée, l’incrément de révision, le conflit côté propriétaire et l’attribution d’audit', async () => {
  const risky = seed({ root: { valuationCurrency: 'CHF', legacyMediaDigest: undefined } });
  const { owner, plan } = await run(risky, { dryRun: true });
  const codes = iwcProfileWarnings({ root: owner.root, plan }).map((warning) => warning.code);
  assert.deepEqual(codes, ['valuation_currency_switch', 'legacy_media_digest_missing', 'schema_version_declared_differs', 'next_sync_increments_revision', 'owner_local_copy_conflict', 'audit_attribution_without_request_sync']);
  const withSync = iwcProfileWarnings({ root: owner.root, plan, requestSync: true }).map((warning) => warning.code);
  assert.ok(!withSync.includes('audit_attribution_without_request_sync'), 'avec --request-sync, la trace d’audit porte la raison');
  assert.ok(withSync.includes('owner_local_copy_conflict'));
  const conflictWarning = iwcProfileWarnings({ root: owner.root, plan }).find((warning) => warning.code === 'owner_local_copy_conflict');
  assert.match(conflictWarning.message, /cartularia-sensitivity-prices/);
  assert.match(conflictWarning.message, /cartularia-editable-copy/);
  const quiet = seed({ root: { schemaVersion: '1.6.0' } });
  await run(quiet);
  const idle = await run(quiet, { dryRun: true });
  assert.deepEqual(iwcProfileWarnings({ root: idle.owner.root, plan: idle.plan, membership: idle.owner.membership }), []);
});

test('(g ter) la précondition de synchronisation (membership) est lue, jamais écrite : absente ou insuffisante, elle produit owner_membership_missing sans bloquer', async () => {
  const noMembership = seed({ membership: null });
  const before = noMembership.dump();
  const absent = await run(noMembership, { dryRun: true });
  assert.deepEqual(absent.owner.membership, { path: MEMBERSHIP, exists: false, ok: false, missing: ['membership absent'] });
  const warnings = iwcProfileWarnings({ root: absent.owner.root, plan: absent.plan, requestSync: true, membership: absent.owner.membership });
  assert.equal(warnings[0].code, 'owner_membership_missing', 'premier avertissement : la synchronisation échouerait');
  assert.match(warnings[0].message, /permission_denied/);
  assert.match(warnings[0].message, new RegExp(MEMBERSHIP.replaceAll('/', '\\/')));
  assert.deepEqual(noMembership.dump(), before, 'lecture seule');
  const applied = await run(noMembership, { requestSync: true });
  assert.deepEqual([applied.result.writes, applied.result.syncRequested, noMembership.dump()[SYNC].status], [4, true, 'pending'], 'non bloquant : clés écrites et demande déposée (elle passera en failed côté serveur)');
  assert.equal(noMembership.dump()[MEMBERSHIP], undefined, 'le membership n’est jamais créé par ce script');

  const insufficient = seed({ membership: membershipDocument({ roles: ['viewer'], scopes: { registryIds: ['reg_autre'] } }) });
  assert.deepEqual((await run(insufficient, { dryRun: true })).owner.membership.missing, ['rôle legal_owner', 'registryId hors scopes.registryIds']);
  const inactive = seed({ membership: membershipDocument({ status: 'suspended', permissions: ['publication.manage'] }) });
  assert.deepEqual((await run(inactive, { dryRun: true })).owner.membership.missing, ['status=suspended', 'permission cartulary.edit']);
  const otherUid = seed({ membership: membershipDocument({ uid: 'wave1-owner' }) });
  assert.deepEqual((await run(otherUid, { dryRun: true })).owner.membership.missing, ['uid différent']);
  const noOrganization = seed({ root: { organizationId: undefined }, membership: null });
  assert.deepEqual((await run(noOrganization, { dryRun: true })).owner.membership, { path: null, exists: false, ok: false, missing: ['organizationId absent de la racine', 'membership absent'] });
  assert.deepEqual(describeOwnerMembership({ membership: { exists: true, data: () => membershipDocument() }, ownerUid: OWNER, organizationId: 'org_demo', registryId: 'reg_collection_privee' }), { path: MEMBERSHIP, exists: true, ok: true, missing: [] });
  assert.ok(!iwcProfileWarnings({ root: absent.owner.root, plan: absent.plan, membership: { path: MEMBERSHIP, exists: true, ok: true, missing: [] } }).some((warning) => warning.code === 'owner_membership_missing'));
});

/** Racine synchronisable par processCartularySyncRequest (chaîne d'audit vide valide, projection sans champ indéfini). */
const SYNCABLE_ROOT = {
  assetType: 'watch', modelName: 'Flieger UTC', referenceCode: 'IW3251-001', manufactureYear: 2002, lifecycleStatus: 'active', possessionStatus: 'owned', completenessLevel: 'documented',
  collectionId: 'col_pilots', collectionIds: ['col_pilots'], integrityHead: ZERO_AUDIT_HASH, integritySequence: 0,
};
const syncableSeed = ({ root = {}, documents = {}, ...options } = {}) => seed({
  ...options,
  root: { ...SYNCABLE_ROOT, ...root },
  documents: { 'registries/reg_collection_privee': { organizationId: 'org_demo', itemCount: 0 }, ...documents },
});
const dropValuationStates = async (firestore, keys = ['cartularia-purchase', 'cartularia-retained-valuation']) => {
  for (const key of keys) await firestore.doc(`${STATE}/${key}`).delete();
};
const codesOf = (report) => report.warnings.map((warning) => warning.code);

test('(g quater) effet monétaire du profil de création : creation_profile_drives_valuation quand la racine n’a pas de montant et que le brouillon n’a ni achat ni valeur retenue exploitables, prouvé par une synchronisation serveur réelle ; silencieux quand cartularia-purchase existe', async () => {
  const profile = buildIwcCreationProfile();
  assert.deepEqual([...IWC_VALUATION_STATE_KEYS], ['cartularia-purchase', 'cartularia-purchase-expenses', 'cartularia-retained-valuation']);

  // Cas 1 : propriétaire sans saisie monétaire, racine sans montant → le profil pilotera la synchronisation.
  const bare = syncableSeed();
  await dropValuationStates(bare);
  const before = bare.dump();
  const dry = await cliRun(bare, ['--dry-run', '--allow-remote']);
  const dryReport = dry.capture.report();
  assert.equal(dry.exitCode, 0);
  assert.equal(dryReport.classification, REPORT_CLASSIFICATION);
  assert.equal(REPORT_CLASSIFICATION, 'Secret');
  assert.deepEqual(dryReport.root.valuation, { purchasePrice: null, costBasis: null, grossValuation: null, netValuation: null, valuationCurrency: 'EUR', present: [] });
  assert.deepEqual(dryReport.draft.valuationKeys, {
    'cartularia-purchase': { present: false, effective: false },
    'cartularia-purchase-expenses': { present: false, effective: false },
    'cartularia-retained-valuation': { present: false, effective: false },
  });
  const warning = dryReport.warnings.find((entry) => entry.code === 'creation_profile_drives_valuation');
  assert.ok(warning, 'avertissement présent');
  assert.deepEqual(warning.fields, ['purchasePrice', 'costBasis', 'grossValuation']);
  assert.deepEqual(warning.missingKeys, ['cartularia-purchase', 'cartularia-retained-valuation']);
  assert.match(warning.message, /cartularia-creation-profile \(purchasePrice, valuationMid/);
  assert.match(warning.message, /projection du Registre/);
  assert.equal(codesOf(dryReport)[0], 'creation_profile_drives_valuation', 'signalé en tête (le membership de la fixture est complet)');
  assertNoValueLeak(dryReport);
  assert.deepEqual(bare.dump(), before, 'dry-run : aucune écriture');

  const applied = await cliRun(bare, ['--apply', '--request-sync', '--allow-remote']);
  assert.equal(applied.exitCode, 0);
  assert.ok(codesOf(applied.capture.report()).includes('creation_profile_drives_valuation'), 'répété à l’application');
  assertNoValueLeak(applied.capture.report());
  const synced = await processCartularySyncRequest({ firestore: bare, requestDocumentId: ID, occurredAt: '2026-09-08T09:05:00.000Z' });
  assert.deepEqual([synced.status, synced.outcome, synced.revision], ['processed', 'updated', 8], 'synchronisation autoritaire réelle (live-sync-command.mjs) sur le Firestore mémoire');
  const root = bare.dump()[`cartularies/${ID}`];
  assert.deepEqual(
    [root.purchasePrice, root.costBasis, root.grossValuation, root.netValuation, root.valuationCurrency],
    [profile.purchasePrice, profile.purchasePrice, profile.valuationMid, null, 'EUR'],
    'la racine reçoit purchasePrice et valuationMid du profil de création',
  );
  const item = bare.dump()[`registries/reg_collection_privee/items/${ID}`];
  assert.deepEqual([item.purchasePrice, item.costBasis, item.grossValuation, item.sourceRevision], [profile.purchasePrice, profile.purchasePrice, profile.valuationMid, 8], 'la projection du Registre aussi');
  assert.deepEqual([bare.dump()[SYNC].status, bare.dump()[SYNC].reason, bare.dump()[SYNC].requestId], ['processed', IWC_PROFILE_SYNC_REASON, REQUEST_ID], 'la trace porte la raison de l’opération');

  const afterSync = await cliRun(bare, ['--dry-run', '--allow-remote']);
  const afterReport = afterSync.capture.report();
  assert.equal(afterSync.exitCode, 0);
  assert.deepEqual(afterReport.root.valuation.present, ['purchasePrice', 'costBasis', 'grossValuation']);
  assert.equal(afterReport.root.valuation.purchasePrice, profile.purchasePrice, 'root.valuation expose les montants de la racine (données Secret : rapport classé Secret)');
  assert.equal(afterReport.root.revision, 8);
  assert.ok(!codesOf(afterReport).includes('creation_profile_drives_valuation'), 'racine dotée de montants : plus d’avertissement');
  assert.deepEqual([afterReport.writes, afterReport.plan.writes], [0, 0]);

  // Cas 2 : propriétaire ayant saisi achat, frais et valeur retenue à des montants différents de la fixture et du profil.
  const owned = syncableSeed({ documents: {
    [`${STATE}/cartularia-purchase`]: stateDocument('cartularia-purchase', { date: '2002-03-08', purchasePrice: 2750 }),
    [`${STATE}/cartularia-purchase-expenses`]: stateDocument('cartularia-purchase-expenses', [{ id: 'exp_1', label: 'Révision', amount: 175 }]),
    [`${STATE}/cartularia-retained-valuation`]: stateDocument('cartularia-retained-valuation', { amount: 2600, saleCostAmount: 100, taxAmount: 0 }),
  } });
  const ownedDry = await cliRun(owned, ['--dry-run', '--allow-remote']);
  const ownedReport = ownedDry.capture.report();
  assert.deepEqual(ownedReport.draft.valuationKeys, {
    'cartularia-purchase': { present: true, effective: true },
    'cartularia-purchase-expenses': { present: true, effective: true },
    'cartularia-retained-valuation': { present: true, effective: true },
  });
  assert.ok(!codesOf(ownedReport).includes('creation_profile_drives_valuation'), 'cartularia-purchase et cartularia-retained-valuation existent : aucun avertissement');
  assert.ok(!JSON.stringify(ownedReport).includes('2750') && !JSON.stringify(ownedReport).includes('2600'), 'les montants du brouillon ne sont jamais exposés');
  assertNoValueLeak(ownedReport);
  await cliRun(owned, ['--apply', '--request-sync', '--allow-remote']);
  const ownedSync = await processCartularySyncRequest({ firestore: owned, requestDocumentId: ID, occurredAt: '2026-09-08T09:06:00.000Z' });
  assert.equal(ownedSync.outcome, 'updated');
  const ownedRoot = owned.dump()[`cartularies/${ID}`];
  assert.deepEqual([ownedRoot.purchasePrice, ownedRoot.costBasis, ownedRoot.grossValuation, ownedRoot.netValuation], [2750, 2925, 2600, 2500], 'les saisies du propriétaire priment sur le profil');
  assert.notEqual(ownedRoot.purchasePrice, profile.purchasePrice);
  assert.notEqual(ownedRoot.grossValuation, profile.valuationMid);

  // Cas 3 : clés présentes mais inexploitables (achat sans montant, valeur retenue supprimée) : le profil pilote quand même.
  const unusable = seed({ documents: {
    [`${STATE}/cartularia-purchase`]: stateDocument('cartularia-purchase', { date: '2002-03-08' }),
    [`${STATE}/cartularia-retained-valuation`]: { ...stateDocument('cartularia-retained-valuation', null, { deleted: true }), value: null },
  } });
  const unusableDry = await cliRun(unusable, ['--dry-run', '--allow-remote']);
  assert.deepEqual(unusableDry.capture.report().draft.valuationKeys, {
    'cartularia-purchase': { present: true, effective: false },
    'cartularia-purchase-expenses': { present: false, effective: false },
    'cartularia-retained-valuation': { present: false, effective: false },
  });
  assert.deepEqual(unusableDry.capture.report().warnings.find((entry) => entry.code === 'creation_profile_drives_valuation')?.fields, ['purchasePrice', 'costBasis', 'grossValuation']);

  // Achat seul exploitable : seul grossValuation reste piloté par valuationMid.
  const purchaseOnly = seed();
  await dropValuationStates(purchaseOnly, ['cartularia-retained-valuation']);
  const purchaseOnlyWarning = (await cliRun(purchaseOnly, ['--dry-run', '--allow-remote'])).capture.report().warnings.find((entry) => entry.code === 'creation_profile_drives_valuation');
  assert.deepEqual([purchaseOnlyWarning.fields, purchaseOnlyWarning.missingKeys], [['grossValuation'], ['cartularia-retained-valuation']]);

  // Fonctions pures : racine dotée de montants, ou profil qui n'existera pas après l'opération (supprimé côté client) → aucun effet.
  const rootWithAmounts = describeRootValuation({ purchasePrice: 2750, costBasis: 2925, grossValuation: 2600, netValuation: null, valuationCurrency: 'CHF' });
  assert.deepEqual(rootWithAmounts, { purchasePrice: 2750, costBasis: 2925, grossValuation: 2600, netValuation: null, valuationCurrency: 'CHF', present: ['purchasePrice', 'costBasis', 'grossValuation'] });
  assert.deepEqual(describeRootValuation({ purchasePrice: 0 }).present, ['purchasePrice'], '0 est un montant (comme moneyBaseline.purchasePrice ?? profil)');
  const noKeys = describeValuationKeys(new Map());
  const editableCopyState = () => [IWC_EDITABLE_COPY_KEY, stateDocument(IWC_EDITABLE_COPY_KEY, buildIwcEditableCopy(), { revision: 2 })];
  const createPlan = planIwcProfileKeys({ states: new Map([editableCopyState()]), now: () => NOW });
  assert.deepEqual(creationProfileValuationEffects({ root: { valuation: rootWithAmounts }, plan: createPlan, draft: { valuationKeys: noKeys } }), []);
  assert.deepEqual(creationProfileValuationEffects({ root: { valuation: describeRootValuation({}) }, plan: createPlan, draft: { valuationKeys: noKeys } }), ['purchasePrice', 'costBasis', 'grossValuation']);
  const tombstonedProfile = planIwcProfileKeys({ states: new Map([editableCopyState(), ['cartularia-creation-profile', { key: 'cartularia-creation-profile', deleted: true, value: null, revision: 2 }]]), now: () => NOW });
  assert.equal(actions(tombstonedProfile)['cartularia-creation-profile'], 'skip_existing');
  assert.deepEqual(creationProfileValuationEffects({ root: { valuation: describeRootValuation({}) }, plan: tombstonedProfile, draft: { valuationKeys: noKeys } }), [], 'profil supprimé côté client : la synchronisation ne le lira pas');
  const existingProfile = planIwcProfileKeys({ states: new Map([editableCopyState(), ['cartularia-creation-profile', stateDocument('cartularia-creation-profile', profile, { revision: 1 })]]), now: () => NOW });
  assert.equal(actions(existingProfile)['cartularia-creation-profile'], 'noop');
  assert.deepEqual(creationProfileValuationEffects({ root: { valuation: describeRootValuation({}) }, plan: existingProfile, draft: { valuationKeys: noKeys } }), ['purchasePrice', 'costBasis', 'grossValuation'], 'profil déjà en place et jamais synchronisé : l’effet reste signalé');
  assert.deepEqual(iwcProfileWarnings({ root: { valuation: describeRootValuation({}), valuationCurrency: 'EUR', hasLegacyMediaDigest: true, schemaVersion: '1.6.0' }, plan: createPlan }).map((entry) => entry.code), ['next_sync_increments_revision', 'owner_local_copy_conflict', 'audit_attribution_without_request_sync'], 'sans vue du brouillon (appel direct), aucun avertissement monétaire');
});

test('(j bis) cas CLI complémentaires : M21 dry-run partiel d’un plan contesté, M53 dry-run d’un plan bloqué, M54 brouillon purgé entre plan et application, M49 clé supprimée à valeur attendue, M56 rapport revision_conflict sans fuite', async () => {
  // M21 : --dry-run --allow-partial d'un plan contesté → 0, dump identique ; c'est aussi le contrôle après --apply --allow-partial.
  const contested = seed({ documents: { [`${STATE}/cartularia-sensitivity-prices`]: stateDocument('cartularia-sensitivity-prices', [1000, 2000, 3000, 4000, 5000], { revision: 1 }) } });
  const contestedBefore = contested.dump();
  const partialDry = await cliRun(contested, ['--dry-run', '--allow-partial', '--allow-remote']);
  assert.equal(partialDry.exitCode, 0, 'M21');
  assert.deepEqual(contested.dump(), contestedBefore, 'M21 : dump identique');
  const partialDryReport = partialDry.capture.report();
  assert.deepEqual([partialDryReport.event, partialDryReport.dryRun, partialDryReport.allowPartial, partialDryReport.completeness, partialDryReport.writes, partialDryReport.plan.skipped, partialDryReport.syncRequested], ['IWC_PROFILE_KEYS_PLAN', true, true, 'partial', 3, 1, false]);
  assertNoValueLeak(partialDryReport);
  const partialApply = await cliRun(contested, ['--apply', '--allow-partial', '--allow-remote']);
  assert.equal(partialApply.exitCode, 0);
  const afterPartial = contested.dump();
  const control = await cliRun(contested, ['--dry-run', '--allow-partial', '--allow-remote']);
  assert.equal(control.exitCode, 0, 'contrôle après --apply --allow-partial : --dry-run --allow-partial rend 0');
  assert.deepEqual([control.capture.report().writes, control.capture.report().plan.skipped, control.capture.report().plan.entries.map((entry) => entry.action)], [0, 1, ['noop', 'noop', 'skip_existing', 'keep_origin_title']]);
  const strict = await cliRun(contested, ['--dry-run', '--allow-remote']);
  assert.deepEqual([strict.exitCode, strict.capture.report().event, strict.capture.report().writes], [1, 'IWC_PROFILE_KEYS_PLAN', 0], '--dry-run seul rend 1 tant que la clé contestée subsiste, sans rien écrire');
  assert.deepEqual(contested.dump(), afterPartial, 'contrôles : dump identique');

  // M53 : --dry-run d'un plan bloqué (copie éditoriale absente) → 1, événement PLAN, dump identique.
  const blocked = seed();
  await blocked.doc(`${STATE}/cartularia-editable-copy`).delete();
  const blockedBefore = blocked.dump();
  const blockedDry = await cliRun(blocked, ['--dry-run', '--allow-remote']);
  assert.equal(blockedDry.exitCode, 1, 'M53');
  const blockedReport = blockedDry.capture.report();
  assert.deepEqual([blockedReport.event, blockedReport.dryRun, blockedReport.plan.blocked, blockedReport.completeness, blockedReport.writes, blockedReport.plan.entries.at(-1).action], ['IWC_PROFILE_KEYS_PLAN', true, true, 'partial', 3, 'missing_editable_copy']);
  assert.ok(codesOf(blockedReport).includes('editable_copy_blocked'));
  assert.deepEqual(blocked.dump(), blockedBefore, 'M53 : dump identique');
  assert.equal((await cliRun(blocked, ['--dry-run', '--allow-partial', '--allow-remote'])).exitCode, 0, 'plan bloqué + --dry-run --allow-partial : 0');
  assert.deepEqual(blocked.dump(), blockedBefore);

  // M54 : brouillon passé en purged entre le plan et l'application → draft_not_ready, dump identique.
  const purged = seed();
  let snapshot;
  await rejectsWithCode(run(purged, {
    beforeApply: async () => {
      await purged.doc(DRAFT).update({ status: 'purged' });
      snapshot = purged.dump();
    },
  }), 'draft_not_ready');
  assert.deepEqual(purged.dump(), snapshot, 'M54 : dump identique');
  assert.equal(purged.dump()[`${STATE}/cartularia-creation-profile`], undefined);
  const purgedViaCli = seed();
  const purgingFirestore = { ...purgedViaCli, runTransaction: async (operation) => { await purgedViaCli.doc(DRAFT).update({ status: 'purged' }); return purgedViaCli.runTransaction(operation); } };
  const purgedRun = await cliRun(purgingFirestore, ['--apply', '--request-sync', '--allow-remote']);
  assert.deepEqual([purgedRun.exitCode, purgedRun.capture.report().event, purgedRun.capture.report().code, purgedRun.capture.report().written], [1, 'IWC_PROFILE_KEYS_FAILED', 'draft_not_ready', false]);
  assert.equal(purgedViaCli.dump()[SYNC].status, 'processed', 'aucune demande déposée');

  // M49 : clé deleted: true dont value vaut la valeur attendue → skip_existing (jamais ressuscitée par ce script).
  const tombstoneSame = seed({ documents: { [`${STATE}/cartularia-public-code`]: stateDocument('cartularia-public-code', IWC_PUBLIC_CODE, { revision: 2, deleted: true }) } });
  const tombstoneBefore = tombstoneSame.dump();
  const tombstonePlan = await run(tombstoneSame, { dryRun: true });
  const tombstoneEntry = tombstonePlan.plan.entries[1];
  assert.deepEqual([tombstoneEntry.key, tombstoneEntry.action, tombstoneEntry.differingFields, tombstoneEntry.current.deleted, tombstoneEntry.nextRevision], ['cartularia-public-code', 'skip_existing', ['(clé supprimée)'], true, 2], 'M49');
  assert.equal(tombstoneEntry.existingDigest, tombstoneEntry.expectedDigest, 'valeur identique sous la pierre tombale : digests tronqués égaux, action inchangée');
  await rejectsWithCode(run(tombstoneSame), 'keys_contested');
  assert.deepEqual(tombstoneSame.dump(), tombstoneBefore);
  await run(tombstoneSame, { allowPartial: true });
  assert.deepEqual(tombstoneSame.dump()[`${STATE}/cartularia-public-code`], tombstoneBefore[`${STATE}/cartularia-public-code`], 'même avec --allow-partial, la clé supprimée reste supprimée');

  // M56 : rapport IWC_PROFILE_KEYS_FAILED de code revision_conflict → aucune valeur ni digest complet.
  const racing = seed();
  const racingFirestore = { ...racing, runTransaction: async (operation) => { await racing.doc(`${STATE}/cartularia-editable-copy`).update({ revision: 3 }); return racing.runTransaction(operation); } };
  const racingBefore = racing.dump();
  const conflict = await cliRun(racingFirestore, ['--apply', '--request-sync', '--allow-remote']);
  const conflictReport = conflict.capture.report();
  assert.deepEqual([conflict.exitCode, conflictReport.event, conflictReport.code, conflictReport.written, conflictReport.classification], [1, 'IWC_PROFILE_KEYS_FAILED', 'revision_conflict', false, REPORT_CLASSIFICATION], 'M56');
  assert.match(conflictReport.message, /cartularia-editable-copy a changé .*révision 2 → 3.*digest identique/);
  assert.ok(Array.isArray(conflictReport.plan.entries) && conflictReport.plan.entries.length === 4, 'le plan (sans valeur) accompagne le refus');
  assertNoValueLeak(conflictReport);
  assert.deepEqual(changedPaths(racingBefore, racing.dump()), [`${STATE}/cartularia-editable-copy`], 'seule la mutation concurrente subsiste : rien d’écrit par le script, aucune demande');
  assert.equal(racing.dump()[`${STATE}/cartularia-editable-copy`].revision, 3);
});

test('(i) parseIwcProfileKeysArgs est pure : cible par défaut IWC, --cartulary explicite, CARTULARIA_CARTULARY_ID ignoré, erreurs en données', () => {
  const plain = parseIwcProfileKeysArgs(['--dry-run', '--allow-remote'], { ...REMOTE_ENV, CARTULARIA_CARTULARY_ID: ROLEX_CARTULARY_ID, CARTULARIA_OWNER_UID: ' uid_x ' });
  assert.deepEqual(plain, {
    ok: true,
    errors: [],
    help: false,
    options: { dryRun: true, apply: false, requestSync: false, allowPartial: false, allowRemote: true, usesEmulator: false, projectId: 'projet-fictif', cartularyId: IWC_CARTULARY_ID, cartularySource: 'default', overrideUid: 'uid_x' },
  });
  assert.equal(parseIwcProfileKeysArgs(['--apply', '--cartulary', ROLEX_CARTULARY_ID, '--allow-remote'], REMOTE_ENV).options.cartularyId, ROLEX_CARTULARY_ID);
  const equals = parseIwcProfileKeysArgs([`--cartulary=${ROLEX_CARTULARY_ID}`, '--apply', '--request-sync', '--allow-partial', '--allow-remote'], REMOTE_ENV);
  assert.deepEqual([equals.ok, equals.options.cartularyId, equals.options.cartularySource, equals.options.requestSync, equals.options.allowPartial], [true, ROLEX_CARTULARY_ID, 'flag', true, true]);
  assert.deepEqual(parseIwcProfileKeysArgs(['--dry-run'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).options, {
    dryRun: true, apply: false, requestSync: false, allowPartial: false, allowRemote: false, usesEmulator: true, projectId: 'cartularia-wave2-local', cartularyId: IWC_CARTULARY_ID, cartularySource: 'default', overrideUid: null,
  });
  assert.match(parseIwcProfileKeysArgs(['--dry-run', '--allow-remote', '--force'], REMOTE_ENV).errors.join('\n'), /Drapeau inconnu : --force/);
  assert.match(parseIwcProfileKeysArgs(['--dry-run', '--apply', '--allow-remote'], REMOTE_ENV).errors.join('\n'), /exactement un mode/);
  assert.match(parseIwcProfileKeysArgs([], REMOTE_ENV).errors.join('\n'), /exactement un mode/);
  assert.match(parseIwcProfileKeysArgs(['--dry-run'], REMOTE_ENV).errors.join('\n'), /--allow-remote est requis même en --dry-run/);
  assert.match(parseIwcProfileKeysArgs(['--dry-run', '--allow-remote'], {}).errors.join('\n'), /GCLOUD_PROJECT ou FIREBASE_PROJECT_ID/);
  assert.match(parseIwcProfileKeysArgs(['--dry-run', '--allow-remote', '--cartulary', 'x'], REMOTE_ENV).errors.join('\n'), /--cartulary attend un identifiant valide/);
  assert.match(parseIwcProfileKeysArgs(['--dry-run', '--allow-remote', '--cartulary'], REMOTE_ENV).errors.join('\n'), /reçu : rien/);
  // --cartulary passé deux fois (même ou autre identifiant) : erreur d'usage, jamais « le dernier gagne ».
  const otherId = 'cart_iwc_copie_recette_2026';
  for (const [argv, first] of [
    [['--dry-run', '--allow-remote', '--cartulary', otherId, '--cartulary', ROLEX_CARTULARY_ID], otherId],
    [['--dry-run', '--allow-remote', `--cartulary=${otherId}`, '--cartulary', otherId], otherId],
    [['--apply', '--allow-remote', `--cartulary=${ID}`, `--cartulary=${otherId}`], ID],
  ]) {
    const twice = parseIwcProfileKeysArgs(argv, REMOTE_ENV);
    assert.equal(twice.ok, false, argv.join(' '));
    assert.match(twice.errors.join('\n'), /--cartulary ne peut être passé qu’une seule fois/);
    assert.deepEqual([twice.options.cartularyId, twice.options.cartularySource], [first, 'flag'], 'la première occurrence est conservée pour le rapport, l’exécution est refusée');
  }
  assert.equal(parseIwcProfileKeysArgs(['--dry-run', '--allow-remote', '--cartulary', otherId, '--cartulary', 'x'], REMOTE_ENV).errors.length, 1, 'une seconde occurrence invalide n’est signalée qu’une fois (identifiant invalide)');
  assert.deepEqual([parseIwcProfileKeysArgs(['--help'], {}).ok, parseIwcProfileKeysArgs(['--help'], {}).help], [true, true]);
  for (const fragment of ['--request-sync', 'conflict', 'cartularia-sensitivity-prices', 'cartularia-editable-copy', 'rien n’a été écrit', '--allow-partial', 'avec --dry-run : prévisualise', 'not_iwc_cartulary', 'CARTULARIA_CARTULARY_ID n’est pas lu', IWC_PROFILE_SYNC_REASON, 'owner_membership_missing', 'memberships/{uid}', 'publicCode, objectCode ou makerName',
    'Contrôle après --apply --allow-partial : --dry-run --allow-partial', '--dry-run seul rend 1 tant qu’une clé contestée subsiste', 'npm run sync:worker -- --allow-remote', 'run-with-firebase-cli-adc.mjs', 'Could not load the default credentials', 'syncCartularyToRegistry', 'CARTULARY_SYNC_FAILED', '(une seule fois)',
    'root.valuation', 'draft.valuationKeys', `rapport classé ${REPORT_CLASSIFICATION}`, 'creation_profile_drives_valuation', 'purchasePrice, valuationMid']) {
    assert.ok(IWC_PROFILE_KEYS_USAGE.includes(fragment), `usage : ${fragment}`);
  }
});

test('(j) runIwcProfileKeysCli câble dry-run, apply, request-sync, allow-partial et le code de sortie sur un Firestore mémoire', async () => {
  const dry = seed();
  const before = dry.dump();
  const dryRun = await cliRun(dry, ['--dry-run', '--allow-remote']);
  assert.equal(dryRun.exitCode, 0);
  assert.deepEqual(dry.dump(), before, '--dry-run : dump identique');
  const dryReport = dryRun.capture.report();
  assert.deepEqual([dryReport.event, dryReport.cartularyId, dryReport.cartularySource, dryReport.ownerUid, dryReport.dryRun, dryReport.writes, dryReport.syncRequested, dryReport.completeness], ['IWC_PROFILE_KEYS_PLAN', ID, 'default', OWNER, true, 4, false, 'complete']);
  assert.deepEqual(dryReport.target, { cartularyId: ID, isDefaultId: true, matchedBy: 'publicCode' });
  assert.deepEqual(dryReport.plan.entries.map((entry) => [entry.key, entry.action, entry.currentRevision, entry.nextRevision]), [
    ['cartularia-creation-profile', 'create', 0, 1], ['cartularia-public-code', 'create', 0, 1], ['cartularia-sensitivity-prices', 'create', 0, 1], ['cartularia-editable-copy', 'merge_origin_title', 2, 3],
  ]);
  assert.match(dryReport.plan.entries[0].expectedDigest, /^[0-9a-f]{12}$/);
  assert.equal(dryReport.plan.entries[0].current, undefined, 'digest complet non exposé');
  assert.deepEqual(dryReport.ownerMembership, { path: MEMBERSHIP, exists: true, ok: true, missing: [] });
  assert.equal(dryReport.root.lastGenericOperationToken, undefined);
  assertNoValueLeak(dryReport);
  assert.equal(dryRun.capture.err(), '');

  const dryWithSync = seed();
  const dryWithSyncBefore = dryWithSync.dump();
  const dryWithSyncRun = await cliRun(dryWithSync, ['--dry-run', '--request-sync', '--allow-remote']);
  assert.equal(dryWithSyncRun.exitCode, 0);
  assert.deepEqual(dryWithSync.dump(), dryWithSyncBefore, '--dry-run --request-sync : aucune écriture, aucune demande');
  assert.deepEqual([dryWithSyncRun.capture.report().requestSyncFlag, dryWithSyncRun.capture.report().syncRequested, dryWithSyncRun.capture.report().requestId], [true, false, null]);

  const applied = seed();
  const appliedBefore = applied.dump();
  const apply = await cliRun(applied, ['--apply', '--allow-remote']);
  assert.equal(apply.exitCode, 0);
  const applyReport = apply.capture.report();
  assert.deepEqual([applyReport.event, applyReport.dryRun, applyReport.writes, applyReport.keys, applyReport.syncRequested, applyReport.requestId], ['IWC_PROFILE_KEYS_APPLIED', false, 4, [...IWC_PROFILE_KEYS], false, null]);
  assert.deepEqual(changedPaths(appliedBefore, applied.dump()), [DRAFT, ...IWC_PROFILE_KEYS.map((key) => `${STATE}/${key}`)].sort(), '--apply écrit les quatre clés et le brouillon');
  assert.deepEqual(applied.dump()[SYNC], appliedBefore[SYNC], 'sans --request-sync : aucune demande');
  assert.equal(applied.dump()[`${STATE}/cartularia-public-code`].value, JSON.stringify(IWC_PUBLIC_CODE));
  assert.ok(applyReport.warnings.some((warning) => warning.code === 'audit_attribution_without_request_sync'));
  assertNoValueLeak(applyReport);

  const synced = seed();
  const withSync = await cliRun(synced, ['--apply', '--request-sync', '--allow-remote']);
  assert.equal(withSync.exitCode, 0);
  assert.deepEqual([withSync.capture.report().syncRequested, withSync.capture.report().requestId], [true, REQUEST_ID]);
  assert.deepEqual([synced.dump()[SYNC].status, synced.dump()[SYNC].requestId, synced.dump()[SYNC].reason, synced.dump()[SYNC].outcome], ['pending', REQUEST_ID, IWC_PROFILE_SYNC_REASON, undefined]);
  assert.ok(!withSync.capture.report().warnings.some((warning) => warning.code === 'audit_attribution_without_request_sync'));

  const contested = seed({ documents: { [`${STATE}/cartularia-sensitivity-prices`]: stateDocument('cartularia-sensitivity-prices', [1000, 2000, 3000, 4000, 5000], { revision: 1 }) } });
  const contestedBefore = contested.dump();
  const refused = await cliRun(contested, ['--apply', '--request-sync', '--allow-remote']);
  assert.equal(refused.exitCode, 1);
  assert.deepEqual(contested.dump(), contestedBefore, 'skip_existing sans --allow-partial : exit 1 et dump identique');
  assert.deepEqual([refused.capture.report().event, refused.capture.report().code, refused.capture.report().written], ['IWC_PROFILE_KEYS_FAILED', 'keys_contested', false]);
  const refusedEntry = refused.capture.report().plan.entries[2];
  assert.deepEqual([refusedEntry.key, refusedEntry.action, refusedEntry.differingFields, refusedEntry.existingDigest], ['cartularia-sensitivity-prices', 'skip_existing', ['length=5 (contenu différent)'], shortDigestOf(JSON.stringify([1000, 2000, 3000, 4000, 5000]))], 'le rapport de refus porte le plan (sans valeur)');
  assertNoValueLeak(refused.capture.report());
  const contestedDry = await cliRun(contested, ['--dry-run', '--allow-remote']);
  assert.equal(contestedDry.exitCode, 1, 'dry-run d’un plan contesté : code 1 (rien n’a été écrit)');
  assert.deepEqual(contested.dump(), contestedBefore);
  const partial = await cliRun(contested, ['--apply', '--allow-partial', '--request-sync', '--allow-remote']);
  assert.equal(partial.exitCode, 0, '--allow-partial : code 0, clés contestées listées dans le rapport');
  const partialReport = partial.capture.report();
  assert.deepEqual([partialReport.completeness, partialReport.allowPartial, partialReport.writes, partialReport.keys, partialReport.plan.skipped, partialReport.syncRequested], ['partial', true, 3, ['cartularia-creation-profile', 'cartularia-public-code', 'cartularia-editable-copy'], 1, true]);
  assert.deepEqual(contested.dump()[`${STATE}/cartularia-sensitivity-prices`], contestedBefore[`${STATE}/cartularia-sensitivity-prices`], 'clé contestée intacte');
  assert.equal(contested.dump()[`${STATE}/cartularia-creation-profile`].revision, 1);
  assert.equal(contested.dump()[SYNC].status, 'pending');

  const blocked = seed();
  await blocked.doc(`${STATE}/cartularia-editable-copy`).delete();
  const blockedBefore = blocked.dump();
  const blockedRun = await cliRun(blocked, ['--apply', '--allow-remote']);
  assert.deepEqual([blockedRun.exitCode, blockedRun.capture.report().code, blockedRun.capture.report().plan.blocked], [1, 'plan_blocked', true]);
  assert.deepEqual(blocked.dump(), blockedBefore);
  const blockedPartial = await cliRun(blocked, ['--apply', '--allow-partial', '--allow-remote']);
  assert.equal(blockedPartial.exitCode, 0);
  assert.ok(blockedPartial.capture.report().warnings.some((warning) => warning.code === 'editable_copy_blocked'), 'plan bloqué + --allow-partial : avertissement dédié dans le rapport');
  assert.deepEqual(blockedPartial.capture.report().keys, SIMPLE_KEYS);
});

test('(k) runIwcProfileKeysCli : cible explicite respectée, CARTULARIA_CARTULARY_ID ignoré, Rolex refusé, CARTULARIA_OWNER_UID différent refusé, drapeau inconnu et --help', async () => {
  const both = seed({ documents: rolexDocuments() });
  const before = both.dump();
  const envPointsToRolex = await cliRun(both, ['--dry-run', '--allow-remote'], { ...REMOTE_ENV, CARTULARIA_CARTULARY_ID: ROLEX_CARTULARY_ID });
  assert.equal(envPointsToRolex.exitCode, 0);
  assert.deepEqual([envPointsToRolex.capture.report().cartularyId, envPointsToRolex.capture.report().cartularySource, envPointsToRolex.capture.report().event], [ID, 'default', 'IWC_PROFILE_KEYS_PLAN'], 'la variable d’environnement partagée n’est plus lue');

  const rolexFlag = await cliRun(both, ['--apply', '--cartulary', ROLEX_CARTULARY_ID, '--allow-remote']);
  assert.equal(rolexFlag.exitCode, 1);
  assert.deepEqual([rolexFlag.capture.report().event, rolexFlag.capture.report().code, rolexFlag.capture.report().cartularyId, rolexFlag.capture.report().cartularySource, rolexFlag.capture.report().written, rolexFlag.capture.report().plan], ['IWC_PROFILE_KEYS_FAILED', 'not_iwc_cartulary', ROLEX_CARTULARY_ID, 'flag', false, null]);
  assert.deepEqual(both.dump(), before, 'racine Rolex : aucune écriture');

  const otherId = 'cart_iwc_copie_recette_2026';
  const relocated = createMemoryFirestore({
    [`cartularies/${otherId}`]: rootDocument(otherId, { publicCode: undefined, objectCode: undefined, makerName: 'IWC Schaffhausen' }),
    [`privateDrafts/${OWNER}/cartularies/${otherId}`]: { ownerUid: OWNER, cartularyId: otherId, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1', purgeAfter: null, lastActiveAt: 'ts-before', updatedAt: 'ts-before' },
    [`privateDrafts/${OWNER}/cartularies/${otherId}/state/cartularia-editable-copy`]: stateDocument('cartularia-editable-copy', editableCopyWithoutTitle(), { revision: 5, cartularyId: otherId }),
  });
  const explicit = await cliRun(relocated, ['--apply', `--cartulary=${otherId}`, '--allow-remote']);
  assert.equal(explicit.exitCode, 0);
  const explicitReport = explicit.capture.report();
  assert.deepEqual([explicitReport.cartularyId, explicitReport.cartularySource, explicitReport.target.matchedBy, explicitReport.writes], [otherId, 'flag', 'makerName', 4]);
  assert.deepEqual(explicitReport.ownerMembership, { path: MEMBERSHIP, exists: false, ok: false, missing: ['membership absent'] });
  assert.equal(explicitReport.warnings[0].code, 'owner_membership_missing', 'sans membership, le rapport le signale en tête');
  assert.equal(relocated.dump()[`privateDrafts/${OWNER}/cartularies/${otherId}/state/cartularia-creation-profile`].cartularyId, otherId);
  assert.equal(relocated.dump()[`privateDrafts/${OWNER}/cartularies/${otherId}/state/cartularia-editable-copy`].revision, 6);
  assert.equal(relocated.dump()[`privateDrafts/${OWNER}/cartularies/${ID}`], undefined, 'rien n’est écrit sous l’identifiant par défaut');

  const mismatch = seed();
  const mismatchBefore = mismatch.dump();
  const ownerMismatch = await cliRun(mismatch, ['--apply', '--allow-remote'], { ...REMOTE_ENV, CARTULARIA_OWNER_UID: 'wave1-owner' });
  assert.deepEqual([ownerMismatch.exitCode, ownerMismatch.capture.report().code], [1, 'owner_mismatch']);
  assert.deepEqual(mismatch.dump(), mismatchBefore);
  const sameOwner = await cliRun(mismatch, ['--dry-run', '--allow-remote'], { ...REMOTE_ENV, CARTULARIA_OWNER_UID: OWNER });
  assert.deepEqual([sameOwner.exitCode, sameOwner.capture.report().ownerSource], [0, 'env']);

  const unknown = await cliRun(seed(), ['--apply', '--allow-remote', '--force']);
  assert.deepEqual([unknown.exitCode, unknown.report], [1, null]);
  assert.match(unknown.capture.err(), /Drapeau inconnu : --force/);
  assert.equal(unknown.capture.out(), '');
  const busyStage = seed({ syncStatus: 'processing' });
  const busy = await cliRun(busyStage, ['--apply', '--allow-remote']);
  assert.deepEqual([busy.exitCode, busy.capture.report().code, busy.capture.report().stage], [1, 'sync_in_progress', 'context']);
  const help = await cliRun(seed(), ['--help'], {});
  assert.deepEqual([help.exitCode, help.report], [0, null]);
  assert.equal(help.capture.out(), `${IWC_PROFILE_KEYS_USAGE}\n`);
});

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = (args, env = {}) => spawnSync(process.execPath, ['scripts/update-iwc-profile-keys.mjs', ...args], {
  cwd: projectRoot,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  encoding: 'utf8',
});

test('(h) update-iwc-dossier.mjs importe le module partagé sans dupliquer les valeurs ; le script CLI ne fait que l’aide et l’initialisation, et refuse l’usage incomplet ou distant sans --allow-remote', () => {
  const dossier = readFileSync(new URL('../scripts/update-iwc-dossier.mjs', import.meta.url), 'utf8');
  assert.match(dossier, /from '\.\/lib\/iwc-dossier-values\.mjs'/);
  for (const symbol of ['buildIwcCreationProfile()', 'buildIwcEditableCopy()', 'IWC_PUBLIC_CODE', 'IWC_SENSITIVITY_PRICES', 'IWC_UPDATE_DATE']) assert.ok(dossier.includes(symbol), symbol);
  assert.doesNotMatch(dossier, /'OP-4892-XZ9'/);
  assert.doesNotMatch(dossier, /3200, 3600, 4000, 4400, 4800/);
  assert.doesNotMatch(dossier, /originTitle:/);
  assert.doesNotMatch(dossier, /const editableCopy = \{|const creationProfile = \{|UPDATE_DATE = '2026-08-29'/);
  const profileScript = readFileSync(new URL('../scripts/update-iwc-profile-keys.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(profileScript, /firebase-admin\/storage|IWC_SOURCE_DIRECTORY|processCartularySyncRequest/);
  assert.doesNotMatch(profileScript, /CARTULARIA_CARTULARY_ID|resolveIwcOwner|applyIwcProfileKeys|runTransaction/, 'le script ne porte plus de logique');
  // Câblage du script mince, prouvé statiquement (l'émulateur étant exclu, un --apply en sous-processus
  // tenterait une connexion distante) : argv réel, env réel, Firestore initialisé, code de sortie propagé.
  assert.match(profileScript, /const argv = process\.argv\.slice\(2\)/);
  assert.match(profileScript, /parseIwcProfileKeysArgs\(argv, process\.env\)/);
  assert.match(profileScript, /runIwcProfileKeysCli\(\{ argv, env: process\.env, firestore, stdout: process\.stdout, stderr: process\.stderr \}\)/);
  assert.match(profileScript, /process\.exitCode = exitCode;/);
  assert.match(profileScript, /const firestore = getFirestore\(app\);/);
  assert.equal((profileScript.match(/process\.exit\(1\)/g) || []).length, 1, 'un seul exit(1) : les arguments invalides');

  const usage = cli([]);
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /--dry-run \| --apply/);
  const both = cli(['--dry-run', '--apply']);
  assert.equal(both.status, 1);
  const unknown = cli(['--dry-run', '--allow-remote', '--force']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Drapeau inconnu/);
  const remote = cli(['--dry-run'], { GCLOUD_PROJECT: 'projet-fictif' });
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /--allow-remote est requis même en --dry-run/);
  const noProject = cli(['--dry-run', '--allow-remote']);
  assert.equal(noProject.status, 1);
  assert.match(noProject.stderr, /GCLOUD_PROJECT ou FIREBASE_PROJECT_ID/);
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--allow-partial/);
  assert.match(help.stdout, /rien n’a été écrit/);
});
