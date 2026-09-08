import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildIwcImportBundle } from '../src/migrations/iwcImport.ts';
import { planSchemaUpgrade, upgradeCartularySchema, listCartulariesToUpgrade, plainJson } from '../scripts/lib/schema-upgrade-command.mjs';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const catalogUrl = new URL('../firebase/schema-catalog/', import.meta.url);
const artifact = (schemaId, version) => JSON.parse(readFileSync(new URL(`${schemaId}/${version}.json`, catalogUrl), 'utf8'));
const targetFrom = (schemaId, version, catalogDigest = `sha256:${'a'.repeat(64)}`) => {
  const schema = artifact(schemaId, version);
  return { schemaId, version, sectionIds: schema.sections, fieldSections: new Map(schema.fields.map((field) => [field.fieldId, field.sectionId])), catalogDigest };
};

test('la remontée IWC 1.3.0 → 1.6.0 ne perd aucune valeur : champs inconnus en extensions, sections retirées non cartographiées', () => {
  const bundle = buildIwcImportBundle();
  const plan = planSchemaUpgrade({ root: bundle.envelope, sections: bundle.sections, target: targetFrom('watch', '1.6.0'), source: targetFrom('watch', '1.3.0') });
  assert.equal(plan.changed, true);
  assert.deepEqual([plan.from, plan.to], ['1.3.0', '1.6.0']);
  assert.ok(plan.patches.every((section) => section.schemaVersion === 'watch@1.6.0'));
  const storage = plan.patches.find((section) => section.schemaSectionId === 'cover.storage');
  assert.equal(storage.status, 'imported_unmapped');
  assert.deepEqual(storage.fields, {});
  assert.ok(Object.keys(storage.extensions).some((key) => key.startsWith('cover.storage.locations[]')));
  assert.deepEqual(plan.orphanedSections, [storage.id]);
  assert.deepEqual(storage.retiredFromSchema, { version: '1.6.0', reason: 'section_removed' });
  const confidential = plan.patches.find((section) => section.schemaSectionId === 'watch.instance.private');
  assert.equal(confidential.status, 'imported_unmapped');
  assert.equal(confidential.retiredFromSchema, undefined, 'une section hors schéma depuis l’origine n’est pas retirée');
  const before = Object.fromEntries(bundle.sections.map((section) => [section.id, { ...(section.fields ?? {}), ...(section.extensions ?? {}) }]));
  const after = Object.fromEntries(plan.patches.map((section) => [section.id, { ...(section.fields ?? {}), ...(section.extensions ?? {}) }]));
  assert.deepEqual(after, before, 'toutes les valeurs sont conservées, en champs ou en extensions');
  const cover = plan.patches.find((section) => section.schemaSectionId === 'cover.watch');
  assert.ok(Object.keys(cover.fields).length > 0, 'les champs toujours connus restent des champs');
});

test('les horodatages Firestore des sections (Timestamp, Date) n’empêchent pas le plan : empreinte calculée sur une projection JSON simple, identique pour une section sans horodatage', () => {
  const target = { schemaId: 'watch', version: '1.6.0', sectionIds: ['identity'], fieldSections: new Map([['brand', 'identity']]), catalogDigest: 'sha256:catalogue' };
  const root = { id: 'cart_horodate', schemaId: 'watch', schemaVersion: '1.3.0' };
  const plain = [{ id: 'identity', schemaSectionId: 'identity', status: 'imported_unreviewed', fields: { brand: 'IWC' } }];
  const stamped = [{ ...plain[0], createdAt: Timestamp.fromDate(new Date('2026-08-29T10:00:00.000Z')), syncedAt: new Date('2026-09-05T11:20:02.588Z'), updatedAt: Timestamp.fromDate(new Date('2026-09-05T11:20:02.588Z')) }];
  const stampedPlan = planSchemaUpgrade({ root, sections: stamped, target });
  assert.match(stampedPlan.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(stampedPlan.patches[0].createdAt.toDate().toISOString(), '2026-08-29T10:00:00.000Z', 'la section écrite garde son horodatage d’origine');
  assert.equal('updatedAt' in stampedPlan.patches[0], false, 'updatedAt est reposé par le serveur');
  // L’empreinte ne dépend pas de la forme des horodatages, seulement de leur valeur ISO.
  const isoPlan = planSchemaUpgrade({ root, sections: [{ ...plain[0], createdAt: '2026-08-29T10:00:00.000Z', syncedAt: '2026-09-05T11:20:02.588Z' }], target });
  assert.equal(stampedPlan.digest, isoPlan.digest);
  assert.notEqual(stampedPlan.digest, planSchemaUpgrade({ root, sections: plain, target }).digest, 'un horodatage présent change l’empreinte');
  assert.deepEqual(plainJson({ a: [Timestamp.fromDate(new Date(0)), { b: new Date(0), c: 1, d: null }], e: 'x' }), { a: ['1970-01-01T00:00:00.000Z', { b: '1970-01-01T00:00:00.000Z', c: 1, d: null }], e: 'x' });
});

test('la remontée refuse une rétrogradation et un changement de verticale', () => {
  const bundle = buildIwcImportBundle();
  assert.throws(() => planSchemaUpgrade({ root: { ...bundle.envelope, schemaVersion: '1.6.0' }, sections: bundle.sections, target: targetFrom('watch', '1.5.0') }), /Remontée refusée/);
  assert.throws(() => planSchemaUpgrade({ root: bundle.envelope, sections: bundle.sections, target: targetFrom('car', '1.2.0') }), /relève de watch/);
});

const seedCatalog = (firestore, schemaId, version, { active = true } = {}) => {
  const schema = artifact(schemaId, version);
  const pointer = firestore.doc(`schemaCatalog/${schemaId}`);
  return Promise.all([
    pointer.set({ activeVersion: active ? version : null, latestVersion: version }),
    firestore.doc(`schemaCatalog/${schemaId}/versions/${version}`).set({ schemaId, version, status: active ? 'active' : 'baseline', sectionIds: schema.sections, catalogDigest: `sha256:${'b'.repeat(64)}` }),
    ...schema.fields.map((field) => firestore.doc(`schemaCatalog/${schemaId}/versions/${version}/sections/${field.sectionId}/fields/${field.fieldId}`).set({ fieldId: field.fieldId, sectionId: field.sectionId })),
  ]);
};

const seedFoundations = async (firestore, bundle) => {
  await firestore.doc(`organizations/${bundle.envelope.organizationId}`).set({ id: bundle.envelope.organizationId, status: 'active' });
  await firestore.doc(`registries/${bundle.envelope.registryId}`).set({ id: bundle.envelope.registryId, organizationId: bundle.envelope.organizationId, status: 'active', itemCount: 0 });
  await firestore.doc(`organizations/${bundle.envelope.organizationId}/memberships/${bundle.envelope.accountHolderId}`).set({ uid: bundle.envelope.accountHolderId, status: 'active', roles: ['legal_owner'], permissions: ['cartulary.create', 'cartulary.edit'], scopes: { registryIds: [bundle.envelope.registryId] } });
  await firestore.doc(`collections/${bundle.envelope.collectionId}`).set({ id: bundle.envelope.collectionId, registryId: bundle.envelope.registryId, organizationId: bundle.envelope.organizationId, status: 'active' });
  await firestore.doc(`registries/${bundle.envelope.registryId}/collections/${bundle.envelope.collectionId}`).set({ id: bundle.envelope.collectionId, registryId: bundle.envelope.registryId, organizationId: bundle.envelope.organizationId, status: 'active' });
};

test('la commande remonte un Cartulaire importé, incrémente la révision et prolonge la chaîne d’audit ; un second passage est sans effet', async () => {
  const firestore = createMemoryFirestore();
  const bundle = buildIwcImportBundle();
  await seedCatalog(firestore, 'watch', '1.3.0', { active: false });
  await seedFoundations(firestore, bundle);
  const imported = await importCartularyBundle({ firestore, bundle, requestId: 'test-import-iwc', actorId: bundle.envelope.accountHolderId, expectedRevision: 0, occurredAt: '2026-08-14T08:00:00.000Z' });
  assert.equal(imported.revision, 1);
  await seedCatalog(firestore, 'watch', '1.6.0');

  const result = await upgradeCartularySchema({ firestore, cartularyId: bundle.envelope.id, requestId: 'test-upgrade-1', occurredAt: '2026-09-08T10:00:00.000Z' });
  assert.equal(result.status, 'upgraded');
  assert.deepEqual([result.from, result.to, result.revision], ['1.3.0', '1.6.0', 2]);
  const root = (await firestore.doc(`cartularies/${bundle.envelope.id}`).get()).data();
  assert.equal(root.schemaVersion, '1.6.0');
  assert.equal(root.previousSchemaVersion, '1.3.0');
  assert.equal(root.schemaDigest, `sha256:${'b'.repeat(64)}`);
  assert.equal(root.integritySequence, 2);
  const sections = (await firestore.collection(`cartularies/${bundle.envelope.id}/sections`).get()).docs.map((document) => document.data());
  assert.ok(sections.length > 0 && sections.every((section) => section.schemaVersion === 'watch@1.6.0'));
  const events = (await firestore.collection(`cartularies/${bundle.envelope.id}/auditEvents`).get()).docs.map((document) => document.data());
  const chain = verifyAuditChain({ events, integrityHead: root.integrityHead, integritySequence: root.integritySequence });
  assert.deepEqual(chain.errors, []);
  assert.equal(events.find((event) => event.action === 'cartulary.schema.upgraded').resource.id, 'watch@1.6.0');

  const again = await upgradeCartularySchema({ firestore, cartularyId: bundle.envelope.id, requestId: 'test-upgrade-2' });
  assert.deepEqual(again, { cartularyId: bundle.envelope.id, status: 'ignored', reason: 'already_current', schemaVersion: '1.6.0' });
  assert.deepEqual(await listCartulariesToUpgrade({ firestore, schemaId: 'watch', targetVersion: '1.6.0' }), []);
});

test('le mode simulation ne modifie rien et liste les sections orphelines', async () => {
  const firestore = createMemoryFirestore();
  const bundle = buildIwcImportBundle();
  await seedCatalog(firestore, 'watch', '1.3.0', { active: false });
  await seedFoundations(firestore, bundle);
  await importCartularyBundle({ firestore, bundle, requestId: 'test-import-iwc', actorId: bundle.envelope.accountHolderId, expectedRevision: 0, occurredAt: '2026-08-14T08:00:00.000Z' });
  await seedCatalog(firestore, 'watch', '1.6.0');
  const before = firestore.dump();
  const planned = await upgradeCartularySchema({ firestore, cartularyId: bundle.envelope.id, requestId: 'dry', dryRun: true });
  assert.equal(planned.status, 'planned');
  assert.ok(planned.orphanedSections.length === 1);
  assert.deepEqual(firestore.dump(), before);
  assert.deepEqual(await listCartulariesToUpgrade({ firestore, schemaId: 'watch', targetVersion: '1.6.0' }), [{ cartularyId: bundle.envelope.id, schemaVersion: '1.3.0' }]);
});
