import { createHash } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { DEMO_ACCOUNT, DEMO_CARTULARIES, demoCartularyContentById } from '../src/data/demoCartularies.ts';
import {
  DEMO_ASSERTED_AT,
  buildDemoCartularyEnvelope,
  buildDemoCartularySections,
  buildDemoRegistryItem,
  buildDemoAssetDocuments,
} from '../src/data/demoCartularyDocuments.ts';
import { CANONICALIZATION_VERSION, sha256Digest } from './lib/canonical-json.mjs';
import { demoRepairOptions, runDemoDataRepair } from './lib/demo-data-repair.mjs';

const repairOptions = demoRepairOptions(process.argv.slice(2), process.env);
const projectId = repairOptions.projectId || 'cartularia-demo-local';
const usesEmulator = repairOptions.usesEmulator;
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error(
    'Seed démo interrompu : utilisez les émulateurs Auth + Firestore ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const auth = getAuth(app);
const firestore = getFirestore(app);

const registryEmail = `${createHash('sha256')
  .update(`registry-alias\u0000${DEMO_ACCOUNT.userName.toLocaleLowerCase('fr')}`)
  .digest('hex')}@registry.cartularia.invalid`;

if (repairOptions.dataOnly) {
  if (app.options.projectId !== projectId) throw new Error('Le projet Firebase initialisé ne correspond pas au projet explicitement demandé.');
  console.log(JSON.stringify(await runDemoDataRepair({
    firestore,
    readAuth: { getUserByEmail: (email) => auth.getUserByEmail(email) },
    registryEmail,
    options: repairOptions,
  }), null, 2));
} else {
let demoUser;
try {
  demoUser = await auth.getUserByEmail(registryEmail);
  demoUser = await auth.updateUser(demoUser.uid, {
    password: DEMO_ACCOUNT.password,
    displayName: DEMO_ACCOUNT.displayName,
    disabled: false,
    emailVerified: true,
  });
} catch (error) {
  if (error?.code !== 'auth/user-not-found') throw error;
  demoUser = await auth.createUser({
    email: registryEmail,
    password: DEMO_ACCOUNT.password,
    displayName: DEMO_ACCOUNT.displayName,
    disabled: false,
    emailVerified: true,
  });
}

const schemaSnapshot = await firestore.doc('schemaCatalog/watch/versions/1.6.0').get();
if (!schemaSnapshot.exists || !['active', 'baseline'].includes(schemaSnapshot.data().status)) {
  throw new Error('Le schéma watch@1.6.0 doit être publié avant le compte démo. Exécutez seed:foundations.');
}
const schemaDigest = schemaSnapshot.data().catalogDigest || null;
const now = FieldValue.serverTimestamp();
const batch = firestore.batch();

batch.set(firestore.doc(`users/${demoUser.uid}`), {
  uid: demoUser.uid,
  email: registryEmail,
  displayName: DEMO_ACCOUNT.displayName,
  status: 'active',
  modelVersion: '1.0.0',
  createdAt: now,
  updatedAt: now,
  lastActiveAt: now,
  inactiveAt: null,
  purgeAfter: null,
  accountPurpose: 'public_read_only_demo',
});
batch.set(firestore.doc(`organizations/${DEMO_ACCOUNT.organizationId}`), {
  id: DEMO_ACCOUNT.organizationId,
  name: 'Collection de démonstration Cartularia',
  status: 'active',
  modelVersion: '1.0.0',
  createdAt: now,
  updatedAt: now,
});
batch.set(firestore.doc(`organizations/${DEMO_ACCOUNT.organizationId}/memberships/${demoUser.uid}`), {
  uid: demoUser.uid,
  organizationId: DEMO_ACCOUNT.organizationId,
  roles: ['guest'],
  status: 'active',
  scopes: { registryIds: [DEMO_ACCOUNT.registryId] },
  permissions: [
    'organization.read',
    'membership.read',
    'registry.read',
    'access.read',
    'cartulary.read',
    'cartulary.export',
  ],
  createdAt: now,
  revokedAt: null,
  accountPurpose: 'public_read_only_demo',
});
batch.set(firestore.doc(`registries/${DEMO_ACCOUNT.registryId}`), {
  id: DEMO_ACCOUNT.registryId,
  organizationId: DEMO_ACCOUNT.organizationId,
  name: 'Registre de démonstration',
  description: 'Cinq Cartulaires horlogers fictifs pour découvrir Cartularia en lecture seule.',
  status: 'active',
  visibility: 'secret',
  itemCount: DEMO_CARTULARIES.length,
  modelVersion: '1.0.0',
  createdAt: now,
  updatedAt: now,
  accountPurpose: 'public_read_only_demo',
});
batch.set(firestore.doc(`registries/${DEMO_ACCOUNT.registryId}/collections/${DEMO_ACCOUNT.collectionId}`), {
  id: DEMO_ACCOUNT.collectionId,
  organizationId: DEMO_ACCOUNT.organizationId,
  registryId: DEMO_ACCOUNT.registryId,
  name: DEMO_ACCOUNT.collectionName,
  description: DEMO_ACCOUNT.collectionDescription,
  websiteTitle: DEMO_ACCOUNT.collectionName,
  websiteSlug: 'les-cinq-icones',
  status: 'draft',
  visibility: 'secret',
  publicationConsent: false,
  publishedCartularyIds: [],
  publishedAt: null,
  createdAt: now,
  updatedAt: now,
});

for (const cartulary of DEMO_CARTULARIES) {
  const demoContent = demoCartularyContentById(cartulary.id);
  if (!demoContent) throw new Error(`Historique de démonstration absent pour ${cartulary.id}.`);
  const sections = buildDemoCartularySections(cartulary);
  const contentDigest = sha256Digest({ cartulary, sections, schemaDigest });
  const eventId = `evt_demo_${createHash('sha256').update(cartulary.id).digest('hex').slice(0, 20)}`;
  const previousEventHash = `sha256:${'0'.repeat(64)}`;
  const event = {
    eventId,
    cartularyId: cartulary.id,
    sequence: 1,
    occurredAt: DEMO_ASSERTED_AT,
    actor: { uid: demoUser.uid, role: 'demo_seed' },
    action: 'cartulary.demo.created',
    resource: { type: 'cartulary', id: cartulary.id },
    beforeDigest: null,
    afterDigest: contentDigest,
    previousEventHash,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    requestId: `seed_demo_${cartulary.id}`,
  };
  const eventHash = sha256Digest({ previousEventHash, event });
  const envelope = {
    ...buildDemoCartularyEnvelope(cartulary, demoUser.uid, eventHash),
    integritySequence: 1,
    ...(schemaDigest ? { schemaDigest } : {}),
    createdAt: now,
    updatedAt: now,
    demo: true,
    demoDisclaimer: 'Exemplaire, documents, historique et valeurs fictifs.',
  };

  batch.set(firestore.doc(`cartularies/${cartulary.id}`), envelope);
  for (const asset of buildDemoAssetDocuments(cartulary)) {
    batch.set(firestore.doc(`cartularies/${cartulary.id}/assets/${asset.id}`), { ...asset, createdAt: now, updatedAt: now });
  }
  for (const section of sections) {
    batch.set(firestore.doc(`cartularies/${cartulary.id}/sections/${section.id}`), {
      ...section,
      createdAt: now,
      updatedAt: now,
    });
  }
  batch.set(firestore.doc(`cartularies/${cartulary.id}/sources/source_${cartulary.id}`), {
    id: `source_${cartulary.id}`,
    kind: 'project_document',
    label: cartulary.sourceLabel,
    locator: 'public_manufacturer_reference_and_fictional_demo_data',
    proofStatus: 'unverified',
    visibility: 'secret',
    createdAt: now,
    updatedAt: now,
  });
  batch.set(firestore.doc(`cartularies/${cartulary.id}/ownerRelations/owner_${cartulary.id}`), {
    id: `owner_${cartulary.id}`,
    cartularyId: cartulary.id,
    organizationId: DEMO_ACCOUNT.organizationId,
    userId: demoUser.uid,
    relationType: 'legal_owner',
    status: 'pending_evidence',
    validFrom: cartulary.purchaseDate,
    validUntil: null,
    proofStatus: 'unverified',
    sourceRefs: [`source_${cartulary.id}`],
    visibility: 'secret',
    createdAt: now,
    updatedAt: now,
  });
  for (const historicalValuation of demoContent.valuationHistory) {
    batch.set(firestore.doc(`cartularies/${cartulary.id}/valuations/${historicalValuation.id}`), {
      id: historicalValuation.id,
      cartularyId: cartulary.id,
      observedAt: `${historicalValuation.date}T00:00:00.000Z`,
      lowValue: historicalValuation.lowValue,
      midValue: historicalValuation.midValue,
      highValue: historicalValuation.highValue,
      currency: historicalValuation.currency,
      sourceLabel: historicalValuation.source,
      sourceRefs: [`source_${cartulary.id}`],
      proofStatus: 'unverified',
      confidence: 'low',
      visibility: 'secret',
      reviewStatus: 'pending_human_review',
      createdAt: now,
      updatedAt: now,
      demo: true,
    });
  }
  batch.set(firestore.doc(`cartularies/${cartulary.id}/auditEvents/${eventId}`), {
    ...event,
    occurredAt: Timestamp.fromDate(new Date(DEMO_ASSERTED_AT)),
    occurredAtIso: DEMO_ASSERTED_AT,
    hash: eventHash,
  });
  batch.set(firestore.doc(`registries/${DEMO_ACCOUNT.registryId}/items/${cartulary.id}`), {
    ...buildDemoRegistryItem(cartulary, contentDigest),
    generatedAt: now,
    updatedAt: now,
  });
}

await batch.commit();

console.log(JSON.stringify({
  projectId,
  account: DEMO_ACCOUNT.userName,
  uid: demoUser.uid,
  registryId: DEMO_ACCOUNT.registryId,
  cartularies: DEMO_CARTULARIES.map(({ id, brand, model, reference }) => ({ id, brand, model, reference })),
  permissions: 'read_only',
}, null, 2));
}
