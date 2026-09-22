import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { DEMO_ACCOUNT, DEMO_CARTULARIES } from '../src/data/demoCartularies.ts';
import { buildDemoAssetDocuments, buildDemoCartularyEnvelope, DEMO_ASSERTED_AT } from '../src/data/demoCartularyDocuments.ts';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { CANONICALIZATION_VERSION, sha256Bytes, sha256Digest } from '../scripts/lib/canonical-json.mjs';
import { detectTrustedFileFormat } from '../scripts/lib/private-upload-command.mjs';
import { PUBLIC_BLOCK_ALLOWLIST, publishPublicBlocks } from '../scripts/lib/projection-command.mjs';
import {
  applyDemoPublication, buildDemoWebsiteBlocks, DEFAULT_DEMO_WEBSITE_BLOCKS, DEMO_DECISION_SOURCE, DEMO_DISCLAIMER, DEMO_EYEBROW,
  DEMO_PUBLICATION_USAGE, describeDemoPublicationRun, parseDemoPublicationArgs, planDemoPublication, prepareDemoDerivative,
  runDemoPublicationCli,
} from '../scripts/lib/demo-publication-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const SUBMARINER = DEMO_CARTULARIES[0];
const ID = SUBMARINER.id;
const CODE = SUBMARINER.publicCode;
const ROOT = `cartularies/${ID}`;
const PUBLICATION = `publications/${CODE}`;
const SEAL = `seals/${CODE}`;
const UID = 'demo-uid-fixture';
const MEMBERSHIP = `organizations/${DEMO_ACCOUNT.organizationId}/memberships/${UID}`;
const REMOTE_ENV = { GCLOUD_PROJECT: 'cartularia-prod-simule' };
const EMULATOR_ENV = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:18087' };
const NOW = '2026-09-14T10:00:00.000Z';
const LATER = '2026-09-14T11:00:00.000Z';
const READ_ONLY_PERMISSIONS = ['organization.read', 'membership.read', 'registry.read', 'access.read', 'cartulary.read', 'cartulary.export'];
const commandSource = readFileSync(new URL('../scripts/lib/demo-publication-command.mjs', import.meta.url), 'utf8');
const wrapperSource = readFileSync(new URL('../scripts/publish-demo-website.mjs', import.meta.url), 'utf8');
const wrapperPath = fileURLToPath(new URL('../scripts/publish-demo-website.mjs', import.meta.url));

assert.equal(CODE, 'DEMO-ROL-124060', 'la Submariner est le seul objet démo publié en V2 (décision e)');

/** Même recette que scripts/seed-demo-account.mjs (événement 1, acteur demo_seed, hash JCS). */
const seedEvent = (cartulary, uid) => {
  const eventId = `evt_demo_${createHash('sha256').update(cartulary.id).digest('hex').slice(0, 20)}`;
  const previousEventHash = `sha256:${'0'.repeat(64)}`;
  const event = {
    eventId, cartularyId: cartulary.id, sequence: 1, occurredAt: DEMO_ASSERTED_AT, actor: { uid, role: 'demo_seed' }, action: 'cartulary.demo.created',
    resource: { type: 'cartulary', id: cartulary.id }, beforeDigest: null, afterDigest: sha256Digest(`demo:${cartulary.id}`), previousEventHash,
    canonicalizationVersion: CANONICALIZATION_VERSION, requestId: `seed_demo_${cartulary.id}`,
  };
  return { eventId, hash: sha256Digest({ previousEventHash, event }), stored: { ...event, occurredAt: Timestamp.fromDate(new Date(DEMO_ASSERTED_AT)), occurredAtIso: DEMO_ASSERTED_AT, hash: sha256Digest({ previousEventHash, event }) } };
};

const seedDocuments = () => {
  const documents = {
    [`users/${UID}`]: { uid: UID, status: 'active', accountPurpose: 'public_read_only_demo' },
    [MEMBERSHIP]: { uid: UID, organizationId: DEMO_ACCOUNT.organizationId, roles: ['guest'], status: 'active', scopes: { registryIds: [DEMO_ACCOUNT.registryId] }, permissions: READ_ONLY_PERMISSIONS, accountPurpose: 'public_read_only_demo' },
  };
  for (const cartulary of DEMO_CARTULARIES) {
    const { eventId, hash, stored } = seedEvent(cartulary, UID);
    documents[`cartularies/${cartulary.id}`] = { ...buildDemoCartularyEnvelope(cartulary, UID, hash), integritySequence: 1, demo: true, demoDisclaimer: DEMO_DISCLAIMER };
    documents[`cartularies/${cartulary.id}/auditEvents/${eventId}`] = stored;
    for (const asset of buildDemoAssetDocuments(cartulary)) documents[`cartularies/${cartulary.id}/assets/${asset.id}`] = asset;
  }
  return documents;
};

/** Faux bucket Storage : getFiles({ prefix }), file(path).save/delete — les seules primitives utilisées par la lib. */
const createMemoryBucket = () => {
  const blobs = new Map();
  const calls = [];
  return {
    blobs, calls,
    getFiles: async ({ prefix }) => [[...blobs.keys()].filter((name) => name.startsWith(prefix)).sort().map((name) => ({ name }))],
    file: (path) => ({
      save: async (bytes, options) => { calls.push(['save', path]); blobs.set(path, { bytes: Buffer.from(bytes), options }); },
      delete: async ({ ignoreNotFound } = {}) => { calls.push(['delete', path]); if (!blobs.has(path) && !ignoreNotFound) throw new Error(`absent : ${path}`); blobs.delete(path); },
    }),
  };
};

const harness = (mutate = () => {}) => {
  const documents = seedDocuments();
  mutate(documents);
  const firestore = createMemoryFirestore(documents);
  const bucket = createMemoryBucket();
  const snapshot = () => JSON.stringify({ documents: firestore.dump(), blobs: [...bucket.blobs.keys()].sort() });
  return { firestore, bucket, snapshot };
};

const captureCli = async (input) => {
  const out = [];
  const err = [];
  const result = await runDemoPublicationCli({ stdout: { write: (chunk) => out.push(chunk) }, stderr: { write: (chunk) => err.push(chunk) }, now: NOW, ...input });
  return { ...result, stdout: out.join(''), stderr: err.join('') };
};

const chainOf = async (firestore) => {
  const root = (await firestore.doc(ROOT).get()).data();
  const events = (await firestore.doc(ROOT).collection('auditEvents').get()).docs.map((snapshot) => snapshot.data()).sort((a, b) => a.sequence - b.sequence);
  return { root, events, verification: verifyAuditChain({ events, integrityHead: root.integrityHead, integritySequence: root.integritySequence }) };
};

test('parseDemoPublicationArgs : --cartulary obligatoire et restreint aux objets démo, --apply exige la confirmation, --blocks vérifié, --revoke exclusif, --help', () => {
  assert.equal(parseDemoPublicationArgs([], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseDemoPublicationArgs(['--cartulary'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseDemoPublicationArgs(['--cartulary', 'cart_iwc_pilote_reel_0001'], REMOTE_ENV).code, 'not_a_demo_cartulary');
  assert.equal(parseDemoPublicationArgs(['--cartulary', ID, '--apply'], REMOTE_ENV).code, 'confirmation_required');
  assert.equal(parseDemoPublicationArgs(['--cartulary', ID, '--blocks', 'cover-watch,value-market'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseDemoPublicationArgs(['--cartulary', ID, '--blocks', 'cover-watch,cover-watch'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseDemoPublicationArgs(['--cartulary', ID, '--revoke', '--blocks=cover-watch'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseDemoPublicationArgs(['--cartulary', ID, '--revoke', '--include-video'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseDemoPublicationArgs(['--cartulary', ID, '--mystere'], REMOTE_ENV).code, 'invalid_argument');
  const remote = parseDemoPublicationArgs([`--cartulary=${ID}`, '--allow-remote'], { ...REMOTE_ENV, FFMPEG_PATH: '/opt/ffmpeg' });
  assert.equal(remote.ok, true);
  assert.deepEqual(remote.options.blocks, [...DEFAULT_DEMO_WEBSITE_BLOCKS]);
  assert.equal(remote.options.projectId, 'cartularia-prod-simule');
  assert.equal(remote.options.usesEmulator, false);
  assert.deepEqual(remote.options.videoTooling, { ffmpegPath: '/opt/ffmpeg', ffprobePath: null });
  const emulator = parseDemoPublicationArgs(['--cartulary', ID, '--blocks', 'media-hero,cover-watch', '--apply', '--confirm-demo-publication'], EMULATOR_ENV);
  assert.equal(emulator.ok, true);
  assert.deepEqual(emulator.options.blocks, ['media-hero', 'cover-watch']);
  assert.equal(emulator.options.projectId, 'cartularia-demo-local');
  assert.equal(emulator.options.apply && emulator.options.confirmDemoPublication, true);
  assert.equal(parseDemoPublicationArgs(['--help'], {}).options.help, true);
  assert.ok(DEFAULT_DEMO_WEBSITE_BLOCKS.every((id) => PUBLIC_BLOCK_ALLOWLIST.includes(id)));
  assert.ok(DEFAULT_DEMO_WEBSITE_BLOCKS.every((id) => !id.startsWith('value-') && !id.startsWith('cover-owner') && !id.includes('transmission')));
});

test('CLI : hors émulateur, projet explicite et --allow-remote obligatoires même en simulation ; identifiant non démo refusé — Firebase jamais initialisé', async () => {
  const factoryCalls = [];
  const firestore = () => { factoryCalls.push('firestore'); return createMemoryFirestore(seedDocuments()); };
  const bucket = () => { factoryCalls.push('bucket'); return createMemoryBucket(); };
  const noProject = await captureCli({ argv: ['--cartulary', ID, '--allow-remote'], env: {}, firestore, bucket });
  assert.equal(noProject.exitCode, 1);
  assert.equal(JSON.parse(noProject.stderr).code, 'project_required');
  const noFlag = await captureCli({ argv: ['--cartulary', ID], env: REMOTE_ENV, firestore, bucket });
  assert.equal(noFlag.exitCode, 1);
  assert.equal(JSON.parse(noFlag.stderr).code, 'remote_not_allowed');
  const notDemo = await captureCli({ argv: ['--cartulary', 'cart_iwc_pilote_reel_0001', '--allow-remote'], env: REMOTE_ENV, firestore, bucket });
  assert.equal(notDemo.exitCode, 1);
  assert.equal(JSON.parse(notDemo.stderr).code, 'not_a_demo_cartulary');
  const help = await captureCli({ argv: ['--help'], env: {}, firestore, bucket });
  assert.equal(help.exitCode, 0);
  assert.equal(help.stdout.trim(), DEMO_PUBLICATION_USAGE.trim());
  assert.deepEqual(factoryCalls, []);
});

test('plan bloqué sans écriture : racine absente, non démo, organisation, registre, code public, publication ou sceau d’un autre objet, compte non démo, compte privilégié, chaîne d’audit invalide', async () => {
  const cases = [
    ['cartulary_not_found', (documents) => { delete documents[ROOT]; }],
    ['not_demo_root', (documents) => { documents[ROOT].demo = false; }],
    ['organization_mismatch', (documents) => { documents[ROOT].organizationId = 'org_autre'; }],
    ['registry_mismatch', (documents) => { documents[ROOT].registryId = 'reg_autre'; }],
    ['public_code_mismatch', (documents) => { documents[ROOT].publicCode = 'DEMO-ROL-000000'; }],
    ['public_code_mismatch', (documents) => { documents[PUBLICATION] = { cartularyId: 'cart_autre', status: 'published' }; }],
    ['public_code_mismatch', (documents) => { documents[SEAL] = { cartularyId: 'cart_autre', status: 'issued' }; }],
    ['demo_account_mismatch', (documents) => { documents[`users/${UID}`].accountPurpose = 'personal'; }],
    ['demo_account_mismatch', (documents) => { delete documents[`users/${UID}`]; }],
    ['demo_account_privileged', (documents) => { documents[MEMBERSHIP].permissions = [...READ_ONLY_PERMISSIONS, 'publication.manage']; }],
    ['demo_account_privileged', (documents) => { documents[MEMBERSHIP].roles = ['legal_owner']; }],
    ['audit_chain_invalid', (documents) => { documents[ROOT].integrityHead = `sha256:${'1'.repeat(64)}`; }],
    ['audit_chain_invalid', (documents) => { documents[ROOT].integritySequence = 2; }],
  ];
  for (const [code, mutate] of cases) {
    const { firestore, bucket, snapshot } = harness(mutate);
    const before = snapshot();
    const plan = await planDemoPublication({ firestore, bucket, cartularyId: ID });
    assert.equal(plan.ok, false, code);
    assert.ok(plan.blockers.some((entry) => entry.code === code), `${code} attendu, obtenu ${plan.blockers.map((entry) => entry.code).join(',')}`);
    assert.equal(plan.derivatives.length, 0, `${code} : aucun dérivé calculé pour un plan bloqué`);
    await assert.rejects(applyDemoPublication({ firestore, bucket, plan, now: NOW }), { code: 'plan_blocked' });
    const report = describeDemoPublicationRun({ plan });
    assert.equal(report.ok, false);
    assert.deepEqual(report.writes, []);
    assert.equal(snapshot(), before, `${code} : aucune écriture`);
  }
  await assert.rejects(planDemoPublication({ firestore: createMemoryFirestore({}), cartularyId: 'cart_iwc_pilote_reel_0001' }), { code: 'not_a_demo_cartulary' });
});

test('simulation (CLI, émulateur) : rapport complet, aucune écriture, aucun octet ni contenu dans la sortie', async () => {
  const { firestore, bucket, snapshot } = harness();
  const before = snapshot();
  const run = await captureCli({ argv: ['--cartulary', ID], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(run.exitCode, 0, run.stderr);
  assert.equal(snapshot(), before);
  const report = JSON.parse(run.stdout);
  assert.equal(report.event, 'DEMO_PUBLICATION_PLAN');
  assert.equal(report.dryRun, true);
  assert.equal(report.mode, 'publish');
  assert.equal(report.ok, true);
  assert.equal(report.usesEmulator, true);
  assert.equal(report.projectId, 'cartularia-demo-local');
  assert.equal(report.uid, UID);
  assert.deepEqual(report.root, { path: ROOT, exists: true, revision: 1, integritySequence: 1, publicationStatus: 'none', schemaVersion: 'watch@1.6.0' });
  assert.deepEqual(report.audit, { valid: true, eventCount: 1, errors: [] });
  assert.equal(report.expectedRevision, 1);
  assert.equal(report.requestId, `demo_publish_${ID}_2`);
  assert.equal(report.publicationRevision, 1);
  assert.deepEqual(report.blocks.map((entry) => entry.id), [...DEFAULT_DEMO_WEBSITE_BLOCKS]);
  assert.equal(report.blockCount, 8);
  assert.equal(report.derivativeCount, 3);
  assert.ok(report.derivatives.every((entry) => entry.mimeType === 'image/webp' && entry.storagePath === `public/${CODE}/${entry.assetId}/${entry.derivativeId}` && entry.byteSize > 0 && entry.width <= 1600 && entry.height <= 1600 && /^[0-9a-f]{16}$/.test(entry.sha256)));
  assert.match(report.contentHash, /^[0-9a-f]{16}$/);
  assert.equal(report.alreadyPublished, false);
  assert.equal(report.storage.existingFileCount, 0);
  assert.ok(report.writes.includes(PUBLICATION) && report.writes.includes(SEAL) && report.writes.includes(ROOT));
  assert.ok(report.writes.some((path) => path.startsWith(`public/${CODE}/`)));
  assert.equal(report.applied, null);
  assert.doesNotMatch(run.stdout, /"bytes"|paragraphs|RIFF/);
  assert.ok(!run.stdout.includes(SUBMARINER.description.slice(0, 40)), 'aucun contenu rédactionnel dans le rapport');
});

test('application : dérivés WebP sans métadonnées déposés avec les métadonnées Storage exigées, projection identique à publishPublicBlocks, événement d’audit demo_seed, aucun droit accordé', async () => {
  const { firestore, bucket } = harness();
  const membershipBefore = JSON.stringify((await firestore.doc(MEMBERSHIP).get()).data());
  const userBefore = JSON.stringify((await firestore.doc(`users/${UID}`).get()).data());
  const run = await captureCli({ argv: ['--cartulary', ID, '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(run.exitCode, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.event, 'DEMO_PUBLICATION_APPLIED');
  assert.equal(report.dryRun, false);
  assert.equal(report.applied.status, 'published');
  assert.equal(report.applied.revision, 2);
  assert.equal(report.applied.uploadedPaths.length, 3);
  assert.deepEqual(report.applied.cleanedPaths, []);
  assert.match(report.applied.contentHash, /^[0-9a-f]{16}$/);

  const publication = (await firestore.doc(PUBLICATION).get()).data();
  assert.equal(publication.status, 'published');
  assert.equal(publication.publicationStatus, 'published');
  assert.equal(publication.cartularyId, ID);
  assert.equal(publication.publicCode, CODE);
  assert.equal(publication.demo, true);
  assert.equal(publication.demoDisclaimer, DEMO_DISCLAIMER);
  assert.equal(publication.publicationRevision, 1);
  assert.equal(publication.sourceRevision, 2);
  assert.equal(publication.assetCount, 3);
  assert.equal(publication.displayTitle, 'Rolex Submariner');
  assert.deepEqual(publication.blockIds, [...DEFAULT_DEMO_WEBSITE_BLOCKS]);
  assert.ok(publication.blockIds.every((id) => PUBLIC_BLOCK_ALLOWLIST.includes(id)));

  const blocks = (await firestore.doc(PUBLICATION).collection('blocks').get()).docs.map((snapshot) => snapshot.data());
  assert.equal(blocks.length, 8);
  for (const block of blocks) {
    assert.equal(block.payload.eyebrow, DEMO_EYEBROW, block.blockId);
    assert.equal(block.publicationStatus, 'published');
    assert.equal(block.sourceRevision, 2);
    assert.equal(typeof block.title, 'string');
    for (const asset of block.assets) {
      assert.equal(asset.storagePath, `public/${CODE}/${asset.assetId}/${asset.derivativeId}`);
      assert.equal(asset.mimeType, 'image/webp');
      assert.equal(asset.mediaKind, 'image');
      const blob = bucket.blobs.get(asset.storagePath);
      assert.ok(blob, `copie publique ${asset.storagePath}`);
      assert.equal(asset.contentHash, sha256Bytes(blob.bytes));
    }
  }
  assert.equal(blocks.find((block) => block.blockId === 'media-hero').assets.length, 1);
  assert.equal(blocks.find((block) => block.blockId === 'media-library').assets.length, 3);
  assert.ok(blocks.find((block) => block.blockId === 'reference-specs').payload.groups[0].items.length >= 6);
  assert.ok(blocks.find((block) => block.blockId === 'reference-history').payload.paragraphs.length >= 1);

  for (const [path, blob] of bucket.blobs) {
    const [, code, assetId, derivativeId] = path.split('/');
    assert.equal(code, CODE);
    assert.equal(detectTrustedFileFormat(blob.bytes), 'webp');
    assert.deepEqual(blob.options, { resumable: false, metadata: { contentType: 'image/webp', cacheControl: 'private, no-store, max-age=0', metadata: { publicCode: CODE, assetId, derivativeId, metadataStripped: 'true', firebaseStorageDownloadTokens: '' } } });
    const metadata = await sharp(blob.bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined, 'métadonnées EXIF retirées');
    assert.ok(metadata.width <= 1600 && metadata.height <= 1600);
    const derivative = (await firestore.doc(`${ROOT}/assets/${assetId}/derivatives/${derivativeId}`).get()).data();
    assert.deepEqual(derivative, { assetId, derivativeId, publicCode: CODE, visibility: 'public', processingState: 'ready', mediaKind: 'image', mimeDetected: 'image/webp', storagePath: path, sha256: sha256Bytes(blob.bytes) });
    const access = (await firestore.doc(`${PUBLICATION}/mediaAccess/${assetId}`).get()).data();
    assert.deepEqual(access, { derivativeIds: [derivativeId] });
  }
  assert.equal((await firestore.doc(PUBLICATION).collection('mediaAccess').get()).size, 3);

  const seal = (await firestore.doc(SEAL).get()).data();
  assert.equal(seal.status, 'issued');
  assert.equal(seal.cartularyId, ID);
  assert.equal(seal.contentHash, publication.contentHash);
  assert.match(seal.supportCode, /^S-[0-9A-F]{8}$/);
  assert.equal(seal.publicationPath, PUBLICATION);

  const { root, events, verification } = await chainOf(firestore);
  assert.equal(root.publicationStatus, 'published');
  assert.equal(root.revision, 2);
  assert.equal(root.integritySequence, 2);
  assert.equal(verification.valid, true, JSON.stringify(verification.errors));
  const published = events.at(-1);
  assert.equal(root.integrityHead, published.hash);
  assert.equal(published.action, 'publication.published');
  assert.deepEqual(published.actor, { uid: UID, role: 'demo_seed' });
  assert.deepEqual(published.resource, { type: 'publication', id: CODE });
  assert.equal(published.requestId, `demo_publish_${ID}_2`);
  assert.equal(published.afterDigest, publication.contentHash);
  assert.equal(published.beforeDigest, events[0].hash);
  assert.equal(published.previousEventHash, events[0].hash);
  assert.equal(published.occurredAtIso, NOW);
  // Grammaire du seed v2 (décision a) : révision = séquence = nombre d'événements, statut racine = dernier événement de publication.
  assert.equal(events.length, root.revision);
  assert.equal(events.length, root.integritySequence);

  const approval = (await firestore.doc(`${ROOT}/publicationApprovals/${report.approvalId}`).get()).data();
  assert.equal(approval.status, 'consumed');
  assert.equal(approval.decisionSource, DEMO_DECISION_SOURCE);
  assert.equal(approval.approvedBy, UID);
  assert.equal(approval.audience, 'public');
  assert.equal(approval.consumedBy, PUBLICATION);
  const receipt = (await firestore.doc(`${ROOT}/commandReceipts/${report.requestId}`).get()).data();
  assert.equal(receipt.command, 'publishDemoWebsite');
  assert.equal(receipt.actorId, UID);
  assert.equal(receipt.result.contentHash, publication.contentHash);

  assert.equal(JSON.stringify((await firestore.doc(MEMBERSHIP).get()).data()), membershipBefore, 'adhésion intacte');
  assert.equal(JSON.stringify((await firestore.doc(`users/${UID}`).get()).data()), userBefore, 'compte intact');
  for (const other of DEMO_CARTULARIES.slice(1)) {
    assert.equal((await firestore.doc(`publications/${other.publicCode}`).get()).exists, false, `${other.publicCode} reste non publié (décision e)`);
    assert.equal((await firestore.doc(`cartularies/${other.id}`).get()).data().publicationStatus, 'none');
  }
});

test('parité de forme avec publishPublicBlocks : mêmes clés pour publications (sur-ensemble strict demo/demoDisclaimer), blocks, mediaAccess, seals, événement d’audit et approbation', async () => {
  const { firestore, bucket } = harness();
  const plan = await planDemoPublication({ firestore, bucket, cartularyId: ID });
  assert.equal(plan.ok, true);
  await applyDemoPublication({ firestore, bucket, plan, now: NOW });

  const OWNER = 'owner-fixture';
  const OWNER_ID = 'cart_owner_fixture_0001';
  const OWNER_CODE = 'OBJ-FIXTURE1';
  await firestore.doc(`cartularies/${OWNER_ID}`).set({ id: OWNER_ID, accountHolderId: OWNER, organizationId: 'org_fixture', registryId: 'reg_fixture', publicCode: OWNER_CODE, revision: 1, integritySequence: 0, assetType: 'watch', schemaId: 'watch', schemaVersion: '1.6.0', displayTitle: 'Objet', makerName: 'Maison', modelName: 'Modèle', referenceCode: 'REF-1', publicationStatus: 'none' });
  await firestore.doc(`organizations/org_fixture/memberships/${OWNER}`).set({ uid: OWNER, status: 'active', roles: ['legal_owner'], permissions: ['publication.manage'], scopes: { registryIds: ['reg_fixture'] } });
  const approvalBlocks = plan.projectedBlocks.map((entry) => ({ id: entry.blockId, title: entry.title, payload: entry.payload, assetRefs: entry.assets.map((asset) => ({ assetId: asset.assetId, derivativeId: asset.derivativeId })) }));
  for (const derivative of plan.derivatives) {
    await firestore.doc(`cartularies/${OWNER_ID}/assets/${derivative.assetId}/derivatives/${derivative.derivativeId}`).set({ assetId: derivative.assetId, derivativeId: derivative.derivativeId, publicCode: OWNER_CODE, visibility: 'public', processingState: 'ready', mediaKind: 'image', mimeDetected: 'image/webp', storagePath: `public/${OWNER_CODE}/${derivative.assetId}/${derivative.derivativeId}`, sha256: derivative.sha256 });
  }
  await firestore.doc(`cartularies/${OWNER_ID}/publicationApprovals/approval_fixture_0001`).set({ status: 'approved', audience: 'public', approvedBy: OWNER, sourceRevision: 1, blocks: approvalBlocks });
  const real = await publishPublicBlocks({ firestore, cartularyId: OWNER_ID, approvalId: 'approval_fixture_0001', actorId: OWNER, requestId: 'website_fixture_0001', expectedRevision: 1, occurredAt: NOW });
  assert.equal(real.replayed, false);

  const keys = async (path) => Object.keys((await firestore.doc(path).get()).data() ?? {}).sort();
  const realPublication = await keys(`publications/${OWNER_CODE}`);
  assert.deepEqual(await keys(PUBLICATION), [...realPublication, 'demo', 'demoDisclaimer'].sort());
  for (const block of plan.projectedBlocks) assert.deepEqual(await keys(`${PUBLICATION}/blocks/${block.blockId}`), await keys(`publications/${OWNER_CODE}/blocks/${block.blockId}`), block.blockId);
  for (const derivative of plan.derivatives) assert.deepEqual(await keys(`${PUBLICATION}/mediaAccess/${derivative.assetId}`), await keys(`publications/${OWNER_CODE}/mediaAccess/${derivative.assetId}`));
  assert.deepEqual(await keys(SEAL), await keys(`seals/${OWNER_CODE}`));
  const eventKeys = async (cartularyId) => (await firestore.doc(`cartularies/${cartularyId}`).collection('auditEvents').get()).docs.map((snapshot) => Object.keys(snapshot.data()).sort()).at(-1);
  assert.deepEqual(await eventKeys(ID), await eventKeys(OWNER_ID));
  const demoRoot = (await firestore.doc(ROOT).get()).data();
  const ownerRoot = (await firestore.doc(`cartularies/${OWNER_ID}`).get()).data();
  assert.equal(demoRoot.publicationStatus, ownerRoot.publicationStatus);
  assert.equal(ownerRoot.revision, 2);
  const receiptKeys = async (cartularyId, requestId) => keys(`cartularies/${cartularyId}/commandReceipts/${requestId}`);
  assert.deepEqual(await receiptKeys(ID, plan.requestId), await receiptKeys(OWNER_ID, 'website_fixture_0001'));
  const demoBlock = (await firestore.doc(`${PUBLICATION}/blocks/media-hero`).get()).data();
  const realBlock = (await firestore.doc(`publications/${OWNER_CODE}/blocks/media-hero`).get()).data();
  assert.deepEqual(demoBlock.payload, realBlock.payload);
  assert.deepEqual(demoBlock.assets.map((asset) => asset.derivativeId), realBlock.assets.map((asset) => asset.derivativeId));
});

test('idempotence et republication : seconde application → already_published sans écriture ; sélection réduite → nouvelle révision, anciens blocs, accès et copies publiques retirés', async () => {
  const { firestore, bucket, snapshot } = harness();
  const first = await captureCli({ argv: ['--cartulary', ID, '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(first.exitCode, 0, first.stderr);
  const after = snapshot();
  const replayPlan = await captureCli({ argv: ['--cartulary', ID], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(JSON.parse(replayPlan.stdout).alreadyPublished, true);
  assert.deepEqual(JSON.parse(replayPlan.stdout).writes, []);
  const replay = await captureCli({ argv: ['--cartulary', ID, '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).applied.status, 'already_published');
  assert.equal(snapshot(), after, 'aucune écriture au rejeu');

  const previousPaths = [...bucket.blobs.keys()];
  const reduced = await captureCli({ argv: ['--cartulary', ID, '--blocks', 'cover-watch,media-hero,condition-summary', '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket, now: LATER });
  assert.equal(reduced.exitCode, 0, reduced.stderr);
  const report = JSON.parse(reduced.stdout);
  assert.equal(report.applied.status, 'published');
  assert.equal(report.applied.revision, 3);
  assert.equal(report.publicationRevision, 2);
  assert.equal(report.requestId, `demo_publish_${ID}_3`);
  assert.deepEqual(report.stalePaths.sort(), previousPaths.sort());
  assert.deepEqual(report.applied.cleanedPaths.sort(), previousPaths.sort());
  const publication = (await firestore.doc(PUBLICATION).get()).data();
  assert.deepEqual(publication.blockIds, ['cover-watch', 'media-hero', 'condition-summary']);
  assert.equal(publication.publicationRevision, 2);
  assert.equal(publication.sourceRevision, 3);
  assert.equal(publication.assetCount, 1);
  assert.equal((await firestore.doc(`${PUBLICATION}/blocks/media-library`).get()).exists, false);
  assert.equal((await firestore.doc(`${PUBLICATION}/blocks/reference-specs`).get()).exists, false);
  assert.equal((await firestore.doc(PUBLICATION).collection('blocks').get()).size, 3);
  assert.equal((await firestore.doc(PUBLICATION).collection('mediaAccess').get()).size, 1);
  assert.equal(bucket.blobs.size, 1);
  assert.ok(previousPaths.every((path) => !bucket.blobs.has(path)), 'anciennes copies publiques supprimées');
  for (const path of previousPaths) {
    const [, , assetId, derivativeId] = path.split('/');
    assert.equal((await firestore.doc(`${ROOT}/assets/${assetId}/derivatives/${derivativeId}`).get()).data().processingState, 'revoked');
  }
  const { verification, events } = await chainOf(firestore);
  assert.equal(verification.valid, true);
  assert.deepEqual(events.map((event) => event.action), ['cartulary.demo.created', 'publication.published', 'publication.published']);
});

test('--revoke : publication et sceau revoked, blocs, accès et copies publiques supprimés, dérivés revoked, chaîne d’audit prolongée ; second retrait refusé ; republication possible', async () => {
  const { firestore, bucket, snapshot } = harness();
  await captureCli({ argv: ['--cartulary', ID, '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket });
  const paths = [...bucket.blobs.keys()];
  assert.equal(paths.length, 3);
  const simulate = await captureCli({ argv: ['--cartulary', ID, '--revoke'], env: EMULATOR_ENV, firestore, bucket });
  const simulation = JSON.parse(simulate.stdout);
  assert.equal(simulation.mode, 'revoke');
  assert.equal(simulation.dryRun, true);
  assert.deepEqual(simulation.previousPaths.sort(), paths.sort());
  assert.ok(paths.every((path) => simulation.writes.includes(path)));
  assert.equal(bucket.blobs.size, 3, 'la simulation de retrait ne supprime rien');

  const run = await captureCli({ argv: ['--cartulary', ID, '--revoke', '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket, now: LATER });
  assert.equal(run.exitCode, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.event, 'DEMO_PUBLICATION_REVOKED');
  assert.equal(report.applied.status, 'revoked');
  assert.equal(report.applied.revision, 3);
  assert.equal(report.applied.revokedBlockCount, 8);
  assert.deepEqual(report.applied.cleanedPaths.sort(), paths.sort());
  assert.equal(bucket.blobs.size, 0);
  const publication = (await firestore.doc(PUBLICATION).get()).data();
  assert.equal(publication.status, 'revoked');
  assert.equal(publication.publicationStatus, 'revoked');
  assert.deepEqual(publication.blockIds, []);
  assert.equal(publication.revokedAtIso, LATER);
  assert.equal(publication.demo, true);
  assert.equal((await firestore.doc(SEAL).get()).data().status, 'revoked');
  assert.equal((await firestore.doc(PUBLICATION).collection('blocks').get()).size, 0);
  assert.equal((await firestore.doc(PUBLICATION).collection('mediaAccess').get()).size, 0);
  for (const path of paths) {
    const [, , assetId, derivativeId] = path.split('/');
    assert.equal((await firestore.doc(`${ROOT}/assets/${assetId}/derivatives/${derivativeId}`).get()).data().processingState, 'revoked');
  }
  const { root, events, verification } = await chainOf(firestore);
  assert.equal(root.publicationStatus, 'revoked');
  assert.equal(root.revision, 3);
  assert.equal(verification.valid, true);
  assert.equal(events.at(-1).action, 'publication.revoked');
  assert.deepEqual(events.at(-1).actor, { uid: UID, role: 'demo_seed' });
  assert.equal(events.at(-1).requestId, `demo_revoke_${ID}_3`);

  const before = snapshot();
  const again = await captureCli({ argv: ['--cartulary', ID, '--revoke', '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(again.exitCode, 1);
  assert.ok(JSON.parse(again.stdout).blockers.some((entry) => entry.code === 'publication_not_active'));
  assert.equal(snapshot(), before);

  const republish = await captureCli({ argv: ['--cartulary', ID, '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(republish.exitCode, 0, republish.stderr);
  assert.equal(JSON.parse(republish.stdout).applied.status, 'published');
  assert.equal((await firestore.doc(PUBLICATION).get()).data().status, 'published');
  assert.equal((await firestore.doc(SEAL).get()).data().status, 'issued');
  assert.equal(bucket.blobs.size, 3);
  assert.equal((await chainOf(firestore)).verification.valid, true);
});

test('politique de texte public : un marqueur privé ou un bloc hors liste blanche bloque le plan avant toute écriture ; les textes démo réels sont déjà conformes', async () => {
  const { firestore, bucket, snapshot } = harness();
  const before = snapshot();
  const leaking = (input) => buildDemoWebsiteBlocks(input).map((block) => (block.id === 'condition-summary' ? { ...block, payload: { ...block.payload, paragraphs: ['Acheté auprès du propriétaire précédent.'] } } : block));
  const leak = await planDemoPublication({ firestore, bucket, cartularyId: ID, blockBuilder: leaking });
  assert.equal(leak.ok, false);
  assert.ok(leak.blockers.some((entry) => entry.code === 'secret_field_detected'));
  assert.equal(leak.derivatives.length, 0);
  const forbidden = await planDemoPublication({ firestore, bucket, cartularyId: ID, blockBuilder: (input) => [...buildDemoWebsiteBlocks(input), { id: 'value-market', title: 'Valeur', payload: { paragraphs: ['12 000 €'] }, assets: [], excludedTextCount: 0 }] });
  assert.ok(forbidden.blockers.some((entry) => entry.code === 'block_not_allowlisted'));
  const empty = await planDemoPublication({ firestore, bucket, cartularyId: ID, blockBuilder: () => [] });
  assert.ok(empty.blockers.some((entry) => entry.code === 'no_blocks' || entry.code === 'invalid_blocks'));
  assert.equal(snapshot(), before);
  for (const cartulary of DEMO_CARTULARIES) {
    const blocks = buildDemoWebsiteBlocks({ definition: cartulary });
    assert.equal(blocks.length, 8, cartulary.id);
    assert.ok(blocks.every((block) => block.payload.eyebrow === DEMO_EYEBROW));
    assert.ok(blocks.every((block) => block.assets.every((asset) => asset.type === 'image' && asset.visibility === 'Tous' && asset.url.startsWith(`/assets/demo-watches/${cartulary.mediaSlug}/`))));
    assert.ok(blocks.find((block) => block.id === 'media-hero').assets.length === 1);
    assert.ok(blocks.find((block) => block.id === 'media-library').assets.every((asset) => asset.tags.includes('main-photo') || !asset.tags.includes('spin-3d')), 'plateau tournant exclu de la bibliothèque');
  }
});

test('vidéo : --include-video sans outillage → video_tooling_missing ; avec outillage → fixture webm refusée ; media-motion sans le drapeau est retiré avec avertissement', async () => {
  const { firestore, bucket, snapshot } = harness();
  const before = snapshot();
  const missing = await captureCli({ argv: ['--cartulary', ID, '--include-video'], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(missing.exitCode, 1);
  assert.ok(JSON.parse(missing.stdout).blockers.some((entry) => entry.code === 'video_tooling_missing'));
  const unsupported = await captureCli({ argv: ['--cartulary', ID, '--include-video'], env: { ...EMULATOR_ENV, FFMPEG_PATH: '/opt/ffmpeg', FFPROBE_PATH: '/opt/ffprobe' }, firestore, bucket });
  assert.equal(unsupported.exitCode, 1);
  assert.ok(JSON.parse(unsupported.stdout).blockers.some((entry) => entry.code === 'video_source_unsupported'));
  const dropped = await captureCli({ argv: ['--cartulary', ID, '--blocks', 'media-hero,media-motion'], env: EMULATOR_ENV, firestore, bucket });
  assert.equal(dropped.exitCode, 0, dropped.stderr);
  const report = JSON.parse(dropped.stdout);
  assert.deepEqual(report.blocks.map((entry) => entry.id), ['media-hero']);
  assert.ok(report.warnings.some((entry) => entry.code === 'video_not_included'));
  assert.equal(snapshot(), before);
});

test('Storage absent : simulation possible avec avertissement, application refusée (storage_required) sans écriture Firestore', async () => {
  const { firestore, snapshot } = harness();
  const before = snapshot();
  const plan = await planDemoPublication({ firestore, bucket: null, cartularyId: ID });
  assert.equal(plan.ok, true);
  assert.equal(plan.storage.available, false);
  assert.ok(plan.warnings.some((entry) => entry.code === 'storage_unavailable'));
  await assert.rejects(applyDemoPublication({ firestore, bucket: null, plan, now: NOW }), { code: 'storage_required' });
  assert.equal(snapshot(), before);
  const cli = await captureCli({ argv: ['--cartulary', ID, '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore, bucket: null });
  assert.equal(cli.exitCode, 1);
  assert.equal(JSON.parse(cli.stderr).code, 'storage_required');
  assert.equal(snapshot(), before);
});

test('révision modifiée entre le plan et l’application : refus revision_conflict, copies publiques et dérivés déjà déposés retirés (rolled_back)', async () => {
  const { firestore, bucket, snapshot } = harness();
  const plan = await planDemoPublication({ firestore, bucket, cartularyId: ID });
  assert.equal(plan.ok, true);
  await firestore.doc(ROOT).update({ revision: 5 });
  const before = snapshot();
  await assert.rejects(applyDemoPublication({ firestore, bucket, plan, now: NOW }), (error) => {
    assert.equal(error.code, 'revision_conflict');
    assert.equal(error.rolledBack, true);
    assert.equal(error.rolledBackPaths.length, 3);
    return true;
  });
  assert.equal(bucket.blobs.size, 0);
  assert.ok(bucket.calls.some(([operation]) => operation === 'save') && bucket.calls.filter(([operation]) => operation === 'delete').length === 3);
  assert.equal((await firestore.doc(PUBLICATION).get()).exists, false);
  assert.equal((await firestore.doc(SEAL).get()).exists, false);
  assert.equal(snapshot(), before, 'dérivés retirés, racine et chaîne intactes');
  const cli = await captureCli({ argv: ['--cartulary', ID, '--apply', '--confirm-demo-publication'], env: EMULATOR_ENV, firestore: async () => { await firestore.doc(ROOT).update({ revision: 1 }); return firestore; }, bucket });
  assert.equal(cli.exitCode, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).applied.status, 'published');
});

test('dérivés : seules les images fixes des fixtures publiques de démonstration sont acceptées, chemins hors périmètre refusés', async () => {
  const [definition] = DEMO_CARTULARIES;
  const assets = buildDemoAssetDocuments(definition);
  const image = assets.find((asset) => asset.tags.includes('main-photo'));
  const derivative = await prepareDemoDerivative({ asset: { id: image.id, type: 'image', url: image.presentationDerivative.url }, publicCode: CODE, requestId: 'demo_publish_test_1' });
  assert.equal(detectTrustedFileFormat(derivative.bytes), 'webp');
  assert.equal(derivative.storagePath, `public/${CODE}/${image.id}/${derivative.derivativeId}`);
  assert.match(derivative.derivativeId, /^web_[0-9a-f]{24}$/);
  assert.equal(derivative.sha256, sha256Bytes(derivative.bytes));
  const other = await prepareDemoDerivative({ asset: { id: image.id, type: 'image', url: image.presentationDerivative.url }, publicCode: CODE, requestId: 'demo_publish_test_2' });
  assert.notEqual(other.derivativeId, derivative.derivativeId, 'identifiant lié à la demande');
  await assert.rejects(prepareDemoDerivative({ asset: { id: 'doc', type: 'document', url: '/assets/demo-watches/NOTICE_DEMO.txt' }, publicCode: CODE, requestId: 'r' }), { code: 'unsupported_demo_media' });
  await assert.rejects(prepareDemoDerivative({ asset: { id: 'ext', type: 'image', url: '/assets/demo-watches/../../index.html' }, publicCode: CODE, requestId: 'r' }), { code: 'fixture_out_of_scope' });
  await assert.rejects(prepareDemoDerivative({ asset: { id: 'ext', type: 'image', url: '/favicon.svg' }, publicCode: CODE, requestId: 'r' }), { code: 'fixture_out_of_scope' });
  await assert.rejects(prepareDemoDerivative({ asset: { id: 'txt', type: 'image', url: '/assets/demo-watches/NOTICE_DEMO.txt' }, publicCode: CODE, requestId: 'r' }), { code: 'fixture_format_unknown' });
});

test('garde statique : la commande ne modifie jamais users ni memberships, n’accorde aucun droit et signe demo_seed ; le wrapper diffère l’initialisation Firebase', () => {
  const sensitiveLines = commandSource.split('\n').filter((line) => /users\/|memberships\//.test(line));
  assert.ok(sensitiveLines.length >= 2);
  for (const line of sensitiveLines) assert.doesNotMatch(line, /\.(set|update|create|delete)\(/, line);
  assert.doesNotMatch(commandSource, /permissions:\s*\[/);
  assert.doesNotMatch(commandSource, /roles:\s*\[/);
  assert.doesNotMatch(commandSource, /FieldValue\.arrayUnion/);
  assert.match(commandSource, /DEMO_AUDIT_ROLE = 'demo_seed'/);
  assert.match(commandSource, /demo_account_privileged/);
  assert.doesNotMatch(commandSource, /firebase-admin\/app|initializeApp|applicationDefault/);
  assert.match(wrapperSource, /runDemoPublicationCli\(/);
  assert.match(wrapperSource, /firestore: \(context\) =>/);
  assert.match(wrapperSource, /bucket: \(context\) =>/);
  assert.match(wrapperSource, /applicationDefault\(\)/);
  assert.match(wrapperSource, /process\.exitCode = exitCode/);
});

test('wrapper : --help sans variable d’environnement sort 0 ; sans projet explicite sort 1 (project_required) avant toute initialisation', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const help = spawnSync(process.execPath, [wrapperPath, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--confirm-demo-publication/);
  const remote = spawnSync(process.execPath, [wrapperPath, '--cartulary', ID, '--allow-remote'], { env, encoding: 'utf8' });
  assert.equal(remote.status, 1);
  assert.equal(JSON.parse(remote.stderr.split('\n').find((line) => line.startsWith('{'))).code, 'project_required');
});
