import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  SCHEMA_CONTRACT_DIGEST_VERSION,
  schemaContractDigest,
  verifySchemaCatalog,
} from './lib/schema-catalog-files.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave1-local';
const usesEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulators && !allowRemote) {
  throw new Error(
    'Bootstrap interrompu : utilisez les émulateurs ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const app =
  getApps()[0] ||
  initializeApp({
    projectId,
    ...(usesEmulators ? {} : { credential: applicationDefault() }),
  });
const auth = getAuth(app);
const firestore = getFirestore(app);

const fixtures = {
  owner: {
    uid: 'wave1-owner',
    email: 'owner.wave1@cartularia.test',
    displayName: 'Propriétaire pilote',
  },
  outsider: {
    uid: 'wave1-outsider',
    email: 'outsider.wave1@cartularia.test',
    displayName: 'Compte isolation',
  },
  organization: { id: 'org_demo', name: 'Collection pilote Cartularia' },
  outsiderOrganization: { id: 'org_isolation', name: 'Organisation isolation' },
  registry: { id: 'reg_collection_privee', name: 'Registre privé pilote' },
  outsiderRegistry: { id: 'reg_isolation', name: 'Registre isolation' },
};

const ensureUser = async ({ uid, email, displayName }) => {
  try {
    await auth.getUser(uid);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid, email, displayName, emailVerified: true, password: 'Cartularia-Wave1-Local!' });
  }
};

await Promise.all([ensureUser(fixtures.owner), ensureUser(fixtures.outsider)]);

const now = FieldValue.serverTimestamp();
const batch = firestore.batch();

const set = (path, data) => batch.set(firestore.doc(path), data, { merge: true });
const create = (path, data) => batch.create(firestore.doc(path), data);

set(`users/${fixtures.owner.uid}`, {
  ...fixtures.owner,
  status: 'active',
  modelVersion: '1.0.0',
  createdAt: now,
  updatedAt: now,
});
set(`users/${fixtures.outsider.uid}`, {
  ...fixtures.outsider,
  status: 'active',
  modelVersion: '1.0.0',
  createdAt: now,
  updatedAt: now,
});

for (const organization of [fixtures.organization, fixtures.outsiderOrganization]) {
  set(`organizations/${organization.id}`, {
    ...organization,
    status: 'active',
    modelVersion: '1.0.0',
    createdAt: now,
    updatedAt: now,
  });
}

set(`organizations/${fixtures.organization.id}/memberships/${fixtures.owner.uid}`, {
  uid: fixtures.owner.uid,
  organizationId: fixtures.organization.id,
  roles: ['account_holder', 'legal_owner'],
  status: 'active',
  scopes: { registryIds: [fixtures.registry.id] },
  permissions: [
    'organization.read',
    'membership.read',
    'registry.read',
    'cartulary.read',
    'cartulary.edit',
    'cartulary.export',
    'integrity.batch',
    'publication.manage',
  ],
  createdAt: now,
  revokedAt: null,
});
set(`organizations/${fixtures.outsiderOrganization.id}/memberships/${fixtures.outsider.uid}`, {
  uid: fixtures.outsider.uid,
  organizationId: fixtures.outsiderOrganization.id,
  roles: ['account_holder'],
  status: 'active',
  scopes: { registryIds: [fixtures.outsiderRegistry.id] },
  permissions: ['organization.read', 'membership.read', 'registry.read'],
  createdAt: now,
  revokedAt: null,
});

set(`communityMemberships/${fixtures.owner.uid}`, {
  uid: fixtures.owner.uid,
  roles: ['member', 'moderator'],
  permissions: [
    'community.read',
    'community.post',
    'community.comment',
    'community.react',
    'community.moderate',
  ],
  status: 'active',
  admittedBy: 'bootstrap:wave5',
  admittedAt: now,
  revokedAt: null,
});
set(`communityProfiles/${fixtures.owner.uid}`, {
  uid: fixtures.owner.uid,
  pseudonym: 'HorlogerPilote',
  bio: 'Profil pseudonyme de démonstration pour la communauté Cartularia.',
  avatarAssetId: null,
  status: 'active',
  visibility: 'community',
  createdAt: now,
  updatedAt: now,
});

for (const [registry, organization] of [
  [fixtures.registry, fixtures.organization],
  [fixtures.outsiderRegistry, fixtures.outsiderOrganization],
]) {
  set(`registries/${registry.id}`, {
    ...registry,
    organizationId: organization.id,
    status: 'active',
    visibility: 'secret',
    itemCount: 0,
    modelVersion: '1.0.0',
    createdAt: now,
    updatedAt: now,
  });
}

const catalogArtifacts = verifySchemaCatalog(new URL('../firebase/schema-catalog/', import.meta.url));
const schemas = catalogArtifacts.map(({ schema, contractDigest }) => ({ schema, contractDigest }));

const readDeployedContract = async (versionRef, versionData) => {
  const sectionIds = Array.isArray(versionData.sectionIds) ? [...versionData.sectionIds].sort() : [];
  const fieldSnapshots = await Promise.all(sectionIds.map((sectionId) =>
    versionRef.collection('sections').doc(sectionId).collection('fields').get()));
  const fields = fieldSnapshots
    .flatMap((snapshot) => snapshot.docs.map((document) => document.data()))
    .sort((left, right) => left.fieldId.localeCompare(right.fieldId));
  return {
    schemaId: versionData.schemaId,
    assetType: versionData.assetType,
    version: versionData.version,
    defaultVisibility: versionData.defaultVisibility,
    fieldCount: versionData.fieldCount,
    sections: sectionIds,
    fields,
  };
};

for (const { schema, contractDigest } of schemas) {
  const versionPath = `schemaCatalog/${schema.schemaId}/versions/${schema.version}`;
  const versionRef = firestore.doc(versionPath);
  const deployedVersion = await versionRef.get();

  if (deployedVersion.exists) {
    const deployedContract = await readDeployedContract(versionRef, deployedVersion.data());
    const deployedDigest = schemaContractDigest(deployedContract);
    if (deployedDigest !== contractDigest) {
      throw new Error(
        `Refus de réécrire ${schema.schemaId}@${schema.version} dans Firestore : ` +
          `le contrat déployé ${deployedDigest} diffère du contrat publié ${contractDigest}.`,
      );
    }
    set(versionPath, {
      catalogDigest: contractDigest,
      contractDigestVersion: SCHEMA_CONTRACT_DIGEST_VERSION,
      verifiedAt: now,
    });
    continue;
  }

  create(versionPath, {
    schemaId: schema.schemaId,
    assetType: schema.assetType,
    version: schema.version,
    status: schema.status,
    defaultVisibility: schema.defaultVisibility,
    fieldCount: schema.fieldCount,
    sectionIds: schema.sections,
    communityFieldIds: schema.fields
      .filter((field) => field.publishableTo.includes('community'))
      .map((field) => field.fieldId),
    catalogDigest: contractDigest,
    contractDigestVersion: SCHEMA_CONTRACT_DIGEST_VERSION,
    source: `firebase/schema-catalog/${schema.schemaId}/${schema.version}.json`,
    publishedAt: now,
    verifiedAt: now,
  });

  for (const sectionId of schema.sections) {
    const sectionFields = schema.fields.filter((field) => field.sectionId === sectionId);
    create(`${versionPath}/sections/${sectionId}`, {
      sectionId,
      fieldCount: sectionFields.length,
      defaultVisibility: sectionFields.some((field) => field.defaultVisibility === 'secret') ? 'secret' : 'community',
    });
    for (const field of sectionFields) {
      create(`${versionPath}/sections/${sectionId}/fields/${field.fieldId}`, field);
    }
  }
}

const schemasById = Map.groupBy(schemas.map(({ schema }) => schema), (schema) => schema.schemaId);
for (const [schemaId, versions] of schemasById) {
  const activeVersions = versions.filter((schema) => schema.status === 'active');
  if (activeVersions.length > 1) {
    throw new Error(`Le catalogue ${schemaId} contient plusieurs versions actives : ${activeVersions.map(({ version }) => version).join(', ')}.`);
  }
  const latestSchema = activeVersions[0] ?? [...versions]
    .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }))
    .at(-1);
  set(`schemaCatalog/${schemaId}`, {
    assetType: latestSchema.assetType,
    latestVersion: latestSchema.version,
    activeVersion: activeVersions[0]?.version ?? null,
    status: 'active',
    updatedAt: now,
  });
}

await batch.commit();

console.log(
  `Fondations créées dans ${projectId}${usesEmulators ? ' (émulateurs)' : ' (distant explicitement autorisé)'} : ` +
    `2 comptes, 2 organisations, 2 memberships, 2 registres, ` +
    `1 admission communautaire pseudonyme, ` +
    `${schemas.map(({ schema }) => `${schema.schemaId}@${schema.version}`).join(', ')}.`,
);
